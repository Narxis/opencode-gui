import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // mcp.ts : serveur MCP lancé par opencode (voir src/main/opencode.ts).
  main: { build: { rollupOptions: { input: { index: 'src/main/index.ts', mcp: 'src/main/mcp.ts' } } } },
  // Le preload sandboxé doit être en CommonJS.
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { plugins: [svelte(), tailwindcss()] }
})
