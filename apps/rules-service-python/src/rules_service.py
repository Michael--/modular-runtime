import argparse
import logging
import time
from concurrent import futures
from typing import Iterable

import grpc

from broker.v1 import broker_pb2
from broker.v1 import broker_pb2_grpc
from pipeline.v1 import pipeline_pb2
from pipeline.v1 import pipeline_pb2_grpc
from rules import apply_rules

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 6003
DEFAULT_BROKER = "127.0.0.1:50051"
SERVICE_NAME = "pipeline.v1.RulesService"
DEFAULT_ROLE = "default"


class ServiceMetrics:
    """Metrics collector for IPC vs Processing time breakdown"""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.events_processed = 0
        self.processing_time_ms = 0.0
        self.ipc_send_time_ms = 0.0
        self.ipc_recv_time_ms = 0.0

    def record_recv(self, duration_ms: float) -> None:
        self.ipc_recv_time_ms += duration_ms

    def record_processing(self, duration_ms: float) -> None:
        self.record_processing_count(duration_ms, 1)

    def record_processing_count(self, duration_ms: float, count: int) -> None:
        self.processing_time_ms += duration_ms
        self.events_processed += count

    def record_send(self, duration_ms: float) -> None:
        self.ipc_send_time_ms += duration_ms

    def print_summary(self) -> None:
        total = self.processing_time_ms + self.ipc_send_time_ms + self.ipc_recv_time_ms
        if total == 0:
            return

        print(f"\n=== {self.service_name} Metrics ===", flush=True)
        print(f"Events processed: {self.events_processed}", flush=True)
        print(f"Processing time: {self.processing_time_ms:.2f}ms ({(self.processing_time_ms / total) * 100:.1f}%)", flush=True)
        print(f"IPC Send time: {self.ipc_send_time_ms:.2f}ms ({(self.ipc_send_time_ms / total) * 100:.1f}%)", flush=True)
        print(f"IPC Recv time: {self.ipc_recv_time_ms:.2f}ms ({(self.ipc_recv_time_ms / total) * 100:.1f}%)", flush=True)
        print("Avg per event:", flush=True)
        print(f"  Processing: {self.processing_time_ms / self.events_processed:.4f}ms", flush=True)
        print(f"  IPC Send: {self.ipc_send_time_ms / self.events_processed:.4f}ms", flush=True)
        print(f"  IPC Recv: {self.ipc_recv_time_ms / self.events_processed:.4f}ms", flush=True)


class RulesService(pipeline_pb2_grpc.RulesServiceServicer):
    def __init__(self):
        super().__init__()
        self.metrics = ServiceMetrics("rules-service")

    def ApplyRules(
        self, request_iterator: Iterable[pipeline_pb2.ApplyRulesRequest], context: grpc.ServicerContext
    ) -> Iterable[pipeline_pb2.ApplyRulesResponse]:
        for request in request_iterator:
            recv_start = time.perf_counter()
            if not request.event:
                continue
            self.metrics.record_recv((time.perf_counter() - recv_start) * 1000)

            process_start = time.perf_counter()
            enriched = apply_rules(request.event)
            self.metrics.record_processing((time.perf_counter() - process_start) * 1000)

            if enriched is None:
                continue

            send_start = time.perf_counter()
            response = pipeline_pb2.ApplyRulesResponse(event=enriched)
            self.metrics.record_send((time.perf_counter() - send_start) * 1000)
            yield response

        self.metrics.print_summary()

    def ApplyRulesBatch(
        self, request_iterator: Iterable[pipeline_pb2.ApplyRulesBatchRequest], context: grpc.ServicerContext
    ) -> Iterable[pipeline_pb2.ApplyRulesBatchResponse]:
        for request in request_iterator:
            recv_start = time.perf_counter()
            if not request.events:
                continue
            self.metrics.record_recv((time.perf_counter() - recv_start) * 1000)

            process_start = time.perf_counter()
            enriched_events = []
            for event in request.events:
                enriched = apply_rules(event)
                if enriched is not None:
                    enriched_events.append(enriched)
            self.metrics.record_processing_count(
                (time.perf_counter() - process_start) * 1000, len(request.events)
            )

            if not enriched_events:
                continue

            send_start = time.perf_counter()
            response = pipeline_pb2.ApplyRulesBatchResponse(events=enriched_events)
            self.metrics.record_send((time.perf_counter() - send_start) * 1000)
            yield response

        self.metrics.print_summary()


def register_with_broker(host: str, port: int, broker_address: str) -> None:
    channel = grpc.insecure_channel(broker_address)
    broker = broker_pb2_grpc.BrokerServiceStub(channel)
    request = broker_pb2.RegisterServiceRequest(
        info=broker_pb2.ServiceInfo(interface_name=SERVICE_NAME, role=DEFAULT_ROLE),
        url=host,
        port=port,
    )
    broker.RegisterService(request)


def serve(host: str, port: int, broker_address: str, register: bool) -> None:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    pipeline_pb2_grpc.add_RulesServiceServicer_to_server(RulesService(), server)
    server.add_insecure_port(f"{host}:{port}")
    server.start()

    logging.info("Rules service listening on %s:%s", host, port)

    if register:
        try:
            register_with_broker(host, port, broker_address)
        except Exception as exc:  # pylint: disable=broad-except
            logging.error("Failed to register with broker: %s", exc)

    server.wait_for_termination()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rules service")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--broker", default=DEFAULT_BROKER)
    parser.add_argument("--no-broker", action="store_true")
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args()
    serve(args.host, args.port, args.broker, not args.no_broker)


if __name__ == "__main__":
    main()
