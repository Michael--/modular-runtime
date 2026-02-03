import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

const externals = Array.from(
  new Set([
    ...builtins,
    '@grpc/grpc-js',
    '@modular-runtime/proto',
    '@modular-runtime/topology-reporter',
  ])
)

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/topology.ts',
      formats: ['es'],
      fileName: 'topology',
    },
    rollupOptions: {
      external: externals,
    },
  },
})
