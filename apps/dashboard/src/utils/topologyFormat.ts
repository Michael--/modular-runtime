import type { ConnectionState, ServiceState } from '../types/topology'

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

const LANGUAGE_LABELS: Record<number, string> = {
  1: 'TypeScript',
  2: 'Rust',
  3: 'C++',
  4: 'Go',
  5: 'Python',
  6: 'Java',
  7: 'C#',
}

/** Returns the label for a service state value. */
export const getServiceStateLabel = (state: ServiceState): string =>
  SERVICE_STATE_LABELS[state] ?? 'Unknown'

/** Returns the color for a service state value. */
export const getServiceStateColor = (state: ServiceState): string =>
  SERVICE_STATE_COLORS[state] ?? '#64748b'

/** Returns the label for a connection state value. */
export const getConnectionStateLabel = (state: ConnectionState): string =>
  CONNECTION_STATE_LABELS[state] ?? 'Unknown'

/** Returns the color for a connection state value. */
export const getConnectionStateColor = (state: ConnectionState): string =>
  CONNECTION_STATE_COLORS[state] ?? '#64748b'

/** Returns a human-friendly label for a service language value. */
export const formatServiceLanguage = (language: number): string =>
  LANGUAGE_LABELS[language] ?? 'Unknown'
