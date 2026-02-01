import { ProcessedWorkItem } from '../../../../packages/proto/generated/ts/pipeline/v1/pipeline'

export interface EnrichedWorkItem {
  id: string
  eigenvalues: number[]
  score: number
  processing_time_ms?: number
}

/**
 * Processes a ProcessedWorkItem from parse-service
 * Simulates Python numpy operations (feature engineering)
 */
export function processWorkItem(processedItem: any): EnrichedWorkItem {
  const start = Date.now()

  // Extract normalized vectors
  const vectors: number[][] =
    processedItem.normalized_vectors?.map((v: any) => v.values || []) || []

  // Compute statistics (mean, std) from all vector values
  const allValues: number[] = []
  for (const vec of vectors) {
    allValues.push(...vec)
  }

  const mean = allValues.length > 0 ? allValues.reduce((s, v) => s + v, 0) / allValues.length : 0
  const variance =
    allValues.length > 0
      ? allValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / allValues.length
      : 0
  const std = Math.sqrt(variance)

  // Use first 5 values as "eigenvalues" (simplified)
  const eigenvalues = allValues.slice(0, 5)

  // Matrix score: sum all elements from transposed matrix
  const matrix = processedItem.transposed_matrix
  let matrixScore = 0.0
  if (matrix?.rows) {
    for (const row of matrix.rows) {
      if (row.values) {
        matrixScore += row.values.reduce((s: number, v: number) => s + v, 0)
      }
    }
  }

  // CPU-intensive iterations
  const iterations = 500
  let enrichedScore = 0.0
  const checksum = processedItem.checksum || 0
  for (let i = 0; i < iterations; i++) {
    enrichedScore += (checksum + matrixScore + mean) * (i + 1) * 0.001
  }

  const processingTime = Date.now() - start

  return {
    id: processedItem.id,
    eigenvalues,
    score: enrichedScore,
    processing_time_ms: processingTime,
  }
}
