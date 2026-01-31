import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateEvents } from './generator'

const readLines = async (filePath: string): Promise<string[]> => {
  const contents = await readFile(filePath, 'utf8')
  return contents.trim().split('\n')
}

const parseUserId = (user: string): number => {
  if (!user.startsWith('u')) {
    return -1
  }
  const parsed = Number(user.slice(1))
  return Number.isFinite(parsed) ? parsed : -1
}

describe('generateEvents', () => {
  let tempDir: string
  let outputFile: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-generator-'))
    outputFile = join(tempDir, 'events.ndjson')
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes the expected number of NDJSON events', async () => {
    await generateEvents({
      eventCount: 5,
      outputFile,
      userCount: 3,
      eventTypes: ['click', 'view', 'purchase'],
      seed: 1234,
      distribution: 'uniform',
    })

    const lines = await readLines(outputFile)
    expect(lines).toHaveLength(5)

    lines.forEach((line, index) => {
      const parsed = JSON.parse(line) as {
        ts: string
        type: string
        user: string
        value: number
        metadata?: { source?: string; seq?: number }
      }

      expect(typeof parsed.ts).toBe('string')
      expect(['click', 'view', 'purchase']).toContain(parsed.type)
      expect(parseUserId(parsed.user)).toBeGreaterThanOrEqual(0)
      expect(parseUserId(parsed.user)).toBeLessThan(3)
      expect(parsed.value).toBeGreaterThan(0)
      expect(parsed.metadata?.source).toBe('generator')
      expect(parsed.metadata?.seq).toBe(index)
    })
  })

  it('is deterministic with the same seed and start time', async () => {
    const outputFileA = join(tempDir, 'events-a.ndjson')
    const outputFileB = join(tempDir, 'events-b.ndjson')

    const config = {
      eventCount: 10,
      outputFile: outputFileA,
      userCount: 8,
      eventTypes: ['click', 'view'],
      seed: 42,
      distribution: 'zipf' as const,
    }

    await generateEvents(config)
    const firstRun = await readFile(outputFileA, 'utf8')

    await generateEvents({ ...config, outputFile: outputFileB })
    const secondRun = await readFile(outputFileB, 'utf8')

    expect(firstRun).toBe(secondRun)
  })

  it('rejects invalid configuration values', async () => {
    await expect(
      generateEvents({
        eventCount: 0,
        outputFile,
        userCount: 3,
        eventTypes: ['click'],
      })
    ).rejects.toThrow('eventCount must be a positive integer')
  })
})
