# opencode-gui

App Electron qui imite l'UI de Claude Code (projets, fils, checklist), branchée sur `opencode serve`. Réponses en français, courtes.

Stack : Electron + electron-vite + Svelte 5 + TS + Tailwind 4.
- `src/main/opencode.ts` : lance `opencode serve`, client `@opencode-ai/sdk/v2` (routes `/api/`, auth Basic `opencode:<password>` lu dans « server password … »).
- `src/preload/` : pont IPC `window.oc`. `src/renderer/src/App.svelte` : UI.

Commandes : `npm run dev`, `npm run check` (avant chaque PR), `npm run build`, `npm run dist`.

Règles :
- Plus petite modif complète, pas d'abstraction ni de dépendance superflue.
- Aucun code/asset propriétaire d'Anthropic.
- Lire le code directement ; graphify seulement si `src/` > 10 000 mots ou > 40 fichiers. Ne pas commiter `graphify-out/`.
- Lire par plages (`sed -n`), pas de gros logs, pas de sous-agents.

Reste à faire : barre latérale projets/fils, checklist, diffs ; installeur Windows.
