import { Badge, Table } from '@mantine/core'
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
    <Table withTableBorder highlightOnHover striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Source ID</Table.Th>
          <Table.Th>Target Service</Table.Th>
          <Table.Th>State</Table.Th>
          <Table.Th>RPS</Table.Th>
          <Table.Th>Avg Latency</Table.Th>
          <Table.Th>Total Requests</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((edge) => (
          <Table.Tr key={edgeKey(edge)}>
            <Table.Td>{edge.sourceServiceId}</Table.Td>
            <Table.Td>{edge.targetService}</Table.Td>
            <Table.Td>
              <Badge
                variant="filled"
                radius="sm"
                size="sm"
                style={{
                  backgroundColor: getConnectionStateColor(edge.state),
                  color: '#0b1120',
                  textTransform: 'uppercase',
                }}
              >
                {getConnectionStateLabel(edge.state)}
              </Badge>
            </Table.Td>
            <Table.Td>{edge.rps.toFixed(1)}</Table.Td>
            <Table.Td>{edge.avgLatencyMs.toFixed(1)} ms</Table.Td>
            <Table.Td>{edge.totalRequests}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
