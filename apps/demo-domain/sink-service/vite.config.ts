import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

const externals = Array.from(new Set([...builtins, '@grpc/grpc-js', '@modular-runtime/proto']))

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/sink-service.ts',
      formats: ['es'],
      fileName: 'sink-service',
    },
    rollupOptions: {
      external: externals,
    },
  },
  test: {
    environment: 'node',
  },
})
