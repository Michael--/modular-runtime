import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/pipeline-orchestrator.ts'),
      formats: ['es'],
      fileName: 'pipeline-orchestrator',
    },
    rollupOptions: {
      external: [/^node:/, '@grpc/grpc-js', /^@modular-runtime\//],
    },
    ssr: true,
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
