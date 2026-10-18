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
    // Bind to all network adapters so devices on the trusted LAN can open
    // the development UI. API and static requests remain same-origin and
    // are proxied to the backend below; the backend itself is not exposed
    // directly by this setting.
    host: '0.0.0.0',
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
