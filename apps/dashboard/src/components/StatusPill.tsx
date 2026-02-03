type StatusValue = 'connecting' | 'live' | 'error'

interface StatusPillProps {
  status: StatusValue
}

/** Renders the live connection status pill. */
export const StatusPill = ({ status }: StatusPillProps): JSX.Element => (
  <span className="status-pill" data-status={status}>
    {status}
  </span>
)
