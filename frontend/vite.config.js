import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const backendPort = process.env.DENNY_BACKEND_PORT || '8001'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT || 5174),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        timeout: 7200000,
        proxyTimeout: 7200000,
      },
      '/static': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
