import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

const externals = Array.from(
  new Set([...builtins, '@grpc/grpc-js', '@modular-runtime/broker', '@modular-runtime/proto'])
)

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/calculator-server.ts',
      formats: ['es'],
      fileName: 'calculator-server',
    },
    rollupOptions: {
      external: externals,
    },
  },
})
