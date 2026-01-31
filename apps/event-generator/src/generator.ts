import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import type { Writable } from 'node:stream'
import type { EventRecord } from '@modular-runtime/pipeline-common'

/**
 * Supported output distributions for generated events.
 */
export type GeneratorDistribution = 'uniform' | 'zipf' | 'burst'

/**
 * Configuration for generating NDJSON event streams.
 */
export interface GeneratorConfig {
  eventCount: number
  outputFile: string
  userCount: number
  eventTypes: string[]
  seed?: number
  distribution?: GeneratorDistribution
}

const defaultEventTypes = ['click', 'view', 'purchase']

const createRng = (seed?: number): (() => number) => {
  if (seed == null) {
    return () => Math.random()
  }
  let value = seed >>> 0
  return () => {
    value |= 0
    value = (value + 0x6d2b79f5) | 0
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const toUserId = (index: number): string => `u${index.toString().padStart(4, '0')}`

const createUserPicker = (
  userCount: number,
  distribution: GeneratorDistribution,
  rng: () => number
): (() => string) => {
  let burstRemaining = 0
  let burstUser = 0

  return () => {
    if (distribution === 'burst') {
      if (burstRemaining > 0) {
        burstRemaining -= 1
        return toUserId(burstUser)
      }
      if (rng() < 0.02) {
        burstRemaining = 50 + Math.floor(rng() * 200)
        burstUser = Math.floor(rng() * userCount)
        burstRemaining -= 1
        return toUserId(burstUser)
      }
    }

    if (distribution === 'zipf') {
      const skewed = Math.pow(rng(), 3)
      return toUserId(Math.floor(skewed * userCount))
    }

    return toUserId(Math.floor(rng() * userCount))
  }
}

const normalizeEventTypes = (eventTypes: string[]): string[] => {
  return eventTypes.length > 0 ? eventTypes : defaultEventTypes
}

const normalizeDistribution = (distribution?: GeneratorDistribution): GeneratorDistribution => {
  return distribution ?? 'uniform'
}

const validateConfig = (config: GeneratorConfig): void => {
  if (!Number.isInteger(config.eventCount) || config.eventCount <= 0) {
    throw new Error('eventCount must be a positive integer')
  }
  if (!Number.isInteger(config.userCount) || config.userCount <= 0) {
    throw new Error('userCount must be a positive integer')
  }
  if (config.outputFile.trim().length === 0) {
    throw new Error('outputFile must be provided')
  }
  if (config.eventTypes.length === 0) {
    throw new Error('eventTypes must include at least one entry')
  }
}

const nextTimestamp = (currentMs: number, rng: () => number): number => {
  const delta = 250 + Math.floor(rng() * 1000)
  return currentMs + delta
}

const pickEventType = (eventTypes: string[], rng: () => number): string => {
  const index = Math.floor(rng() * eventTypes.length)
  return eventTypes[index] ?? eventTypes[0]
}

const writeLine = async (stream: Writable, line: string): Promise<void> => {
  if (!stream.write(line)) {
    await once(stream, 'drain')
  }
}

/**
 * Generates an NDJSON file with synthetic events.
 * @param config Configuration controlling the generated output.
 * @returns A promise that resolves once the file has been written.
 */
export const generateEvents = async (config: GeneratorConfig): Promise<void> => {
  const normalizedEventTypes = normalizeEventTypes(config.eventTypes)
  validateConfig({ ...config, eventTypes: normalizedEventTypes })

  const rng = createRng(config.seed)
  const distribution = normalizeDistribution(config.distribution)
  const pickUser = createUserPicker(config.userCount, distribution, rng)
  const stream = createWriteStream(config.outputFile, { encoding: 'utf8' })

  let currentTime = Date.now()
  for (let i = 0; i < config.eventCount; i += 1) {
    currentTime = nextTimestamp(currentTime, rng)
    const event: EventRecord = {
      ts: new Date(currentTime).toISOString(),
      type: pickEventType(normalizedEventTypes, rng) as EventRecord['type'],
      user: pickUser(),
      value: Math.floor(rng() * 100) + 1,
      metadata: {
        source: 'generator',
        seq: i,
      },
    }
    await writeLine(stream, `${JSON.stringify(event)}\n`)
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve())
    stream.on('error', (error: NodeJS.ErrnoException) => reject(error))
  })
}
