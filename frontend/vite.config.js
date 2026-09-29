import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api/* to the FastAPI server (api/server.py, uvicorn on :8000).
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
