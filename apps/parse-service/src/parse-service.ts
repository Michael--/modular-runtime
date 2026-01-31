/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { BrokerClientManager } from '../../../packages/broker/src'
import {
  ParseServiceClient,
  ParseServiceServer,
  ParseServiceService,
  ParseEventsRequest,
  ParseEventsResponse,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { parseEvent } from './parse'

interface ParseConfig {
  host: string
  port: number
  brokerHost: string
  brokerPort: number
  registerWithBroker: boolean
}

const DEFAULT_CONFIG: ParseConfig = {
  host: '127.0.0.1',
  port: 6002,
  brokerHost: '127.0.0.1',
  brokerPort: 50051,
  registerWithBroker: true,
}

const usage = `Usage: parse-service [options]

Options:
  --host <host>          Bind host (default: ${DEFAULT_CONFIG.host})
  --port <port>          Bind port (default: ${DEFAULT_CONFIG.port})
  --broker-host <host>   Broker host (default: ${DEFAULT_CONFIG.brokerHost})
  --broker-port <port>   Broker port (default: ${DEFAULT_CONFIG.brokerPort})
  --no-broker            Disable broker registration
  -h, --help             Show this help message
`

const parseArgs = (argv: string[]): ParseConfig => {
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

const startParseServer = async (config: ParseConfig): Promise<grpc.Server> => {
  const parseService: ParseServiceServer = {
    parseEvents: (call) => {
      call.on('data', (request: ParseEventsRequest) => {
        if (!request.event) {
          return
        }
        const parsed = parseEvent(request.event)
        if (!parsed) {
          return
        }
        const response: ParseEventsResponse = { event: parsed }
        call.write(response)
      })

      call.on('end', () => {
        call.end()
      })
    },
  }

  const server = new grpc.Server()
  server.addService(ParseServiceService, parseService)

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

  console.log(`Parse service listening on ${config.host}:${config.port}`)

  if (config.registerWithBroker) {
    const brokerManager = BrokerClientManager.create(config.brokerHost, config.brokerPort)
    brokerManager.onConnected = () => {
      brokerManager.registerService(ParseServiceClient, config.host, config.port)
    }
  }

  return server
}

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2))
  await startParseServer(config)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  console.error('Use --help to see valid options.')
  process.exitCode = 1
})
