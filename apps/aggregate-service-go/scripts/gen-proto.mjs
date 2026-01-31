#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const protoRoot = resolve(repoRoot, 'packages/proto')
const outputDir = resolve(repoRoot, 'apps/aggregate-service-go')

const args = [
  `-I${protoRoot}`,
  `--go_out=${outputDir}`,
  `--go-grpc_out=${outputDir}`,
  `${protoRoot}/pipeline/v1/pipeline.proto`,
  `${protoRoot}/broker/v1/broker.proto`,
]

const child = spawn('protoc', args, { stdio: 'inherit' })
child.on('close', (code) => {
  process.exitCode = code ?? 1
})
