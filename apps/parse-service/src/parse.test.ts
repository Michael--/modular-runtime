import { describe, expect, it } from 'vitest'
import type { Event } from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { parseEvent } from './parse'

const buildEvent = (rawJson: string, sequence: string = '1'): Event => ({
  rawJson,
  sequence,
})

describe('parseEvent', () => {
  it('parses valid JSON into a ParsedEvent', () => {
    const raw = buildEvent(
      JSON.stringify({
        ts: '2026-01-30T10:00:00Z',
        type: 'click',
        user: 'u1234',
        value: 42,
      }),
      '9'
    )

    const parsed = parseEvent(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe('click')
    expect(parsed?.user).toBe('u1234')
    expect(parsed?.value).toBe('42')
    expect(parsed?.sequence).toBe('9')
  })

  it('returns null for unsupported types', () => {
    const raw = buildEvent(
      JSON.stringify({
        ts: '2026-01-30T10:00:00Z',
        type: 'signup',
        user: 'u1234',
        value: 42,
      })
    )

    expect(parseEvent(raw)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const raw = buildEvent('{"ts":"2026-01-30T10:00:00Z"')
    expect(parseEvent(raw)).toBeNull()
  })

  it('keeps timestamp at zero when parsing fails', () => {
    const raw = buildEvent(
      JSON.stringify({
        ts: 'not-a-date',
        type: 'purchase',
        user: 'u1234',
        value: 5,
      })
    )

    const parsed = parseEvent(raw)
    expect(parsed?.timestamp).toBe('0')
  })
})
