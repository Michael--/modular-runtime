import type { Event, ParsedEvent } from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'

const SUPPORTED_TYPES = new Set(['click', 'view', 'purchase'])

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

/**
 * Parses a raw pipeline event into a typed ParsedEvent.
 * @param rawEvent Event payload containing raw JSON.
 * @returns ParsedEvent when valid; otherwise null.
 */
export const parseEvent = (rawEvent: Event): ParsedEvent | null => {
  if (!rawEvent.rawJson) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawEvent.rawJson)
  } catch {
    return null
  }

  if (!isRecord(parsed)) {
    return null
  }

  const ts = parsed.ts
  const type = parsed.type
  const user = parsed.user
  const value = parsed.value

  if (typeof ts !== 'string' || typeof type !== 'string' || typeof user !== 'string') {
    return null
  }

  if (!SUPPORTED_TYPES.has(type)) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const timestampMs = Date.parse(ts)
  const timestamp = Number.isFinite(timestampMs) ? String(Math.trunc(timestampMs)) : '0'

  return {
    type,
    user,
    value: String(Math.trunc(value)),
    timestamp,
    sequence: rawEvent.sequence ?? '0',
  }
}
