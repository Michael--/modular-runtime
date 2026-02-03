import {
  ActivityType,
  type ApplicationHealth,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type RegisterServiceRequest,
  type RegisterServiceResponse,
  type ReportActivityRequest,
  ServiceLanguage,
  ServiceType,
  type ServiceHandle,
  type ServiceMetadata,
  type ServiceMetrics,
  type UnregisterServiceRequest,
  TopologyServiceClient,
} from '../../proto/generated/ts/runtime/v1/topology'
import {
  ChannelCredentials,
  type ClientDuplexStream,
  type ClientOptions,
  type ClientWritableStream,
  type ServiceError,
  credentials,
} from '@grpc/grpc-js'

/**
 * Configuration for the topology reporter.
 */
export interface TopologyReporterOptions {
  /** Address of the topology service (e.g., "127.0.0.1:50053"). */
  topologyAddress: string
  /** Service name to report. */
  serviceName: string
  /** Service type (server/client/hybrid). */
  serviceType: ServiceType
  /** Implementation language. */
  language: ServiceLanguage
  /** Optional version string. */
  version?: string
  /** Optional network address of the service. */
  address?: string
  /** Optional host identifier. */
  host?: string
  /** Optional service metadata. */
  metadata?: ServiceMetadata
  /** Whether activity reporting should be enabled. */
  enableActivity?: boolean
  /** Optional channel credentials (defaults to insecure). */
  credentials?: ChannelCredentials
  /** Optional gRPC client options. */
  clientOptions?: Partial<ClientOptions>
}

/**
 * Activity report payload to record a service interaction.
 */
export interface ActivityReport {
  /** Target service name. */
  targetService: string
  /** Activity type. */
  type: ActivityType
  /** Optional timestamp (milliseconds since epoch). */
  timestampMs?: number
  /** Optional latency in milliseconds. */
  latencyMs?: number
  /** Optional gRPC method name. */
  method?: string
  /** Optional success flag. */
  success?: boolean
  /** Optional batch size for aggregated events. */
  batchSize?: number
  /** Optional error message. */
  errorMessage?: string
}

/**
 * Status information for the topology reporter.
 */
export interface TopologyReporterStatus {
  /** Service identifier assigned by the topology service. */
  serviceId: string | null
  /** Heartbeat interval reported by the topology service. */
  heartbeatIntervalMs: number | null
  /** Whether activity reporting is enabled. */
  activityEnabled: boolean
}

/**
 * TopologyReporter registers a service and sends heartbeats/activity updates.
 */
export class TopologyReporter {
  private readonly client: TopologyServiceClient
  private readonly options: TopologyReporterOptions
  private serviceId: string | null = null
  private heartbeatIntervalMs: number | null = null
  private timeoutMultiplier: number | null = null
  private heartbeatSeq = 0
  private heartbeatStream: ClientDuplexStream<HeartbeatRequest, HeartbeatResponse> | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private activityStream: ClientWritableStream<ReportActivityRequest> | null = null
  private currentHealth: ApplicationHealth | undefined
  private currentMetrics: ServiceMetrics | undefined

  /**
   * Creates a new topology reporter.
   * @param options Reporter configuration.
   */
  public constructor(options: TopologyReporterOptions) {
    this.options = options
    const channelCredentials = options.credentials ?? credentials.createInsecure()
    this.client = new TopologyServiceClient(
      options.topologyAddress,
      channelCredentials,
      options.clientOptions
    )
  }

