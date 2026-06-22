import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config
export default defineConfig({
  plugins: [react()],
  base: './',
  esbuild: {
    // Strip console.log/info/debug in production builds (keeps console.warn/error)
    pure: ['console.log', 'console.info', 'console.debug'],
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.ngrok-free.app', 'harsh-pc.local'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:58392',
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: 'ws://127.0.0.1:58392',
        ws: true,
        changeOrigin: true
      }
    }
  }
})
