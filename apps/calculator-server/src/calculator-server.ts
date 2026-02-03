/* eslint-disable no-console */
import { hostname } from 'node:os'
import * as grpc from '@grpc/grpc-js'
import {
  Operation,
  CalculateRequest,
  CalculateResponse,
  CalculatorServiceClient,
  CalculatorServiceServer,
  CalculatorServiceService,
} from '../../../packages/proto/generated/ts/calculator/v1/calculator'
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js'
import { BrokerClientManager } from '../../../packages/broker/src/BrokerClientManager'
import { NotifyServiceChangesResponse } from '../../../packages/proto/generated/ts/broker/v1/broker'
import { TopologyReporter } from '../../../packages/topology-reporter/src'
import {
  ServiceLanguage,
  ServiceType,
} from '../../../packages/proto/generated/ts/runtime/v1/topology'

const parseArgs = () => {
  const args = process.argv.slice(2)
  let address = '127.0.0.1:5555'
  let brokerAddress = '127.0.0.1:50051'
  let topologyAddress = process.env.TOPOLOGY_ADDRESS ?? '127.0.0.1:50053'
  let topologyEnabled = process.env.TOPOLOGY_ENABLED !== 'false'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--address' && i + 1 < args.length) {
      address = args[i + 1]
      i++
    } else if (args[i] === '--broker-address' && i + 1 < args.length) {
      brokerAddress = args[i + 1]
      i++
    } else if (args[i] === '--topology-address' && i + 1 < args.length) {
      topologyAddress = args[i + 1]
      i++
    } else if (args[i] === '--no-topology') {
      topologyEnabled = false
    }
  }
  const [url, portStr] = address.split(':')
  const port = parseInt(portStr, 10)
  const [brokerUrl, brokerPortStr] = brokerAddress.split(':')
  const brokerPort = parseInt(brokerPortStr, 10)
  return { url, port, brokerUrl, brokerPort, topologyAddress, topologyEnabled }
}

const { url, port, brokerUrl, brokerPort, topologyAddress, topologyEnabled } = parseArgs()

let brokerManager: BrokerClientManager | null = null
let topologyReporter: TopologyReporter | null = null

function brokerManagerInstance() {
  console.log('Lookup calculator service')
  brokerManager = BrokerClientManager.create(brokerUrl, brokerPort)

  brokerManager.onChanges = (changes: NotifyServiceChangesResponse) => {
    console.log('notifyServiceChanges:', changes)
    // prepareClient();
  }
  brokerManager.onConnected = async () => {
    console.log('Broker connected')

    brokerManager?.registerService(CalculatorServiceClient, url, port)
    // prepareClient();
  }
  brokerManager.onDisconnected = () => {
    console.log('Broker disconnected')
    // calculatorClient = null;
  }
}

// Function to perform the calculation
function calculate(request: CalculateRequest): number {
  switch (request.operation) {
    case Operation.OPERATION_ADD:
      return request.operand1 + request.operand2
    case Operation.OPERATION_SUBTRACT:
      return request.operand1 - request.operand2
    case Operation.OPERATION_MULTIPLY:
      return request.operand1 * request.operand2
    case Operation.OPERATION_DIVIDE:
      return request.operand1 / request.operand2
    default:
      throw new Error('Invalid operation')
  }
}

const calculatorService: CalculatorServiceServer = {
  calculate: function (
    call: ServerUnaryCall<CalculateRequest, CalculateResponse>,
    callback: sendUnaryData<CalculateResponse>
  ): void {
    const rq = call.request
    const result = calculate(rq)
    callback(null, { result, error: '' })
  },
}

// Start the gRPC server
async function startServer() {
  const serverOptions: grpc.ServerOptions = {
    // interceptors: [myServerInterceptor],
  }
  const server = new grpc.Server(serverOptions)
  server.addService(CalculatorServiceService, calculatorService)

  const address = `${url}:${port}`
  server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error('Failed to bind server:', err)
      return
    }
    console.log(`Server is running at ${address}`)
  })

  // await registerService(url, port);
  console.log('Registered calculator service with broker')
}

async function startTopologyReporter() {
  if (!topologyEnabled || topologyReporter != null) {
    return
  }

  topologyReporter = new TopologyReporter({
    topologyAddress,
    serviceName: 'calculator-server',
    serviceType: ServiceType.SERVICE_TYPE_SERVER,
    language: ServiceLanguage.SERVICE_LANGUAGE_TYPESCRIPT,
    host: hostname(),
    address: `${url}:${port}`,
    enableActivity: false,
  })

  try {
    await topologyReporter.register()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Topology reporter failed to start: ${message}`)
    topologyReporter = null
  }
}

// Centralized shutdown logic
async function handleShutdown() {
  console.log('Shutdown signal received')
  try {
    await brokerManager?.shutdown()
    await topologyReporter?.shutdown()
  } catch (error) {
    console.error('Error during shutdown:', error)
  }
  process.exit()
}

// Handle SIGINT signal, SIGTERM signal
process.on('SIGINT', handleShutdown)
process.on('SIGTERM', handleShutdown)

async function main() {
  console.log('Starting calculator server...')
  brokerManagerInstance()
  await startTopologyReporter()
  startServer()
}

main().catch(console.error)
