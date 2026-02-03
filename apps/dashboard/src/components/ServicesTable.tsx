import type { ServiceNode } from '../types/topology'
import { formatTimestamp } from '../utils/formatters'
import { getServiceStateColor, getServiceStateLabel } from '../utils/topologyFormat'

interface ServicesTableProps {
  nodes: ServiceNode[]
}

/** Renders the simple runtime services table view. */
export const ServicesTable = ({ nodes }: ServicesTableProps): JSX.Element => {
  const sorted = [...nodes].sort((a, b) => a.serviceName.localeCompare(b.serviceName))

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>State</th>
          <th>Last Heartbeat</th>
          <th>Last Activity</th>
          <th>Address</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((node) => (
          <tr key={node.serviceId}>
            <td>{node.serviceName}</td>
            <td>
              <span className="pill" style={{ background: getServiceStateColor(node.state) }}>
                {getServiceStateLabel(node.state)}
              </span>
            </td>
            <td>{formatTimestamp(node.lastHeartbeatMs)}</td>
            <td>{formatTimestamp(node.lastActivityMs)}</td>
            <td>{node.address ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
