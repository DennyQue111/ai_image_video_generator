import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const backendPort = process.env.DENNY_BACKEND_PORT || '8005'

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
    port: Number(process.env.PORT || 5175),
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (normalizedId.includes('/node_modules/three/examples/')) return 'three-extras'
          if (normalizedId.includes('/node_modules/three/')) return 'three-vendor'
          if (normalizedId.includes('/node_modules/reactflow/') || normalizedId.includes('/node_modules/@reactflow/')) return 'reactflow-vendor'
          if (normalizedId.includes('/node_modules/react-dom/') || normalizedId.includes('/node_modules/react/') || normalizedId.includes('/node_modules/scheduler/')) return 'react-vendor'
        },
      },
    },
  },
})
