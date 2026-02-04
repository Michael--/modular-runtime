/* eslint-disable no-console */
import { hostname } from 'node:os'
import { BrokerClientManager } from '../../../packages/broker/src'
import {
  Operation,
  CalculateRequest,
  CalculatorServiceClient,
} from '../../../packages/proto/generated/ts/calculator/v1/calculator'
import { credentials } from '@grpc/grpc-js'
import { TopologyReporter } from '../../../packages/topology-reporter/src'
import {
  ActivityType,
  ServiceLanguage,
  ServiceType,
} from '../../../packages/proto/generated/ts/runtime/v1/topology'

const parseArgs = () => {
  const args = process.argv.slice(2)
  let brokerAddress = '127.0.0.1:50051'
  let topologyAddress = process.env.TOPOLOGY_ADDRESS ?? '127.0.0.1:50053'
  let topologyEnabled = process.env.TOPOLOGY_ENABLED !== 'false'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--broker-address' && i + 1 < args.length) {
      brokerAddress = args[i + 1]
      i++
    } else if (args[i] === '--topology-address' && i + 1 < args.length) {
      topologyAddress = args[i + 1]
      i++
    } else if (args[i] === '--no-topology') {
      topologyEnabled = false
    }
  }
  const [brokerUrl, brokerPortStr] = brokerAddress.split(':')
  const brokerPort = parseInt(brokerPortStr, 10)
  return { brokerUrl, brokerPort, topologyAddress, topologyEnabled }
}

const { brokerUrl, brokerPort, topologyAddress, topologyEnabled } = parseArgs()

let brokerManager: BrokerClientManager | null = null
let calculatorClient: CalculatorServiceClient | null = null
let topologyReporter: TopologyReporter | null = null

async function someTestCalculations() {
  const calculator = async (
    operand1: number,
    operand2: number,
    operation: Operation
  ): Promise<number> => {
    const request: CalculateRequest = {
      operand1: operand1,
      operand2: operand2,
      operation: operation,
    }
    return new Promise((resolve, reject) => {
      if (calculatorClient == null) return reject(new Error('Client not existing'))
      const startedAt = Date.now()
      calculatorClient.calculate(request, (error, response) => {
        const latencyMs = Date.now() - startedAt
        topologyReporter?.reportActivity({
          targetService: 'calculator-server',
          type: ActivityType.ACTIVITY_TYPE_RESPONSE_RECEIVED,
          latencyMs,
          method: 'CalculatorService/Calculate',
          success: error == null,
          errorMessage: error?.message,
        })
        if (error) {
          console.error(`Error: ${error.message}`)
          reject(error)
        } else {
          const operationSymbol = (op: Operation) => {
            switch (op) {
              case Operation.OPERATION_ADD:
                return '+'
              case Operation.OPERATION_SUBTRACT:
                return '-'
              case Operation.OPERATION_MULTIPLY:
                return '*'
              case Operation.OPERATION_DIVIDE:
                return '/'
              default:
                return '?'
            }
          }
          console.log(
            `calculate(${request.operand1.toFixed(6)} ${operationSymbol(request.operation)} ${request.operand2.toFixed(6)}) => ${response.result.toFixed(6)}`
          )
          resolve(response.result)
        }
      })
    })
  }

  const value = () => Math.random() * 10
  const operation = () => (Math.floor(Math.random() * 4) + 1) as Operation
  try {
    await calculator(value(), value(), operation())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error:', error.message)
  }
}

async function startTopologyReporter() {
  if (!topologyEnabled || topologyReporter != null) {
    return
  }

  topologyReporter = new TopologyReporter({
    topologyAddress,
    serviceName: 'calculator-client',
    serviceType: ServiceType.SERVICE_TYPE_CLIENT,
    language: ServiceLanguage.SERVICE_LANGUAGE_TYPESCRIPT,
    host: hostname(),
    enableActivity: true,
  })

  topologyReporter.start()
}

async function handleShutdown() {
  console.log('Shutdown signal received')
  try {
    await topologyReporter?.shutdown()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Topology reporter shutdown failed: ${message}`)
  }
  process.exit()
}

process.on('SIGINT', handleShutdown)
process.on('SIGTERM', handleShutdown)

async function prepareClient() {
  if (calculatorClient != null) return
  const s = await brokerManager?.getService(CalculatorServiceClient, 'default')
  console.log('getService:', s)
  if (s != null) {
    const address = `${s.url}:${s.port}`
    calculatorClient = new CalculatorServiceClient(address, credentials.createInsecure())
  }
}

function brokerManagerInstance() {
  console.log('Lookup calculator service')
  brokerManager = BrokerClientManager.create(brokerUrl, brokerPort)

  brokerManager.onChanges = (changes) => {
    console.log('notifyServiceChanges:', changes)
    prepareClient()
  }
  brokerManager.onConnected = async () => {
    console.log('Broker connected')
    prepareClient()
  }
  brokerManager.onDisconnected = () => {
    console.log('Broker disconnected')
    calculatorClient = null
  }
}

async function main() {
  console.log('Starting client...')
  brokerManagerInstance()
  await startTopologyReporter()

  setInterval(() => {
    someTestCalculations()
  }, 2000)
}

main().catch(console.error)
