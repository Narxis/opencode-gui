# opencode-gui

GUI Electron pour [opencode](https://opencode.ai), inspirée de l'interface Claude Code.

Stack : Electron + Vite (electron-vite) + Svelte 5 + TypeScript + Tailwind 4.

## Commandes

- `npm run dev` : lance l'app en mode développement
- `npm run build` : compile main, preload et renderer
- `npm run check` : vérifie les types
- `npm run dist` : crée l'installeur Windows

## Plan

1. Squelette du projet (fait)
2. Brancher opencode via `opencode serve` et le SDK `@opencode-ai/sdk`
3. Interface : projets, fils, appels d'outils, checklist, diffs
4. Installeur Windows
