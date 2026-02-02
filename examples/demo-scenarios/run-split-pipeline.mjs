#!/usr/bin/env node
import { spawn } from 'node:child_process'
import console from 'node:console'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { setTimeout as sleep } from 'node:timers/promises'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shutdownTimeoutMs = 2500

const defaultConfig = {
  count: 100000,
  users: 10000,
  seed: 42,
  types: 'click,view,purchase',
  input: join(repoRoot, 'examples', 'demo-scenarios', 'events.ndjson'),
  output: join(repoRoot, 'examples', 'demo-scenarios', 'aggregate-results-split.ndjson'),
  build: true,
  generate: true,
  enableBatching: false,
  batchSize: 100,
  workload: 'events',
  payloadSize: 'medium',
  iterations: 500,
}

const usage = `Usage: run-split-pipeline.mjs [options]

Options:
  --count <number>       Event count (default: ${defaultConfig.count})
  --users <number>       User count (default: ${defaultConfig.users})
  --seed <number>        RNG seed (default: ${defaultConfig.seed})
  --types <list>         Comma-separated event types (default: ${defaultConfig.types})
  --input <file>         Input NDJSON file
  --output <file>        Output NDJSON file
  --enable-batching      Enable batching mode
  --batch-size <number>  Batch size (default: ${defaultConfig.batchSize})
  --workload <mode>      Workload mode: events|work-items|mixed (default: ${defaultConfig.workload})
  --payload-size <size>  Payload size: small|medium|large (default: ${defaultConfig.payloadSize})
  --iterations <number>  Compute iterations (default: ${defaultConfig.iterations})
  --no-build             Skip build step
  --no-generate          Skip generator step
  -h, --help             Show this help message
`

const parseArgs = (argv) => {
  const config = { ...defaultConfig }

  const getValue = (index) => {
    const value = argv[index]
    if (!value) throw new Error('Missing value for argument')
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    }

    if (arg === '--count') {
      config.count = Number(getValue(i + 1))
      i++
      continue
    }

    if (arg === '--users') {
      config.users = Number(getValue(i + 1))
      i++
      continue
    }

    if (arg === '--seed') {
      config.seed = Number(getValue(i + 1))
      i++
      continue
    }

    if (arg === '--types') {
      config.types = getValue(i + 1)
      i++
      continue
    }

    if (arg === '--input') {
      config.input = getValue(i + 1)
      i++
      continue
    }

    if (arg === '--output') {
      config.output = getValue(i + 1)
      i++
      continue
    }

    if (arg === '--no-build') {
      config.build = false
      continue
    }

    if (arg === '--no-generate') {
      config.generate = false
      continue
    }

    if (arg === '--enable-batching') {
      config.enableBatching = true
      continue
    }

    if (arg === '--batch-size') {
      config.batchSize = Number(getValue(i + 1))
      i++
      continue
    }

    if (arg === '--workload') {
      config.workload = getValue(i + 1)
      i++
      continue
    }

    if (arg === '--payload-size') {
      config.payloadSize = getValue(i + 1)
      i++
      continue
    }

    if (arg === '--iterations') {
      config.iterations = Number(getValue(i + 1))
      i++
      continue
    }
  }

  return config
}

const execCommand = (command, args, opts = {}) => {
  return new Promise((resolve, reject) => {
    console.log(`→ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      ...opts,
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`))
      } else {
        resolve()
      }
    })

    child.on('error', reject)
  })
}

