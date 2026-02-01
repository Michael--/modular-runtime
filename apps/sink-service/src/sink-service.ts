/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { BrokerClientManager } from '../../../packages/broker/src'
import { MetricsCollector } from '@modular-runtime/pipeline-common'
import {
  SinkServiceClient,
  SinkServiceServer,
  SinkServiceService,
  WriteResultsRequest,
  WriteResultsResponse,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'

interface SinkConfig {
  host: string
  port: number
  brokerHost: string
  brokerPort: number
  registerWithBroker: boolean
  outputFile: string
}

const DEFAULT_CONFIG: SinkConfig = {
  host: '127.0.0.1',
  port: 6005,
  brokerHost: '127.0.0.1',
  brokerPort: 50051,
  registerWithBroker: true,
  outputFile: 'aggregate-results.ndjson',
}

const usage = `Usage: sink-service [options]

Options:
  --host <host>          Bind host (default: ${DEFAULT_CONFIG.host})
  --port <port>          Bind port (default: ${DEFAULT_CONFIG.port})
  --output <file>        Output NDJSON file (default: ${DEFAULT_CONFIG.outputFile})
  --broker-host <host>   Broker host (default: ${DEFAULT_CONFIG.brokerHost})
  --broker-port <port>   Broker port (default: ${DEFAULT_CONFIG.brokerPort})
  --no-broker            Disable broker registration
  -h, --help             Show this help message
`

const parseArgs = (argv: string[]): SinkConfig => {
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

    if (arg === '--output') {
      config.outputFile = getValue(i + 1)
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

const formatResult = (result: NonNullable<WriteResultsRequest['result']>): string => {
  // Check if this is a WorkItemResult by looking for workItemId
  if (result.key.startsWith('w-')) {
    // WorkItem result - include all fields
    return JSON.stringify({
      workItemId: result.key,
      vectorChecksum: result.sum,
      finalScore: result.avg,
      timestamp: Math.floor(result.count / 1000), // Reused count as timestamp
    })
  }
  // Regular event result
  return `{"key":"${result.key}","count":${result.count},"sum":${result.sum},"avg":${result.avg}}`
}

const writeWithBackpressure = async (
  stream: NodeJS.WritableStream,
  line: string
): Promise<void> => {
  if (!stream.write(line)) {
    await once(stream, 'drain')
  }
}

const startSinkServer = async (config: SinkConfig): Promise<grpc.Server> => {
  const metrics = new MetricsCollector('sink-service')

  const sinkService: SinkServiceServer = {
    writeResults: (call, callback) => {
      const output = createWriteStream(config.outputFile, { encoding: 'utf8' })
      let written = 0
      let writeChain = Promise.resolve()

      call.on('data', (request: WriteResultsRequest) => {
        const recvStart = metrics.recordRecvStart()
        metrics.recordRecvEnd(recvStart)

        if (!request.result) {
          return
        }
        const line = metrics.recordProcessing(() => `${formatResult(request.result!)}\n`)
        written += 1
        writeChain = writeChain.then(() =>
          metrics.recordSend(() => writeWithBackpressure(output, line))
        )
      })

      call.on('end', () => {
        writeChain
          .then(() => new Promise<void>((resolve) => output.end(() => resolve())))
          .then(() => {
            metrics.printSummary()
            const response: WriteResultsResponse = { written: String(written) }
            callback(null, response)
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            callback(new Error(message))
          })
      })
    },
  }

  const server = new grpc.Server()
  server.addService(SinkServiceService, sinkService)

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

  console.log(`Sink service listening on ${config.host}:${config.port}`)

  if (config.registerWithBroker) {
    const brokerManager = BrokerClientManager.create(config.brokerHost, config.brokerPort)
    brokerManager.onConnected = () => {
      brokerManager.registerService(SinkServiceClient, config.host, config.port)
    }
  }

  return server
}

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2))
  await startSinkServer(config)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  console.error('Use --help to see valid options.')
  process.exitCode = 1
})
