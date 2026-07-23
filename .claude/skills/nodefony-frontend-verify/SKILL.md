---
name: nodefony-frontend-verify
metadata:
  version: 1.0.0
description: >
  Vérifie une modif frontend Studio (ou tout module Vite) SANS navigateur headless
  (règle projet) : curl du transform Vite d'un fichier .tsx pour valider la
  résolution + la transpilation, purge du prébundle Vite (`node_modules/.vite`)
  quand un import/subpath change, rappel hard-reload navigateur (cache React).
  Délègue l'analyse runtime à `nodefony-tail-error-logs` et la gate types à
  `npm run typecheck` du module — esbuild attrape la syntaxe, PAS les types.
  NE remplace PAS `nodefony-start-server` (qui démarre/arrête) ni la confirmation
  visuelle user.
  Déclencheurs : "vérifie le front", "curl Vite", "transform Vite", "vérifie le
  bundle", "prébundle Vite périmé", "purge .vite", "ma modif front passe ?",
  "hard-reload nécessaire ?", "frontend verify", "verify front Studio".
---

# nodefony-frontend-verify — vérification d'une modif frontend SANS navigateur

> Règle projet : **JAMAIS de Chrome headless / CDP** ([[feedback_no_headless_chrome]]).
> Vérification front = **curl + confirmation visuelle user**. Ce skill outille la partie curl.

Playbook **déterministe** : 3 recettes pour prouver qu'une modif frontend Studio
(ou tout module servi par Vite) est bien prise en compte côté serveur AVANT de
demander un test navigateur au user. Ne charge pas un navigateur, ne fait pas de
screenshot. Sortie cible : un verdict en 1-3 commandes.

## Quand l'utiliser (vs `nodefony-start-server`)

| Besoin                                                      | Skill                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Démarrer / arrêter / redémarrer le serveur dev              | `nodefony-start-server`                                                            |
| Vérifier qu'une modif `.tsx` est transformée par Vite (HMR) | **`nodefony-frontend-verify`**                                                     |
| Purger un prébundle Vite après ajout d'un import/subpath    | **`nodefony-frontend-verify`**                                                     |
| Confirmer le rendu visuel                                   | **demander au user** (hard-reload — `Cmd+Shift+R` Safari, `Ctrl+Shift+R` ailleurs) |
| Lire un crash serveur après une modif                       | `nodefony-tail-error-logs`                                                         |
| Valider les types frontend                                  | `npm run typecheck` dans le module                                                 |

> **Le HMR Vite est suffisant pour 99 % des modifs frontend** : 0 restart serveur.
> Restart UNIQUEMENT quand un **subpath neuf** (`nodefony/<truc>`) apparaît →
> Vite ré-optimise les deps au boot (cf. mémoire `feedback_session_pitfalls`).

## 1. Curl du transform Vite (la recette #1)

Vérifie que Vite voit ton fichier modifié, le résout, et le transpile en JS valide.

```bash
# Cible = fichier ABSOLU, préfixé /@fs/ dans Vite (résout depuis le système de fichiers)
ABS="/Users/cci/repository/nodefony-core/src/packages/@nodefony/studio/frontend/src/routes/MaVue.tsx"
curl -sk "https://127.0.0.1:5173/@fs${ABS}" | head -30
```

Ce qu'on attend :

- **HTTP 200** (curl `-w "%{http_code}\n"` pour vérifier explicitement)
- **JavaScript transpilé** en sortie (pas du JSX brut) : `import {…} from "react"` + `_jsx(...)` (React 19) ou similaire.
- Pas de message d'erreur Vite (`Failed to resolve`, `Pre-transform error`).

Verdict rapide (un seul curl) :

```bash
curl -sk -o /tmp/vite-check.js -w "http=%{http_code} size=%{size_download}\n" \
  "https://127.0.0.1:5173/@fs${ABS}"
head -5 /tmp/vite-check.js
# Attendu : http=200, size > 200 octets, JS visible (pas de balise <html>)
```

**Causes courantes de KO** :

