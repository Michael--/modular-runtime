import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/supervisor.ts',
      formats: ['es'],
      fileName: 'supervisor',
    },
    sourcemap: true,
    rollupOptions: {
      external: Array.from(new Set([...builtins, 'js-yaml'])),
    },
  },
})
