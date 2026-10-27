---
name: run-opencode-gui
description: Lancer, piloter et capturer l'app Electron opencode-gui en cloud (xvfb + Playwright). À utiliser pour voir un changement d'UI dans l'app réelle ou faire une capture d'écran.
---

Chemins relatifs à la racine du dépôt.

## Préparer
```bash
npm install
node node_modules/electron/install.js   # si node_modules/electron/dist manque (téléchargement sauté)
npm i -g opencode-ai                    # l'app lance `opencode serve`
npm run build                           # le script lit out/ ; refaire après chaque modif
```

## Lancer + piloter
```bash
xvfb-run -a node .claude/skills/run-opencode-gui/drive.mjs "ss 01" "type dis bonjour" "press Enter" "wait 8" "ss 02" "text"
```
Sans argument : `ss 01` + `text`. Captures dans `/tmp/shots/` (`SCREENSHOT_DIR`). **Regarder la capture** (Read sur le .png).

Étapes : `ss [nom]`, `type <texte>` (remplit la zone de saisie), `press <touche>`, `click <css>`, `wait <secondes>`, `text` (innerText), `eval <js>`. Logs du process principal préfixés `[main]`.

## Pièges
- npm n'a qu'opencode **1.19.x** ; l'app vise l'API 2.x et aucun fournisseur LLM n'est configuré en cloud : l'UI s'affiche, le chat reste sur « Réflexion… ». Pour tester le chat, faux serveur ou PC de Geoffrey.
- `app.close()` bloque tant que `opencode serve` tourne : le script tue `opencode serve` puis Electron.
- Réseau : `models.opencode.ai` refusé par le proxy (sans gravité).
- `--no-sandbox` obligatoire en conteneur. Erreurs dbus : bruit, filtrées.
- `playwright` est préinstallé globalement (pas dans package.json) : chargé via `createRequire`.
