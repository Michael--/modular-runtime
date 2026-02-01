/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { createReadStream } from 'node:fs'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { BrokerClientManager } from '../../../packages/broker/src'
import { MetricsCollector } from '@modular-runtime/pipeline-common'
import {
  GetStatusRequest,
  GetStatusResponse,
  IngestServiceClient,
  IngestServiceServer,
  IngestServiceService,
  StreamEventsRequest,
  StreamEventsResponse,
  WorkloadMode,
  PayloadSize,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { generateWorkItem } from './workitem-generator'

interface IngestConfig {
  host: string
  port: number
  brokerHost: string
  brokerPort: number
  registerWithBroker: boolean
  defaultInputFile: string
}

const DEFAULT_CONFIG: IngestConfig = {
  host: '127.0.0.1',
  port: 6001,
  brokerHost: '127.0.0.1',
  brokerPort: 50051,
  registerWithBroker: true,
  defaultInputFile: 'events.ndjson',
}

const usage = `Usage: ingest-service [options]

Options:
  --host <host>          Bind host (default: ${DEFAULT_CONFIG.host})
  --port <port>          Bind port (default: ${DEFAULT_CONFIG.port})
  --input <file>         Default input file (default: ${DEFAULT_CONFIG.defaultInputFile})
  --broker-host <host>   Broker host (default: ${DEFAULT_CONFIG.brokerHost})
  --broker-port <port>   Broker port (default: ${DEFAULT_CONFIG.brokerPort})
  --no-broker            Disable broker registration
  -h, --help             Show this help message
`

const parseArgs = (argv: string[]): IngestConfig => {
  const config = { ...DEFAULT_CONFIG }

  const getValue = (index: number): string => {
    const value = argv[index]
    if (value == null) {
      throw new Error('Missing value for argument')
    }
    return value
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    }

    if (arg === '--host') {
      config.host = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--port') {
      config.port = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--input') {
      config.defaultInputFile = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--broker-host') {
      config.brokerHost = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--broker-port') {
      config.brokerPort = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--no-broker') {
      config.registerWithBroker = false
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return config
}

const createServiceError = (message: string, code: grpc.status): grpc.ServiceError => {
  const error = new Error(message) as grpc.ServiceError
  error.code = code
  return error
}

const parseMaxEvents = (value: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return Math.trunc(parsed)
}

const writeWithBackpressure = async (
  stream: grpc.ServerWritableStream<StreamEventsRequest, StreamEventsResponse>,
  message: StreamEventsResponse
): Promise<void> => {
  if (!stream.write(message)) {
    await once(stream, 'drain')
  }
}

const startIngestServer = async (config: IngestConfig): Promise<grpc.Server> => {
  let streamedEvents = 0
  const metrics = new MetricsCollector('ingest-service')

  const ingestService: IngestServiceServer = {
    streamEvents: (call) => {
      const recvStart = metrics.recordRecvStart()
      const request = call.request
      metrics.recordRecvEnd(recvStart)

      const inputFile = request.inputFile.length > 0 ? request.inputFile : config.defaultInputFile
      const maxEvents = parseMaxEvents(request.maxEvents)
      const enableBatching = request.enableBatching ?? false
      const batchSize = request.batchSize > 0 ? request.batchSize : 100
      const workloadMode = request.workloadMode ?? WorkloadMode.EVENTS
      const workloadConfig = request.workloadConfig ?? {
        workRatio: 0,
        payloadSize: PayloadSize.MEDIUM,
        computeIterations: 500,
      }

      console.log(
        `[ingest] WorkloadMode: ${workloadMode} (EVENTS=${WorkloadMode.EVENTS}, WORK_ITEMS=${WorkloadMode.WORK_ITEMS})`
      )

      let cancelled = false

      call.on('cancelled', () => {
        cancelled = true
      })

      const run = async () => {
        try {
          // WORK_ITEMS mode: generate WorkItems instead of reading file
          if (workloadMode === WorkloadMode.WORK_ITEMS) {
            let sequence = 0
            const totalItems = maxEvents

            while (sequence < totalItems && !cancelled) {
              const workItem = metrics.recordProcessing(() =>
                generateWorkItem(`w-${String(sequence).padStart(6, '0')}`, workloadConfig)
              )

              const response: StreamEventsResponse = {
                event: {
                  rawJson: JSON.stringify(workItem),
                  sequence: String(sequence),
                },
              }

              await metrics.recordSend(() => writeWithBackpressure(call, response))
              streamedEvents += 1
              sequence += 1
            }

            call.end()
            metrics.printSummary()
            return
          }

          // EVENTS mode (default): read from file
          const input = createReadStream(inputFile)
          const reader = createInterface({ input })
          let sequence = 0
          let batch: StreamEventsResponse[] = []
          let batchStart = Date.now()

          for await (const line of reader) {
            if (cancelled) {
              reader.close()
              break
            }
            if (sequence >= maxEvents) {
              reader.close()
              break
            }

            const response = metrics.recordProcessing(() => ({
              event: {
                rawJson: line,
                sequence: String(sequence),
              },
            }))

            if (enableBatching) {
              // Collect into batch
              batch.push(response)

              const shouldFlush = batch.length >= batchSize || Date.now() - batchStart > 10

              if (shouldFlush) {
                // Send all events in batch
                for (const msg of batch) {
                  await metrics.recordSend(() => writeWithBackpressure(call, msg))
                  streamedEvents += 1
                }
                batch = []
                batchStart = Date.now()
              }
            } else {
              // Send immediately (original behavior)
              await metrics.recordSend(() => writeWithBackpressure(call, response))
              streamedEvents += 1
            }

            sequence += 1
          }

          // Flush remaining batch
          if (enableBatching && batch.length > 0) {
            for (const msg of batch) {
              await metrics.recordSend(() => writeWithBackpressure(call, msg))
              streamedEvents += 1
            }
          }

          call.end()
          metrics.printSummary()
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          call.destroy(createServiceError(message, grpc.status.INTERNAL))
        }
      }

      void run()
    },
    getStatus: (
      _call: grpc.ServerUnaryCall<GetStatusRequest, GetStatusResponse>,
      callback: grpc.sendUnaryData<GetStatusResponse>
    ) => {
      callback(null, {
        status: {
          queuedEvents: '0',
          streamedEvents: String(streamedEvents),
          healthy: true,
        },
      })
    },
  }

  const server = new grpc.Server()
  server.addService(IngestServiceService, ingestService)

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `${config.host}:${config.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      }
    )
  })

  console.log(`Ingest service listening on ${config.host}:${config.port}`)

  if (config.registerWithBroker) {
    const brokerManager = BrokerClientManager.create(config.brokerHost, config.brokerPort)
    brokerManager.onConnected = () => {
      brokerManager.registerService(IngestServiceClient, config.host, config.port)
    }
  }

  return server
}

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2))
  await startIngestServer(config)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  console.error('Use --help to see valid options.')
  process.exitCode = 1
})
