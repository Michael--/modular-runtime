/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { BrokerClientManager } from '../../../packages/broker/src'
import {
  AggregateRequest,
  AggregateResponse,
  AggregateBatchRequest,
  AggregateServiceClient,
  AggregateServiceServer,
  AggregateServiceService,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { createAggregator } from './aggregate'
import { processEnrichedWorkItem } from './workitem-processor'

interface AggregateConfig {
  host: string
  port: number
  brokerHost: string
  brokerPort: number
  registerWithBroker: boolean
}

const DEFAULT_CONFIG: AggregateConfig = {
  host: '127.0.0.1',
  port: 6004,
  brokerHost: '127.0.0.1',
  brokerPort: 50051,
  registerWithBroker: true,
}

const usage = `Usage: aggregate-service [options]

Options:
  --host <host>          Bind host (default: ${DEFAULT_CONFIG.host})
  --port <port>          Bind port (default: ${DEFAULT_CONFIG.port})
  --broker-host <host>   Broker host (default: ${DEFAULT_CONFIG.brokerHost})
  --broker-port <port>   Broker port (default: ${DEFAULT_CONFIG.brokerPort})
  --no-broker            Disable broker registration
  -h, --help             Show this help message
`

const parseArgs = (argv: string[]): AggregateConfig => {
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

const startAggregateServer = async (config: AggregateConfig): Promise<grpc.Server> => {
  const aggregateService: AggregateServiceServer = {
    aggregate: (call) => {
      const aggregator = createAggregator()
      const workItemResults: any[] = []

      call.on('data', (request: AggregateRequest) => {
        if (!request.event) {
          return
        }

        // Handle WorkItems
        if (request.event.event?.type === 'work-item') {
          try {
            const enrichedJSON = request.event.event.user
            const result = processEnrichedWorkItem(enrichedJSON)
            workItemResults.push(result)
            return
          } catch (error) {
            console.warn('Failed to process WorkItem:', error)
            return
          }
        }

        aggregator.add(request.event)
      })

      call.on('end', () => {
        const results = aggregator.results()
        results.forEach((result) => {
          const response: AggregateResponse = { result }
          call.write(response)
        })

        // Send WorkItem results as individual results
        workItemResults.forEach((item) => {
          const workItemRes = {
            key: item.work_item_id,
            count: '0',
            sum: String(Math.round(item.vector_checksum)),
            avg: item.final_score,
          }
          call.write({ result: workItemRes })
        })

        call.end()
      })
    },
    aggregateBatch: (call) => {
      const aggregator = createAggregator()
      const workItemResults: any[] = []

      call.on('data', (request: AggregateBatchRequest) => {
        if (!request.events || request.events.length === 0) {
          return
        }

        request.events.forEach((event) => {
          // Handle WorkItems
          if (event.event?.type === 'work-item') {
            try {
              const enrichedJSON = event.event.user
              const result = processEnrichedWorkItem(enrichedJSON)
              workItemResults.push(result)
            } catch (error) {
              console.warn('Failed to process WorkItem in batch:', error)
            }
            return
          }

          aggregator.add(event)
        })
      })

      call.on('end', () => {
        const results = aggregator.results()

        // Add WorkItem results as individual results
        workItemResults.forEach((item) => {
          results.push({
            key: item.work_item_id,
            count: '0',
            sum: String(Math.round(item.vector_checksum)),
            avg: item.final_score,
          })
        })

        const response = { results }
        call.write(response)
        call.end()
      })
    },
  }

  const server = new grpc.Server()
  server.addService(AggregateServiceService, aggregateService)

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

  console.log(`Aggregate service listening on ${config.host}:${config.port}`)

  if (config.registerWithBroker) {
    const brokerManager = BrokerClientManager.create(config.brokerHost, config.brokerPort)
    brokerManager.onConnected = () => {
      brokerManager.registerService(AggregateServiceClient, config.host, config.port)
    }
  }

  return server
}

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2))
  await startAggregateServer(config)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  console.error('Use --help to see valid options.')
  process.exitCode = 1
})
