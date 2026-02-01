import { describe, expect, it } from 'vitest'
import type { EnrichedEvent } from '../../../../packages/proto/generated/ts/pipeline/v1/pipeline'
import { createAggregator } from './aggregate'

const buildEvent = (overrides: Partial<EnrichedEvent>): EnrichedEvent => ({
  event: {
    type: 'click',
    user: 'u1',
    value: '10',
    timestamp: '0',
    sequence: '1',
  },
  metadata: {},
  passedRules: true,
  ...overrides,
})

describe('createAggregator', () => {
  it('aggregates counts and sums per key', () => {
    const aggregator = createAggregator()

    aggregator.add(
      buildEvent({
        event: { type: 'click', user: 'u1', value: '10', timestamp: '0', sequence: '1' },
      })
    )
    aggregator.add(
      buildEvent({
        event: { type: 'click', user: 'u2', value: '5', timestamp: '0', sequence: '2' },
      })
    )
    aggregator.add(
      buildEvent({
        event: { type: 'purchase', user: 'u3', value: '7', timestamp: '0', sequence: '3' },
      })
    )

    const results = aggregator.results()
    const click = results.find((result) => result.key === 'click')
    const purchase = results.find((result) => result.key === 'purchase')

    expect(click?.count).toBe('2')
    expect(click?.sum).toBe('15')
    expect(click?.avg).toBeCloseTo(7.5)

    expect(purchase?.count).toBe('1')
    expect(purchase?.sum).toBe('7')
    expect(purchase?.avg).toBeCloseTo(7)
  })

  it('ignores events that did not pass rules', () => {
    const aggregator = createAggregator()
    aggregator.add(buildEvent({ passedRules: false }))
    expect(aggregator.results()).toHaveLength(0)
  })
})
