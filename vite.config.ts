import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'

// base relativa: funciona en https://<usuario>.github.io/<repo>/ sin configurar el nombre del repo
export default defineConfig({
  base: './',
  plugins: [preact(), tailwindcss()],
})
