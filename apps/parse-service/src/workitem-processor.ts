import {
  WorkItem,
  ProcessedWorkItem,
  Vector,
  Matrix,
} from '../../../packages/proto/generated/ts/pipeline/v1/pipeline'

/**
 * Processes a WorkItem: vector normalization, matrix transpose, CPU work
 */
export function processWorkItem(item: WorkItem): ProcessedWorkItem {
  // Vector normalization
  const normalizedVectors = item.vectors.map((v) => normalizeVector(v))

  // Matrix transpose
  const transposedMatrix = transposeMatrix(item.matrix)

  // CPU-intensive work
  let checksum = 0.0
  for (let i = 0; i < item.iterations; i++) {
    checksum += computeChecksum(normalizedVectors, i)
  }

  return {
    id: item.id,
    normalizedVectors,
    transposedMatrix,
    checksum,
  }
}

/**
 * Normalizes a vector (L2 norm)
 */
function normalizeVector(vec: Vector): Vector {
  const values = vec.values
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))

  if (magnitude === 0) {
    return { values }
  }

  return {
    values: values.map((v) => v / magnitude),
  }
}

/**
 * Transposes a matrix
 */
function transposeMatrix(matrix: Matrix): Matrix {
  const rows = matrix.rows
  if (rows.length === 0) {
    return { rows: [] }
  }

  const numRows = rows.length
  const numCols = rows[0].values.length

  const transposed: Vector[] = []
  for (let col = 0; col < numCols; col++) {
    const newRow: number[] = []
    for (let row = 0; row < numRows; row++) {
      newRow.push(rows[row].values[col] ?? 0)
    }
    transposed.push({ values: newRow })
  }

  return { rows: transposed }
}

/**
 * Computes a checksum over normalized vectors (simulates CPU work)
 */
function computeChecksum(vectors: Vector[], iteration: number): number {
  let sum = 0.0
  for (const vec of vectors) {
    for (const v of vec.values) {
      sum += v * (iteration + 1) * 0.001
    }
  }
  return sum
}
