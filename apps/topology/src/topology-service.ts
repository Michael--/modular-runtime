/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import {
  UpdateType,
  type GetTopologyRequest,
  type GetTopologyResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type RegisterServiceResponse,
  type ReportActivityRequest,
  type ReportActivityResponse,
  type TopologyServiceServer,
  type TopologyUpdate,
  type UnregisterServiceResponse,
  type WatchTopologyRequest,
  type WatchTopologyResponse,
  TopologyServiceService,
} from '../../../packages/proto/generated/ts/runtime/v1/topology'
import { TopologyStore } from './topology-store'
import type { TopologyServiceConfig } from './config'

/**
 * Runtime handle for the topology service.
 */
export interface TopologyServiceHandle {
  /** Stops the gRPC server and background timers. */
  stop: () => Promise<void>
}

/**
 * Starts the topology gRPC service.
 * @param config Service configuration.
 * @returns Handle for shutting down the service.
 */
export const startTopologyService = async (
  config: TopologyServiceConfig
): Promise<TopologyServiceHandle> => {
  const store = new TopologyStore({
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    timeoutMultiplier: config.timeoutMultiplier,
    idleTimeoutMs: config.idleTimeoutMs,
    activityFlushMs: config.activityFlushMs,
    nodeUpdateThrottleMs: config.nodeUpdateThrottleMs,
  })

  const watchers = new Set<grpc.ServerWritableStream<WatchTopologyRequest, WatchTopologyResponse>>()

  const broadcast = (updates: TopologyUpdate[]): void => {
    if (updates.length === 0) {
      return
    }

    for (const watcher of watchers) {
      for (const update of updates) {
        try {
          const response: WatchTopologyResponse = { update }
          watcher.write(response)
        } catch (error) {
          console.error('Failed to write topology update:', error)
          watchers.delete(watcher)
          break
        }
      }
    }
  }

  const topologyService: TopologyServiceServer = {
    registerService: (call, callback): void => {
      const result = store.registerService(call.request)
      broadcast(result.updates)
      const response: RegisterServiceResponse = {
        handle: result.handle,
      }
      callback(null, response)
    },
    heartbeat: (call): void => {
      call.on('data', (request: HeartbeatRequest) => {
        const updates = store.recordHeartbeat(request)
        broadcast(updates)
        const response: HeartbeatResponse = {
          sequence: request.sequence,
          acknowledged: true,
        }
        call.write(response)
      })

      call.on('error', (error: Error) => {
        console.error('Heartbeat stream error:', error)
      })

      call.on('end', () => {
        call.end()
      })
    },
    reportActivity: (call, callback): void => {
      let acceptedEvents = 0
      call.on('data', (event: ReportActivityRequest) => {
        const updates = store.recordActivity(event)
        acceptedEvents += Math.max(1, event.batchSize ?? 1)
        broadcast(updates)
      })

      call.on('error', (error: Error) => {
        console.error('Activity stream error:', error)
      })

      call.on('end', () => {
        const response: ReportActivityResponse = {
          acknowledged: true,
          acceptedEvents: String(acceptedEvents),
        }
        callback(null, response)
      })
    },
    unregisterService: (call, callback): void => {
      const updates = store.unregisterService(call.request.serviceId)
      broadcast(updates)
      const response: UnregisterServiceResponse = {
        removed: updates.length > 0,
      }
      callback(null, response)
    },
    getTopology: (
      call: grpc.ServerUnaryCall<GetTopologyRequest, GetTopologyResponse>,
      callback
    ): void => {
      const response: GetTopologyResponse = {
        snapshot: store.snapshot(),
      }
      callback(null, response)
    },
    watchTopology: (call): void => {
      watchers.add(call)
      call.on('cancelled', () => watchers.delete(call))
      call.on('error', () => watchers.delete(call))
      call.on('close', () => watchers.delete(call))

      const snapshotUpdate: TopologyUpdate = {
        type: UpdateType.UPDATE_TYPE_SNAPSHOT,
        snapshot: store.snapshot(),
      }
      const response: WatchTopologyResponse = {
        update: snapshotUpdate,
      }
      call.write(response)
    },
  }

  const server = new grpc.Server()
  server.addService(TopologyServiceService, topologyService)

  const sweepTimer = setInterval(() => {
    broadcast(store.sweep())
  }, config.sweepIntervalMs)

  const flushTimer = setInterval(() => {
    broadcast(store.flushActivity())
  }, config.activityFlushMs)

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(config.address, grpc.ServerCredentials.createInsecure(), (error) => {
      if (error) {
        reject(error)
        return
      }
      console.log(`Topology service running at ${config.address}`)
      resolve()
    })
  })

  const stop = async (): Promise<void> => {
    clearInterval(sweepTimer)
    clearInterval(flushTimer)
    const shutdownTimeoutMs = 5000

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        console.warn('Topology service shutdown timed out; forcing shutdown.')
        server.forceShutdown()
        resolve()
      }, shutdownTimeoutMs)

      server.tryShutdown((error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        if (error) {
          server.forceShutdown()
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  return { stop }
}
