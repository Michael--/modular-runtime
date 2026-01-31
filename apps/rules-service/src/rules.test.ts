import { describe, expect, it } from 'vitest'
import type { ParsedEvent } from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { applyRules } from './rules'

const buildEvent = (overrides: Partial<ParsedEvent>): ParsedEvent => ({
  type: 'click',
  user: 'u1',
  value: '10',
  timestamp: '0',
  sequence: '1',
  ...overrides,
})

describe('applyRules', () => {
  it('filters out view events', () => {
    const event = buildEvent({ type: 'view' })
    expect(applyRules(event)).toBeNull()
  })

  it('filters out low value events', () => {
    const event = buildEvent({ value: '5' })
    expect(applyRules(event)).toBeNull()
  })

  it('passes events that meet rule criteria', () => {
    const event = buildEvent({ type: 'purchase', value: '12' })
    const enriched = applyRules(event)
    expect(enriched).not.toBeNull()
    expect(enriched?.passedRules).toBe(true)
    expect(enriched?.metadata?.rule).toBe('min_value_and_type')
  })
})
