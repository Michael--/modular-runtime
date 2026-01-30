/* eslint-disable no-console */
import { startBrokerServer } from './broker'

const address = process.env.BROKER_ADDRESS ?? '127.0.0.1:50051'

const main = async (): Promise<void> => {
  const server = await startBrokerServer(address)

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`Received ${signal}, shutting down gracefully...`)
    server.tryShutdown(() => {
      console.log('Server shut down.')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Broker server failed to start: ${message}`)
  process.exit(1)
})
