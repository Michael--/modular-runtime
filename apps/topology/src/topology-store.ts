import { randomUUID } from 'node:crypto'
import {
  ActivityType,
  ConnectionState,
  HealthState,
  ServiceState,
  UpdateType,
  type ReportActivityRequest,
  type HeartbeatRequest,
  type RegisterServiceRequest,
  type ServiceEdge,
  type ServiceHandle,
  type ServiceNode,
  type TopologySnapshot,
  type TopologyUpdate,
} from '../../../packages/proto/generated/ts/runtime/v1/topology'

interface ServiceRecord {
  node: ServiceNode
  lastHeartbeatMs: number
  lastActivityMs: number
  lastNodeUpdateMs: number
  heartbeatIntervalMs: number
  timeoutMultiplier: number
}

interface EdgeRecord {
  edge: ServiceEdge
  lastActivityMs: number
  lastFlushMs: number
  pendingCount: number
  pendingErrorCount: number
  pendingLatencyTotal: number
  totalCount: number
  totalErrorCount: number
  avgLatencyMs: number
}

const buildServiceKey = (node: ServiceNode): string => {
  const serviceInterface = node.metadata?.serviceInterface?.trim()
  const serviceRole = node.metadata?.serviceRole?.trim()
  if (serviceInterface) {
    return serviceRole ? `${serviceInterface}::${serviceRole}` : serviceInterface
  }
  return node.serviceName
}

const buildServiceKeys = (node: ServiceNode): Set<string> => {
  const keys = new Set<string>()
  keys.add(node.serviceName)

  const serviceKey = buildServiceKey(node)
  keys.add(serviceKey)

  const address = node.address?.trim()
  if (address) {
    keys.add(address)
    if (serviceKey) {
      keys.add(`${serviceKey}@${address}`)
    }
  }

  return keys
}

/**
 * Configuration options for the topology store.
 */
export interface TopologyStoreOptions {
  /** Heartbeat interval in milliseconds. */
  heartbeatIntervalMs?: number
  /** Number of missed heartbeats before a service is considered dead. */
  timeoutMultiplier?: number
  /** Idle timeout before active services become idle. */
  idleTimeoutMs?: number
  /** Activity aggregation flush interval. */
  activityFlushMs?: number
  /** Throttle interval for node update broadcasts. */
  nodeUpdateThrottleMs?: number
  /** Custom time provider for deterministic tests. */
  now?: () => number
  /** Custom service ID generator for deterministic tests. */
  generateId?: () => string
}

/**
 * Result returned after registering a service.
 */
export interface RegisterServiceResult {
  handle: ServiceHandle
  updates: TopologyUpdate[]
}

/**
 * In-memory topology state with heartbeat and activity aggregation.
 */
export class TopologyStore {
  private readonly services = new Map<string, ServiceRecord>()
  private readonly edges = new Map<string, EdgeRecord>()
  private readonly serviceNameIndex = new Map<string, string>()
  private readonly heartbeatIntervalMs: number
  private readonly timeoutMultiplier: number
  private readonly idleTimeoutMs: number
  private readonly activityFlushMs: number
  private readonly nodeUpdateThrottleMs: number
  private readonly now: () => number
  private readonly generateId: () => string
  private lastActivityFlushMs: number

  public constructor(options: TopologyStoreOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000
    this.timeoutMultiplier = options.timeoutMultiplier ?? 3
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30000
    this.activityFlushMs = options.activityFlushMs ?? 1000
    this.nodeUpdateThrottleMs = options.nodeUpdateThrottleMs ?? 5000
    this.now = options.now ?? (() => Date.now())
    this.generateId = options.generateId ?? (() => randomUUID())
    this.lastActivityFlushMs = this.now()
  }

  /**
   * Registers a service and returns a handle plus topology updates.
   * @param request Registration request.
   * @param nowMs Optional timestamp override.
   * @returns Service handle and updates to broadcast.
   */
  public registerService(request: RegisterServiceRequest, nowMs?: number): RegisterServiceResult {
    const now = this.getNow(nowMs)
    const serviceId = this.generateId()
    const handle: ServiceHandle = {
      serviceId,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      timeoutMultiplier: this.timeoutMultiplier,
    }

    const node: ServiceNode = {
      serviceId,
      serviceName: request.serviceName,
      serviceType: request.serviceType,
      language: request.language,
      version: request.version,
      address: request.address,
      host: request.host,
      metadata: request.metadata,
      state: ServiceState.SERVICE_STATE_REGISTERED,
      lastHeartbeatMs: String(now),
      lastActivityMs: '0',
      health: HealthState.HEALTH_STATE_UNKNOWN,
    }

    const record: ServiceRecord = {
      node,
      lastHeartbeatMs: now,
      lastActivityMs: 0,
      lastNodeUpdateMs: now,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      timeoutMultiplier: this.timeoutMultiplier,
    }

    this.services.set(serviceId, record)
    this.serviceNameIndex.set(request.serviceName, serviceId)

    return {
      handle,
      updates: [this.createNodeUpdate(UpdateType.UPDATE_TYPE_NODE_ADDED, node)],
    }
  }

