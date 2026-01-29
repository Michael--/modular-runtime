import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]

const externals = Array.from(new Set([...builtins, 'ink', 'js-yaml', 'react', 'react/jsx-runtime']))

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: 'src/supervisor.tsx',
      formats: ['es'],
      fileName: 'supervisor',
    },
    sourcemap: true,
    rollupOptions: {
      external: externals,
    },
  },
})
