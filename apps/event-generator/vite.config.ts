import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

const externals = Array.from(new Set([...builtins, '@modular-runtime/pipeline-common']))

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/event-generator.ts',
      formats: ['es'],
      fileName: 'event-generator',
    },
    rollupOptions: {
      external: externals,
    },
  },
  test: {
    environment: 'node',
  },
})
