/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import {
  IngestServiceClient,
  ParseServiceClient,
  RulesServiceClient,
  AggregateServiceClient,
  SinkServiceClient,
  StreamEventsRequest,
  StreamEventsResponse,
  ParseEventsRequest,
  ParseEventsResponse,
  ApplyRulesRequest,
  ApplyRulesResponse,
  AggregateRequest,
  AggregateResponse,
  WriteResultsRequest,
  WriteResultsResponse,
  ParseEventsBatchRequest,
  ParseEventsBatchResponse,
  ApplyRulesBatchRequest,
  ApplyRulesBatchResponse,
  AggregateBatchRequest,
  AggregateBatchResponse,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline.js'

interface PipelineConfig {
  inputFile: string
  outputFile: string
  maxEvents: number
  enableBatching: boolean
  batchSize: number
  ingestHost: string
  ingestPort: number
  parseHost: string
  parsePort: number
  rulesHost: string
  rulesPort: number
  aggregateHost: string
  aggregatePort: number
  sinkHost: string
  sinkPort: number
}

const DEFAULT_CONFIG: PipelineConfig = {
  inputFile: 'examples/demo-scenarios/events.ndjson',
  outputFile: 'examples/demo-scenarios/aggregate-results-split.ndjson',
  maxEvents: 0, // 0 means all
  enableBatching: false,
  batchSize: 100,
  ingestHost: '127.0.0.1',
  ingestPort: 6001,
  parseHost: '127.0.0.1',
  parsePort: 6002,
  rulesHost: '127.0.0.1',
  rulesPort: 6003,
  aggregateHost: '127.0.0.1',
  aggregatePort: 6004,
  sinkHost: '127.0.0.1',
  sinkPort: 6005,
}

const usage = `Usage: pipeline-orchestrator [options]

Options:
  --input <file>          Input NDJSON file (default: ${DEFAULT_CONFIG.inputFile})
  --output <file>         Output NDJSON file (default: ${DEFAULT_CONFIG.outputFile})
  --max-events <number>   Max events to process (default: all)
  --enable-batching       Enable batching mode
  --batch-size <number>   Batch size (default: ${DEFAULT_CONFIG.batchSize})
  -h, --help              Show this help message
`

const parseArgs = (argv: string[]): PipelineConfig => {
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

    if (arg === '--input') {
      config.inputFile = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--output') {
      config.outputFile = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--max-events') {
      config.maxEvents = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--enable-batching') {
      config.enableBatching = true
      continue
    }

    if (arg === '--batch-size') {
      config.batchSize = Number(getValue(i + 1))
      i += 1
      continue
    }
  }

  return config
}

const createClient = <T>(
  ServiceClient: new (address: string, credentials: grpc.ChannelCredentials) => T,
  host: string,
  port: number
): T => {
  return new ServiceClient(`${host}:${port}`, grpc.credentials.createInsecure())
}

