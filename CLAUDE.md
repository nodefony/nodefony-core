# CLAUDE.md — nodefony-core

---

## Token Optimization Rules (URGENT)

Pour économiser le quota de tokens (session de 5h) :

1. **Réponses "Chirurgicales"** : Ne jamais réécrire un fichier entier. Utilise les blocs de code partiels ou les outils d'édition de fichiers de Claude Code.
2. **Style "Caveman"** : Pas de politesses, pas de phrases d'introduction ("Voici le code...", "J'ai analysé..."). Va directement au code ou à l'erreur.
3. **Context Stripping** : À chaque début de session, n'analyse QUE le module cible (ex: `@nodefony/http`). Ignore le reste.
4. **Log Cleaning** : Avant de me donner un retour de test, résume-le. Supprime les warnings inutiles, ne garde que l'erreur bloquante.
5. **Auto-Compact** : Si la conversation devient longue, suggère-moi d'utiliser `/compact` immédiatement.
6. **No Prose** : Interdiction de récapituler ce qui a été fait en fin de message, sauf si demandé explicitement.

---

## PERSONA & TONE (CRITICAL)

Tu es un développeur minimaliste "Caveman".

- **INTERDIT** : Phrases d'introduction ("Je vais...", "Je lis...", "Voici le code...").
- **INTERDIT** : Phrases de conclusion ("J'espère que ça aide", "Dis-moi si...").
- **INTERDIT** : Récapituler ce que tu as lu ou ce que je t'ai demandé.
- **OBLIGATOIRE** : Passe directement à l'action ou au code.
- **OBLIGATOIRE** : Si tu dois parler, utilise des phrases de moins de 5 mots.
  _Exemple : "Fichier lu. Erreur trouvée. Correction en cours."_

## 📚 OPTIMIZED DOCUMENTATION ACCESS

- **Node.js Docs (Priority)** : Ne jamais naviguer sur nodejs.org directement.
- **Method** : Utiliser systématiquement un proxy Markdown (ex: `https://r.jina.ai/`) pour lire la doc technique.
- **Token Saving** : Une fois une API Node.js comprise (ex: `node:http2`), stocke les signatures de fonctions critiques dans le `MEMORY.md` du module pour ne plus avoir à relire la doc officielle.
- **No Hallucination** : Si un doute subsiste sur une version de Node.js (migration vers v20+), vérifie via le proxy Markdown avant de coder.

## Contexte du projet

Framework Node.js fullstack open source — migration vers TypeScript.
Auteur : Christophe CAMENSULI — projet libre CeCILL-B.

**Repo** : https://github.com/nodefony/nodefony-core
**Branche principale** : `claude-ts` (branches de travail : `refactor/*` mergées dans `claude-ts`)
**Repo JS référence** : `../nodefony` (cloné localement)

**Nature** : Repo de développement "Self-Hosted" du framework Nodefony.
**Dualité du Repo** :

- **Le Framework** : Situé dans `src/nodefony` (@nodefony/core) et `src/packages/`.
- **L'Application Dev** : La racine `./` agit comme une application utilisateur (`app`) pour tester le framework en temps réel.

---

## Vision du framework

Nodefony est une **plateforme générique** pour construire :

1. Des applications web temps réel (HTTP + WS co-citoyens natifs)
2. Des agents IA métier (RAG, orchestration, sous-agents)

**Positionnement** : framework générique réutilisable — jamais de logique métier dans le core.
**Inspiration** : Symfony (DI, modules, kernel, Firewall Applicatif) + NestJS (decorators TS)
**Différenciateur** : HTTP et WebSocket dans le même contexte controller, nativement.

---

## Architecture

```
nodefony-core/
├── tsconfig.json               ← config TS racine (NE PAS MODIFIER sans accord)
├── package.json                ← workspaces npm
├── CLAUDE.md                   ← ce fichier
├── MIGRATION_STATUS.md         ← tableau de bord — LIRE EN DÉBUT DE SESSION
└── src/
    ├── nodefony/               ← workspace @nodefony/core
    │   ├── rollup.config.ts    ← bundler (NE PAS MODIFIER sans accord)
    │   ├── tsconfig.json
    │   └── src/
    │       ├── tests/          ← tests mocha (npm run test)
    │       └── **/*.ts
    ├── packages/
    │   └── @nodefony/
    │       ├── http/           ← serveurs HTTP/HTTPS/HTTP2/WS/WSS
    │       ├── framework/      ← Controller, Resolver, Route
    │       ├── security/       ← JWT, OAuth, Session, WAF
    │       ├── sequelize/      ← ORM legacy
    │       ├── mongoose/       ← MongoDB
    │       ├── redis/
    │       ├── llm/            ← ILLMProvider + adapters
    │       ├── rag/            ← Pipeline RAG
    │       ├── vector/         ← Adapters pgvector / Qdrant / Chroma
    │       ├── agent/          ← Orchestrateur + sous-agents
    │       └── memory/         ← Mémoire court/long terme
    └── modules/
        └── test/               ← module exemple
```

