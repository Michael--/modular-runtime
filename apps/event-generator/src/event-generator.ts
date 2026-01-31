/* eslint-disable no-console */
import { generateEvents, type GeneratorConfig, type GeneratorDistribution } from './generator'

const usage = `Usage: event-generator [options]

Options:
  --count <number>         Number of events to generate (default: 100000)
  --output <file>          Output NDJSON file (default: events.ndjson)
  --users <number>         Number of unique users (default: 10000)
  --types <list>           Comma-separated event types (default: click,view,purchase)
  --seed <number>          RNG seed for reproducible output
  --distribution <mode>    uniform | zipf | burst (default: uniform)
  -h, --help               Show this help message
`

const parseDistribution = (value: string): GeneratorDistribution => {
  if (value === 'uniform' || value === 'zipf' || value === 'burst') {
    return value
  }
  throw new Error(`Invalid distribution: ${value}`)
}

const parseArgs = (argv: string[]): GeneratorConfig => {
  const config: GeneratorConfig = {
    eventCount: 100000,
    outputFile: 'events.ndjson',
    userCount: 10000,
    eventTypes: [],
  }

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

    if (arg === '--count') {
      const value = Number(getValue(i + 1))
      if (!Number.isFinite(value)) {
        throw new Error('Invalid --count value')
      }
      config.eventCount = Math.trunc(value)
      i += 1
      continue
    }

    if (arg === '--output') {
      config.outputFile = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--users') {
      const value = Number(getValue(i + 1))
      if (!Number.isFinite(value)) {
        throw new Error('Invalid --users value')
      }
      config.userCount = Math.trunc(value)
      i += 1
      continue
    }

    if (arg === '--types') {
      config.eventTypes = getValue(i + 1)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      i += 1
      continue
    }

    if (arg === '--seed') {
      const value = Number(getValue(i + 1))
      if (!Number.isFinite(value)) {
        throw new Error('Invalid --seed value')
      }
      config.seed = Math.trunc(value)
      i += 1
      continue
    }

    if (arg === '--distribution') {
      config.distribution = parseDistribution(getValue(i + 1))
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return config
}

const run = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2))
  await generateEvents(config)
  console.log(`Generated ${config.eventCount} events to ${config.outputFile}`)
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  console.error('Use --help to see valid options.')
  process.exitCode = 1
})
