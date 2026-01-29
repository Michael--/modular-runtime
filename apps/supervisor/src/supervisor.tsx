import * as fs from 'fs'
import * as path from 'path'
import { spawn, ChildProcess, SpawnOptions } from 'child_process'
import * as yaml from 'js-yaml'
import { fileURLToPath } from 'url'
import { Box, Text, render } from 'ink'
import { useEffect, useState } from 'react'

const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml')
const MAX_EVENT_ENTRIES = 8
const MAX_OUTPUT_ENTRIES = 40
const DEFAULT_RESTART_TIMEOUT_MS = 2000

enum ServiceStatus {
  Idle = 'idle',
  Starting = 'starting',
  Running = 'running',
  WaitingRestart = 'waiting-restart',
  Restarting = 'restarting',
  Stopped = 'stopped',
  Failed = 'failed',
}

type StatusColor = 'green' | 'red' | 'yellow' | 'magenta' | 'gray'

function getStatusColor(status: ServiceStatus): StatusColor {
  switch (status) {
    case ServiceStatus.Running:
      return 'green'
    case ServiceStatus.Failed:
    case ServiceStatus.Stopped:
      return 'red'
    case ServiceStatus.Starting:
    case ServiceStatus.Restarting:
      return 'yellow'
    case ServiceStatus.WaitingRestart:
      return 'magenta'
    default:
      return 'gray'
  }
}

interface ServiceConfig {
  name: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  restart?: 'never' | 'on-failure' | 'always'
  maxRestarts?: number
  restartDelay?: number
  restartOnUnexpectedExit?: boolean
}

interface ServiceEntry {
  config: ServiceConfig
  process?: ChildProcess
  restarts: number
  lastExitCode?: number | null
  status: ServiceStatus
  statusMessage?: string
  shuttingDown: boolean
  pendingRestart?: NodeJS.Timeout
}

interface EventEntry {
  timestamp: string
  message: string
}

interface OutputEntry {
  timestamp: string
  serviceName: string
  stream: 'stdout' | 'stderr'
  message: string
}

interface RestartDecision {
  allow: boolean
  reason?: string
}

const services: ServiceEntry[] = []
const eventLog: EventEntry[] = []
const outputLog: OutputEntry[] = []
const updateListeners = new Set<() => void>()
let shuttingDown = false
let supervisorStarted = false

function subscribe(listener: () => void): () => void {
  updateListeners.add(listener)
  return () => {
    updateListeners.delete(listener)
  }
}

function notifyUpdate(): void {
  for (const listener of updateListeners) {
    listener()
  }
}

function pushEvent(message: string): void {
  eventLog.unshift({ timestamp: new Date().toISOString(), message })
  if (eventLog.length > MAX_EVENT_ENTRIES) {
    eventLog.pop()
  }
  notifyUpdate()
}

function pushOutput(service: ServiceEntry, stream: 'stdout' | 'stderr', message: string): void {
  outputLog.unshift({
    timestamp: new Date().toISOString(),
    serviceName: service.config.name,
    stream,
    message,
  })
  if (outputLog.length > MAX_OUTPUT_ENTRIES) {
    outputLog.pop()
  }
  notifyUpdate()
}

function loadConfig(): void {
  const configContent = fs.readFileSync(CONFIG_FILE, 'utf8')
  const config = yaml.load(configContent) as { services?: ServiceConfig[] }

  if (!config?.services?.length) {
    throw new Error('supervisor: config.yaml must define at least one service')
  }

  for (const serviceConfig of config.services) {
    services.push({
      config: serviceConfig,
      restarts: 0,
      status: ServiceStatus.Idle,
      shuttingDown: false,
    })
  }
}

function resolveCwd(cwd?: string): string {
  return cwd ? path.resolve(cwd) : process.cwd()
}

function spawnOptions(config: ServiceConfig): SpawnOptions {
  return {
    cwd: resolveCwd(config.cwd),
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
}

function logServiceOutput(service: ServiceEntry, chunk: Buffer, stream: 'stdout' | 'stderr'): void {
  const text = chunk.toString('utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) {
      continue
    }
    pushOutput(service, stream, rawLine)
  }
}

function scheduleRestart(service: ServiceEntry, delayMs: number, reason: string): void {
  if (service.pendingRestart) {
    clearTimeout(service.pendingRestart)
  }

  service.status = ServiceStatus.WaitingRestart
  service.statusMessage = `waiting ${delayMs}ms before restart (${reason})`
  pushEvent(`Service ${service.config.name} will restart in ${delayMs}ms (${reason})`)

  service.pendingRestart = setTimeout(() => {
    service.pendingRestart = undefined
    if (shuttingDown) {
      pushEvent(`Supervisor is shutting down; skipping restart for ${service.config.name}`)
      return
    }

    service.status = ServiceStatus.Restarting
    service.statusMessage = 'restarting now'
    pushEvent(`Restarting ${service.config.name}`)
    startService(service)
  }, delayMs)
}

