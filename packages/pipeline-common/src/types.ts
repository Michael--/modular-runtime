/**
 * Defines the canonical event shape used throughout the pipeline.
 */
export interface EventRecord {
  ts: string
  type: 'click' | 'view' | 'purchase'
  user: string
  value: number
  metadata?: Record<string, unknown>
}

/**
 * Captures pipeline performance and resource metrics.
 */
export interface PipelineMetrics {
  processedEvents: number
  invalidEvents: number
  throughputPerSec: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
  cpuPercent: number
  memoryMB: number
}

/**
 * Configures how the pipeline is executed.
 */
export interface PipelineConfig {
  mode: 'monolith' | 'split'
  inputFile: string
  outputFile: string
  batchSize: number
  workerCount?: number
}