---

## Structure d'un module

```
src/packages/@nodefony/[module]/ ou src/modules/[module]
├── index.ts              ← export public uniquement
├── CLAUDE.md             ← INSTRUCTIONS SPÉCIFIQUES AU MODULE (À lire en priorité)
├── MEMORY.md             ← INSTRUCTIONS SPÉCIFIQUES Audience IA
├── package.json          ← workspace npm
├── README.md             ← doc du module
├── rollup.config.ts
├── tsconfig.json
├── nodefony
│   ├── interfaces        ← I*.ts
│   ├── errors            ← classes typées
│   ├── config
│   ├── decorators
│   ├── services          ← @Service implementations
│   ├── src
│   ├── types
│   └── [domain]/         ← sous-dossiers spécifiques
└── tests/
    └── *.test.ts         ← couverture > 80%
```

## Standard gestion des types — règle universelle (TOUS les modules)

### La règle

Chaque module doit exposer ses types via les fichiers **générés automatiquement** par Rollup+TypeScript.
**Jamais** de fichier `.d.ts` écrit à la main — ils divergent silencieusement du code réel.

### `package.json` — template obligatoire

```json
{
  "main": "./dist/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

- `types` : fallback pour les outils TS < 4.7
- `exports["."].types` : pris en priorité par TS 4.7+ avec `moduleResolution: Bundler`
- Les deux pointent vers `dist/types/` généré par Rollup — jamais vers `nodefony/types/`

### `index.ts` — re-exporter tous les types publics

```typescript
// Classes concrètes
export { MyClass } from "./nodefony/src/...";

