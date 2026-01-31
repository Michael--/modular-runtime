import argparse
import logging
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


class RulesService(pipeline_pb2_grpc.RulesServiceServicer):
    def ApplyRules(
        self, request_iterator: Iterable[pipeline_pb2.ApplyRulesRequest], context: grpc.ServicerContext
    ) -> Iterable[pipeline_pb2.ApplyRulesResponse]:
        for request in request_iterator:
            if not request.event:
                continue
            enriched = apply_rules(request.event)
            if enriched is None:
                continue
            yield pipeline_pb2.ApplyRulesResponse(event=enriched)


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
