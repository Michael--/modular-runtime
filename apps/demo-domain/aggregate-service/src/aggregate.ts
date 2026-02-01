import type {
  AggregateResult,
  EnrichedEvent,
} from '../../../../packages/proto/generated/ts/pipeline/v1/pipeline'

interface AggregateStats {
  count: number
  sum: number
}

export interface Aggregator {
  add: (event: EnrichedEvent) => void
  results: () => AggregateResult[]
}

const toNumber = (value: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.trunc(parsed)
}

/**
 * Creates a simple in-memory aggregator for enriched events.
 * @returns Aggregator instance with add/results methods.
 */
export const createAggregator = (): Aggregator => {
  const stats = new Map<string, AggregateStats>()

  const add = (event: EnrichedEvent): void => {
    if (!event.passedRules || !event.event) {
      return
    }

    const key = event.event.type
    const value = toNumber(event.event.value)
    const current = stats.get(key) ?? { count: 0, sum: 0 }
    current.count += 1
    current.sum += value
    stats.set(key, current)
  }

  const results = (): AggregateResult[] => {
    const output: AggregateResult[] = []
    for (const [key, value] of stats.entries()) {
      output.push({
        key,
        count: String(value.count),
        sum: String(value.sum),
        avg: value.count === 0 ? 0 : value.sum / value.count,
      })
    }
    return output
  }

  return { add, results }
}
