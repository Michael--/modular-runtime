/* eslint-disable no-console */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { setTimeout } from 'node:timers/promises'
import { credentials, type ClientReadableStream } from '@grpc/grpc-js'
import {
  UpdateType,
  type GetTopologyRequest,
  type GetTopologyResponse,
  type TopologyUpdate,
  type WatchTopologyRequest,
  type WatchTopologyResponse,
} from '../../../packages/proto/generated/ts/runtime/v1/topology'
import { TopologyServiceClient } from '../../../packages/proto/generated/ts/runtime/v1/topology'
import type { TopologyProxyConfig } from './config'

/**
 * Runtime handle for the topology SSE proxy.
 */
export interface TopologyProxyHandle {
  /** Stops the HTTP server and gRPC watcher. */
  stop: () => Promise<void>
}

/**
 * Starts the topology SSE proxy.
 * @param config Proxy configuration.
 * @returns Handle for shutting down the proxy.
 */
export const startTopologyProxy = async (
  config: TopologyProxyConfig
): Promise<TopologyProxyHandle> => {
  const client = new TopologyServiceClient(config.grpcAddress, credentials.createInsecure())
  const listeners = new Set<ServerResponse>()
  let lastSnapshot: TopologyUpdate | null = null
  let watchStream: ClientReadableStream<WatchTopologyResponse> | null = null
  let isStopping = false

  const writeEvent = (response: ServerResponse, update: TopologyUpdate): void => {
    response.write(`data: ${JSON.stringify(update)}\n\n`)
  }

  const broadcast = (update: TopologyUpdate): void => {
    if (update.type === UpdateType.UPDATE_TYPE_SNAPSHOT) {
      lastSnapshot = update
    }
    for (const response of listeners) {
      writeEvent(response, update)
    }
  }

  const fetchSnapshot = async (): Promise<TopologyUpdate | null> => {
    const request: GetTopologyRequest = {
      query: { serviceNames: [], includeIdle: true, includeStale: true },
    }
    return new Promise<TopologyUpdate | null>((resolve) => {
      client.getTopology(request, (error, response: GetTopologyResponse) => {
        if (error) {
          console.error(`Failed to fetch topology snapshot: ${error.message}`)
          resolve(null)
          return
        }
        if (!response.snapshot) {
          resolve(null)
          return
        }
        resolve({ type: UpdateType.UPDATE_TYPE_SNAPSHOT, snapshot: response.snapshot })
      })
    })
  }

  const handleStreamData = (response: WatchTopologyResponse): void => {
    if (isStopping) {
      return
    }
    if (!response.update) {
      return
    }
    broadcast(response.update)
  }

  const handleStreamError = async (error: Error): Promise<void> => {
    if (isStopping) {
      return
    }
    console.error(`Topology watch error: ${error.message}`)
    watchStream = null
    await setTimeout(1000)
    startWatchStream()
  }

  const handleStreamEnd = async (): Promise<void> => {
    if (isStopping) {
      return
    }
    console.warn('Topology watch ended; reconnecting.')
    watchStream = null
    await setTimeout(1000)
    startWatchStream()
  }

  const startWatchStream = (): void => {
    if (watchStream || isStopping) {
      return
    }
    const request: WatchTopologyRequest = {
      query: { serviceNames: [], includeIdle: true, includeStale: true },
    }
    watchStream = client.watchTopology(request)
    watchStream.on('data', handleStreamData)
    watchStream.on('error', handleStreamError)
    watchStream.on('end', handleStreamEnd)
  }

  const handleSse = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write('retry: 1000\n\n')
    listeners.add(res)

    const snapshot = await fetchSnapshot()
    if (snapshot) {
      lastSnapshot = snapshot
      writeEvent(res, snapshot)
    } else if (lastSnapshot) {
      writeEvent(res, lastSnapshot)
    }

    req.on('close', () => {
      listeners.delete(res)
    })
  }

  const server = createServer((req, res) => {
    if (req.url === '/events') {
      void handleSse(req, res)
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      console.log(`Topology proxy listening on http://127.0.0.1:${config.httpPort}/events`)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(config.httpPort)
  })

  startWatchStream()

  const stop = async (): Promise<void> => {
    isStopping = true
    if (watchStream) {
      watchStream.off('data', handleStreamData)
      watchStream.off('end', handleStreamEnd)
      watchStream.cancel()
      watchStream = null
    }

    for (const response of listeners) {
      response.end()
    }
    listeners.clear()

    client.close()

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
