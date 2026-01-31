import { MetricsCollector } from '@modular-runtime/pipeline-common'
import { IngestServiceClient } from '@modular-runtime/proto/pipeline/v1/ingest_service_pb.client'
import { IngestRequest } from '@modular-runtime/proto/pipeline/v1/ingest_service_pb'
import type { EventRecord } from '@modular-runtime/pipeline-common'

/**
 * Example: Instrumented ingest service
 *
 * Shows how to measure:
 * - Processing time (JSON parse + transform)
 * - IPC send time (proto serialization + gRPC send)
 * - IPC recv time (tracked at request handler entry)
 */

export async function runIngestServiceWithMetrics(
  events: EventRecord[],
  targetHost: string,
  targetPort: number
): Promise<void> {
  const metrics = new MetricsCollector('ingest-service')
  const client = new IngestServiceClient(
    `${targetHost}:${targetPort}`,
    // @ts-expect-error - grpc credentials
    grpc.credentials.createInsecure()
  )

  const stream = client.ingest()

  for (const event of events) {
    // Measure processing (transform to protobuf)
    const request = metrics.recordProcessing(() => {
      const req = new IngestRequest()
      req.id = event.id
      req.eventType = event.event_type
      req.timestamp = event.timestamp
      req.userId = event.user_id
      req.data = JSON.stringify(event.data)
      return req
    })

    // Measure IPC send (serialization + network)
    await metrics.recordSend(() => stream.write(request))
  }

  await stream.end()

  // Print metrics
  metrics.printSummary()

  // Return metrics for aggregation
  return metrics.getMetrics()
}

/**
 * Example: Service handler with IPC recv tracking
 */
export class IngestServiceHandler {
  private metrics = new MetricsCollector('ingest-service')

  async handleIngest(call: ServerWritableStream<IngestRequest, IngestResponse>) {
    for await (const request of call) {
      // Track IPC receive time
      const recvStart = this.metrics.recordRecvStart()

      // Parse the incoming message (already done by gRPC, but we measure the handler entry)
      this.metrics.recordRecvEnd(recvStart)

      // Measure processing
      const response = this.metrics.recordProcessing(() => {
        // Business logic: parse, validate, transform
        const event = {
          id: request.id,
          event_type: request.eventType,
          timestamp: request.timestamp,
          user_id: request.userId,
          data: JSON.parse(request.data),
        }

        // Create response
        const resp = new IngestResponse()
        resp.success = true
        return resp
      })

      // Measure IPC send
      this.metrics.recordSend(() => call.write(response))
    }

    // Print metrics at end
    this.metrics.printSummary()
  }

  getMetrics() {
    return this.metrics.getMetrics()
  }
}