  /**
   * Unregisters a service and returns topology updates.
   * @param serviceId Service identifier.
   * @returns Updates to broadcast.
   */
  public unregisterService(serviceId: string): TopologyUpdate[] {
    return this.removeService(serviceId, UpdateType.UPDATE_TYPE_NODE_REMOVED)
  }

  /**
   * Records a heartbeat and returns any topology updates.
   * @param request Heartbeat payload.
   * @param nowMs Optional timestamp override.
   * @returns Updates to broadcast.
   */
  public recordHeartbeat(request: HeartbeatRequest, nowMs?: number): TopologyUpdate[] {
    const record = this.services.get(request.serviceId)
    if (!record) {
      return []
    }

    const now = this.getNow(nowMs)
    record.lastHeartbeatMs = now
    record.node.lastHeartbeatMs = String(now)

    const updates: TopologyUpdate[] = []
    let forceUpdate = false
    const nextState =
      record.lastActivityMs > 0
        ? ServiceState.SERVICE_STATE_IDLE
        : ServiceState.SERVICE_STATE_REGISTERED
    if (record.node.state === ServiceState.SERVICE_STATE_STALE) {
      record.node.state = nextState
      forceUpdate = true
    }

    if (request.health?.state !== undefined && request.health.state !== record.node.health) {
      record.node.health = request.health.state
      forceUpdate = true
    }

    if (forceUpdate || this.shouldEmitNodeUpdate(record, now)) {
      this.queueNodeUpdate(record, updates, now)
    }

    return updates
  }

  /**
   * Records an activity event and returns immediate topology updates.
   * @param event Activity event payload.
   * @param nowMs Optional timestamp override.
   * @returns Updates to broadcast immediately.
   */
  public recordActivity(event: ReportActivityRequest, nowMs?: number): TopologyUpdate[] {
    const record = this.services.get(event.serviceId)
    if (!record) {
      return []
    }

    const now = this.getNow(nowMs)
    record.lastActivityMs = now
    record.node.lastActivityMs = String(now)

    const updates: TopologyUpdate[] = []
    let forceUpdate = false
    if (record.node.state !== ServiceState.SERVICE_STATE_ACTIVE) {
      record.node.state = ServiceState.SERVICE_STATE_ACTIVE
      forceUpdate = true
    }

    if (forceUpdate || this.shouldEmitNodeUpdate(record, now)) {
      this.queueNodeUpdate(record, updates, now)
    }

    const edgeKey = this.edgeKey(event.serviceId, event.targetService)
    const edgeRecord = this.edges.get(edgeKey)

    if (!edgeRecord) {
      const edge: ServiceEdge = {
        sourceServiceId: event.serviceId,
        targetService: event.targetService,
        state: ConnectionState.CONNECTION_STATE_ACTIVE,
        lastActivityMs: String(now),
        totalRequests: '0',
        totalErrors: '0',
        avgLatencyMs: 0,
        rps: 0,
      }

      const created: EdgeRecord = {
        edge,
        lastActivityMs: now,
        lastFlushMs: now,
        pendingCount: 0,
        pendingErrorCount: 0,
        pendingLatencyTotal: 0,
        totalCount: 0,
        totalErrorCount: 0,
        avgLatencyMs: 0,
      }

      this.edges.set(edgeKey, created)
      updates.push(this.createEdgeUpdate(UpdateType.UPDATE_TYPE_EDGE_ADDED, edge))
    }

    const activeEdge = this.edges.get(edgeKey)
    if (!activeEdge) {
      return updates
    }

    const batchSize = Math.max(1, event.batchSize ?? 1)
    activeEdge.pendingCount += batchSize
    activeEdge.pendingLatencyTotal += (event.latencyMs ?? 0) * batchSize
    if (event.type === ActivityType.ACTIVITY_TYPE_ERROR || event.success === false) {
      activeEdge.pendingErrorCount += batchSize
    }
    activeEdge.lastActivityMs = now
    activeEdge.edge.lastActivityMs = String(now)
    activeEdge.edge.state = ConnectionState.CONNECTION_STATE_ACTIVE

    return updates
  }

  /**
   * Flushes aggregated activity and returns topology updates.
   * @param nowMs Optional timestamp override.
   * @returns Updates to broadcast.
   */
  public flushActivity(nowMs?: number): TopologyUpdate[] {
    const now = this.getNow(nowMs)
    const elapsedMs = Math.max(1, now - this.lastActivityFlushMs)
    const elapsedSeconds = elapsedMs / 1000
    this.lastActivityFlushMs = now

    const updates: TopologyUpdate[] = []
    for (const edgeRecord of this.edges.values()) {
      if (edgeRecord.pendingCount === 0) {
        continue
      }

      edgeRecord.totalCount += edgeRecord.pendingCount
      edgeRecord.totalErrorCount += edgeRecord.pendingErrorCount

      const newLatencyTotal = edgeRecord.pendingLatencyTotal
      const previousCount = edgeRecord.totalCount - edgeRecord.pendingCount
      const previousLatencyTotal = edgeRecord.avgLatencyMs * Math.max(0, previousCount)
      const combinedCount = edgeRecord.totalCount
      edgeRecord.avgLatencyMs =
        combinedCount === 0 ? 0 : (previousLatencyTotal + newLatencyTotal) / combinedCount

      edgeRecord.edge.totalRequests = String(edgeRecord.totalCount)
      edgeRecord.edge.totalErrors = String(edgeRecord.totalErrorCount)
      edgeRecord.edge.avgLatencyMs = edgeRecord.avgLatencyMs
      edgeRecord.edge.rps = edgeRecord.pendingCount / elapsedSeconds

      edgeRecord.pendingCount = 0
      edgeRecord.pendingErrorCount = 0
      edgeRecord.pendingLatencyTotal = 0
      edgeRecord.lastFlushMs = now

      updates.push(this.createEdgeUpdate(UpdateType.UPDATE_TYPE_EDGE_UPDATED, edgeRecord.edge))
    }

    return updates
  }

