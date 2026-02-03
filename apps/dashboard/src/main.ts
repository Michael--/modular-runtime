type UpdateType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

type ServiceState = 0 | 1 | 2 | 3 | 4 | 5
type ConnectionState = 0 | 1 | 2 | 3

interface ServiceNode {
  serviceId: string
  serviceName: string
  serviceType: number
  language: number
  version?: string
  address?: string
  host?: string
  state: ServiceState
  lastHeartbeatMs: string
  lastActivityMs: string
  health: number
}

interface ServiceEdge {
  sourceServiceId: string
  targetService: string
  state: ConnectionState
  lastActivityMs: string
  totalRequests: string
  totalErrors: string
  avgLatencyMs: number
  rps: number
}

interface TopologySnapshot {
  nodes: ServiceNode[]
  edges: ServiceEdge[]
  timestampMs: string
}

interface TopologyUpdate {
  type: UpdateType
  node?: ServiceNode
  edge?: ServiceEdge
  snapshot?: TopologySnapshot
}

const UPDATE_TYPE_SNAPSHOT: UpdateType = 1
const UPDATE_TYPE_NODE_ADDED: UpdateType = 2
const UPDATE_TYPE_NODE_UPDATED: UpdateType = 3
const UPDATE_TYPE_NODE_REMOVED: UpdateType = 4
const UPDATE_TYPE_EDGE_ADDED: UpdateType = 5
const UPDATE_TYPE_EDGE_UPDATED: UpdateType = 6
const UPDATE_TYPE_EDGE_REMOVED: UpdateType = 7

const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  0: 'Unknown',
  1: 'Registered',
  2: 'Idle',
  3: 'Active',
  4: 'Stale',
  5: 'Dead',
}

const SERVICE_STATE_COLORS: Record<ServiceState, string> = {
  0: '#64748b',
  1: '#38bdf8',
  2: '#94a3b8',
  3: '#22c55e',
  4: '#f59e0b',
  5: '#ef4444',
}

const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  0: 'Unknown',
  1: 'Idle',
  2: 'Active',
  3: 'Failed',
}

const CONNECTION_STATE_COLORS: Record<ConnectionState, string> = {
  0: '#64748b',
  1: '#94a3b8',
  2: '#38bdf8',
  3: '#ef4444',
}

const STREAM_URL = 'http://127.0.0.1:50054/events'

const getElement = <T extends HTMLElement>(selector: string, label: string): T => {
  const element = document.querySelector(selector)
  if (!element) {
    throw new Error(`Missing required element: ${label}`)
  }
  return element as T
}

const elements = {
  status: getElement<HTMLSpanElement>('[data-status]', 'status indicator'),
  servicesCount: getElement<HTMLSpanElement>('[data-services]', 'services count'),
  connectionsCount: getElement<HTMLSpanElement>('[data-connections]', 'connections count'),
  lastUpdate: getElement<HTMLSpanElement>('[data-last-update]', 'last update'),
  nodesTable: getElement<HTMLTableSectionElement>('[data-nodes]', 'nodes table'),
  edgesTable: getElement<HTMLTableSectionElement>('[data-edges]', 'edges table'),
}

const state: TopologySnapshot = {
  nodes: [],
  edges: [],
  timestampMs: '0',
}

const updateStatus = (status: 'connecting' | 'live' | 'error'): void => {
  elements.status.textContent = status
  elements.status.dataset.status = status
}

const applySnapshot = (snapshot: TopologySnapshot): void => {
  state.nodes = snapshot.nodes
  state.edges = snapshot.edges
  state.timestampMs = snapshot.timestampMs
}

const removeNode = (node: ServiceNode): void => {
  state.nodes = state.nodes.filter((item) => item.serviceId !== node.serviceId)
  state.edges = state.edges.filter(
    (edge) => edge.sourceServiceId !== node.serviceId && edge.targetService !== node.serviceName
  )
}