const runPipeline = async (config: PipelineConfig): Promise<void> => {
  console.log('=== Pipeline Orchestrator ===')
  console.log(`Input: ${config.inputFile}`)
  console.log(`Output: ${config.outputFile}`)
  console.log(
    `Batching: ${config.enableBatching ? `enabled (size: ${config.batchSize})` : 'disabled'}`
  )
  console.log()

  const ingestClient = createClient(IngestServiceClient, config.ingestHost, config.ingestPort)
  const parseClient = createClient(ParseServiceClient, config.parseHost, config.parsePort)
  const rulesClient = createClient(RulesServiceClient, config.rulesHost, config.rulesPort)
  const aggregateClient = createClient(
    AggregateServiceClient,
    config.aggregateHost,
    config.aggregatePort
  )
  const sinkClient = createClient(SinkServiceClient, config.sinkHost, config.sinkPort)

  const request: StreamEventsRequest = {
    inputFile: config.inputFile,
    batchSize: config.batchSize,
    maxEvents: config.maxEvents.toString(),
    enableBatching: config.enableBatching,
  }

  let ingestCount = 0
  let parseCount = 0
  let rulesCount = 0
  let aggregateCount = 0
  let _sinkCount = 0

  // Start timing after connection setup
  const startTime = Date.now()
  let firstEventTime: number | null = null

  const ingestStream = ingestClient.streamEvents(request)
  let parseStream: any
  let rulesStream: any
  let aggregateStream: any

  if (config.enableBatching) {
    parseStream = parseClient.parseEventsBatch()
    rulesStream = rulesClient.applyRulesBatch()
    aggregateStream = aggregateClient.aggregateBatch()
  } else {
    parseStream = parseClient.parseEvents()
    rulesStream = rulesClient.applyRules()
    aggregateStream = aggregateClient.aggregate()
  }

  const sinkStream = sinkClient.writeResults(
    (err: Error | null, response: WriteResultsResponse | undefined) => {
      const endTime = Date.now()
      const totalDuration = endTime - startTime
      const processingDuration = firstEventTime ? endTime - firstEventTime : totalDuration

      if (err) {
        console.error('Sink error:', err)
        return
      }

      console.log(
        `\n✓ Pipeline complete! Written ${response?.written || 0} results to ${config.outputFile}`
      )
      console.log('\n=== Performance Metrics ===')
      console.log(`Total events processed: ${ingestCount}`)
      console.log(
        `Events passed rules: ${rulesCount} (${((rulesCount / ingestCount) * 100).toFixed(1)}%)`
      )
      console.log(
        `Processing time: ${processingDuration}ms (${(processingDuration / 1000).toFixed(2)}s)`
      )
      console.log(
        `Throughput: ${((ingestCount / processingDuration) * 1000).toFixed(0)} events/sec`
      )
      console.log(`Avg latency per event: ${(processingDuration / ingestCount).toFixed(3)}ms`)
      process.exit(0)
    }
  )

  if (config.enableBatching) {
    // Batching mode: collect events into batches
    let eventBatch: (typeof response.event)[] = []

    const flushBatch = () => {
      if (eventBatch.length === 0) return

      const batchRequest = {
        events: eventBatch,
        batchSize: eventBatch.length,
      }
      parseStream.write(batchRequest)
      eventBatch = []
    }

    ingestStream.on('data', (response: StreamEventsResponse) => {
      if (firstEventTime === null) {
        firstEventTime = Date.now()
      }
      ingestCount += 1
      if (ingestCount % 10000 === 0) {
        process.stdout.write(`\rIngested: ${ingestCount}`)
      }

      if (response.event) {
        eventBatch.push(response.event)
      }

      if (eventBatch.length >= config.batchSize) {
        flushBatch()
      }
    })

    ingestStream.on('end', () => {
      flushBatch() // Flush any remaining events
      console.log(`\n✓ Ingest complete: ${ingestCount} events`)
      parseStream.end()
    })

    ingestStream.on('error', (err: Error) => {
      console.error('Ingest error:', err)
      process.exit(1)
    })

    // Parse receives batches
    let parseBatch: (typeof response.event)[] = []

    const flushParseBatch = () => {
      if (parseBatch.length === 0) return

      const batchRequest = {
        events: parseBatch,
        batchSize: parseBatch.length,
      }
      rulesStream.write(batchRequest)
      parseBatch = []
    }

    parseStream.on('data', (response: ParseEventsBatchResponse) => {
      if (response.events) {
        parseCount += response.events.length
        parseBatch.push(...response.events)

        if (parseBatch.length >= config.batchSize) {
          flushParseBatch()
        }
      }
    })

    parseStream.on('end', () => {
      flushParseBatch()
      console.log(`✓ Parse complete: ${parseCount} events`)
      rulesStream.end()
    })

    parseStream.on('error', (err: Error) => {
      console.error('Parse error:', err)
      process.exit(1)
    })

    // Rules receives batches
    let rulesBatch: (typeof response.event)[] = []

    const flushRulesBatch = () => {
      if (rulesBatch.length === 0) return

      const batchRequest = {
        events: rulesBatch,
        batchSize: rulesBatch.length,
      }
      aggregateStream.write(batchRequest)
      rulesBatch = []
    }

    rulesStream.on('data', (response: ApplyRulesBatchResponse) => {
      if (response.events) {
        rulesCount += response.events.length
        rulesBatch.push(...response.events)

        if (rulesBatch.length >= config.batchSize) {
          flushRulesBatch()
        }
      }
    })

    rulesStream.on('end', () => {
      flushRulesBatch()
      console.log(`✓ Rules complete: ${rulesCount} events (filtered)`)
      aggregateStream.end()
    })

    rulesStream.on('error', (err: Error) => {
      console.error('Rules error:', err)
      process.exit(1)
    })

    // Aggregate receives batches, outputs batch of results
    aggregateStream.on('data', (response: AggregateBatchResponse) => {
      if (response.results) {
        response.results.forEach((result) => {
          aggregateCount += 1
          const sinkRequest: WriteResultsRequest = { result }
          sinkStream.write(sinkRequest)
        })
      }
    })

    aggregateStream.on('end', () => {
      console.log(`✓ Aggregate complete: ${aggregateCount} results`)
      sinkStream.end()
    })

    aggregateStream.on('error', (err: Error) => {
      console.error('Aggregate error:', err)
      process.exit(1)
    })
  } else {
    // Original behavior: send individual events
    ingestStream.on('data', (response: StreamEventsResponse) => {
      if (firstEventTime === null) {
        firstEventTime = Date.now()
      }
      ingestCount += 1
      if (ingestCount % 10000 === 0) {
        process.stdout.write(`\rIngested: ${ingestCount}`)
      }
      const parseRequest: ParseEventsRequest = { event: response.event }
      parseStream.write(parseRequest)
    })

    ingestStream.on('end', () => {
      console.log(`\n✓ Ingest complete: ${ingestCount} events`)
      parseStream.end()
    })

    ingestStream.on('error', (err: Error) => {
      console.error('Ingest error:', err)
      process.exit(1)
    })

    parseStream.on('data', (response: ParseEventsResponse) => {
      parseCount += 1
      const rulesRequest: ApplyRulesRequest = { event: response.event }
      rulesStream.write(rulesRequest)
    })

    parseStream.on('end', () => {
      console.log(`✓ Parse complete: ${parseCount} events`)
      rulesStream.end()
    })

    parseStream.on('error', (err: Error) => {
      console.error('Parse error:', err)
      process.exit(1)
    })

    rulesStream.on('data', (response: ApplyRulesResponse) => {
      rulesCount += 1
      const aggregateRequest: AggregateRequest = { event: response.event }
      aggregateStream.write(aggregateRequest)
    })

    rulesStream.on('end', () => {
      console.log(`✓ Rules complete: ${rulesCount} events (filtered)`)
      aggregateStream.end()
    })

    rulesStream.on('error', (err: Error) => {
      console.error('Rules error:', err)
      process.exit(1)
    })

    aggregateStream.on('data', (response: AggregateResponse) => {
      aggregateCount += 1
      const sinkRequest: WriteResultsRequest = { result: response.result }
      sinkStream.write(sinkRequest)
    })

    aggregateStream.on('end', () => {
      console.log(`✓ Aggregate complete: ${aggregateCount} results`)
      sinkStream.end()
    })

    aggregateStream.on('error', (err: Error) => {
      console.error('Aggregate error:', err)
      process.exit(1)
    })
  }
}

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2))
  await runPipeline(config)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
