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

interface ProxyConfig {
  grpcAddress: string
  httpPort: number
}

const parseArgs = (): ProxyConfig => {
  const args = process.argv.slice(2)
  let grpcAddress = '127.0.0.1:50053'
  let httpPort = 50054
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1]
    if (args[i] === '--grpc-address' && value) {
      grpcAddress = value
      i++
    } else if (args[i] === '--http-port' && value) {
      httpPort = Number.parseInt(value, 10)
      i++
    }
  }
  return { grpcAddress, httpPort }
}

const config = parseArgs()
const client = new TopologyServiceClient(config.grpcAddress, credentials.createInsecure())

const listeners = new Set<ServerResponse>()
let lastSnapshot: TopologyUpdate | null = null
let watchStream: ClientReadableStream<WatchTopologyResponse> | null = null

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

const startWatchStream = (): void => {
  if (watchStream) {
    return
  }
  const request: WatchTopologyRequest = {
    query: { serviceNames: [], includeIdle: true, includeStale: true },
  }
  watchStream = client.watchTopology(request)
  watchStream.on('data', (response) => {
    if (!response.update) {
      return
    }
    broadcast(response.update)
  })
  watchStream.on('error', async (error) => {
    console.error(`Topology watch error: ${error.message}`)
    watchStream = null
    await setTimeout(1000)
    startWatchStream()
  })
  watchStream.on('end', async () => {
    console.warn('Topology watch ended; reconnecting.')
    watchStream = null
    await setTimeout(1000)
    startWatchStream()
  })
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

server.listen(config.httpPort, () => {
  console.log(`Topology proxy listening on http://127.0.0.1:${config.httpPort}/events`)
})

startWatchStream()
