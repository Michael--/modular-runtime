/* eslint-disable no-console */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  ActivityType,
  ServiceLanguage,
  ServiceType,
} from '../../../packages/proto/generated/ts/runtime/v1/topology.js'
import {
  TopologyReporter,
  type ActivityReport,
  type TopologyReporterOptions,
} from '../../../packages/topology-reporter/src/topology-reporter.js'
import type { TopologyReporterProxyConfig } from './config'

/**
 * Runtime handle for the topology reporter proxy.
 */
export interface TopologyReporterProxyHandle {
  /** Stops the HTTP server and registered reporters. */
  stop: () => Promise<void>
}

/**
 * Registration request payload.
 */
interface RegisterRequest {
  serviceName: string
  serviceType: keyof typeof ServiceType
  language: keyof typeof ServiceLanguage
  version?: string
  address?: string
  host?: string
  enableActivity?: boolean
  serviceInterface?: string
  serviceRole?: string
  programName?: string
}

/**
 * Registration response payload.
 */
interface RegisterResponse {
  serviceId: string
  heartbeatIntervalMs: number
}

/**
 * Heartbeat request payload.
 */
interface HeartbeatRequest {
  serviceId: string
}

/**
 * Activity request payload.
 */
interface ActivityRequest {
  serviceId: string
  targetService: string
  type: keyof typeof ActivityType
  timestampMs?: number
  latencyMs?: number
  method?: string
  success?: boolean
  errorMessage?: string
}

/**
 * Unregister request payload.
 */
interface UnregisterRequest {
  serviceId: string
}

/**
 * Generic error response payload.
 */
interface ErrorResponse {
  error: string
}

/**
 * Managed service instance with its reporter.
 */
interface ServiceInstance {
  reporter: TopologyReporter
  serviceName: string
}

/**
 * Starts the topology reporter proxy.
 * @param config Proxy configuration.
 * @returns Handle for shutting down the proxy.
 */
