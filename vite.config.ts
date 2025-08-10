import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^ts-morph$/, replacement: 'ts-morph-npm' },
      { find: /^@ts-morph\/common$/, replacement: '@ts-morph/common-npm' },
    ],
  },
  optimizeDeps: {
    include: ['ts-morph-npm', '@ts-morph/common-npm'],
  },
})
