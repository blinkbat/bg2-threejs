import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { saveMapPlugin } from './vite-plugin-save-map'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), saveMapPlugin()],
  base: '/bg2-threejs/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
