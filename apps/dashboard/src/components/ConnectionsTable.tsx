import type { ServiceEdge } from '../types/topology'
import { getConnectionStateColor, getConnectionStateLabel } from '../utils/topologyFormat'

interface ConnectionsTableProps {
  edges: ServiceEdge[]
}

const edgeKey = (edge: ServiceEdge): string => `${edge.sourceServiceId}::${edge.targetService}`

/** Renders the simple runtime connections table view. */
export const ConnectionsTable = ({ edges }: ConnectionsTableProps): JSX.Element => {
  const sorted = [...edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))

  return (
    <table>
      <thead>
        <tr>
          <th>Source ID</th>
          <th>Target Service</th>
          <th>State</th>
          <th>RPS</th>
          <th>Avg Latency</th>
          <th>Total Requests</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((edge) => (
          <tr key={edgeKey(edge)}>
            <td>{edge.sourceServiceId}</td>
            <td>{edge.targetService}</td>
            <td>
              <span className="pill" style={{ background: getConnectionStateColor(edge.state) }}>
                {getConnectionStateLabel(edge.state)}
              </span>
            </td>
            <td>{edge.rps.toFixed(2)}</td>
            <td>{edge.avgLatencyMs.toFixed(1)} ms</td>
            <td>{edge.totalRequests}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
