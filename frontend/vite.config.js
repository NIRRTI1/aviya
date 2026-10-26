import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const previewHost = process.env.VITE_ALLOWED_HOST
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: previewHost ? [previewHost] : [],
  },
})
