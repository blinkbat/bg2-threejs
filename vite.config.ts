import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/bg2-threejs/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
