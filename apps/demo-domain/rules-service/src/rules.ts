import type {
  EnrichedEvent,
  ParsedEvent,
} from '../../../../packages/proto/generated/ts/pipeline/v1/pipeline'

const MIN_VALUE = 10

const parseValue = (value: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.trunc(parsed)
}

/**
 * Applies simple demo rules to a parsed event.
 * @param event Parsed event payload.
 * @returns EnrichedEvent when rules pass; otherwise null.
 */
export const applyRules = (event: ParsedEvent): EnrichedEvent | null => {
  const numericValue = parseValue(event.value)
  const passed = numericValue >= MIN_VALUE && event.type !== 'view'

  if (!passed) {
    return null
  }

  return {
    event,
    metadata: {
      rule: 'min_value_and_type',
    },
    passedRules: true,
  }
}
