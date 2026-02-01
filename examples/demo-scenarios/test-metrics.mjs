#!/usr/bin/env node
/**
 * Test metrics output from all services
 * Runs a small pipeline (1000 events) and captures all service metrics
 */

import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const EVENTS = 1000

async function runCommand(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n→ Starting ${label}...`)
    const proc = spawn(cmd, args, { stdio: 'pipe' })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      // Show metrics immediately
      if (text.includes('Metrics')) {
        console.log(`[${label}] ${text}`)
      }
    })
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr, label })
    })
    
    return proc
  })
}

async function main() {
  console.log('=== Service Metrics Test ===')
  console.log(`Testing with ${EVENTS} events\n`)
  
  // Start broker
  const broker = spawn('node', ['../../packages/broker/dist/broker.js'], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  console.log('→ Broker started')
  await setTimeout(1000)
  
  // Start services with metrics enabled
  const services = [
    { 
      cmd: 'node', 
      args: ['../../apps/ingest-service/dist/ingest-service.js'],
      label: 'ingest'
    },
    { 
      cmd: '../../apps/parse-service-rust/target/release/parse-service-rust',
      args: [],
      label: 'parse'
    },
    { 
      cmd: 'python3',
      args: ['../../apps/rules-service-python/src/rules_service.py'],
      label: 'rules'
    },
    {
      cmd: '../../apps/aggregate-service-go/aggregate-service-go',
      args: [],
      label: 'aggregate'
    },
    {
      cmd: 'node',
      args: ['../../apps/sink-service/dist/sink-service.js'],
      label: 'sink'
    }
  ]
  
  const procs = []
  for (const svc of services) {
    const proc = spawn(svc.cmd, svc.args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd()
    })
    
    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[${svc.label}] ${line}`)
        }
      }
    })
    
    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (line.includes('Metrics') || line.includes('processed')) {
          console.log(`[${svc.label}] ${line}`)
        }
      }
    })
    
    procs.push({ proc, ...svc })
    console.log(`→ ${svc.label} started`)
  }
  
  await setTimeout(2000)
  
  // Run orchestrator
  console.log('\n→ Running pipeline...')
  const orch = await runCommand(
    'node',
    [
      '../../apps/pipeline-orchestrator/dist/pipeline-orchestrator.js',
      '--input', './events.ndjson',
      '--output', './test-metrics-output.ndjson',
      '--max-events', String(EVENTS)
    ],
    'orchestrator'
  )
  
  console.log(orch.stdout)
  
  await setTimeout(2000)
  
  // Cleanup
  console.log('\n→ Shutting down...')
  for (const { proc, label } of procs) {
    proc.kill('SIGTERM')
    console.log(`  ${label} stopped`)
  }
  broker.kill('SIGTERM')
  console.log('  broker stopped')
  
  console.log('\n✓ Test complete!')
}

main().catch(console.error)
