/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { BrokerClientManager } from '../../../packages/broker/src'
import {
  ParseServiceClient,
  ParseServiceServer,
  ParseServiceService,
  ParseEventsRequest,
  ParseEventsResponse,
  ParseEventsBatchRequest,
  ParseEventsBatchResponse,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { parseEvent } from './parse'
import { processWorkItem } from './workitem-processor'

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

        // Check if this is a WorkItem
        try {
          const data = JSON.parse(request.event.rawJson)
          if (data.id && data.vectors && data.matrix) {
            // This is a WorkItem - process it
            const processedItem = processWorkItem(data)
            const response: ParseEventsResponse = {
              event: {
                type: 'work-item',
                user: JSON.stringify(processedItem),
                value: '0',
                timestamp: String(Date.now()),
                sequence: request.event.sequence,
              },
            }
            call.write(response)
            return
          }
        } catch {
          // Not a WorkItem, fall through to normal event parsing
        }

        // Normal event parsing
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
    parseEventsBatch: (call) => {
      call.on('data', (request: ParseEventsBatchRequest) => {
        if (!request.events || request.events.length === 0) {
          return
        }

        const parsedEvents = request.events
          .map((event) => {
            // Check if this is a WorkItem
            try {
              const data = JSON.parse(event.rawJson)
              if (data.id && data.vectors && data.matrix) {
                // Process WorkItem
                const processedItem = processWorkItem(data)
                return {
                  type: 'work-item',
                  user: JSON.stringify(processedItem),
                  value: '0',
                  timestamp: String(Date.now()),
                  sequence: event.sequence,
                }
              }
            } catch {
              // Not a WorkItem, fall through to normal parsing
            }

            // Normal event parsing
            return parseEvent(event)
          })
          .filter((e) => e !== null)

        if (parsedEvents.length > 0) {
          const response: ParseEventsBatchResponse = { events: parsedEvents }
          call.write(response)
        }
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
