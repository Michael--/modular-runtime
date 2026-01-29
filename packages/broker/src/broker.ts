/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import {
  BrokerServiceService,
  BrokerServiceServer,
  NotifyServiceChangesResponse,
  RegisterServiceRequest,
  RegisterServiceResponse,
  LookupServiceRequest,
  LookupServiceResponse,
  GetAvailableServicesRequest,
  GetAvailableServicesResponse,
  UnregisterServiceRequest,
  UnregisterServiceResponse,
  NotifyServiceChangesRequest,
} from '../../proto/generated/ts/broker/v1/broker'

interface IService {
  name: string
  role: string
  url: string
  port: number
}

const services: IService[] = []
const serviceChangeListeners: grpc.ServerWritableStream<unknown, unknown>[] = []

// Function to notify all listeners about a service change
function notifyAllListeners(notification: NotifyServiceChangesResponse) {
  serviceChangeListeners.forEach((listener) => {
    listener.write(notification)
  })
}

// Example usage of notifyAllListeners
function serviceChange(s: IService, change: string) {
  const notification: NotifyServiceChangesResponse = {
    info: { interfaceName: s.name, role: s.role },
    url: s.url,
    port: s.port,
    changeType: change,
  }
  notifyAllListeners(notification)
}

// Implement the BrokerService
const brokerService: BrokerServiceServer = {
  registerService: (
    call: grpc.ServerUnaryCall<RegisterServiceRequest, RegisterServiceResponse>,
    callback: grpc.sendUnaryData<RegisterServiceResponse>
  ) => {
    const rq = call.request
    console.log(`registerService: ${JSON.stringify(rq)}`)
    if (!rq.info) {
      callback(new Error('Invalid request'))
      return
    }
    const sv = {
      name: rq.info.interfaceName,
      role: rq.info.role,
      url: rq.url,
      port: rq.port,
    }
    services.push(sv)
    callback(null)
    serviceChange(sv, 'added')
  },
  lookupService: (
    call: grpc.ServerUnaryCall<LookupServiceRequest, LookupServiceResponse>,
    callback: grpc.sendUnaryData<LookupServiceResponse>
  ) => {
    const rq = call.request
    console.log(`lookupService: ${JSON.stringify(rq)}`)
    const s = services.find((s) => s.name === rq.interfaceName)
    if (s == null) callback(null, { url: '', port: 0, error: 'Service not found' })
    else callback(null, { url: s.url, port: s.port, error: '' })
  },
  getAvailableServices: (
    call: grpc.ServerUnaryCall<GetAvailableServicesRequest, GetAvailableServicesResponse>,
    callback: grpc.sendUnaryData<GetAvailableServicesResponse>
  ) => {
    const rq = call.request
    console.log(`getAvailableServices: ${JSON.stringify(rq)}`)
    callback(null, {
      services: services.map((s) => ({
        info: { interfaceName: s.name, role: s.role },
        url: s.url,
        port: s.port,
      })),
    })
  },
  unregisterService: (
    call: grpc.ServerUnaryCall<UnregisterServiceRequest, UnregisterServiceResponse>,
    callback: grpc.sendUnaryData<UnregisterServiceResponse>
  ) => {
    const rq = call.request
    console.log(`unregisterService: ${JSON.stringify(rq)}`)
    const i = services.findIndex((s) => s.name === rq.interfaceName)
    if (i >= 0) {
      const s = services.splice(i, 1)
      callback(null)
      serviceChange(s[0], 'removed')
    }
  },
  notifyServiceChanges: (
    call: grpc.ServerWritableStream<NotifyServiceChangesRequest, NotifyServiceChangesResponse>
  ) => {
    serviceChangeListeners.push(call)
    console.log('Listener added, listeners count:', serviceChangeListeners.length)
    call.on('cancelled', () => {
      const index = serviceChangeListeners.indexOf(call)
      if (index !== -1) {
        /*const _deleted =*/ serviceChangeListeners.splice(index, 1)
        console.log('Listener cancelled, listeners count:', serviceChangeListeners.length)
      }
    })
  },
}

// Start the gRPC server
function startServer() {
  try {
    const server = new grpc.Server()
    server.addService(
      BrokerServiceService,
      brokerService as unknown as grpc.UntypedServiceImplementation
    )

    const address = '127.0.0.1:50051'
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) {
        console.error('Failed to bind server:', err)
        return
      }
      console.log(`Server is running at ${address}`)
    })

    // Handle shutdown signals
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully...')
      server.tryShutdown(() => {
        console.log('Server shut down.')
        process.exit(0)
      })
    })

    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully...')
      server.tryShutdown(() => {
        console.log('Server shut down.')
        process.exit(0)
      })
    })
  } catch (e) {
    console.error('Error:', e)
  }
}

startServer()
