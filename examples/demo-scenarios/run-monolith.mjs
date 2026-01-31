#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const defaultConfig = {
  count: 100000,
  users: 10000,
  seed: 42,
  types: 'click,view,purchase',
  input: join(repoRoot, 'examples', 'demo-scenarios', 'events.ndjson'),
  output: join(repoRoot, 'examples', 'demo-scenarios', 'aggregate-results.ndjson'),
  workers: 0,
  queueSize: 10000,
  build: true,
  generate: true,
  checksum: true,
  verify: false,
}

const usage = `Usage: run-monolith.mjs [options]

Options:
  --count <number>       Event count (default: ${defaultConfig.count})
  --users <number>       User count (default: ${defaultConfig.users})
  --seed <number>        RNG seed (default: ${defaultConfig.seed})
  --types <list>         Comma-separated event types (default: ${defaultConfig.types})
  --input <file>         Input NDJSON file
  --output <file>        Output NDJSON file
  --workers <number>     Parser worker threads (default: auto)
  --queue-size <number>  Max queue size per stage (default: ${defaultConfig.queueSize})
  --no-build             Skip builds
  --no-generate          Skip generator step
  --no-checksum          Skip output checksum
  --verify               Run monolith twice and compare output checksums
  -h, --help             Show this help message
`

const parseArgs = (argv) => {
  const config = { ...defaultConfig }

  const normalizedArgs = argv[0] === '--' ? argv.slice(1) : argv

  const getValue = (index) => {
    const value = normalizedArgs[index]
    if (value == null) {
      throw new Error('Missing value for argument')
    }
    return value
  }

  for (let i = 0; i < normalizedArgs.length; i += 1) {
    const arg = normalizedArgs[i]

    if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    }

    if (arg === '--count') {
      config.count = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--users') {
      config.users = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--seed') {
      config.seed = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--types') {
      config.types = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--input') {
      config.input = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--output') {
      config.output = getValue(i + 1)
      i += 1
      continue
    }

    if (arg === '--workers') {
      config.workers = Number(getValue(i + 1))
      i += 1
      continue
    }

    if (arg === '--queue-size') {
      config.queueSize = Number(getValue(i + 1))
      i += 1
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

    if (arg === '--no-checksum') {
      config.checksum = false
      continue
    }

    if (arg === '--verify') {
      config.verify = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return config
}

const runCommand = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: repoRoot,
      ...options,
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`))
      }
    })
  })
}

const fileExists = async (filePath) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const hashFile = async (filePath) => {
  const hash = createHash('sha256')
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

const deriveVerifyOutput = (outputPath) => {
  const suffix = '.verify'
  if (outputPath.endsWith('.ndjson')) {
    return outputPath.replace(/\.ndjson$/, `${suffix}.ndjson`)
  }
  return `${outputPath}${suffix}`
}

const main = async () => {
  const config = parseArgs(process.argv.slice(2))

  if (config.build) {
    await runCommand('pnpm', ['-C', 'apps/event-generator', 'build'])
    await runCommand('pnpm', ['-C', 'apps/event-pipeline-monolith', 'build'])
  }

  if (config.generate) {
    await runCommand('pnpm', [
      '-C',
      'apps/event-generator',
      'start',
      '--',
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
  } else if (!(await fileExists(config.input))) {
    throw new Error(`Input file does not exist: ${config.input}`)
  }

  const monolithBinary = join(
    repoRoot,
    'apps',
    'event-pipeline-monolith',
    'build',
    'event-pipeline-monolith'
  )
  const runMonolith = async (outputPath) => {
    const monolithArgs = ['--input', config.input]
    if (outputPath) {
      monolithArgs.push('--output', outputPath)
    }
    if (config.workers > 0) {
      monolithArgs.push('--workers', String(config.workers))
    }
    if (config.queueSize > 0) {
      monolithArgs.push('--queue-size', String(config.queueSize))
    }
    await runCommand(monolithBinary, monolithArgs)
  }

  await runMonolith(config.output)

  if (config.verify) {
    const verifyOutput = deriveVerifyOutput(config.output)
    await runMonolith(verifyOutput)
    const firstChecksum = await hashFile(config.output)
    const secondChecksum = await hashFile(verifyOutput)
    console.log(`Output checksum (sha256): ${firstChecksum}`)
    console.log(`Verify checksum (sha256): ${secondChecksum}`)
    if (firstChecksum !== secondChecksum) {
      throw new Error('Checksum mismatch: verify run differs from baseline output')
    }
    console.log('Verify checksum match: OK')
  } else if (config.checksum) {
    const checksum = await hashFile(config.output)
    console.log(`Output checksum (sha256): ${checksum}`)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  console.error('Use --help to see valid options.')
  process.exitCode = 1
})
