import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["5577-2401-4900-1ce2-e06c-24c9-c309-8613-9874.ngrok-free.app","b08c-2401-4900-1ce2-e06c-a8f5-e3aa-6c95-ecc6.ngrok-free.app"],
    proxy: {
      "/api": "http://api:8000",
      "/auth": "http://api:8000",
      "/health": "http://api:8000",
    },
  },
})
