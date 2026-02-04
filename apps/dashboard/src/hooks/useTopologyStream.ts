import { useEffect, useState } from 'react'
import type { ServiceEdge, ServiceNode, TopologySnapshot, TopologyUpdate } from '../types/topology'

const UPDATE_TYPE_SNAPSHOT = 1
const UPDATE_TYPE_NODE_ADDED = 2
const UPDATE_TYPE_NODE_UPDATED = 3
const UPDATE_TYPE_NODE_REMOVED = 4
const UPDATE_TYPE_EDGE_ADDED = 5
const UPDATE_TYPE_EDGE_UPDATED = 6
const UPDATE_TYPE_EDGE_REMOVED = 7

const DEFAULT_STREAM_URL =
  import.meta.env.VITE_TOPOLOGY_STREAM_URL ?? 'http://127.0.0.1:50054/events'

type ConnectionStatus = 'connecting' | 'live' | 'error'

const initialSnapshot: TopologySnapshot = {
  nodes: [],
  edges: [],
  timestampMs: '0',
}

const removeNode = (
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  node: ServiceNode
): TopologySnapshot => ({
  nodes: nodes.filter((item) => item.serviceId !== node.serviceId),
  edges: edges.filter(
    (edge) => edge.sourceServiceId !== node.serviceId && edge.targetService !== node.serviceName
  ),
  timestampMs: Date.now().toString(),
})

const upsertNode = (
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  node: ServiceNode
): TopologySnapshot => {
  const index = nodes.findIndex((item) => item.serviceId === node.serviceId)
  if (index === -1) {
    return {
      nodes: [...nodes, node],
      edges,
      timestampMs: Date.now().toString(),
    }
  }
  return {
    nodes: nodes.map((item) => (item.serviceId === node.serviceId ? node : item)),
    edges,
    timestampMs: Date.now().toString(),
  }
}

const edgeKey = (edge: ServiceEdge): string => `${edge.sourceServiceId}::${edge.targetService}`

const areServiceNodesEqual = (left: ServiceNode, right: ServiceNode): boolean =>
  left.serviceId === right.serviceId &&
  left.serviceName === right.serviceName &&
  left.serviceType === right.serviceType &&
  left.language === right.language &&
  left.version === right.version &&
  left.address === right.address &&
  left.host === right.host &&
  left.state === right.state &&
  left.lastHeartbeatMs === right.lastHeartbeatMs &&
  left.lastActivityMs === right.lastActivityMs &&
  left.health === right.health

const areServiceEdgesEqual = (left: ServiceEdge, right: ServiceEdge): boolean =>
  left.sourceServiceId === right.sourceServiceId &&
  left.targetService === right.targetService &&
  left.state === right.state &&
  left.lastActivityMs === right.lastActivityMs &&
  left.totalRequests === right.totalRequests &&
  left.totalErrors === right.totalErrors &&
  left.avgLatencyMs === right.avgLatencyMs &&
  left.rps === right.rps

const areSnapshotsEqual = (left: TopologySnapshot, right: TopologySnapshot): boolean => {
  if (left === right) {
    return true
  }
  if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) {
    return false
  }
  const leftNodes = new Map(left.nodes.map((node) => [node.serviceId, node]))
  const rightNodes = new Map(right.nodes.map((node) => [node.serviceId, node]))
  if (leftNodes.size !== rightNodes.size) {
    return false
  }
  for (const [id, node] of leftNodes.entries()) {
    const match = rightNodes.get(id)
    if (!match || !areServiceNodesEqual(node, match)) {
      return false
    }
  }

  const leftEdges = new Map(left.edges.map((edge) => [edgeKey(edge), edge]))
  const rightEdges = new Map(right.edges.map((edge) => [edgeKey(edge), edge]))
  if (leftEdges.size !== rightEdges.size) {
    return false
  }
  for (const [id, edge] of leftEdges.entries()) {
    const match = rightEdges.get(id)
    if (!match || !areServiceEdgesEqual(edge, match)) {
      return false
    }
  }

  return true
}

const removeEdge = (
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  edge: ServiceEdge
): TopologySnapshot => ({
  nodes,
  edges: edges.filter((item) => edgeKey(item) !== edgeKey(edge)),
  timestampMs: Date.now().toString(),
})

const upsertEdge = (
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  edge: ServiceEdge
): TopologySnapshot => {
  const key = edgeKey(edge)
  const index = edges.findIndex((item) => edgeKey(item) === key)
  if (index === -1) {
    return {
      nodes,
      edges: [...edges, edge],
      timestampMs: Date.now().toString(),
    }
  }
  return {
    nodes,
    edges: edges.map((item) => (edgeKey(item) === key ? edge : item)),
    timestampMs: Date.now().toString(),
  }
}

const applyUpdate = (snapshot: TopologySnapshot, update: TopologyUpdate): TopologySnapshot => {
  if (update.type === UPDATE_TYPE_SNAPSHOT && update.snapshot) {
    return update.snapshot
  }

  if (update.node) {
    if (update.type === UPDATE_TYPE_NODE_REMOVED) {
      return removeNode(snapshot.nodes, snapshot.edges, update.node)
    }
    if (update.type === UPDATE_TYPE_NODE_ADDED || update.type === UPDATE_TYPE_NODE_UPDATED) {
      return upsertNode(snapshot.nodes, snapshot.edges, update.node)
    }
  }

  if (update.edge) {
    if (update.type === UPDATE_TYPE_EDGE_REMOVED) {
      return removeEdge(snapshot.nodes, snapshot.edges, update.edge)
    }
    if (update.type === UPDATE_TYPE_EDGE_ADDED || update.type === UPDATE_TYPE_EDGE_UPDATED) {
      return upsertEdge(snapshot.nodes, snapshot.edges, update.edge)
    }
  }

  return snapshot
}

/** Live topology state derived from the SSE stream. */
export interface TopologyStreamState {
  status: ConnectionStatus
  snapshot: TopologySnapshot
  lastEventMs: string
  streamUrl: string
}

/** Connects to the topology SSE stream and keeps a live snapshot in state. */
export const useTopologyStream = (streamUrl: string = DEFAULT_STREAM_URL): TopologyStreamState => {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(initialSnapshot)
  const [lastEventMs, setLastEventMs] = useState('0')

  useEffect(() => {
    setStatus('connecting')
    const source = new EventSource(streamUrl)

    source.onopen = () => {
      setStatus('live')
    }

    source.onerror = () => {
      setStatus('error')
      setSnapshot(initialSnapshot)
    }

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const update = JSON.parse(event.data) as TopologyUpdate
        setSnapshot((current) => {
          const next = applyUpdate(current, update)
          if (areSnapshotsEqual(current, next)) {
            return current
          }
          setLastEventMs(Date.now().toString())
          return next
        })
      } catch {
        setStatus('error')
      }
    }

    return () => {
      source.close()
    }
  }, [streamUrl])

  return { status, snapshot, lastEventMs, streamUrl }
}
