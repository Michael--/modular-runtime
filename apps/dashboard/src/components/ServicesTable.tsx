import { Badge, Table, Text } from '@mantine/core'
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
    <Table withTableBorder highlightOnHover striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>State</Table.Th>
          <Table.Th>Last Heartbeat</Table.Th>
          <Table.Th>Last Activity</Table.Th>
          <Table.Th>Address</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((node) => (
          <Table.Tr key={node.serviceId}>
            <Table.Td>{node.serviceName}</Table.Td>
            <Table.Td>
              <Badge
                variant="filled"
                radius="sm"
                size="sm"
                style={{
                  backgroundColor: getServiceStateColor(node.state),
                  color: '#0b1120',
                  textTransform: 'uppercase',
                }}
              >
                {getServiceStateLabel(node.state)}
              </Badge>
            </Table.Td>
            <Table.Td>{formatTimestamp(node.lastHeartbeatMs)}</Table.Td>
            <Table.Td>{formatTimestamp(node.lastActivityMs)}</Table.Td>
            <Table.Td>
              <Text size="sm" c="dimmed">
                {node.address ?? '-'}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