export const startTopologyReporterProxy = async (
  config: TopologyReporterProxyConfig
): Promise<TopologyReporterProxyHandle> => {
  const services = new Map<string, ServiceInstance>()

  /**
   * Sends a JSON response.
   */
  const sendJson = (
    response: ServerResponse,
    statusCode: number,
    data: RegisterResponse | ErrorResponse | Record<string, unknown>
  ): void => {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(data))
  }

  /**
   * Sends an error response.
   */
  const sendError = (response: ServerResponse, statusCode: number, message: string): void => {
    sendJson(response, statusCode, { error: message })
  }

  /**
   * Parses JSON from request body.
   */
  const parseBody = async <T>(request: IncomingMessage): Promise<T> => {
    return new Promise((resolve, reject) => {
      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        try {
          resolve(JSON.parse(body) as T)
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
      request.on('error', reject)
    })
  }

  /**
   * Handles service registration.
   */
  const handleRegister = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    try {
      const body = await parseBody<RegisterRequest>(request)

      if (!body.serviceName || !body.serviceType || !body.language) {
        sendError(response, 400, 'Missing required fields: serviceName, serviceType, language')
        return
      }

      const serviceType = ServiceType[body.serviceType]
      const language = ServiceLanguage[body.language]

      if (serviceType === undefined || language === undefined) {
        sendError(response, 400, 'Invalid serviceType or language')
        return
      }

      const options: TopologyReporterOptions = {
        topologyAddress: config.topologyAddress,
        serviceName: body.serviceName,
        serviceType,
        language,
        version: body.version,
        address: body.address,
        host: body.host,
        enableActivity: body.enableActivity ?? true,
        metadata: {
          serviceInterface: body.serviceInterface,
          serviceRole: body.serviceRole,
          programName: body.programName,
        },
      }

      const reporter = new TopologyReporter(options)
      const handle = await reporter.register()

      services.set(handle.serviceId, { reporter, serviceName: body.serviceName })

      console.log(`[register] ${body.serviceName} -> ${handle.serviceId}`)

      const responseData: RegisterResponse = {
        serviceId: handle.serviceId,
        heartbeatIntervalMs: handle.heartbeatIntervalMs,
      }

      sendJson(response, 200, responseData)
    } catch (error) {
      console.error(`[register] error:`, error)
      sendError(response, 500, error instanceof Error ? error.message : 'Registration failed')
    }
  }

  /**
   * Handles heartbeat (manual trigger - normally automatic).
   */
  const handleHeartbeat = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    try {
      const body = await parseBody<HeartbeatRequest>(request)

      if (!body.serviceId) {
        sendError(response, 400, 'Missing required field: serviceId')
        return
      }

      const service = services.get(body.serviceId)
      if (!service) {
        sendError(response, 404, 'Service not found')
        return
      }

      // Heartbeats are sent automatically by TopologyReporter
      // This endpoint is mainly for debugging/testing
      console.log(`[heartbeat] ${service.serviceName} (${body.serviceId})`)

      sendJson(response, 200, { status: 'ok' })
    } catch (error) {
      console.error(`[heartbeat] error:`, error)
      sendError(response, 500, error instanceof Error ? error.message : 'Heartbeat failed')
    }
  }

  /**
   * Handles activity reporting.
   */
  const handleActivity = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    try {
      const body = await parseBody<ActivityRequest>(request)

      if (!body.serviceId || !body.targetService || !body.type) {
        sendError(response, 400, 'Missing required fields: serviceId, targetService, type')
        return
      }

      const service = services.get(body.serviceId)
      if (!service) {
        sendError(response, 404, 'Service not found')
        return
      }

      const activityType = ActivityType[body.type]
      if (activityType === undefined) {
        sendError(response, 400, 'Invalid activity type')
        return
      }

      const report: ActivityReport = {
        targetService: body.targetService,
        type: activityType,
        timestampMs: body.timestampMs,
        latencyMs: body.latencyMs,
        method: body.method,
        success: body.success,
        errorMessage: body.errorMessage,
      }

      service.reporter.reportActivity(report)

      console.log(`[activity] ${service.serviceName} -> ${body.targetService}`)

      sendJson(response, 200, { status: 'ok' })
    } catch (error) {
      console.error(`[activity] error:`, error)
      sendError(response, 500, error instanceof Error ? error.message : 'Activity report failed')
    }
  }

  /**
   * Handles service unregistration.
   */
  const handleUnregister = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    try {
      const body = await parseBody<UnregisterRequest>(request)

      if (!body.serviceId) {
        sendError(response, 400, 'Missing required field: serviceId')
        return
      }

      const service = services.get(body.serviceId)
      if (!service) {
        sendError(response, 404, 'Service not found')
        return
      }

      await service.reporter.shutdown()
      services.delete(body.serviceId)

      console.log(`[unregister] ${service.serviceName} (${body.serviceId})`)

      sendJson(response, 200, { status: 'ok' })
    } catch (error) {
      console.error(`[unregister] error:`, error)
      sendError(response, 500, error instanceof Error ? error.message : 'Unregister failed')
    }
  }

  /**
   * Main HTTP request handler.
   */
  const handleRequest = (request: IncomingMessage, response: ServerResponse): void => {
    const { url, method } = request

    if (method !== 'POST') {
      sendError(response, 405, 'Method not allowed')
      return
    }

    if (url === '/register') {
      handleRegister(request, response).catch((error) => {
        console.error('[register] unhandled error:', error)
        sendError(response, 500, 'Internal server error')
      })
    } else if (url === '/heartbeat') {
      handleHeartbeat(request, response).catch((error) => {
        console.error('[heartbeat] unhandled error:', error)
        sendError(response, 500, 'Internal server error')
      })
    } else if (url === '/activity') {
      handleActivity(request, response).catch((error) => {
        console.error('[activity] unhandled error:', error)
        sendError(response, 500, 'Internal server error')
      })
    } else if (url === '/unregister') {
      handleUnregister(request, response).catch((error) => {
        console.error('[unregister] unhandled error:', error)
        sendError(response, 500, 'Internal server error')
      })
    } else if (url === '/health') {
      sendJson(response, 200, { status: 'healthy', services: services.size })
    } else {
      sendError(response, 404, 'Not found')
    }
  }

  const server = createServer(handleRequest)

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      console.log(`Topology Reporter HTTP Proxy listening on http://0.0.0.0:${config.httpPort}`)
      console.log(`Topology Service: ${config.topologyAddress}`)
      console.log('Endpoints:')
      console.log('  POST /register')
      console.log('  POST /heartbeat')
      console.log('  POST /activity')
      console.log('  POST /unregister')
      console.log('  POST /health')
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(config.httpPort, '0.0.0.0')
  })

  const stop = async (): Promise<void> => {
    for (const [serviceId, service] of services) {
      console.log(`Unregistering ${service.serviceName} (${serviceId})`)
      await service.reporter.shutdown()
    }
    services.clear()

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  return { stop }
}
