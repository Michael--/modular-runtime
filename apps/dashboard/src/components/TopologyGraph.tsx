import { useMemo, useRef } from 'react'
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow'
import type { ServiceEdge, ServiceNode, TopologySnapshot } from '../types/topology'
import {
  formatServiceLanguage,
  getConnectionStateColor,
  getServiceStateColor,
  getServiceStateLabel,
} from '../utils/topologyFormat'

const GRID_GAP_X = 240
const GRID_GAP_Y = 160

interface TopologyGraphProps {
  snapshot: TopologySnapshot
}

interface GraphNodeData {
  label: JSX.Element
}

interface GraphElements {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
}

const createMissingNode = (serviceId: string, serviceName: string): ServiceNode => ({
  serviceId,
  serviceName,
  serviceType: 0,
  language: 0,
  state: 0,
  lastHeartbeatMs: '0',
  lastActivityMs: '0',
  health: 0,
})

const buildEdgeId = (edge: ServiceEdge): string => `${edge.sourceServiceId}::${edge.targetService}`

const formatRps = (value: number): number => Number(value.toFixed(1))

/** Renders the graphical topology view using React Flow. */
export const TopologyGraph = ({ snapshot }: TopologyGraphProps): JSX.Element => {
  const stableElements = useRef<{ signature: string; elements: GraphElements } | null>(null)
  const { nodes: enrichedNodes, serviceIdByName } = useMemo(() => {
    const existingNodes = [...snapshot.nodes]
    const serviceIdByName = new Map<string, string>(
      existingNodes.map((node) => [node.serviceName, node.serviceId])
    )
    const serviceIds = new Set(existingNodes.map((node) => node.serviceId))
    const missingByName = new Map<string, ServiceNode>()
    const missingById = new Map<string, ServiceNode>()

    for (const edge of snapshot.edges) {
      if (!serviceIdByName.has(edge.targetService)) {
        const placeholderId = `missing:${edge.targetService}`
        if (!missingByName.has(edge.targetService)) {
          const missingNode = createMissingNode(placeholderId, edge.targetService)
          missingByName.set(edge.targetService, missingNode)
        }
        serviceIdByName.set(edge.targetService, placeholderId)
      }

      if (!serviceIds.has(edge.sourceServiceId) && !missingById.has(edge.sourceServiceId)) {
        missingById.set(
          edge.sourceServiceId,
          createMissingNode(edge.sourceServiceId, edge.sourceServiceId)
        )
      }
    }

    return {
      nodes: [...existingNodes, ...missingByName.values(), ...missingById.values()],
      serviceIdByName,
    }
  }, [snapshot.edges, snapshot.nodes])

  const visualSignature = useMemo(() => {
    const nodeSignature = enrichedNodes
      .map((node) => `${node.serviceId}|${node.serviceName}|${node.language}|${node.state}`)
      .sort()
      .join('||')
    const edgeSignature = snapshot.edges
      .map(
        (edge) =>
          `${edge.sourceServiceId}|${edge.targetService}|${edge.state}|${formatRps(edge.rps)}`
      )
      .sort()
      .join('||')
    return `${nodeSignature}@@${edgeSignature}`
  }, [enrichedNodes, snapshot.edges])

  const positions = useMemo(() => {
    const sorted = [...enrichedNodes].sort((a, b) => a.serviceName.localeCompare(b.serviceName))
    const columns = Math.max(3, Math.ceil(Math.sqrt(sorted.length || 1)))
    const positionMap = new Map<string, { x: number; y: number }>()
    sorted.forEach((node, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      positionMap.set(node.serviceId, { x: column * GRID_GAP_X, y: row * GRID_GAP_Y })
    })
    return positionMap
  }, [enrichedNodes])

  const elements = useMemo<GraphElements>(() => {
    if (stableElements.current?.signature === visualSignature) {
      return stableElements.current.elements
    }

    const nodes = enrichedNodes.map((node) => ({
      id: node.serviceId,
      type: 'default',
      position: positions.get(node.serviceId) ?? { x: 0, y: 0 },
      data: {
        label: (
          <div className="graph-node">
            <div className="graph-node__title">{node.serviceName}</div>
            <div className="graph-node__meta">
              {formatServiceLanguage(node.language)} · {getServiceStateLabel(node.state)}
            </div>
          </div>
        ),
      },
      style: {
        background: getServiceStateColor(node.state),
        border: node.state === 4 ? '2px dashed #fbbf24' : '1px solid #0b1120',
        color: '#0f172a',
        padding: '6px 8px',
        borderRadius: '10px',
        width: 200,
      },
    }))

    const edges = snapshot.edges.map((edge) => {
      const targetId = serviceIdByName.get(edge.targetService) ?? edge.targetService
      const isActive = edge.state === 2
      const roundedRps = formatRps(edge.rps)
      return {
        id: buildEdgeId(edge),
        source: edge.sourceServiceId,
        target: targetId,
        label: roundedRps > 0 ? `${roundedRps.toFixed(1)} rps` : undefined,
        animated: isActive,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: getConnectionStateColor(edge.state),
          strokeWidth: Math.min(2 + Math.log10(roundedRps + 1), 6),
        },
      }
    })

    const next = { nodes, edges }
    stableElements.current = { signature: visualSignature, elements: next }
    return next
  }, [enrichedNodes, positions, serviceIdByName, snapshot.edges, visualSignature])

  return (
    <div className="graph-shell">
      <ReactFlow
        nodes={elements.nodes}
        edges={elements.edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