function handleExit(
  service: ServiceEntry,
  code: number | null,
  signal: NodeJS.Signals | null
): void {
  service.process = undefined
  service.lastExitCode = code
  const exitDescription = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`

  if (service.shuttingDown || shuttingDown) {
    service.status = ServiceStatus.Stopped
    service.statusMessage = `stopped (${exitDescription})`
    pushEvent(`Service ${service.config.name} stopped (${exitDescription})`)
    return
  }

  service.status = ServiceStatus.Stopped
  service.statusMessage = `unexpectedly exited (${exitDescription})`
  pushEvent(`Service ${service.config.name} exited unexpectedly (${exitDescription})`)

  const restartAllowed = service.config.restartOnUnexpectedExit ?? true
  if (!restartAllowed) {
    pushEvent(`Restart disabled for ${service.config.name} (restartOnUnexpectedExit=false)`)
    return
  }

  const decision = determineRestartDecision(service)
  if (!decision.allow) {
    pushEvent(
      `Restart prevented for ${service.config.name}: ${decision.reason ?? 'policy prevented restart'}`
    )
    return
  }

  const timeout = service.config.restartDelay ?? DEFAULT_RESTART_TIMEOUT_MS
  service.restarts += 1
  scheduleRestart(service, timeout, exitDescription)
}

function handleSpawnError(service: ServiceEntry, error: Error): void {
  service.status = ServiceStatus.Failed
  service.statusMessage = error.message
  pushEvent(`Service ${service.config.name} failed to start: ${error.message}`)
}

function startService(service: ServiceEntry): void {
  if (service.pendingRestart) {
    clearTimeout(service.pendingRestart)
    service.pendingRestart = undefined
  }

  service.shuttingDown = false
  service.status = ServiceStatus.Starting
  service.statusMessage = 'launching'
  pushEvent(`Starting ${service.config.name}`)

  const proc = spawn(
    service.config.command,
    service.config.args ?? [],
    spawnOptions(service.config)
  )
  service.process = proc

  proc.stdout?.on('data', (chunk) => logServiceOutput(service, chunk, 'stdout'))
  proc.stderr?.on('data', (chunk) => logServiceOutput(service, chunk, 'stderr'))

  proc.on('spawn', () => {
    service.status = ServiceStatus.Running
    service.statusMessage = `running (pid ${proc.pid ?? '-'})`
    pushEvent(`Service ${service.config.name} is running (pid ${proc.pid ?? '-'})`)
  })

  proc.on('exit', (code, signal) => handleExit(service, code, signal))
  proc.on('error', (error) => handleSpawnError(service, error))
}

function startAllServices(): void {
  for (const service of services) {
    startService(service)
  }
}

function shutdownSupervisor(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  pushEvent(`Supervisor received ${signal}; shutting down services`)

  for (const service of services) {
    service.shuttingDown = true
    if (service.pendingRestart) {
      clearTimeout(service.pendingRestart)
      service.pendingRestart = undefined
    }
    if (service.process) {
      service.process.kill()
    }
  }

  setTimeout(() => {
    pushEvent('Supervisor exiting now')
    process.exit(0)
  }, 1000)
}

function determineRestartDecision(service: ServiceEntry): RestartDecision {
  const policy = service.config.restart ?? 'never'
  const maxRestarts = service.config.maxRestarts ?? 5

  if (service.restarts >= maxRestarts) {
    return { allow: false, reason: `max restarts (${maxRestarts}) reached` }
  }

  if (policy === 'always') {
    return { allow: true }
  }

  if (policy === 'on-failure') {
    const exitCode = service.lastExitCode ?? -1
    if (exitCode === 0) {
      return { allow: false, reason: 'clean exit (exit code 0)' }
    }
    return { allow: true }
  }

  return { allow: false, reason: 'restart policy set to never' }
}

const ServiceRow = ({ service }: { service: ServiceEntry }): JSX.Element => {
  const pid = service.process?.pid ?? '-'
  const exitCode = service.lastExitCode ?? '-'
  const statusMessage = service.statusMessage ? ` (${service.statusMessage})` : ''

  return (
    <Text>
      {'  '}
      <Text color={getStatusColor(service.status)}>[{service.status}]</Text>{' '}
      <Text color="cyan">{service.config.name}</Text>
      {statusMessage}
      {' | '}pid={pid} restarts={service.restarts} lastExit={exitCode}
    </Text>
  )
}

const EventRow = ({ entry }: { entry: EventEntry }): JSX.Element => (
  <Text color="blue">
    {'  '}[SUPERVISOR] [{entry.timestamp}] {entry.message}
  </Text>
)

const OutputRow = ({ entry }: { entry: OutputEntry }): JSX.Element => {
  const streamLabel = entry.stream === 'stderr' ? 'ERR' : 'OUT'
  const color = entry.stream === 'stderr' ? 'red' : 'green'

  return (
    <Text color={color}>
      {'  '}[{entry.serviceName}][{streamLabel}][{entry.timestamp}] {entry.message}
    </Text>
  )
}

const SupervisorApp = (): JSX.Element => {
  const [, forceRender] = useState(0)

  useEffect(() => subscribe(() => forceRender((tick) => tick + 1)), [])

  return (
    <Box flexDirection="column">
      <Text color="blue">=== Supervisor snapshot @ {new Date().toISOString()} ===</Text>
      <Text bold>Services:</Text>
      {services.map((service) => (
        <ServiceRow key={service.config.name} service={service} />
      ))}
      <Text bold>Recent events:</Text>
      {eventLog.length > 0 ? (
        eventLog.map((entry, index) => <EventRow key={`event-${index}`} entry={entry} />)
      ) : (
        <Text dimColor>{'  '}(no recent events)</Text>
      )}
      <Text bold>Recent output:</Text>
      {outputLog.length > 0 ? (
        outputLog.map((entry, index) => <OutputRow key={`output-${index}`} entry={entry} />)
      ) : (
        <Text dimColor>{'  '}(no output yet)</Text>
      )}
    </Box>
  )
}

function startSupervisor(): void {
  if (supervisorStarted) {
    return
  }
  supervisorStarted = true

  loadConfig()
  pushEvent(`Loaded ${services.length} services from config`)
  startAllServices()

  process.on('SIGINT', () => shutdownSupervisor('SIGINT'))
  process.on('SIGTERM', () => shutdownSupervisor('SIGTERM'))
}

function main(): void {
  startSupervisor()
  render(<SupervisorApp />)
}

main()
