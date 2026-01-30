/* eslint-disable no-console */
import { BrokerClientManager } from '../../../packages/broker/src'
import {
  Operation,
  CalculationRequest,
  CalculatorServiceClient,
} from '../../../packages/proto/generated/ts/calculator/v1/calculator'
import { credentials } from '@grpc/grpc-js'

let brokerManager: BrokerClientManager | null = null
let calculatorClient: CalculatorServiceClient | null = null

async function someTestCalculations() {
  const calculator = async (
    operand1: number,
    operand2: number,
    operation: Operation
  ): Promise<number> => {
    const request: CalculationRequest = {
      operand1: operand1,
      operand2: operand2,
      operation: operation,
    }
    return new Promise((resolve, reject) => {
      if (calculatorClient == null) return reject(new Error('Client not existing'))
      calculatorClient.calculate(request, (error, response) => {
        if (error) {
          console.error(`Error: ${error.message}`)
          reject(error)
        } else {
          const operationSymbol = (op: Operation) => {
            switch (op) {
              case Operation.ADD:
                return '+'
              case Operation.SUBTRACT:
                return '-'
              case Operation.MULTIPLY:
                return '*'
              case Operation.DIVIDE:
                return '/'
              default:
                return '?'
            }
          }
          console.log(
            `calculate(${request.operand1} ${operationSymbol(request.operation)} ${request.operand2}) => ${response.result}`
          )
          resolve(response.result)
        }
      })
    })
  }

  const value = () => Math.round(Math.random() * 10)
  const operation = () => Math.round(Math.random() * 3) as Operation
  try {
    await calculator(value(), value(), operation())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error:', error.message)
  }
}

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
  brokerManager = BrokerClientManager.create('127.0.0.1', 50051)

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

  setInterval(() => {
    someTestCalculations()
  }, 2000)
}

main().catch(console.error)
