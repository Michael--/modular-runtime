import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentials, type ClientReadableStream, type ServerWritableStream } from '@grpc/grpc-js'
import {
  IngestServiceClient,
  type StreamEventsRequest,
  type StreamEventsResponse,
  WorkloadMode,
  PayloadSize,
} from '@modular-runtime/proto/pipeline/v1/pipeline'
import { MetricsCollector, type ServiceMetrics } from './metrics.js'
import type { EventRecord } from './types.js'

/**
 * Example: Instrumented ingest stream consumer.
 * Shows how to measure processing, IPC send, and IPC receive times.
 * @param events Events to serialize to a temporary NDJSON file.
 * @param targetHost Hostname or IP of the ingest service.
 * @param targetPort Port of the ingest service.
 * @returns Collected service metrics.
 * @throws When the ingest stream fails or the temp file cannot be written.
 */
export async function runIngestServiceWithMetrics(
  events: EventRecord[],
  targetHost: string,
  targetPort: number
): Promise<ServiceMetrics> {
  const metrics = new MetricsCollector('ingest-service')
  const tempFile = join(tmpdir(), `ingest-events-${randomUUID()}.ndjson`)
  const payload = events.map((event) => JSON.stringify(event)).join('\n')
  await writeFile(tempFile, payload.length > 0 ? `${payload}\n` : '')

  try {
    const client = new IngestServiceClient(
      `${targetHost}:${targetPort}`,
      credentials.createInsecure()
    )

    const request: StreamEventsRequest = {
      inputFile: tempFile,
      batchSize: 1,
      maxEvents: String(events.length),
      enableBatching: false,
      workloadMode: WorkloadMode.EVENTS,
      workloadConfig: {
        workRatio: 0,
        payloadSize: PayloadSize.MEDIUM,
        computeIterations: 0,
      },
    }

    const stream = metrics.recordSend(() => client.streamEvents(request))
    await consumeStream(stream, metrics)

    metrics.printSummary()
    return metrics.getMetrics()
  } finally {
    await rm(tempFile, { force: true })
  }
}

/**
 * Example: Service handler with IPC recv tracking
 */
export class IngestServiceHandler {
  private metrics = new MetricsCollector('ingest-service')

  /**
   * Handles a StreamEvents request and records IPC/processing timing.
   * @param call Stream request/response wrapper.
   * @returns A promise that resolves once the response stream is closed.
   */
  async handleIngest(
    call: ServerWritableStream<StreamEventsRequest, StreamEventsResponse>
  ): Promise<void> {
    const recvStart = this.metrics.recordRecvStart()
    this.metrics.recordRecvEnd(recvStart)

    const response = this.metrics.recordProcessing<StreamEventsResponse>(() => ({
      event: {
        rawJson: JSON.stringify({ inputFile: call.request.inputFile }),
        sequence: '0',
      },
    }))

    this.metrics.recordSend(() => call.write(response))
    call.end()
    this.metrics.printSummary()
  }

  /**
   * Returns the current metrics snapshot.
   * @returns Metrics collected so far.
   */
  getMetrics(): ServiceMetrics {
    return this.metrics.getMetrics()
  }
}

const consumeStream = (
  stream: ClientReadableStream<StreamEventsResponse>,
  metrics: MetricsCollector
): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.on('data', (response: StreamEventsResponse) => {
      const recvStart = metrics.recordRecvStart()
      metrics.recordRecvEnd(recvStart)
      if (!response.event?.rawJson) {
        return
      }
      metrics.recordProcessing(() => {
        JSON.parse(response.event?.rawJson ?? '{}')
      })
    })
    stream.on('end', resolve)
    stream.on('error', reject)
  })
