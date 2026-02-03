import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

const externals = Array.from(
  new Set([...builtins, '@modular-runtime/topology-reporter', '@grpc/grpc-js'])
)

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/topology-reporter-proxy.ts',
      formats: ['es'],
      fileName: 'topology-reporter-proxy',
    },
    rollupOptions: {
      external: externals,
    },
  },
})
