import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: {
        broker: 'src/index.ts',
        cli: 'src/cli.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    rollupOptions: {
      external: ['@grpc/grpc-js', '@modular-runtime/proto'],
    },
  },
  plugins: [dts({ outDir: './dist', entryRoot: 'src' })],
})
