import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'broker',
    },
    rollupOptions: {
      external: ['@grpc/grpc-js', '@modular-runtime/proto'],
    },
  },
  plugins: [dts({ outDir: './dist', entryRoot: 'src' })],
})
