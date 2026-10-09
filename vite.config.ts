import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the build works from any sub-path (GitHub Pages).
  base: './',
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  test: {
    testTimeout: 60000,
  },
})
