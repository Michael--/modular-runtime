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

interface ServiceConfig {
  address: string
  heartbeatIntervalMs: number
  timeoutMultiplier: number
  idleTimeoutMs: number
  activityFlushMs: number
  sweepIntervalMs: number
}

const parseArgs = (): ServiceConfig => {
  const args = process.argv.slice(2)
  let address = '127.0.0.1:50053'
  let heartbeatIntervalMs = 5000
  let timeoutMultiplier = 3
  let idleTimeoutMs = 30000
  let activityFlushMs = 1000
  let sweepIntervalMs = 5000

  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1]
    if (args[i] === '--address' && value) {
      address = value
      i++
    } else if (args[i] === '--heartbeat-interval-ms' && value) {
      heartbeatIntervalMs = Number.parseInt(value, 10)
      i++
    } else if (args[i] === '--timeout-multiplier' && value) {
      timeoutMultiplier = Number.parseInt(value, 10)
      i++
    } else if (args[i] === '--idle-timeout-ms' && value) {
      idleTimeoutMs = Number.parseInt(value, 10)
      i++
    } else if (args[i] === '--activity-flush-ms' && value) {
      activityFlushMs = Number.parseInt(value, 10)
      i++
    } else if (args[i] === '--sweep-interval-ms' && value) {
      sweepIntervalMs = Number.parseInt(value, 10)
      i++
    }
  }

  return {
    address,
    heartbeatIntervalMs,
    timeoutMultiplier,
    idleTimeoutMs,
    activityFlushMs,
    sweepIntervalMs,
  }
}

const config = parseArgs()
const store = new TopologyStore({
  heartbeatIntervalMs: config.heartbeatIntervalMs,
  timeoutMultiplier: config.timeoutMultiplier,
  idleTimeoutMs: config.idleTimeoutMs,
  activityFlushMs: config.activityFlushMs,
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
  registerService(call, callback): void {
    const result = store.registerService(call.request)
    broadcast(result.updates)
    const response: RegisterServiceResponse = {
      handle: result.handle,
    }
    callback(null, response)
  },
  heartbeat(call): void {
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
  reportActivity(call, callback): void {
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
  unregisterService(call, callback): void {
    const updates = store.unregisterService(call.request.serviceId)
    broadcast(updates)
    const response: UnregisterServiceResponse = {
      removed: updates.length > 0,
    }
    callback(null, response)
  },
  getTopology(call: grpc.ServerUnaryCall<GetTopologyRequest, GetTopologyResponse>, callback): void {
    const response: GetTopologyResponse = {
      snapshot: store.snapshot(),
    }
    callback(null, response)
  },
  watchTopology(call): void {
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

const startServer = (): void => {
  server.bindAsync(config.address, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) {
      console.error('Failed to bind topology service:', error)
      return
    }
    console.log(`Topology service running at ${config.address}`)
  })
}

const shutdown = (): void => {
  console.log('Shutting down topology service...')
  clearInterval(sweepTimer)
  clearInterval(flushTimer)
  server.tryShutdown((error) => {
    if (error) {
      console.error('Failed to shut down cleanly:', error)
      process.exit(1)
    }
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

startServer()
