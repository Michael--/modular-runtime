/* eslint-disable no-console */
import * as fs from 'fs'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'
import * as yaml from 'js-yaml'

interface ServiceConfig {
  name: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  restart?: 'never' | 'on-failure' | 'always'
  maxRestarts?: number
  restartDelay?: number
}

interface Service {
  config: ServiceConfig
  process?: ChildProcess
  restarts: number
  lastExitCode?: number | null
}

const services: Service[] = []

function loadConfig(): void {
  const configPath = path.join(__dirname, '..', 'config.yaml')
  const configContent = fs.readFileSync(configPath, 'utf8')
  const config = yaml.load(configContent) as { services: ServiceConfig[] }

  for (const serviceConfig of config.services) {
    services.push({
      config: serviceConfig,
      restarts: 0,
    })
  }
}

function startService(service: Service): void {
  const { config } = service
  const cwd = config.cwd ? path.resolve(config.cwd) : process.cwd()
  const env = { ...process.env, ...config.env }

  console.log(`Starting service ${config.name}...`)
  const proc = spawn(config.command, config.args || [], { cwd, env, stdio: 'inherit' })

  service.process = proc

  proc.on('exit', (code) => {
    console.log(`Service ${config.name} exited with code ${code}`)
    service.lastExitCode = code
    service.process = undefined

    if (shouldRestart(service)) {
      setTimeout(() => startService(service), config.restartDelay || 0)
    }
  })

  proc.on('error', (err) => {
    console.error(`Service ${config.name} error: ${err.message}`)
  })
}

function shouldRestart(service: Service): boolean {
  const { config, lastExitCode, restarts } = service
  const restart = config.restart || 'never'
  const maxRestarts = config.maxRestarts || 5

  if (restart === 'always') return true
  if (restart === 'on-failure' && lastExitCode !== 0 && restarts < maxRestarts) {
    service.restarts++
    return true
  }
  return false
}

function startAllServices(): void {
  for (const service of services) {
    startService(service)
  }
}

function main(): void {
  loadConfig()
  startAllServices()

  // Keep running
  process.on('SIGINT', () => {
    console.log('Shutting down...')
    for (const service of services) {
      if (service.process) {
        service.process.kill()
      }
    }
    process.exit(0)
  })
}

main()
