/* eslint-disable no-console */
import { parseTopologyStackArgs } from './config'
import { startTopologyProxy } from './topology-proxy'
import { startTopologyReporterProxy } from './topology-reporter-proxy'
import { startTopologyService } from './topology-service'

const run = async (): Promise<void> => {
  let serviceHandle: Awaited<ReturnType<typeof startTopologyService>> | null = null
  let proxyHandle: Awaited<ReturnType<typeof startTopologyProxy>> | null = null
  let reporterHandle: Awaited<ReturnType<typeof startTopologyReporterProxy>> | null = null
  let shuttingDown = false

  const stopAll = async (): Promise<void> => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    const errors: Error[] = []

    if (reporterHandle) {
      try {
        await reporterHandle.stop()
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error('Reporter proxy shutdown failed'))
      }
      reporterHandle = null
    }

    if (proxyHandle) {
      try {
        await proxyHandle.stop()
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error('Topology proxy shutdown failed'))
      }
      proxyHandle = null
    }

    if (serviceHandle) {
      try {
        await serviceHandle.stop()
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error('Topology service shutdown failed'))
      }
      serviceHandle = null
    }

    if (errors.length > 0) {
      for (const error of errors) {
        console.error(error.message)
      }
      process.exit(1)
    }
  }

  const handleSignal = (signal: string): void => {
    if (shuttingDown) {
      return
    }
    console.log(`Received ${signal}. Shutting down topology stack...`)
    void stopAll().then(() => {
      console.log('Topology stack stopped.')
      process.exit(0)
    })
  }

  process.on('SIGINT', () => handleSignal('SIGINT'))
  process.on('SIGTERM', () => handleSignal('SIGTERM'))

  try {
    const config = parseTopologyStackArgs(process.argv.slice(2))

    serviceHandle = await startTopologyService(config.service)
    proxyHandle = await startTopologyProxy(config.topologyProxy)
    reporterHandle = await startTopologyReporterProxy(config.reporterProxy)
  } catch (error) {
    console.error('Failed to start topology stack:', error)
    await stopAll()
    process.exit(1)
  }
}

void run()