  /**
   * Sweeps for stale/dead services and idle edges.
   * @param nowMs Optional timestamp override.
   * @returns Updates to broadcast.
   */
  public sweep(nowMs?: number): TopologyUpdate[] {
    const now = this.getNow(nowMs)
    const updates: TopologyUpdate[] = []

    for (const [serviceId, record] of this.services.entries()) {
      const elapsed = now - record.lastHeartbeatMs
      const timeoutMs = record.heartbeatIntervalMs * record.timeoutMultiplier

      if (elapsed > timeoutMs) {
        updates.push(...this.removeService(serviceId, UpdateType.UPDATE_TYPE_NODE_REMOVED))
        continue
      }

      if (
        elapsed > record.heartbeatIntervalMs * 2 &&
        record.node.state !== ServiceState.SERVICE_STATE_STALE
      ) {
        record.node.state = ServiceState.SERVICE_STATE_STALE
        this.queueNodeUpdate(record, updates, now)
      }

      if (record.node.state === ServiceState.SERVICE_STATE_ACTIVE) {
        const idleElapsed = now - record.lastActivityMs
        if (record.lastActivityMs > 0 && idleElapsed > this.idleTimeoutMs) {
          record.node.state = ServiceState.SERVICE_STATE_IDLE
          this.queueNodeUpdate(record, updates, now)
        }
      }
    }

    for (const edgeRecord of this.edges.values()) {
      if (edgeRecord.edge.state === ConnectionState.CONNECTION_STATE_ACTIVE) {
        const idleElapsed = now - edgeRecord.lastActivityMs
        if (idleElapsed > this.idleTimeoutMs) {
          edgeRecord.edge.state = ConnectionState.CONNECTION_STATE_IDLE
          updates.push(this.createEdgeUpdate(UpdateType.UPDATE_TYPE_EDGE_UPDATED, edgeRecord.edge))
        }
      }
    }

    return updates
  }

  /**
   * Returns the current topology snapshot.
   * @param nowMs Optional timestamp override.
   * @returns Snapshot of nodes and edges.
   */
  public snapshot(nowMs?: number): TopologySnapshot {
    const now = this.getNow(nowMs)
    return {
      nodes: Array.from(this.services.values()).map((record) => record.node),
      edges: Array.from(this.edges.values()).map((record) => record.edge),
      timestampMs: String(now),
    }
  }

  private removeService(serviceId: string, updateType: UpdateType): TopologyUpdate[] {
    const record = this.services.get(serviceId)
    if (!record) {
      return []
    }
    const serviceKeys = buildServiceKeys(record.node)

    const updates: TopologyUpdate[] = []
    this.services.delete(serviceId)
    this.serviceNameIndex.delete(record.node.serviceName)
    updates.push(this.createNodeUpdate(updateType, record.node))

    for (const [edgeKey, edgeRecord] of this.edges.entries()) {
      if (
        edgeRecord.edge.sourceServiceId === serviceId ||
        serviceKeys.has(edgeRecord.edge.targetService)
      ) {
        this.edges.delete(edgeKey)
        updates.push(this.createEdgeUpdate(UpdateType.UPDATE_TYPE_EDGE_REMOVED, edgeRecord.edge))
      }
    }

    return updates
  }

  private edgeKey(sourceServiceId: string, targetService: string): string {
    return `${sourceServiceId}::${targetService}`
  }

  private getNow(nowMs?: number): number {
    return nowMs ?? this.now()
  }

  private shouldEmitNodeUpdate(record: ServiceRecord, now: number): boolean {
    if (this.nodeUpdateThrottleMs <= 0) {
      return true
    }
    return now - record.lastNodeUpdateMs >= this.nodeUpdateThrottleMs
  }

  private queueNodeUpdate(record: ServiceRecord, updates: TopologyUpdate[], now: number): void {
    updates.push(this.createNodeUpdate(UpdateType.UPDATE_TYPE_NODE_UPDATED, record.node))
    record.lastNodeUpdateMs = now
  }

  private createNodeUpdate(type: UpdateType, node: ServiceNode): TopologyUpdate {
    return { type, node }
  }

  private createEdgeUpdate(type: UpdateType, edge: ServiceEdge): TopologyUpdate {
    return { type, edge }
  }
}
