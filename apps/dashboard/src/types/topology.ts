/** Update type values emitted by the topology stream. */
export type UpdateType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Service lifecycle states used by the topology snapshot. */
export type ServiceState = 0 | 1 | 2 | 3 | 4 | 5

/** Connection lifecycle states used by the topology snapshot. */
export type ConnectionState = 0 | 1 | 2 | 3

/** Topology node describing a registered service. */
export interface ServiceNode {
  serviceId: string
  serviceName: string
  serviceType: number
  language: number
  version?: string
  address?: string
  host?: string
  metadata?: ServiceMetadata
  state: ServiceState
  lastHeartbeatMs: string
  lastActivityMs: string
  health: number
}

/** Optional metadata attached to a service. */
export interface ServiceMetadata {
  region?: string
  environment?: string
  team?: string
  versionHash?: string
  serviceInterface?: string
  serviceRole?: string
  programName?: string
}

/** Topology edge describing a connection between services. */
export interface ServiceEdge {
  sourceServiceId: string
  targetService: string
  state: ConnectionState
  lastActivityMs: string
  totalRequests: string
  totalErrors: string
  avgLatencyMs: number
  rps: number
}

/** Snapshot containing all nodes and edges in the topology. */
export interface TopologySnapshot {
  nodes: ServiceNode[]
  edges: ServiceEdge[]
  timestampMs: string
}

/** Update message delivered by the topology SSE endpoint. */
export interface TopologyUpdate {
  type: UpdateType
  node?: ServiceNode
  edge?: ServiceEdge
  snapshot?: TopologySnapshot
}