const startService = (name, command, args, env = {}) => {
  console.log(`→ Starting ${name}...`)
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })

  let ready = false

  child.stdout.on('data', (data) => {
    const line = data.toString().trim()
    if (line.includes('listening') || line.includes('running')) {
      ready = true
    }
    console.log(`[${name}] ${line}`)
  })

  child.stderr.on('data', (data) => {
    console.error(`[${name}] ${data.toString().trim()}`)
  })

  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`)
    }
  })

  return { child, isReady: () => ready }
}

const signalProcess = (child, signal) => {
  if (!child || child.killed) {
    return
  }

  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // fall through to direct kill
  }

  try {
    child.kill(signal)
  } catch (error) {
    console.error(`[cleanup] Failed to send ${signal}:`, error)
  }
}

const main = async () => {
  const config = parseArgs(process.argv.slice(2))

  console.log('=== Split Pipeline Demo ===')
  console.log('Config:', config)
  console.log()

  const services = []

  let cleaning = false

  const cleanup = (reason = 'shutdown', error) => {
    if (cleaning) {
      return
    }
    cleaning = true
    console.log(`\n\nShutting down services (${reason})...`)
    if (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      console.error(`[cleanup] ${message}`)
    }
    for (const service of services) {
      signalProcess(service, 'SIGTERM')
    }
    setTimeout(() => {
      for (const service of services) {
        signalProcess(service, 'SIGKILL')
      }
    }, shutdownTimeoutMs)
    setTimeout(() => {
      process.exit(error ? 1 : 0)
    }, shutdownTimeoutMs + 500)
  }

  process.on('SIGINT', () => cleanup('SIGINT'))
  process.on('SIGTERM', () => cleanup('SIGTERM'))
  process.on('uncaughtException', (error) => cleanup('uncaughtException', error))
  process.on('unhandledRejection', (error) => cleanup('unhandledRejection', error))

  try {
    // Step 0: Build if needed
    if (config.build) {
      console.log('Step 0: Building services...')
      await execCommand('pnpm', [
        '-r',
        '--filter',
        './apps/demo-domain/*-service',
        '--filter',
        './apps/demo-domain/pipeline-orchestrator',
        'run',
        'build',
      ])
      console.log('✓ Build complete\n')
    }

    // Step 1: Generate events if needed
    if (config.generate) {
      console.log('Step 1: Generating events...')
      await execCommand('node', [
        'apps/demo-domain/event-generator/dist/event-generator.js',
        '--count',
        String(config.count),
        '--users',
        String(config.users),
        '--seed',
        String(config.seed),
        '--types',
        config.types,
        '--output',
        config.input,
      ])
      console.log('✓ Events generated\n')
    } else {
      console.log('Step 1: Skipping generator (using existing events.ndjson)\n')
    }

    // Step 2: Start services
    console.log('Step 2: Starting services...')

    const ingest = startService('ingest', 'node', [
      'apps/demo-domain/ingest-service/dist/ingest-service.js',
      '--input',
      config.input,
    ])
    services.push(ingest.child)
    await sleep(1000)

    const parse = startService('parse', 'node', [
      'apps/demo-domain/parse-service/dist/parse-service.js',
    ])
    services.push(parse.child)
    await sleep(1000)

    const rules = startService('rules', 'node', [
      'apps/demo-domain/rules-service/dist/rules-service.js',
    ])
    services.push(rules.child)
    await sleep(1000)

    const aggregate = startService('aggregate', 'node', [
      'apps/demo-domain/aggregate-service/dist/aggregate-service.js',
    ])
    services.push(aggregate.child)
    await sleep(1000)

    const sink = startService('sink', 'node', [
      'apps/demo-domain/sink-service/dist/sink-service.js',
      '--output',
      config.output,
    ])
    services.push(sink.child)
    await sleep(1000)

    console.log('✓ All services started\n')

    // Step 3: Run pipeline orchestrator
    console.log('Step 3: Running pipeline...')

    const orchestratorArgs = [
      'apps/demo-domain/pipeline-orchestrator/dist/pipeline-orchestrator.js',
      '--input',
      config.input,
      '--output',
      config.output,
    ]

    if (config.enableBatching) {
      orchestratorArgs.push('--enable-batching', '--batch-size', String(config.batchSize))
    }

    if (config.workload !== 'events') {
      orchestratorArgs.push('--workload', config.workload)
      orchestratorArgs.push('--max-events', String(config.count))
    }

    if (config.payloadSize !== 'medium') {
      orchestratorArgs.push('--payload-size', config.payloadSize)
    }

    if (config.iterations !== 500) {
      orchestratorArgs.push('--iterations', String(config.iterations))
    }

    await execCommand('node', orchestratorArgs)

    console.log('\n✓ Pipeline complete!')
    cleanup('complete')
  } catch (err) {
    console.error('Error:', err)
    cleanup('error', err)
  }
}

main()
