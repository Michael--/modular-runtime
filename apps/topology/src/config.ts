/**
 * Configuration for the topology service.
 */
export interface TopologyServiceConfig {
  /** gRPC bind address (e.g. "127.0.0.1:50053"). */
  address: string
  /** Heartbeat interval in milliseconds. */
  heartbeatIntervalMs: number
  /** Number of missed heartbeats before a service is considered stale. */
  timeoutMultiplier: number
  /** Idle timeout before active services become idle. */
  idleTimeoutMs: number
  /** Timeout before removing idle edges with unresolved targets. */
  unknownEdgeTimeoutMs?: number
  /** Window size in milliseconds for RPS averaging. */
  rpsWindowMs?: number
  /** Activity aggregation flush interval. */
  activityFlushMs: number
  /** Throttle interval for node update broadcasts. */
  nodeUpdateThrottleMs: number
  /** Sweep interval for stale services. */
  sweepIntervalMs: number
}

/**
 * Configuration for the topology SSE proxy.
 */
export interface TopologyProxyConfig {
  /** gRPC address for the topology service. */
  grpcAddress: string
  /** HTTP port for the proxy server. */
  httpPort: number
}

/**
 * Configuration for the topology reporter proxy.
 */
export interface TopologyReporterProxyConfig {
  /** Topology service address used by the reporter. */
  topologyAddress: string
  /** HTTP port for the reporter proxy server. */
  httpPort: number
}

/**
 * Aggregated configuration for the topology stack.
 */
export interface TopologyStackConfig {
  /** Topology gRPC service config. */
  service: TopologyServiceConfig
  /** SSE proxy config. */
  topologyProxy: TopologyProxyConfig
  /** Reporter proxy config. */
  reporterProxy: TopologyReporterProxyConfig
}

const parseNumberArg = (value: string, flag: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`)
  }
  return parsed
}

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

/**
 * Parses CLI arguments into a topology stack configuration.
 * @param argv CLI arguments (excluding node and script path).
 * @returns Parsed configuration for the topology stack.
 * @throws When a flag is missing a required value or has an invalid number.
 */
export const parseTopologyStackArgs = (argv: string[]): TopologyStackConfig => {
  const service: TopologyServiceConfig = {
    address: '127.0.0.1:50053',
    heartbeatIntervalMs: 5000,
    timeoutMultiplier: 3,
    idleTimeoutMs: 30000,
    rpsWindowMs: 5000,
    activityFlushMs: 1000,
    nodeUpdateThrottleMs: 5000,
    sweepIntervalMs: 5000,
  }

  let topologyProxyGrpcAddress: string | undefined
  let topologyProxyHttpPort = 50054
  let reporterProxyTopologyAddress: string | undefined
  let reporterProxyHttpPort = 50055

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]

    if (flag === '--address') {
      service.address = requireValue(value, flag)
      i += 1
    } else if (flag === '--heartbeat-interval-ms') {
      service.heartbeatIntervalMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--timeout-multiplier') {
      service.timeoutMultiplier = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--idle-timeout-ms') {
      service.idleTimeoutMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--unknown-edge-timeout-ms') {
      service.unknownEdgeTimeoutMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--rps-window-ms') {
      service.rpsWindowMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--activity-flush-ms') {
      service.activityFlushMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--node-update-throttle-ms') {
      service.nodeUpdateThrottleMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--sweep-interval-ms') {
      service.sweepIntervalMs = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--topology-proxy-grpc-address') {
      topologyProxyGrpcAddress = requireValue(value, flag)
      i += 1
    } else if (flag === '--topology-proxy-http-port') {
      topologyProxyHttpPort = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    } else if (flag === '--topology-reporter-topology-address') {
      reporterProxyTopologyAddress = requireValue(value, flag)
      i += 1
    } else if (flag === '--topology-reporter-http-port') {
      reporterProxyHttpPort = parseNumberArg(requireValue(value, flag), flag)
      i += 1
    }
  }

  const topologyProxy: TopologyProxyConfig = {
    grpcAddress: topologyProxyGrpcAddress ?? service.address,
    httpPort: topologyProxyHttpPort,
  }

  const reporterProxy: TopologyReporterProxyConfig = {
    topologyAddress: reporterProxyTopologyAddress ?? service.address,
    httpPort: reporterProxyHttpPort,
  }

  return {
    service,
    topologyProxy,
    reporterProxy,
  }
}
