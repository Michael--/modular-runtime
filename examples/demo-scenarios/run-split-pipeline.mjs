#!/usr/bin/env node
import { spawn } from 'node:child_process'
import console from 'node:console'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { setTimeout as sleep } from 'node:timers/promises'
import { format } from 'node:util'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shutdownTimeoutMs = 2500
const ansi = {
  reset: '\x1b[0m',
  colors: ['\x1b[36m', '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[31m'],
}
const processColors = new Map()

const colorizePrefix = (name) => {
  let color = processColors.get(name)
  if (!color) {
    color = ansi.colors[processColors.size % ansi.colors.length]
    processColors.set(name, color)
  }
  return `${color}[${name}]${ansi.reset}`
}

const emitPrefixedLine = (prefix, line, isError = false) => {
  const output = isError ? console.error : console.log
  output(`${prefix} ${line}`)
}

const emitPrefixedMessage = (prefix, message, isError = false) => {
  const lines = String(message).split(/\r?\n/u)
  for (const line of lines) {
    emitPrefixedLine(prefix, line, isError)
  }
}

const runnerPrefix = colorizePrefix('runner')

const logRunner = (...args) => {
  emitPrefixedMessage(runnerPrefix, format(...args))
}

const errorRunner = (...args) => {
  emitPrefixedMessage(runnerPrefix, format(...args), true)
}

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
  implementation: 'ts', // ts | polyglot
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
  --impl <mode>          Service implementation: ts|polyglot (default: ${defaultConfig.implementation})
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
      logRunner(usage)
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

    if (arg === '--impl') {
      const value = getValue(i + 1)
      if (value !== 'ts' && value !== 'polyglot') {
        throw new Error(`Invalid implementation: ${value}`)
      }
      config.implementation = value
      i++
      continue
    }
  }

  return config
}

const execCommand = (command, args, opts = {}) => {
  return new Promise((resolve, reject) => {
    const { name, ...spawnOpts } = opts
    const prefix = colorizePrefix(name ?? command)
    emitPrefixedLine(prefix, `→ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...spawnOpts,
    })

    streamLines(child.stdout, (line) => {
      emitPrefixedLine(prefix, line)
    })

    streamLines(child.stderr, (line) => {
      emitPrefixedLine(prefix, line, true)
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

const streamLines = (stream, onLine) => {
  let buffer = ''
  stream.on('data', (data) => {
    buffer += data.toString()
    const lines = buffer.split(/\r?\n/u)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      onLine(line)
    }
  })
  stream.on('end', () => {
    if (buffer.length > 0) {
      onLine(buffer)
    }
  })
}

const startService = (name, command, args, env = {}, options = {}) => {
  logRunner(`→ Starting ${name}...`)
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })

  let ready = false
  const prefix = colorizePrefix(name)

  streamLines(child.stdout, (line) => {
    if (line.includes('listening') || line.includes('running')) {
      ready = true
    }
    emitPrefixedLine(prefix, line)
  })

  streamLines(child.stderr, (line) => {
    emitPrefixedLine(prefix, line, true)
  })

  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      emitPrefixedLine(prefix, `exited with code ${code}`, true)
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
    errorRunner(`[cleanup] Failed to send ${signal}:`, error)
  }
}

const resolveServiceCommands = (config) => {
  if (config.implementation === 'polyglot') {
    return {
      parse: {
        command: 'cargo',
        args: [
          'run',
          '--release',
          '--manifest-path',
          'apps/demo-domain/parse-service-rust/Cargo.toml',
        ],
      },
      rules: {
        command: 'python3',
        args: ['src/rules_service.py'],
        cwd: 'apps/demo-domain/rules-service-python',
        env: { PYTHONUNBUFFERED: '1' },
      },
      aggregate: {
        command: 'go',
        args: ['run', '.'],
        cwd: 'apps/demo-domain/aggregate-service-go',
      },
    }
  }

  return {
    parse: {
      command: 'node',
      args: ['apps/demo-domain/parse-service/dist/parse-service.js'],
    },
    rules: {
      command: 'node',
      args: ['apps/demo-domain/rules-service/dist/rules-service.js'],
    },
    aggregate: {
      command: 'node',
      args: ['apps/demo-domain/aggregate-service/dist/aggregate-service.js'],
    },
  }
}

const main = async () => {
  const config = parseArgs(process.argv.slice(2))

  logRunner('=== Split Pipeline Demo ===')
  logRunner('Config:', config)
  logRunner('')

  const services = []

  let cleaning = false

  const cleanup = (reason = 'shutdown', error) => {
    if (cleaning) {
      return
    }
    cleaning = true
    logRunner(`\n\nShutting down services (${reason})...`)
    if (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      errorRunner(`[cleanup] ${message}`)
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
      logRunner('Step 0: Building services...')
      await execCommand(
        'pnpm',
        [
          '-r',
          '--filter',
          './apps/demo-domain/*-service',
          '--filter',
          './apps/demo-domain/pipeline-orchestrator',
          'run',
          'build',
        ],
        { name: 'build' }
      )
      logRunner('✓ Build complete\n')
    }

    // Step 1: Generate events if needed
    if (config.generate) {
      logRunner('Step 1: Generating events...')
      await execCommand(
        'node',
        [
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
        ],
        { name: 'generator' }
      )
      logRunner('✓ Events generated\n')
    } else {
      logRunner('Step 1: Skipping generator (using existing events.ndjson)\n')
    }

    // Step 2: Start services
    logRunner('Step 2: Starting services...')

    const serviceCommands = resolveServiceCommands(config)

    const ingest = startService('ingest', 'node', [
      'apps/demo-domain/ingest-service/dist/ingest-service.js',
      '--input',
      config.input,
    ])
    services.push(ingest.child)
    await sleep(1000)

    const parse = startService(
      'parse',
      serviceCommands.parse.command,
      serviceCommands.parse.args,
      serviceCommands.parse.env ?? {},
      { cwd: serviceCommands.parse.cwd }
    )
    services.push(parse.child)
    await sleep(1000)

    const rules = startService(
      'rules',
      serviceCommands.rules.command,
      serviceCommands.rules.args,
      serviceCommands.rules.env ?? {},
      { cwd: serviceCommands.rules.cwd }
    )
    services.push(rules.child)
    await sleep(1000)

    const aggregate = startService(
      'aggregate',
      serviceCommands.aggregate.command,
      serviceCommands.aggregate.args,
      serviceCommands.aggregate.env ?? {},
      { cwd: serviceCommands.aggregate.cwd }
    )
    services.push(aggregate.child)
    await sleep(1000)

    const sink = startService('sink', 'node', [
      'apps/demo-domain/sink-service/dist/sink-service.js',
      '--output',
      config.output,
    ])
    services.push(sink.child)
    await sleep(1000)

    logRunner('✓ All services started\n')

    // Step 3: Run pipeline orchestrator
    logRunner('Step 3: Running pipeline...')

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

    await execCommand('node', orchestratorArgs, { name: 'orchestrator' })

    logRunner('\n✓ Pipeline complete!')
    cleanup('complete')
  } catch (err) {
    errorRunner('Error:', err)
    cleanup('error', err)
  }
}

main()
