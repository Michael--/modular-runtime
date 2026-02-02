#!/usr/bin/env node
/**
 * Simple batching test - just test ingest service with batching enabled
 */
import * as grpc from '@grpc/grpc-js'
import { IngestServiceClient } from '../../packages/proto/generated/ts/pipeline/v1/pipeline.js'
import { process } from 'node:child_process'
import { console } from 'node:console'

const main = async () => {
  console.log('=== Batching Test ===\n')

  const client = new IngestServiceClient('127.0.0.1:6001', grpc.credentials.createInsecure())

  console.log('Testing WITHOUT batching (baseline)...')
  const stream1 = client.streamEvents({
    inputFile: 'examples/demo-scenarios/test-batching.ndjson',
    batchSize: 100,
    maxEvents: '1000',
    enableBatching: false,
  })

  let count1 = 0
  const start1 = Date.now()

  // eslint-disable-next-line no-unused-vars
  for await (const response of stream1) {
    count1++
  }

  const duration1 = Date.now() - start1
  console.log(
    `✓ Processed ${count1} events in ${duration1}ms (${(count1 / (duration1 / 1000)).toFixed(0)} events/sec)\n`
  )

  console.log('Testing WITH batching (batch_size=100)...')
  const stream2 = client.streamEvents({
    inputFile: 'examples/demo-scenarios/test-batching.ndjson',
    batchSize: 100,
    maxEvents: '1000',
    enableBatching: true,
  })

  let count2 = 0
  const start2 = Date.now()

  // eslint-disable-next-line no-unused-vars
  for await (const response of stream2) {
    count2++
  }

  const duration2 = Date.now() - start2
  console.log(
    `✓ Processed ${count2} events in ${duration2}ms (${(count2 / (duration2 / 1000)).toFixed(0)} events/sec)\n`
  )

  console.log('=== Comparison ===')
  console.log(`Without batching: ${duration1}ms`)
  console.log(`With batching:    ${duration2}ms`)
  console.log(`Speedup:          ${(duration1 / duration2).toFixed(2)}x`)

  process.exit(0)
}

main().catch(console.error)
