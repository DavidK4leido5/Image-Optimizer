import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works from /Image-Optimizer/ on GitHub Pages
// and from any other subpath without a rebuild.
export default defineConfig({
  base: './',
  plugins: [react()],
})
