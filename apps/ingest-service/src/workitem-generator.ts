import {
  WorkItem,
  Vector,
  Matrix,
  PayloadSize,
  WorkloadConfig,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'

/**
 * Generates a WorkItem for compute-heavy testing
 */
export function generateWorkItem(id: string, config: WorkloadConfig): WorkItem {
  const size = getSizeFromConfig(config.payloadSize)
  const iterations = config.computeIterations > 0 ? config.computeIterations : 500

  return {
    id,
    vectors: generateVectors(2, size),
    matrix: generateMatrix(size, size),
    text: generateText(config.payloadSize),
    iterations,
  }
}

/**
 * Generates random vectors
 */
function generateVectors(count: number, size: number): Vector[] {
  return Array.from({ length: count }, () => ({
    values: Array.from({ length: size }, () => Math.random()),
  }))
}

/**
 * Generates random matrix
 */
function generateMatrix(rows: number, cols: number): Matrix {
  return {
    rows: Array.from({ length: rows }, () => ({
      values: Array.from({ length: cols }, () => Math.random()),
    })),
  }
}

/**
 * Generates text payload based on size
 */
function generateText(payloadSize: PayloadSize): string {
  const baseText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '
  const repetitions =
    payloadSize === PayloadSize.LARGE ? 1000 : payloadSize === PayloadSize.MEDIUM ? 100 : 10
  return baseText.repeat(repetitions)
}

/**
 * Maps PayloadSize enum to numeric size
 */
function getSizeFromConfig(payloadSize: PayloadSize): number {
  switch (payloadSize) {
    case PayloadSize.LARGE:
      return 1000
    case PayloadSize.MEDIUM:
      return 100
    case PayloadSize.SMALL:
    default:
      return 10
  }
}
