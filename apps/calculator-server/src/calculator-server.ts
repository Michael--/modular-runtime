/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import {
  Operation,
  CalculationRequest,
  CalculationResponse,
  CalculatorServiceClient,
  CalculatorServiceServer,
  CalculatorServiceService,
} from '../../../packages/proto/generated/ts/calculator/v1/calculator'
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js'
import { BrokerClientManager } from '../../../packages/broker/src/BrokerClientManager'
import { NotifyServiceChangesResponse } from '../../../packages/proto/generated/ts/broker/v1/broker'

let brokerManager: BrokerClientManager | null = null

function brokerManagerInstance() {
  console.log('Lookup calculator service')
  brokerManager = BrokerClientManager.create('127.0.0.1', 50051)

  brokerManager.onChanges = (changes: NotifyServiceChangesResponse) => {
    console.log('notifyServiceChanges:', changes)
    // prepareClient();
  }
  brokerManager.onConnected = async () => {
    console.log('Broker connected')

    const url = '127.0.0.1'
    const port = 5555
    brokerManager?.registerService(CalculatorServiceClient, url, port)
    // prepareClient();
  }
  brokerManager.onDisconnected = () => {
    console.log('Broker disconnected')
    // calculatorClient = null;
  }
}

// Function to perform the calculation
function calculate(request: CalculationRequest): number {
  switch (request.operation) {
    case Operation.ADD:
      return request.operand1 + request.operand2
    case Operation.SUBTRACT:
      return request.operand1 - request.operand2
    case Operation.MULTIPLY:
      return request.operand1 * request.operand2
    case Operation.DIVIDE:
      return request.operand1 / request.operand2
    default:
      throw new Error('Invalid operation')
  }
}

const calculatorService: CalculatorServiceServer = {
  calculate: function (
    call: ServerUnaryCall<CalculationRequest, CalculationResponse>,
    callback: sendUnaryData<CalculationResponse>
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

  const url = '127.0.0.1'
  const port = 5555
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

// Centralized shutdown logic
async function handleShutdown() {
  console.log('Shutdown signal received')
  try {
    await brokerManager?.shutdown()
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
  startServer()

  setInterval(() => {
    // someTestCalculations();
  }, 2000)
}

main().catch(console.error)
