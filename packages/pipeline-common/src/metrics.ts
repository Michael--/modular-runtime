/**
 * Service-level metrics for IPC vs Processing time breakdown
 */
export interface ServiceMetrics {
  serviceName: string
  eventsProcessed: number
  processingTimeMs: number // Pure business logic
  ipcSendTimeMs: number // Serialization + send
  ipcRecvTimeMs: number // Receive + deserialization
  otherTimeMs: number // GC, scheduling, etc.
}

export class MetricsCollector {
  private serviceName: string
  private eventsProcessed = 0
  private processingTimeMs = 0
  private ipcSendTimeMs = 0
  private ipcRecvTimeMs = 0

  constructor(serviceName: string) {
    this.serviceName = serviceName
  }

  /**
   * Measure pure processing time (business logic)
   */
  recordProcessing<T>(fn: () => T): T {
    const start = performance.now()
    const result = fn()
    this.processingTimeMs += performance.now() - start
    this.eventsProcessed += 1
    return result
  }

  /**
   * Measure async processing time
   */
  async recordProcessingAsync<T>(fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    const result = await fn()
    this.processingTimeMs += performance.now() - start
    this.eventsProcessed += 1
    return result
  }

  /**
   * Measure IPC send time (serialization + network)
   */
  recordSend<T>(fn: () => T): T {
    const start = performance.now()
    const result = fn()
    this.ipcSendTimeMs += performance.now() - start
    return result
  }

  /**
   * Record IPC receive time (typically done by framework)
   * Call this at the start of request handling
   */
  recordRecvStart(): number {
    return performance.now()
  }

  /**
   * Complete IPC receive measurement
   */
  recordRecvEnd(startTime: number): void {
    this.ipcRecvTimeMs += performance.now() - startTime
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): ServiceMetrics {
    return {
      serviceName: this.serviceName,
      eventsProcessed: this.eventsProcessed,
      processingTimeMs: this.processingTimeMs,
      ipcSendTimeMs: this.ipcSendTimeMs,
      ipcRecvTimeMs: this.ipcRecvTimeMs,
      otherTimeMs: 0, // Can be calculated: total - (processing + ipc)
    }
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.eventsProcessed = 0
    this.processingTimeMs = 0
    this.ipcSendTimeMs = 0
    this.ipcRecvTimeMs = 0
  }

  /**
   * Print metrics summary
   */
  printSummary(): void {
    const m = this.getMetrics()
    const totalTime = m.processingTimeMs + m.ipcSendTimeMs + m.ipcRecvTimeMs
    const avgProcessing = m.processingTimeMs / m.eventsProcessed
    const avgIpcSend = m.ipcSendTimeMs / m.eventsProcessed
    const avgIpcRecv = m.ipcRecvTimeMs / m.eventsProcessed

    console.log(`\n=== ${m.serviceName} Metrics ===`)
    console.log(`Events processed: ${m.eventsProcessed}`)
    console.log(
      `Processing time: ${m.processingTimeMs.toFixed(2)}ms (${((m.processingTimeMs / totalTime) * 100).toFixed(1)}%)`
    )
    console.log(
      `IPC Send time: ${m.ipcSendTimeMs.toFixed(2)}ms (${((m.ipcSendTimeMs / totalTime) * 100).toFixed(1)}%)`
    )
    console.log(
      `IPC Recv time: ${m.ipcRecvTimeMs.toFixed(2)}ms (${((m.ipcRecvTimeMs / totalTime) * 100).toFixed(1)}%)`
    )
    console.log(`Avg per event:`)
    console.log(`  Processing: ${avgProcessing.toFixed(4)}ms`)
    console.log(`  IPC Send: ${avgIpcSend.toFixed(4)}ms`)
    console.log(`  IPC Recv: ${avgIpcRecv.toFixed(4)}ms`)
  }
}

/**
 * Aggregate metrics from all services
 */
export interface PipelineMetrics {
  totalEvents: number
  totalProcessingMs: number
  totalIpcMs: number
  totalTimeMs: number
  ipcOverheadPercent: number
  services: ServiceMetrics[]
}

export function aggregatePipelineMetrics(
  serviceMetrics: ServiceMetrics[],
  totalWallClockMs: number
): PipelineMetrics {
  const totalProcessing = serviceMetrics.reduce((sum, m) => sum + m.processingTimeMs, 0)
  const totalIpcSend = serviceMetrics.reduce((sum, m) => sum + m.ipcSendTimeMs, 0)
  const totalIpcRecv = serviceMetrics.reduce((sum, m) => sum + m.ipcRecvTimeMs, 0)
  const totalIpc = totalIpcSend + totalIpcRecv
  const totalEvents = serviceMetrics[0]?.eventsProcessed || 0

  return {
    totalEvents,
    totalProcessingMs: totalProcessing,
    totalIpcMs: totalIpc,
    totalTimeMs: totalWallClockMs,
    ipcOverheadPercent: (totalIpc / totalWallClockMs) * 100,
    services: serviceMetrics,
  }
}

export function printPipelineMetrics(metrics: PipelineMetrics): void {
  console.log('\n=== Pipeline Metrics Summary ===')
  console.log(`Total events: ${metrics.totalEvents}`)
  console.log(`Total time: ${(metrics.totalTimeMs / 1000).toFixed(2)}s`)
  console.log(
    `Processing time: ${(metrics.totalProcessingMs / 1000).toFixed(2)}s (${((metrics.totalProcessingMs / metrics.totalTimeMs) * 100).toFixed(1)}%)`
  )
  console.log(
    `IPC time: ${(metrics.totalIpcMs / 1000).toFixed(2)}s (${metrics.ipcOverheadPercent.toFixed(1)}%)`
  )
  console.log(
    `Other (GC, scheduling): ${((metrics.totalTimeMs - metrics.totalProcessingMs - metrics.totalIpcMs) / 1000).toFixed(2)}s`
  )

  console.log('\n=== Batching Impact Estimate ===')
  const batchReduction = 0.95 // 95% IPC reduction with batch size 100
  const optimizedIpc = metrics.totalIpcMs * (1 - batchReduction)
  const optimizedTotal = metrics.totalProcessingMs + optimizedIpc
  const optimizedThroughput = (metrics.totalEvents / optimizedTotal) * 1000
  const currentThroughput = (metrics.totalEvents / metrics.totalTimeMs) * 1000

  console.log(`Current IPC overhead: ${(metrics.totalIpcMs / 1000).toFixed(2)}s`)
  console.log(`With batching (95% reduction): ${(optimizedIpc / 1000).toFixed(2)}s`)
  console.log(`Estimated optimized total: ${(optimizedTotal / 1000).toFixed(2)}s`)
  console.log(`Current throughput: ${currentThroughput.toFixed(0)} events/sec`)
  console.log(`Estimated optimized throughput: ${optimizedThroughput.toFixed(0)} events/sec`)
  console.log(`Improvement factor: ${(optimizedThroughput / currentThroughput).toFixed(1)}x`)
}