  /**
   * Registers the service and starts heartbeats.
   * @returns The service handle returned by the topology service.
   * @throws When registration fails or the response is missing the handle.
   */
  public async register(): Promise<ServiceHandle> {
    if (this.serviceId) {
      return {
        serviceId: this.serviceId,
        heartbeatIntervalMs: this.heartbeatIntervalMs ?? 0,
        timeoutMultiplier: this.timeoutMultiplier ?? 0,
      }
    }

    const request: RegisterServiceRequest = {
      serviceName: this.options.serviceName,
      serviceType: this.options.serviceType,
      language: this.options.language,
      version: this.options.version,
      address: this.options.address,
      host: this.options.host,
      metadata: this.options.metadata,
    }

    const response = await this.registerService(request)
    const handle = response.handle
    if (!handle) {
      throw new Error('Topology registration failed: missing service handle.')
    }

    this.serviceId = handle.serviceId
    this.heartbeatIntervalMs = handle.heartbeatIntervalMs
    this.timeoutMultiplier = handle.timeoutMultiplier
    this.startHeartbeat()

    if (this.options.enableActivity ?? true) {
      this.startActivityStream()
    }

    return handle
  }

  /**
   * Reports activity for a connection.
   * @param report Activity report payload.
   */
  public reportActivity(report: ActivityReport): void {
    if (!this.activityStream || !this.serviceId) {
      return
    }

    const event: ReportActivityRequest = {
      serviceId: this.serviceId,
      targetService: report.targetService,
      type: report.type,
      timestampMs: String(report.timestampMs ?? Date.now()),
      latencyMs: report.latencyMs,
      method: report.method,
      success: report.success,
      batchSize: report.batchSize,
      errorMessage: report.errorMessage,
    }

    this.activityStream.write(event)
  }

  /**
   * Updates application health to include in subsequent heartbeats.
   * @param health Health payload or undefined to clear.
   */
  public setHealth(health: ApplicationHealth | undefined): void {
    this.currentHealth = health
  }

  /**
   * Updates runtime metrics to include in subsequent heartbeats.
   * @param metrics Metrics payload or undefined to clear.
   */
  public setMetrics(metrics: ServiceMetrics | undefined): void {
    this.currentMetrics = metrics
  }

  /**
   * Returns the current reporter status.
   * @returns Reporter status information.
   */
  public status(): TopologyReporterStatus {
    return {
      serviceId: this.serviceId,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      activityEnabled: Boolean(this.activityStream),
    }
  }

  /**
   * Gracefully shuts down the reporter and unregisters the service.
   * @returns Resolves when shutdown completes.
   */
  public async shutdown(): Promise<void> {
    this.stopHeartbeat()
    this.endActivityStream()

    if (!this.serviceId) {
      return
    }

    const request: UnregisterServiceRequest = { serviceId: this.serviceId }
    await new Promise<void>((resolve) => {
      this.client.unregisterService(request, () => resolve())
    })

    this.serviceId = null
    this.heartbeatIntervalMs = null
  }

  private registerService(request: RegisterServiceRequest): Promise<RegisterServiceResponse> {
    return new Promise((resolve, reject) => {
      this.client.registerService(
        request,
        (error: ServiceError | null, response: RegisterServiceResponse) => {
          if (error) {
            reject(error)
            return
          }
          resolve(response)
        }
      )
    })
  }

  private startHeartbeat(): void {
    if (!this.serviceId || this.heartbeatIntervalMs == null) {
      return
    }

    const stream = this.client.heartbeat()
    this.heartbeatStream = stream

    const sendHeartbeat = () => {
      if (!this.serviceId || !this.heartbeatStream) {
        return
      }

      this.heartbeatSeq += 1
      this.heartbeatStream.write({
        serviceId: this.serviceId,
        sequence: String(this.heartbeatSeq),
        health: this.currentHealth,
        metrics: this.currentMetrics,
      })
    }

    sendHeartbeat()
    this.heartbeatTimer = setInterval(sendHeartbeat, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatStream) {
      this.heartbeatStream.end()
      this.heartbeatStream = null
    }
  }

  private startActivityStream(): void {
    if (this.activityStream) {
      return
    }

    this.activityStream = this.client.reportActivity(() => {
      // Response handled on end.
    })
  }

  private endActivityStream(): void {
    if (!this.activityStream) {
      return
    }
    this.activityStream.end()
    this.activityStream = null
  }
}
