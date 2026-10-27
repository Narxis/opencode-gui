# Interface « coordinateur » sur opencode

But : passer d'un chat unique à un **chat de projet** où un agent coordinateur délègue le travail à des **fils** (sessions opencode), suivis comme des cartes avec état. On reproduit l'ergonomie, pas le code.

Sources : types de `@opencode-ai/sdk` 1.19.4 (`dist/v2`), mémoire du projet (opencode 2.2 testé). Points marqués ⚠ à vérifier sur le vrai 2.2.

## 1. Éléments visibles → opencode

| Élément UI | Ce qu'on voit | opencode 2.2 | Manque côté app |
|---|---|---|---|
| Projets multiples | Liste de projets à gauche, un par sujet | `location.directory` des sessions, `/api/location`, `projectID` | Liste des projets (dossiers) + choix du dossier |
| Chat de projet | Fil principal, l'utilisateur parle au coordinateur | Une session « racine » par projet, agent `coordinateur` (`POST /api/session {agent}`) | Retenir quelle session est le chat du projet |
| Réponse courte du coordinateur | 2-3 phrases, lien vers le fil créé | Prompt de l'agent (`agent.<nom>.prompt` dans `opencode.json`) | Rien, juste le prompt |
| Carte de fil | Titre cliquable, état, dernier message, résultat | Session `title`, `session.status` (idle / busy / retry), `session.idle`, `session.error` | Lien parent→fil (le create v2 n'a pas `parentID`), état dérivé |
| États | en cours, attend l'utilisateur, prêt, terminé, échec | busy → en cours ; `permission.asked` / `question.asked` → attend ; idle → prêt ; `session.error` → échec | « terminé » = marqué par l'utilisateur ou le fil, stocké par l'app |
| Vue d'un fil | Chat du fil, saisie, checklist, diffs | `/api/session/:id/message`, `todo.updated` (outil todowrite), `session.diff` | Rendu checklist + diffs (déjà au « reste à faire ») |
| Avertissement « attend » | Badge sur la carte, notification système | `permission.asked`, `question.asked` + `/api/session/:id/permission/:req/reply`, `/question/:req/reply` | Boutons Autoriser/Refuser, réponse aux questions, `Notification` Electron |
| Le coordinateur crée un fil | « J'ouvre un fil pour ça » | Outil `task` = sous-agent **bloquant** (le coordinateur attend la fin) ⚠ | Outil `start_thread` non bloquant (voir §2) |
| Le coordinateur relance un fil | Message au fil, réponse dans le fil | `POST /api/session/:id/prompt` | Outil `message_thread` |
| Mémoire de projet | Faits durables lus par chaque fil | `AGENTS.md` du dossier, chargé par opencode à chaque session | Rien (l'agent l'édite avec ses outils) ; vue lecture seule en option |
| Liste de PR | PR liées au projet, état CI | Rien de natif ; `gh` via l'outil bash, ou un MCP GitHub (`/mcp`) | Phase tardive, optionnelle |
| Arrêt d'un fil | Bouton stop | `/api/session/:id/interrupt` | Bouton |

## 2. Manques à combler

1. **Routage des événements par fil.** Aujourd'hui `src/main/opencode.ts` jette tout ce qui n'est pas la session courante. Il faut tout garder, indexé par `sessionID`, et mettre à jour l'état de chaque carte, même hors écran.
2. **État des fils.** Petit store JSON dans `userData` : `{ projet: dossier, chat: sessionID, fils: [{ id, parent, état, résultat }] }`. L'état « live » se recalcule depuis les événements ; seuls `parent` et « terminé » sont persistés.
3. **Outil `start_thread`.** L'outil `task` d'opencode bloque le coordinateur, donc pas de fils en parallèle ni de réponse courte immédiate. Solution : l'app expose un petit **serveur MCP local** (HTTP sur 127.0.0.1, déclaré à opencode via `OPENCODE_CONFIG_CONTENT` au lancement) avec 3 outils :
   - `start_thread(titre, consigne)` → crée la session (`POST /api/session {agent:"build"}`), envoie la consigne, enregistre le lien, renvoie l'id ;
   - `message_thread(id, texte)` ;
   - `list_threads()` → titres + états.
   Quand un fil passe à prêt / attend / échec, l'app envoie une ligne au chat du coordinateur (« [fil X] prêt : résumé ») pour qu'il réagisse, comme un réveil.
4. **Agent coordinateur.** Défini dans la config injectée : `mode: primary`, prompt court (déléguer, répondre en 3 phrases, ne pas coder lui-même), outils d'édition désactivés, outils MCP ci-dessus actifs.

## 3. Plan

| Phase | Contenu | Ce que Geoffrey voit |
|---|---|---|
| 1. Fils vivants | Routage des événements par session, état par fil, badge sur chaque fil de la barre latérale | Les fils existants affichent en cours / prêt / échec en direct, même ceux qu'on ne regarde pas |
| 2. Attente utilisateur | Permissions et questions dans la vue du fil + notification Windows | « Fil X attend ta réponse », boutons Autoriser / Refuser / réponse |
| 2 bis. Panneau « Fils de discussion » | Panneau groupé par état (voir §4) | Le même panneau que dans Claude : en attente, en cours, inactif, résolu |
| 3. Chat de projet + coordinateur | Projet = dossier, session racine avec agent `coordinateur`, MCP `start_thread` / `message_thread` / `list_threads` | On demande une tâche, le coordinateur répond court et une carte de fil apparaît dans le chat |
| 4. Retour au coordinateur | Fin ou blocage d'un fil → message au chat du coordinateur ; fils en parallèle | Le coordinateur annonce « fil X prêt » et enchaîne sans qu'on relance |
| 5. Vue d'un fil complète | Checklist (`todo.updated`), diffs (`session.diff`), bouton stop, « marquer terminé » | La vue fil ressemble à celle de Claude Code |
| 6. Extras | Plusieurs projets, mémoire (`AGENTS.md`) en lecture, liste de PR via `gh`, installeur Windows | Produit complet à installer |

## 4. Panneau « Fils de discussion » (capture Claude de Geoffrey)

| Élément | Source opencode | Faisable ? |
|---|---|---|
| Section « En attente de votre action · N », zone pointillée « Décisions, révisions et demandes d'autorisation » si vide | état `wait` (permission / question) | Oui |
| Section « En cours · N », spinner | état `busy` | Oui |
| Section « Inactif · N », cercle pointillé | session ni busy ni wait ni archivée | Oui |
| Section « Résolu · N », repliée par défaut | `time.archived` de la session ⚠ (route d'archivage à vérifier) | Oui, sinon drapeau stocké par l'app |
| Sections repliables (flèche) | UI seule | Oui |
| Titre en gras, heure relative à droite (« maintenant », « 1h ») | `title`, `time.updated` | Oui |
| Pastille checklist « 5/6 » avec spinner | dernier `todo.updated` (terminés / total) ; à recharger à l'ouverture ⚠ | Oui |
| Pastille PR verte « #17 » (ouverte), violette (mergée) | Rien de natif : repérer les liens `…/pull/N` dans les sorties d'outils, état via `gh pr view` | Partiel, phase 6 |
| Compteur « ⧉ N » = fichiers livrés par le fil ; survol = liste des noms | fichiers créés par les outils `write` / `edit` du fil (ou `session.diff`) | Oui |
| Après le titre : « — dernier message » en gris | dernier texte de la session | Oui |
| Icône rouge à côté du titre (machine déconnectée ?) | Sans objet en local | Non |
| Recherche | filtre sur les titres côté app | Oui |
| Filtre, agrandir, fermer | UI seule (options du filtre inconnues) | Oui, filtre à préciser |

Manque côté app : rien de nouveau hors PR ; tout vient de l'état des fils (phase 1) et de `todo.updated`.

## 5. Décisions (Geoffrey, 2026-10-27)

1. **Modèle du coordinateur** : Sonnet 5.5 ; les fils gardent le modèle par défaut.
2. **Un projet = un dossier** : oui (`location.directory`, `AGENTS.md` comme mémoire).
3. **Fils en parallèle** : oui, 3 au maximum.
4. **MCP local** : maison (JSON-RPC minimal, 3 outils), sans dépendance.