- `http=404` → mauvais chemin (typo) ou fichier hors workspace Vite.
- `http=500` → erreur de syntaxe TS/TSX (lire la sortie : Vite renvoie un commentaire d'erreur).
- `http=200` mais HTML/`<title>Vite + …`</title>`dans la sortie → tu as tapé l'URL de la page racine, pas du`/@fs/<abs>`.
- 200 mais le code TRANSPILÉ ne reflète pas ta modif → **prébundle périmé** → recette #2.

> Le port HMR Vite est par défaut **5173** (publié sur `https` en dev nodefony).
> Si le serveur Studio écoute ailleurs (configuration `frontend.devServer.port`),
> adapter. Voir `src/packages/@nodefony/frontend/CLAUDE.md`.

## 2. Purge du prébundle Vite (`node_modules/.vite`)

Vite **pré-bundle** les deps (CommonJS → ESM, JSX → JS) au boot et **cache** ça
dans `node_modules/.vite/`. Quand on **ajoute** un import (ex. un subpath
`nodefony/react` qui n'existait pas avant), le cache **ne le sait pas** → Vite
peut servir une version sans le nouveau symbole → faux bug front « le hook
n'existe pas » alors qu'il existe.

```bash
# Purger le prébundle d'UN module (ne pas purger global = ré-optimisation lente)
MOD="src/packages/@nodefony/studio"
rm -rf "$MOD/node_modules/.vite" "$MOD/frontend/node_modules/.vite"
echo "prébundle purgé : $(ls -la "$MOD/node_modules/.vite" 2>/dev/null || echo 'absent')"
# Puis : redémarrer le serveur dev → ré-optimisation au boot (cf nodefony-start-server)
```

**Quand purger** :

- Ajout d'un nouveau **subpath Core** (`nodefony/react`, `nodefony/debugbar`, `nodefony/roles`…)
- Ajout d'une **nouvelle dependency** Vite-side (package.json frontend modifié)
- Erreur runtime « `does not provide an export named '…'` » sur un import qui EXISTE bien dans le source
- Après un `git pull` qui change les exports d'un module dépendant

**Ne PAS purger sans raison** : la ré-optimisation prend 5-20 s au boot (multiplie par N modules pour Studio).

## 3. Hard-reload navigateur (cache React)

Une fois les recettes #1-#2 OK côté serveur, demander au user de **hard-reload**
la page (`Cmd+Shift+R` Safari/Mac, `Ctrl+Shift+R` Chrome/Firefox) :

- Le **bundle HTML** (`/nodefony`) est servi avec hash, mais le navigateur peut
  garder l'**ancienne version du composant React** en mémoire (HMR raté ou
  partial).
- Sur un **cluster** (`nodefony cluster -w N`), le HMR n'existe PAS → après
  rebuild + restart, **TOUJOURS** hard-reload avec **DevTools « Disable cache »
  ON** sinon vieux `index.html` → chunk hashé supprimé → **404 import lazy =
  « la page ne marche plus »**, ≠ bug code. Cf. `nodefony-studio-dev` §Cluster
  PIÈGE #1 (vécu 2026-05-25, a coûté des heures).

> Ne pas demander au user des dizaines de hard-reload : batcher les modifs front
> avant de demander UNE vérif (cf. hygiène §2 CLAUDE.md « 1 feature = 1 session
> courte » + cahier des charges amont).

## Limites — ce que ce skill NE VÉRIFIE PAS

- **Types TypeScript** : esbuild (le transformer de Vite) attrape la **syntaxe**,
  PAS les types. Un `as any`, un `// @ts-ignore`, un type incompatible passent
  silencieusement le transform. → gate **distincte** :
  ```bash
  cd src/packages/@nodefony/studio && npm run typecheck   # 0 erreur attendue
  ```
- **Rendu visuel** : seul le user peut confirmer (règle projet — pas de headless).
- **Erreur runtime React** (cycle, état mal initialisé, hook conditionnel) : se
  voit dans la console navigateur ; demander au user de copier les lignes
  (`feedback_browser_loop_ask_console`).

## Réfs

- Mémoires : [[feedback_no_headless_chrome]] (règle absolue), [[feedback_session_pitfalls]]
  (subpath neuf = restart + ré-optimisation), [[feedback_live_cluster_debug_workflow]]
  (cluster 0-HMR, hard-reload obligatoire avec « Disable cache »).
- Skills sœurs : `nodefony-start-server` (cycle de vie), `nodefony-studio-dev`
  (gate typecheck frontend), `nodefony-tail-error-logs` (crash serveur après
  modif), `nodefony-check-externals` (peerDeps mal externalisées au build).

## Changelog (SemVer)

- **1.0.0** (2026-05-27) — Création. Action #IV du KIT autonome
  `project_retex_improvements_kit` (suggéré 2× dans les retex, jamais fait).
  3 recettes : curl `/@fs/<abs>`, purge `.vite` par module, hard-reload
  navigateur (cache React + cluster 0-HMR). Limite types explicite (esbuild
  syntaxe-only). Ne remplace pas `nodefony-start-server` ni la confirmation user.
