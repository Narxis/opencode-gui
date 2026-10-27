# opencode-gui

App de bureau Electron qui reproduit l'interface de Claude Code (projets, fils, checklist, messages), branchée sur `opencode serve`.

## Réponses
- En français, court, style caveman : réponse d'abord, pas de blabla.

## Stack
Electron + electron-vite + Svelte 5 + TypeScript + Tailwind 4.

## Structure
- `src/main/` : process principal. `opencode.ts` lance `opencode serve` et parle au serveur.
- `src/preload/` : pont IPC exposé au renderer (`window.oc`).
- `src/renderer/` : UI Svelte (`src/App.svelte`).

## opencode 2.2
- Routes sous `/api/` (`/api/session`, `/api/event`, `/api/health`).
- Auth Basic `opencode:<mot de passe>` (affiché au démarrage : « server password … »).
- Ligne de démarrage : « server listening on … ».
- Client : `@opencode-ai/sdk/v2` (le client v1 ne marche pas avec 2.x).

## Commandes
- `npm run dev` : lancer en dev
- `npm run check` : types (à passer avant chaque PR)
- `npm run build` : compiler
- `npm run dist` : installeur Windows

## Règles
- Code au plus court (ponytail full) : plus petite modif complète, réutiliser l'existant, pas d'abstraction inutile.
- Pas de dépendance superflue.
- Ne copier aucun code ni asset propriétaire d'Anthropic : on s'inspire de l'interface, on ne la recopie pas.
- Économiser les tokens : lire le code directement tant que `src/` est petit.

## Graphify
Utiliser graphify (`graphify update .` puis `graphify query`) seulement si :
- `src/` > 10 000 mots (`find src -type f | xargs wc -w | tail -1`),
- ou > 40 fichiers source,
- ou question sur plus de 3 dossiers à la fois.
Sinon lire le code. Ne pas commiter `graphify-out/`. Si le graphe contredit le code, le code a raison.

## Plan
1. Squelette (fait)
2. Brancher opencode + chat en direct (fait)
3. Barre latérale projets/fils, checklist, diffs
4. Installeur Windows
