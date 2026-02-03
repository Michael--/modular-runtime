import { Badge } from '@mantine/core'

type StatusValue = 'connecting' | 'live' | 'error'

interface StatusPillProps {
  status: StatusValue
}

const STATUS_COLORS: Record<StatusValue, string> = {
  live: '#14b8a6',
  error: '#f97316',
  connecting: '#38bdf8',
}

/** Renders the live connection status pill. */
export const StatusPill = ({ status }: StatusPillProps): JSX.Element => (
  <Badge
    className="status-pill"
    radius="sm"
    size="sm"
    variant="filled"
    style={{ backgroundColor: STATUS_COLORS[status], color: '#0b1120' }}
  >
    {status}
  </Badge>
)