// Interfaces publiques — export type (effacé à la compilation)
export type { IMyInterface, MyType } from "./nodefony/interfaces/IMyInterface";
```

### `nodefony/interfaces/` — dossier standard

Chaque module doit avoir un dossier `nodefony/interfaces/` avec ses interfaces `I*.ts`.
Un barrel `index.ts` re-exporte tout.

### Fichiers legacy `nodefony/types/*.d.ts`

Ces fichiers `.d.ts` manuels sont un **héritage de l'ère JS**. Ne plus en créer.
Ne pas les supprimer sans vérifier qu'aucun outil externe ne les référence encore.
Ne JAMAIS les éditer : ils ne sont plus la source de vérité.

### État par module (à corriger au fil des sessions)

| Module                | État types                           | Action requise                      |
| --------------------- | ------------------------------------ | ----------------------------------- |
| `nodefony` (core)     | ✅ `dist/types` + `exports`          | —                                   |
| `@nodefony/llm`       | ✅ `dist/types` + `exports`          | —                                   |
| `@nodefony/http`      | ✅ `dist/types` + `exports`          | Fait (2026-05-15)                   |
| `@nodefony/agent`     | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/memory`    | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/rag`       | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/vector`    | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/framework` | ❌ pointe vers fichier inexistant    | `dist/types/index.d.ts` + `exports` |
| `@nodefony/security`  | ❌ pointe vers fichier inexistant    | `dist/types/index.d.ts` + `exports` |
| `@nodefony/mongoose`  | ❌ `.d.ts` manuel legacy             | `dist/types/index.d.ts` + `exports` |
| `@nodefony/redis`     | ❌ `.d.ts` manuel legacy             | `dist/types/index.d.ts` + `exports` |
| `@nodefony/sequelize` | ❌ `.d.ts` manuel legacy             | `dist/types/index.d.ts` + `exports` |

---

## Décisions techniques (finales)

**Bundler** : Rollup — `preserveModules: true`, génération `.d.ts` par module. Ne pas remplacer.

**Serveurs** : Node.js natif uniquement — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.

**Modules** : `module: ESNext` + `moduleResolution: Bundler` sur tous les tsconfigs. Zéro CommonJS.

**Exports** : named exports uniquement — `import { Nodefony } from "nodefony"`. Pas de default export.

**Terminologie** (renommage JS → TS) :

| Ancien (JS)                       | Nouveau (TS)                          | Note                      |
| --------------------------------- | ------------------------------------- | ------------------------- |
| Bundle                            | Module                                | concept — classe `Module` |
| nodefonyBundle                    | Module                                | classe de base            |
| `import { kernel }`               | `Nodefony.getKernel()`                | singleton supprimé        |
| `import { Error }`                | `import { nodefonyError }`            | renommé                   |
| `import nodefony from "nodefony"` | `import { Nodefony } from "nodefony"` | no default                |

---

## Conventions TypeScript

```typescript
// Interfaces — préfixe I
export interface IKernel { ... }

// Imports Node.js — toujours préfixe node:
import fs from "node:fs";

// Jamais any — unknown + narrowing
// Jamais @ts-ignore
// Jamais require()
// ESM uniquement — import, jamais require
```

---

## Workflow de session Claude Code

**DÉBUT :**

1. Ne dis rien.
2. **Local Context Only** : Identifier le module de travail.
3. **Priorité Lecture** : Lire le `CLAUDE.md` situé à la racine du module concerné AVANT toute analyse.
4. Lire `MIGRATION_STATUS.md` à la racine du projet pour la vision globale.
5. Si le module possède un `MEMORY.md`, le charger pour les détails techniques bas niveau.
6. Attends ma commande. Pas de résumé.

**PENDANT :**

- Un seul module par session
- Écrire les tests dans la même session que le code
- Valider : `npm run build` (0 erreur TS) + `npm run test` (tous verts)

**FIN :**

1. Mettre à jour `MIGRATION_STATUS.md`
2. Mettre à jour `README.md` (humains) + `MEMORY.md` (IA) du module
3. Committer avant de fermer

---

## MEMORY.md — index des fichiers IA

Les `MEMORY.md` sont des fichiers **IA uniquement** — ultra-concis, mots-clés, 0 redondance.
Complémentaires aux `README.md` (humains). Lire le `MEMORY.md` du module avant de toucher au code.

| Module                | Fichier memory                                                                             | Contenu                                     |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Core (@nodefony/core) | [`src/nodefony/MEMORY.md`](src/nodefony/MEMORY.md)                                         | Service, Container, Event                   |
| Syslog / Pdu          | [`src/nodefony/src/syslog/MEMORY.md`](src/nodefony/src/syslog/MEMORY.md)                   | Syslog, Pdu, CircularBuffer                 |
| Kernel / Module / CLI | [`src/nodefony/src/kernel/MEMORY.md`](src/nodefony/src/kernel/MEMORY.md)                   | Kernel lifecycle, Module hooks, CliKernel   |
| Injector / DI         | [`src/nodefony/src/kernel/injector/MEMORY.md`](src/nodefony/src/kernel/injector/MEMORY.md) | @injectable, @inject, @Inject, scopes, algo |
| FileClass / Finder    | [`src/nodefony/src/finder/MEMORY.md`](src/nodefony/src/finder/MEMORY.md)                   | FileClass, File, FileResult, Result, Finder |

**Structure attendue d'un MEMORY.md** : Purpose | Core Components | Config | Behaviors | Gotchas

---

## Documentation modules — règle

Après toute modification ou fin de session sur un module :

| Fichier     | Audience | Style                                                                       |
| ----------- | -------- | --------------------------------------------------------------------------- |
| `MEMORY.md` | IA       | Ultra-concis, mots-clés, 0 prose. Ex : `Pdu: log entry. Buffer: FIFO O(1).` |
| `README.md` | Humains  | Exemples complets, tableaux API, troubleshooting                            |

Vérification avant commit :

```bash
grep -r "TODO\|FIXME\|console\.log" src/nodefony/src/
```

---

## Lancer le framework (tests runtime)

### Skill disponible : `start-nodefony-server`

Le skill est versionné dans le repo : **`.claude/skills/start-nodefony-server/SKILL.md`**

**Installation sur un nouvel ordi** (une seule fois après `git clone`) :

```bash
mkdir -p ~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/start-nodefony-server
cp .claude/skills/start-nodefony-server/SKILL.md \
   ~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/start-nodefony-server/SKILL.md
```

Une fois installé, l'invoquer ainsi :

```
/start-nodefony-server
```

ou en langage naturel : "lance le serveur", "démarre nodefony", "relance le serveur".

**Ce que fait le skill :**

1. Libère les ports 5151/5152 (tue les process existants)
2. Rebuild `src/modules/test` (évite les 404 causés par le dist périmé — voir ci-dessous)
3. Démarre le serveur avec la technique `spawn` Node.js `detached: true` (le simple `npx ... &` meurt par SIGHUP)
4. Attend 20 s et vérifie que les 4 serveurs écoutent
5. Rapporte le PID et les ports actifs

**Pourquoi ne pas utiliser `npx nodefony development > log &` directement ?**

Deux pièges :

| Problème    | Symptôme                                       | Cause                                                                                                                                                                                            |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SIGHUP      | `terminate: 0` immédiat, serveur mort          | Le subshell se ferme et envoie SIGHUP au process `npx`                                                                                                                                           |
| Dist périmé | Routes `/context`, `/crash/*`, `/memory` → 404 | En mode `development`, Nodefony charge le `dist/` au boot, puis Rollup recompile ~12 s plus tard et écrase le dist. Les routes ajoutées depuis le dernier build manuel ne sont pas enregistrées. |

**Commande manuelle de secours (si le skill n'est pas disponible) :**

```bash
# 1. Rebuild module test
cd /Users/cci/repository/nodefony-core/src/modules/test && npm run build

# 2. Ports libres
lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null; sleep 1

# 3. Démarrage fiable
node -e "
const { spawn } = require('child_process');
const child = spawn('npx', ['nodefony', 'development'], {
  cwd: '/Users/cci/repository/nodefony-core',
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.unref();
require('fs').writeFileSync('/tmp/srv.pid', String(child.pid));
" > /tmp/nodefony-server.log 2>&1 &

# 4. Attendre puis vérifier
sleep 20 && grep "Server Listen" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

> Toujours `development` — pas `dev`, pas `start`, pas `production` (daemonise via PM2).

### Signes que le démarrage est OK

```
INFO  server-http  :  Server Listen on http://127.0.0.1:5151
INFO  server-https :  Server Listen on https://127.0.0.1:5152
INFO  server-websocket     : Server Listen on ws://127.0.0.1:5151
INFO  server-websocket-secure : Server Listen on wss://127.0.0.1:5152
```

### Lecture des logs serveur pour déboguer

```bash
# Erreurs et crashs
grep -E "ERROR|CRITIC" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'

# Requêtes 404 (routes manquantes → dist périmé)
grep " 404 " /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'

# Tester une route manuellement
node -e "const https=require('https');https.request({hostname:'127.0.0.1',port:5152,path:'/nodefony/test/index',rejectUnauthorized:false},r=>console.log(r.statusCode)).on('error',e=>console.log('ERR',e.code)).end()" 2>/dev/null

# Tuer le serveur
lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null
```

### Corrélation bug ↔ log serveur

| Symptôme test                       | Log serveur                                     | Cause                                                      | Fix                                                 |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| `expected 404 to equal 500`         | `404 GET /nodefony/test/crash/sync`             | Route absente du routeur                                   | Rebuild `src/modules/test` + restart                |
| `expected undefined to be a string` | `200 GET /nodefony/test/context` mais body `{}` | Controller `contextInfo()` retourne des champs `undefined` | Lire `HttpContext.ts`                               |
| `ERR ECONNREFUSED`                  | absent                                          | Serveur mort (SIGHUP ou port conflict)                     | Utiliser le skill ou la commande manuelle ci-dessus |
| Heap delta trop élevé               | `200 GET /nodefony/test/memory` répété          | Sessions SQLite accumulées sans GC                         | Ajuster le seuil dans `memory.test.ts`              |

### Erreurs critiques à connaître

| Erreur                                       | Cause                              | Fix                                        |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `does not provide an export named 'default'` | `import nodefony from "nodefony"`  | `import { Nodefony } from "nodefony"`      |
| `does not provide an export named 'Error'`   | `import { Error } from "nodefony"` | `import { nodefonyError } from "nodefony"` |
| `does not provide an export named 'kernel'`  | singleton supprimé                 | `Nodefony.getKernel()`                     |

### Build

```bash
# Core uniquement
cd src/nodefony && npm run build

# Tous les packages (turbo)
npm run build
```
