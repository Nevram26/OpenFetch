import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preloads run as plain scripts that can only require('electron'):
    // emit one self-contained CommonJS file (index.cjs), never an ES module.
    build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs' } } }
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