const upsertNode = (node: ServiceNode): void => {
  const index = state.nodes.findIndex((item) => item.serviceId === node.serviceId)
  if (index === -1) {
    state.nodes = [...state.nodes, node]
    return
  }
  state.nodes = state.nodes.map((item) => (item.serviceId === node.serviceId ? node : item))
}

const edgeKey = (edge: ServiceEdge): string => `${edge.sourceServiceId}::${edge.targetService}`

const removeEdge = (edge: ServiceEdge): void => {
  const key = edgeKey(edge)
  state.edges = state.edges.filter((item) => edgeKey(item) !== key)
}

const upsertEdge = (edge: ServiceEdge): void => {
  const key = edgeKey(edge)
  const index = state.edges.findIndex((item) => edgeKey(item) === key)
  if (index === -1) {
    state.edges = [...state.edges, edge]
    return
  }
  state.edges = state.edges.map((item) => (edgeKey(item) === key ? edge : item))
}

const applyUpdate = (update: TopologyUpdate): void => {
  if (update.type === UPDATE_TYPE_SNAPSHOT && update.snapshot) {
    applySnapshot(update.snapshot)
    return
  }

  if (update.node) {
    if (update.type === UPDATE_TYPE_NODE_REMOVED) {
      removeNode(update.node)
      return
    }
    if (update.type === UPDATE_TYPE_NODE_ADDED || update.type === UPDATE_TYPE_NODE_UPDATED) {
      upsertNode(update.node)
    }
  }

  if (update.edge) {
    if (update.type === UPDATE_TYPE_EDGE_REMOVED) {
      removeEdge(update.edge)
      return
    }
    if (update.type === UPDATE_TYPE_EDGE_ADDED || update.type === UPDATE_TYPE_EDGE_UPDATED) {
      upsertEdge(update.edge)
    }
  }
}

const formatTimestamp = (value: string): string => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return '-'
  }
  return new Date(parsed).toLocaleTimeString()
}

const renderNodes = (): void => {
  const sorted = [...state.nodes].sort((a, b) => a.serviceName.localeCompare(b.serviceName))
  elements.nodesTable.innerHTML = ''
  for (const node of sorted) {
    const row = document.createElement('tr')
    row.innerHTML = `
      <td>${node.serviceName}</td>
      <td><span class="pill" style="background:${SERVICE_STATE_COLORS[node.state]}">${SERVICE_STATE_LABELS[node.state]}</span></td>
      <td>${formatTimestamp(node.lastHeartbeatMs)}</td>
      <td>${formatTimestamp(node.lastActivityMs)}</td>
      <td>${node.address ?? '-'}</td>
    `
    elements.nodesTable.appendChild(row)
  }
}

const renderEdges = (): void => {
  const sorted = [...state.edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
  elements.edgesTable.innerHTML = ''
  for (const edge of sorted) {
    const row = document.createElement('tr')
    row.innerHTML = `
      <td>${edge.sourceServiceId}</td>
      <td>${edge.targetService}</td>
      <td><span class="pill" style="background:${CONNECTION_STATE_COLORS[edge.state]}">${CONNECTION_STATE_LABELS[edge.state]}</span></td>
      <td>${edge.rps.toFixed(2)}</td>
      <td>${edge.avgLatencyMs.toFixed(1)} ms</td>
      <td>${edge.totalRequests}</td>
    `
    elements.edgesTable.appendChild(row)
  }
}

const renderSummary = (): void => {
  elements.servicesCount.textContent = state.nodes.length.toString()
  elements.connectionsCount.textContent = state.edges.length.toString()
  elements.lastUpdate.textContent = formatTimestamp(state.timestampMs)
}

const render = (): void => {
  renderSummary()
  renderNodes()
  renderEdges()
}

const connect = (): void => {
  updateStatus('connecting')
  const source = new EventSource(STREAM_URL)

  source.onopen = () => {
    updateStatus('live')
  }

  source.onerror = () => {
    updateStatus('error')
  }

  source.onmessage = (event) => {
    try {
      const update = JSON.parse(event.data) as TopologyUpdate
      applyUpdate(update)
      render()
    } catch {
      updateStatus('error')
    }
  }
}

connect()
