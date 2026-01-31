#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const protoRoot = resolve(repoRoot, 'packages/proto')
const outputDir = resolve(repoRoot, 'apps/rules-service-python/src')

const args = [
  '-m',
  'grpc_tools.protoc',
  `-I${protoRoot}`,
  `--python_out=${outputDir}`,
  `--grpc_python_out=${outputDir}`,
  `${protoRoot}/pipeline/v1/pipeline.proto`,
  `${protoRoot}/broker/v1/broker.proto`,
]

const child = spawn('python', args, { stdio: 'inherit' })
child.on('close', (code) => {
  process.exitCode = code ?? 1
})
