import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  // Le preload sandboxé doit être en CommonJS.
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { plugins: [svelte(), tailwindcss()] }
})
