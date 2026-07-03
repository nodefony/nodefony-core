---
title: Release Nodefony 10 — plan & décisions
status: DISCUSSION (historisation — on n'exécute PAS aujourd'hui)
date: 2026-05-24
audience: Lead Architect / mainteneur
---

# Release Nodefony 10 — plan & décisions

> **Doc VIVANT.** On ne release **pas** aujourd'hui : on **historise** les décisions au fil des
> discussions pour les exécuter plus tard. Chaque section « Décisions » est figée une fois tranchée ;
> les « Questions ouvertes » descendent dans « Décisions » quand on choisit.

---

## 1. Objectif (vision — tirée de la douleur Nodefony 1→7)

- **Ne plus maintenir N packages npm indépendants** → le versioning croisé de N packages est l'enfer
  vécu sur les versions précédentes.
- La release = **UNE version unique** ; le **build embarque les `dist/`** de tous les packages.
- Un dev qui crée une **app** part d'un **repo « dev-ready »** : la **même DX que ce repo de dev**
  (start.sh, build, Studio, HMR, `modules/`, config) **mais sans le source du framework** — il
  **consomme la distribution embarquée**.

---

## 2. Périmètre de release

| Inclus (publiable)                                                        | Exclu                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/nodefony` → package **`nodefony`** (core, nom non-scopé, historique) | `src/modules/*` (test, mediasoup, test-frontend-react/vue/angular = bancs d'essai **dev-only**) |
| `src/packages/@nodefony/*` → 16 packages scopés                           | racine `nodefony-core` (`private:true`) = **app de dev**, jamais publiée                        |

---

## 3. Inventaire (état 2026-05-24) — ⚠️ blocker `private` incohérent

> Aujourd'hui un `npm publish` ferait **l'inverse** de ce qu'on veut : le cœur est bloqué, l'IA alpha sortirait.

| Catégorie                   | Packages                                          | `private`   | Version            | Verdict                        |
| --------------------------- | ------------------------------------------------- | ----------- | ------------------ | ------------------------------ |
| **Cœur** (DOIT sortir)      | http, framework, security, frontend, **realtime** | **true** ❌ | 10.0.0             | bloqués à tort                 |
| **ORM/data**                | orm-core, drizzle (défaut), user, redis, mongoose | false       | 10.0.0             | OK (sauf legacy à arbitrer)    |
| **IA** (Phase 12 PAS faite) | agent, llm, rag, vector, memory                   | false ⚠️    | 10.0.0-**alpha.1** | sortiraient prématurément      |
| **Studio**                  | studio                                            | true        | 10.0.0-**poc.1**   | POC — sortir en 10.0.0 ?       |
| **Core**                    | nodefony                                          | false       | 10.0.0             | OK (mais pas de champ `files`) |

Constats : (a) flags `private` à recadrer ; (b) **versions mélangées** (`10.0.0`/`alpha.1`/`poc.1`) →
aucune stratégie de version ; (c) hygiène publish (`files`/`exports`) à cadrer.

---

## 4. Modèle cible — ⚠️ §4.1 OBSOLÈTE (tranché 2026-07-02 → §6bis : modèle (B) N-packages lockstep)

### 4.1 ~~Mono-distribution `nodefony` à **version unique** (subpaths)~~ — ABANDONNÉ

Les 16 `@nodefony/*` deviennent des **subpaths** d'un seul package : `nodefony/http`,
`nodefony/framework`, `nodefony/security`, `nodefony/drizzle`, `nodefony/studio`… **UN `package.json`,
UNE version, tous les `dist/` embarqués**. → 0 versioning croisé.

> **Déjà la direction prise** : `nodefony/react`, `nodefony/client`, `nodefony/debugbar`,
> `nodefony/roles`, `nodefony/sip|media` existent. On **généralise** le pattern subpath isomorphe.

### 4.2 Template **dev-ready** `create-nodefony`

Repo starter qui **clone la DX de ce repo** (tooling, `modules/`, config, scripts start/build, Studio,
HMR) mais **dépend de la mono-distribution** → app dev-ready out-of-the-box, sans source framework.

### 4.3 Deps externes lourdes = **optionnelles**

Le **code Nodefony** est embarqué ; les **libs tierces** (mongoose, mediasoup, redis, SDK
LLM, mediasoup) restent `peer`/`optionalDependencies` → installées à la demande (sinon la distrib pèse
des centaines de Mo).

---

## 5. Résolution des TYPES (point délicat — `import` propre des types)

> Préoccupation user : « c'est un framework de dev → il faut importer les **types** proprement ».
> C'est LE point technique sensible du modèle mono-package + subpaths.

- **Chaque subpath doit déclarer ses types dans `exports`** (TS 4.7+ / `moduleResolution: Bundler|NodeNext`) :
  ```jsonc
  "exports": {
    "./http":      { "types": "./dist/types/http/index.d.ts",      "import": "./dist/http/index.js" },
    "./framework": { "types": "./dist/types/framework/index.d.ts", "import": "./dist/framework/index.js" }
    // … un bloc par subpath
  }
  ```
- **Le build doit ASSEMBLER les `.d.ts` générés** de chaque package sous `dist/types/<subpath>/` (jamais
  de `.d.ts` à la main — règle CLAUDE.md « types générés par Rollup uniquement »).
- **Imports de types cross-subpath** : un type de `nodefony/framework` qui référence un type de
  `nodefony/http` doit **résoudre dans la mono-distrib** (chemins internes cohérents, pas de fuite vers
  l'ancien `@nodefony/http`). Risque #1 de dérive de types.
- **Vérification automatisée** : `@arethetypeswrong/cli` (attw) sur le tarball + un **`tsc` depuis une app
  consommatrice témoin** (le template) à chaque build de release → garantit que `import { X } from
"nodefony/http"` résout type ET runtime.
- Conserver `types` (fallback TS < 4.7) **et** `exports[...].types` par subpath (cf table « Standard
  gestion des types » du `CLAUDE.md` racine).

---

## 6. Décisions à trancher (questions ouvertes)

1. **Mono-package subpaths** vs **dists vendorés** dans le template (npm install d'1 package vs repo
   auto-contenu) — ou hybride.
2. **Versioning** : lockstep strict (tout `10.0.0`) — acté comme objectif ; reste l'outillage (script de
   stamp unique vs changesets).
3. **Ce qui sort en 10.0.0** : IA (agent/llm/rag/vector/memory, Phase 12 non faite) → **dehors** ?
   Studio (POC) → dehors ou « preview » ?
4. **Assemblage du build** : comment le build de release collecte les `dist/` + `dist/types/` des 16
   packages en une distrib cohérente (script d'assemblage + ordre topologique des deps internes).
5. **Hygiène publish** : `files`/`exports`/`.npmignore` (publier `dist/`+`dist/types/` only) ; `nodefony`
   n'a pas de `files`.
6. **Recadrage `private`** : aligner les flags sur « releasable en 10.0.0 » (libérer le cœur, geler l'IA alpha).

---

## 6bis. Re-cadrage 2026-06-29 — terrain vérifié + POC « mono vs N-packages »

> Session de planification : **vérification du figé contre le code** (3 sous-agents). **3 sur-ventes corrigées** + 2 décisions + **1 POC à mener** pour trancher le modèle de release.

### Terrain vérifié — sur-ventes du journal à corriger

- **ORM postgres « prouvé 7/7 »** = faux au sens fort : seul le **store d'idempotence** tourne sur pg (via `getNativeConnection`). Le **`DrizzleRepository` générique (14 méthodes) n'a JAMAIS tourné sur pg**. 6 entités (session/user/token×3/webauthn/webhook) = **sqlite-only**. mysql = enum + throw (`mysql2` même pas en deps).
- **CLI « essentielles implémentées, non testées »** = faux : `orm:migrate` / `user:*` / `security:*` = **0 %, à CRÉER** (lifecycle dev/prod/cluster OK ; infra CLI saine, 0 TODO).
- **Sécu** = solide (2FA/webhooks/Argon2id/throttling NIST/WebAuthn/firewall fail-closed, 0 mock runtime). **Trous réels** : audit **100 % volatil** (RAM/per-pod) + **0 rate-limit** général (hors login). Propreté OK (0 `@ts-ignore`, 3 `as any`, 147 `:any` **structurels** events/décorateurs).

### Décision A — pg + MySQL/MariaDB DANS le MVP (figé user 2026-06-29)

« Un framework qui ne tourne que sur SQLite n'est pas crédible. » ⇒ **« Drizzle production-ready » (DoD §8) = multi-dialecte sqlite/pg/mysql**, pas sqlite seul (le « (✅) » du §8 était sur-vendu). **Précédé** d'un **comparatif ORM froid** (Drizzle factory-par-dialecte vs Prisma / Kysely / TypeORM nativement multi-dialecte) — le multi-dialecte est le **point faible** de Drizzle (schema-as-code dialect-spécifique) → trancher AVANT d'investir ~6 sessions de portage.

### Décision B — colonne vertébrale MVP = onboarding

Le bloqueur n'est pas l'admin-CLI : c'est **`npm i -g` + `npx nodefony create app` → repo qui marche**. Or ça **exige la release** (publier le code framework). Donc **release = prérequis** du CLI d'onboarding.

### ✅ MODÈLE DE RELEASE TRANCHÉ (2026-07-02) : (B) N-packages + changesets `fixed`/lockstep

**Décision user 2026-07-02** (ré-audit du plan) : le modèle **(B) N-packages lockstep** est acté ; la
mono-distrib (A) est **abandonnée**. Raisonnement : la douleur v1→7 = le **versioning croisé**, pas le
nombre de packages → le lockstep la tue par construction (1 version partout, publication groupée,
deps internes exactes), SANS l'assemblage `.d.ts` maison (risque #1 du §5), SANS l'union des deps
tierces dans un seul package (install lean par-package), SANS outillage bespoke. Le scope `@nodefony/*`
est **conservé tel quel** (0 renommage, 0 changement d'import). Le POC comparatif devient un simple
**smoke test de VALIDATION** du modèle B (cf infra), à mener avant la release réelle.

| Critère (analyse ayant fondé la décision)  | (A) Mono-distrib — abandonnée                                               | (B) N-packages + changesets `fixed` — **ACTÉ**                     |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 version, 0 juggling                      | ✅ (assemblage)                                                             | ✅ (lockstep)                                                      |
| **Types par subpath**                      | ⚠️ **assemblage `.d.ts` MAISON** (= risque #1 du §5, fragile)               | ✅ **déjà fonctionnels** par package (monorepo typecheck 0)        |
| Deps propres (Studio séparable / adapters) | ⚠️ tout en optional/peer d'**un** package (optional = installés par défaut) | ✅ par-package                                                     |
| Patch sécu isolé                           | ❌ re-publish 6-7 Mo                                                        | ✅ le seul package touché                                          |
| Outillage                                  | ⚠️ build d'assemblage **bespoke**                                           | ✅ changesets (standard)                                           |
| Import                                     | `nodefony/http` (esthétique +)                                              | `@nodefony/http`                                                   |
| Isomorphisme **client**                    | subpaths (déjà le cas)                                                      | idem — **le client reste subpaths du core quel que soit le choix** |

> ⚠️ Le §7.3 (« changesets moins pertinent ») est **biaisé** : il suppose versioning indépendant. En mode `fixed`, changesets donne **la version unique voulue SANS l'assemblage maison ni le risque de types** — c.-à-d. il **supprime** l'angoisse #1 au lieu de la créer. C'est l'argument central pour (B).

### Smoke test de parité (VALIDATION du modèle B — avant la release réelle)

`npm pack` → install **dossier vierge** → mini-app + `tsc --noEmit` + boot sqlite/pg. **Vert ⇒ `import nodefony` se comporte comme en self-hosted, PROUVÉ.** À câbler en CI (le doute devient une case verte). Plus un POC comparatif (modèle tranché) : c'est la **gate de validation** unique, à mener avant la release (Phase 1.2 recadrée).

> ⚠️ **Point d'exécution à couvrir par cette gate** (repéré au terrain 2026-07-02) : 7 packages du
> cœur (http, framework, security, frontend, realtime, orm-core, user) ont `exports["."].types =
"./index.ts"` (source TS, pattern anti-race turbo du monorepo) → publiés tels quels, leurs types
> seraient CASSÉS chez le consommateur (source absente du tarball `files: ["dist"]`). npm ne supporte
> pas `publishConfig.exports` (pnpm only) ⇒ le pipeline (`scripts/release.mjs`) doit **basculer
> `exports.types` → `./dist/types/index.d.ts` au moment du pack/publish** (le pattern source reste en
> dev). `attw` + `tsc` témoin vérifient. Autre piège : npm ≥ 7 **auto-installe les `peerDependencies`**
> → les adapters lourds (pg/mysql2/mongoose/redis) exigent `peerDependenciesMeta: { optional: true }`
> pour une install lean.

### Taille — démystifiée

Dist embarqué (subpaths released, IA/média exclus) ≈ **6-7 Mo** (petit ; **serveur**, jamais navigateur). **Vrai gras** = le **toolchain de build** (`rollup`/`terser`/`chokidar`/`figlet`/`lodash`) en `dependencies` runtime du core → **rendre lazy/optional** (chargé par `build`/`dev` seulement) ⇒ install prod lean. Adapters lourds (pg/mysql2/mongoose/redis/mediasoup) = **`peer`**. 🔑 **Install serveur ≠ bundle navigateur** (Vite, tree-shaké depuis l'app).

---

## 7. Pipeline de release (GitHub Action + script)

**Principe : la logique vit dans un SCRIPT Node (runnable en LOCAL) ; la GH Action est un wrapper
mince.** Jamais de boîte noire « ça ne marche qu'en CI » (même philosophie que `start.sh`/`run.sh`).

### 7.1 Pourquoi un script Node (pas tout-YAML, pas bash)

- **Reproductible local** : `npm run release -- --dry` débugue sans pousser.
- **Node ≫ bash pour CE job** : lire/fusionner des `package.json`, **ordre topologique** des deps
  internes, **assembler `dist/` + `dist/types/`** dans la mono-distrib, **générer la map `exports`**
  (+ `types` par subpath), **estampiller UNE version** partout → manipulation JSON/graphe = Node/TS.
- **Action mince** : `checkout → setup-node → npm ci → node scripts/release.mjs --publish` + secret
  `NPM_TOKEN`. Tout le reste dans le script.

### 7.2 Étapes du script (= le pipeline)

1. `clean` + **build** tous les packages (turbo → `dist/` + `dist/types/` par package).
2. **Assemble** la mono-distrib `nodefony` : collecte chaque `dist` sous `nodefony/dist/<subpath>/`,
   génère `exports` (+ `types` par subpath), **stamp 1 version** partout (lockstep).
3. **Vérifie** : `@arethetypeswrong/cli` sur le tarball + `tsc` depuis l'app **témoin** (le template)
   - smoke `import "nodefony/http"` (type ET runtime). Échec ⇒ abort avant publish.
4. **Pack/publish** : `npm pack` (dry-run) → `npm publish` (la distrib unique). + maj template
   `create-nodefony`.
5. **Tag + GitHub Release** : tag `v10.x` + `gh release create` + changelog.

### 7.3 Déclencheur + outillage version/changelog

- **Déclencheur** : push de tag `v10.*` **OU** `workflow_dispatch` (manuel). Pas sur chaque push.
- **Version + changelog** : commitlint (conventional commits) est **déjà en place** → soit
  **release-please / semantic-release** (version+changelog+tag auto, puis appellent le script
  d'assemblage), soit script maison qui lit `git log`.
- **Changesets** = standard monorepo mais brille pour le versioning **indépendant** → moins pertinent
  (on veut version **unique**). ⚠️ **Quel que soit l'outil, l'ASSEMBLAGE N-packages → 1 distrib avec
  types par subpath reste MAISON** (aucun outil du marché ne le fait).

### 7.4 Squelette (à titre indicatif)

```yaml
# .github/workflows/release.yml (MINCE)
on: { push: { tags: ["v10.*"] }, workflow_dispatch: {} }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: "https://registry.npmjs.org" }
      - run: npm ci
      - run: node scripts/release.mjs --publish
        env:
          {
            NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
            GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
          }
```

---

## 8. Critères de release 10.0.0 (Definition of Done)

> **Gate = migration complète SAUF IA + média/SIP ; cloud-native en BASELINE.**
> Cadrage : 10.0.0 = **framework fullstack complet** (web + realtime + ORM + sécurité +
> cloud-native baseline). L'IA et le télécom (média/SIP) arrivent en **10.x / 11**.

### ✅ INCLUS — doivent être prêts pour 10.0.0

| Domaine          | Phase              | Gate précis                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sécurité**     | P6                 | **Complète** (firewall, auth, JWT, RBAC `@IsGranted`). **Bloqueur #1, non négociable.**                                                                                                                                                                                                        |
| **ORM**          | P5/P7              | **Core stable** (✅) + **Drizzle production-ready = multi-dialecte sqlite/pg/mysql** (🔶 cf §6bis-A : seul sqlite + idempotence-pg faits ; pg/mysql repo générique à porter+prouver ; **précédé du comparatif ORM froid**). Adapter Mongoose (NoSQL) = **acceptable en 10.x** (ne bloque pas). |
| **Cloud-native** | P16 (**baseline**) | **Dockerfile prêt** + **config 100 % par variables d'env** (12-factor). **PAS** le P16 complet (HPA, opérateurs k8s, secret managers, outillage multi-process = **10.x**).                                                                                                                     |
| **Reste**        | P10/P11/P13/P14    | Studio, CLI, **realtime base** (socket/hub/AIMD/granularité ; backplane Redis si prêt, sinon 10.x), frontend.                                                                                                                                                                                  |

### ❌ EXCLUS de 10.0.0 (→ 10.x / 11)

| Exclu                                            | Phase / subpaths                                |
| ------------------------------------------------ | ----------------------------------------------- |
| **Modules IA** (agent, llm, rag, vector, memory) | P12 — `alpha`, dernière phase de migration      |
| **Mediasoup** (média WebRTC)                     | P15                                             |
| **Couche client SIP**                            | P15 + subpaths `nodefony/sip`, `nodefony/media` |

> **Conséquence mono-distrib** : l'assemblage 10.0.0 n'inclut **que les subpaths « released »** →
> les subpaths IA + `sip`/`media` sont simplement **exclus** de l'artefact 10.0.0 (ajoutés en 10.x).

---

## 9. Hors scope aujourd'hui

Exécution de la release. Ce doc ne fait que **capturer** la cible et les décisions. Reprendre la
discussion → relire ce fichier d'abord.

---

## Journal des décisions

| Date       | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Statut                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 2026-05-24 | Périmètre = `src/nodefony` + `src/packages/@nodefony/*` (modules/\* + racine exclus)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ acté                 |
| 2026-05-24 | **Version UNIQUE** + build embarque les dist (fini les N packages indépendants)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ acté (vision)        |
| 2026-05-24 | App utilisateur = **repo dev-ready** (DX du repo de dev, sans source framework)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ acté (vision)        |
| 2026-05-24 | Modèle mono-package subpaths + deps lourdes optionnelles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 🔶 proposé, à confirmer |
| 2026-05-24 | Résolution types par `exports[...].types` par subpath + attw + tsc témoin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 🔶 proposé              |
| 2026-05-24 | **Pipeline = script Node** (logique, runnable local) + **GH Action mince** (wrapper)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ acté (vision)        |
| 2026-05-24 | Déclencheur tag `v10.*`/`workflow_dispatch` ; assemblage N→1 = MAISON ; version via commitlint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 🔶 proposé              |
| 2026-05-24 | **DoD 10.0.0** = P6 sécu + ORM(core+Drizzle) + cloud-native BASELINE (Dockerfile + env), tout SAUF IA(P12) + média/SIP(P15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ acté                 |
| 2026-05-24 | Cloud-native gate = **Dockerfile + config par env** seulement (PAS tout P16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ acté                 |
| 2026-05-24 | **Couche client SIP exclue** de 10.0.0 (avec mediasoup + IA) → 10.x                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ acté                 |
| 2026-05-30 | Audit `private` vérifié terrain : **6** packages `private:true` = http, framework, security, frontend, **realtime**, studio (realtime manquait §3). IA (agent/llm/rag/vector/memory) = `private` absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ constaté             |
| 2026-07-02 | **MODÈLE DE RELEASE = (B) N-packages + changesets `fixed`/lockstep** ; mono-distrib (A) abandonnée ; scope `@nodefony/*` conservé ; POC comparatif → recadré en **smoke test de validation** (avant release)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ acté                 |
| 2026-07-02 | Pipeline publish : bascule `exports.types` source→`dist/types` au pack (7 packages cœur) + `peerDependenciesMeta.optional` sur adapters lourds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ acté (contrainte)    |
| 2026-07-03 | **Phase 0.4 APPLIQUÉE** — (a) toolchain build hors deps runtime du core (rollup/@rollup/terser→devDeps, lodash×2 supprimés, DevSupervisor+figlet lazy) ; (b) `private` recadré (cœur+studio+documentation libérés, IA gelée `private:true`), versions lockstep 10.0.0, `files` dist-only (+`bin` core, +`public` studio, +`docs` partout — parité portail doc Studio), `publishConfig.access:public` ×12 scopés. Périmètre réel = **13 publiables** (§3 datait de mai : +`documentation` ; `agent-guard`/`mcp` = squelettes sans package.json, hors scope). Adapters : deps lourdes restent par-package (modèle B) ; peer-optional ne concernera que les drivers multi-dialecte drizzle (chantier 2.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ fait                 |
| 2026-07-03 | **Phase 0.6 — revue red-team realtime (PARTIEL)** : threat-first (matrice de menace avant lecture) + 3 sondes de câblage. **F4** révocation asymétrique `subscribe` FIXÉ (`14629f69`, blue B = re-validation `isValid()` périodique dans le hub, close 4001, verrou sync préservé) · **F7** prototype pollution des frames SAIN (`3091cfd7`, 0 finding) · **F1** policy de canal silencieuse sans frameAuthorizer → fail-loud (`5873ceec`). Reste = chantier `project_realtime_dos_limits_kit` : **F5/F6** DoS (rate-limit handshake WS hors module + caps connexions/canaux/messages ; banc de charge + décision framework/infra), **F2** plancher config, **F3** docstring « ≤ GET ». Gates vertes (tsc + tests realtime/security + `memory.test` http).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🔶 partiel              |
| 2026-07-03 | **Phase 0.6 — volet DoS handshake (F5)** : banc de charge threat-first (200 sockets anonymes floodant → latence HTTP tail p95 ~57 s = famine event-loop). Le vrai vecteur est au PÉRIMÈTRE, pas au débit. **F5** handshake WS échappait au rate-limit IP → FIXÉ (`870ddca6`, `@nodefony/http`) : garde en tête `onWebsocketRequest` AVANT scope/ALS, MÊME compteur que HTTP, IP forwarded-aware (le framework tient l'IP fiable), close 1013 au dépassement, 0 log/rejet. Banc versionné `ws-handshake-ratelimit-e2e.mjs`. **F6b** (throttle messages/conn) **ABANDONNÉ** (contredit la North Star : un socket authentifié pousse fort = légitime). **F6a** cap canaux/conn (`02406ac9`, realtime, défaut 256 configurable `null`=illimité, refus observable `realtime:denied`) + **F9** `slowConsumer.bytes` (clé morte câblée). **F2** plancher irréductible `authenticated` sur namespaces réservés (`2db12d35`, security : une config ne peut plus ouvrir `security:`/`syslog:` à l'anonyme ; anti-bypass prefixe court) + **F3** docstring api.request corrigé. **F6c** cap connexions concurrentes/IP (`a074f8a4`, http) = **backstop OPT-IN par-process** (défaut OFF) : décision archi = le cap concurrent/IP est le rôle de l'INGRESS/LB (nginx `limit_conn`, k8s), pas du framework ; backstop documenté pour bare-metal sans ingress ; prouvé live (cap=3 → 3 vivantes/5 close 1013). **Volet DoS 0.6 COMPLET.** Gates : http 536+560+memory 9/9 · realtime 312 · security 781. | ✅ fait                 |
| 2026-07-03 | **Phase 0.5 CLÔTURÉE — ADR-0007 ClientKernel isomorphe** (`docs/adr/0007`, `cb186179`) : contrat runtime client gelé AVANT publication (périmètre infra-jamais-la-vue, contrat d'abord, pas de DI décorateurs client, opt-in strict, observabilité full-stack `traceparent`+`syslog:front`, sécurité d'identité structurelle, budgets bundle + gate size-limit à câbler au pipeline, convergence debug-client→Studio). **Volet 10.0.0 APPLIQUÉ** (`8928c558`) : `IClientKernel` publié types-only + façade client named-only (export default supprimé, 0 consommateur) + legacy `api/Storage`/`transport/websocket` sortis de la surface et du bundle (49,4 KB gzip, −0,6). Implémentation → Phase 3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ fait                 |
