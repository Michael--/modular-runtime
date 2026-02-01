export interface EnrichedWorkItem {
  id: string
  eigenvalues: number[]
  score: number
}

export interface WorkItemResult {
  id: string
  final_score: number
  processed_count: number
}

/**
 * Processes an EnrichedWorkItem (from Python rules service)
 */
export function processEnrichedWorkItem(enrichedJSON: string): WorkItemResult {
  const item: EnrichedWorkItem = JSON.parse(enrichedJSON)

  // Compute dot products from eigenvalues
  const dotProducts: number[] = []
  for (let i = 0; i < item.eigenvalues.length - 1; i++) {
    const dp = item.eigenvalues[i] * item.eigenvalues[i + 1]
    dotProducts.push(dp)
  }

  // Sum of eigenvalues
  const eigenSum = item.eigenvalues.reduce((sum, val) => sum + val, 0)

  // CPU-intensive iterations
  let finalScore = 0.0
  const iterations = 500
  for (let i = 0; i < iterations; i++) {
    finalScore += (item.score + eigenSum) * (i + 1) * 0.001
  }

  // Add dot product contribution
  for (const dp of dotProducts) {
    finalScore += Math.abs(dp) * 0.1
  }

  return {
    id: item.id,
    final_score: finalScore,
    processed_count: 1,
  }
}
