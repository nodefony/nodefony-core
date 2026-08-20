---
title: Release Nodefony 10 — plan & décisions
lang: fr
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

« Un framework qui ne tourne que sur SQLite n'est pas crédible. » ⇒ **« Drizzle production-ready » (DoD §8) = multi-dialecte sqlite/pg/mysql**, pas sqlite seul (le « (✅) » du §8 était sur-vendu). **Précédé** d'un **comparatif ORM froid** (Drizzle factory-par-dialecte vs Prisma / Kysely / TypeORM nativement multi-dialecte) — le multi-dialecte est le **point faible** de Drizzle (schema-as-code dialect-spécifique) → trancher AVANT d'investir ~6 sessions de portage. **✅ TRANCHÉ 2026-07-07** (`a370b5a1`, comparatif ORM froid — mémoire IA `core-dev/audits/orm-comparatif-froid-2026-07.md`) : **Drizzle confirmé** sur panel élargi (+ MikroORM 7 ; TypeORM 1.0 et Prisma 7 réévalués post-sortie) — portage S1-S4 débloqué avec garde-fous (confinement dialectal ~200 l., plan B Kysely nommé, `rowid`→PK-subquery d'abord).

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

<!-- prettier-ignore -->
| Critère (analyse ayant fondé la décision) | (A) Mono-distrib — abandonnée | (B) N-packages + changesets `fixed` — **ACTÉ** |
| --- | --- | --- |
| 1 version, 0 juggling | ✅ (assemblage) | ✅ (lockstep) |
| **Types par subpath** | ⚠️ **assemblage `.d.ts` MAISON** (= risque #1 du §5, fragile) | ✅ **déjà fonctionnels** par package (monorepo typecheck 0) |
| Deps propres (Studio séparable / adapters) | ⚠️ tout en optional/peer d'**un** package (optional = installés par défaut) | ✅ par-package |
| Patch sécu isolé | ❌ re-publish 6-7 Mo | ✅ le seul package touché |
| Outillage | ⚠️ build d'assemblage **bespoke** | ✅ changesets (standard) |
| Import | `nodefony/http` (esthétique +) | `@nodefony/http` |
| Isomorphisme **client** | subpaths (déjà le cas) | idem — **le client reste subpaths du core quel que soit le choix** |

> ⚠️ Le §7.3 (« changesets moins pertinent ») est **biaisé** : il suppose versioning indépendant. En mode `fixed`, changesets donne **la version unique voulue SANS l'assemblage maison ni le risque de types** — c.-à-d. il **supprime** l'angoisse #1 au lieu de la créer. C'est l'argument central pour (B).

### Smoke test de parité (VALIDATION du modèle B) — ✅ LIVRÉ, fusionné avec la preuve Docker (0.7)

**Réalisé** : `bash .claude/skills/nodefony-release/scripts/smoke-docker.sh` = pack des 13
publiables → `attw` sur les types publiés → **le paquet `nodefony` installé DEPUIS SON TARBALL**
dans un dossier jetable, qui **GÉNÈRE** les applications témoins hors du dépôt (deps → tarballs) →
`docker build` (npm install **vierge**) → `docker run` → probes `/livez` `/readyz` + routes →
`docker stop` pendant une requête lente. Trois scénarios (`--scenario base|front|studio`).
Le décor n'est plus copié d'un dossier figé : les **gabarits sont donc éprouvés tels qu'ils sont
publiés**, ce qu'aucun test du dépôt ne peut voir. Reste : le câbler en CI (R5) + boot pg
(multi-dialecte Ph.2).

> ⚠️ **À ÉTENDRE — scénario FRONT en production (trou vécu 2026-07-25 : page blanche muette).**
> La chaîne est corrigée à trois étages — (1) scaffold : le `npm run build` d'une app à front
> chaîne `nodefony frontend:build` (le package.json généré est COPIÉ à la création : les apps
> nées AVANT n'ont pas ce chaînage — le canal de correction pour elles = les étages 2-3, portés
> par npm) ; (2) `@nodefony/frontend` : `setupProd()` refuse la page blanche muette — entry sans
> manifest → build one-shot au boot si vite est résolvable (WARNING annoncé), sinon ERROR qui
> nomme l'entrée et le geste ; (3) `TemplateHelper.loadManifest()` ne met JAMAIS l'absence en
> cache → un `frontend:build` post-boot est vu au reload, sans restart. Le smoke doit PROUVER ces
> scénarios sur l'install vierge (le repo self-hosted ne peut pas les voir) : **(a)** app témoin
> AVEC front → `npm run build` → `nodefony production --detach --wait` → `GET /` contient des
> tags `/_assets/…` ; **(b)** `rm -rf public/dist` → boot → auto-build annoncé (devDeps
> présentes) ET, dans l'image runtime sans devDependencies, ERROR nommée + API toujours servie ;
> **(c)** Studio `ui: "static"` + `policy: "mandatory"` → `GET /nodefony` 200 + un asset
> `/_assets/studio/…` 200 (l'UI pré-buildée shippée npm — un 404 ici = dist/frontend absent du
> tarball ou config dist non rebuildée).

> ✅ **Mutations AU PACK câblées dans `pack-all.mjs`** (mutation temporaire du package.json,
> restauration à l'octet près en try/finally) : (1) **bascule `exports.types`** `./index.ts` →
> `./dist/types/index.d.ts` — détection AUTO des packages concernés (les 7 du cœur), garde-fou
> `dist/types/index.d.ts` présent ; (2) **`peerDependenciesMeta.optional`** injecté (table
> `PACK_PEER_OPTIONAL` : react/react-dom du core — npm ≥7 auto-installe les peers, toute app backend
> pure les tirait). À étendre aux adapters lourds (pg/mysql2/mongoose/redis) quand leurs peers seront
> câblés. `attw` reste à ajouter en complément du `tsc` témoin.
>
> ✅ **Types publiés certifiés `node16`/`nodenext` + `bundler` (audit toolchain 2026-07-04, TRANCHÉ
> une fois pour toutes)**. Terrain : `attw` relevait 182 `InternalResolutionError` (imports relatifs
> sans extension dans les `.d.ts`, + 19 erreurs `globals` cassant même `bundler`). Doctrine vérifiée :
> Node ESM exige les extensions (doc esm.md) ; tsc ne réécrit JAMAIS un specifier nu (TS 5.7
> `rewriteRelativeImportExtensions` ne traite que les imports portant déjà `.ts`). **Décision** :
> (1) `src/types/globals.d.ts` (`.d.ts` manuel legacy, jamais émis → types fantômes) migré en
> `globals.ts` ; (2) **post-processing AST au pack** (`fix-dts-extensions.mjs`, câblé dans
> `pack-all.mjs`) : specifiers relatifs des `.d.ts` extensionnés contre le fs (fichier→`.js`,
> dossier→`/index.js`), idempotent, specifier irrésolu = échec du pack ; (3) **gate `attw
--profile esm-only` 13/13 dans le smoke** (entrée d'asset `nodefony/debugbar.js` exclue). Rejetés :
> codemod extensions des sources (centaines de fichiers, contredit le style `Bundler` interne) et
> dts-bundling (nouvelle dep + 13 rollup.config + risques inlining/multi-entry). Le template compile
> en **`NodeNext`** (résolution la plus stricte) — `Bundler` marche a fortiori. `types: ["node"]`
> requis (TS 6 n'auto-inclut plus les `@types`). Assumés : `require()` CJS (framework ESM-only) et
> résolution `node10` (TS < 4.7) non supportés.

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
- **Action mince** : `checkout → setup-node → npm ci → node scripts/release.mjs --publish`, avec
  `permissions: id-token: write` (trusted publishing) et **aucun secret npm** — cf §7.3bis. Tout le
  reste dans le script.

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

### 7.3bis Authentification — la publication ne passe PAS par un jeton

**Constat de terrain (relevé sur le registre, pas supposé)** : le scope `@nodefony` existe et
porte déjà **15 paquets historiques** ; `nodefony` y est publié en **7.0.2**, mainteneur
`ccamensuli`. Les **13 `@nodefony/*` de la 10 sont NEUFS** — aucun n'a jamais été publié.

**Ce qui a changé chez npm, et qui périme le plan initial** : depuis **novembre 2025**, seuls les
**granular access tokens** existent — les jetons « Automation » ont été retirés. Un jeton d'écriture
utilisable en CI suppose donc l'option **Bypass 2FA**, devant laquelle npm affiche :

> There are security risks with this option. For automation or CI/CD uses, please use Trusted
> Publishing instead.

L'avertissement est fondé : un tel jeton **annule la 2FA du compte pour lui-même**, vit dans les
secrets, transite par chaque action tierce du workflow — et quiconque le vole publie sous l'identité
du mainteneur. C'est le vecteur des attaques de chaîne d'approvisionnement npm.

**Cible : trusted publishing (OIDC).** GitHub prouve à npm que la publication vient de ce dépôt et
de ce workflow ; npm délivre un jeton valable quelques minutes. Rien à stocker, rien à faire
tourner, rien à révoquer — et la provenance est signée automatiquement.

⚠️ **Sauf pour la PREMIÈRE publication.** Le publieur de confiance se déclare dans les réglages
d'un paquet **qui existe déjà**, et npm n'a pas de « publieur en attente » (contrairement à PyPI —
vérifié dans la doc). Les 13 paquets neufs ne peuvent donc pas naître par OIDC.

**Ordre retenu** :

1. publier les 13 neufs + `nodefony@10` **à la main**, depuis le poste du mainteneur, avec le code
   2FA interactif — c'est ce pour quoi la 2FA est faite, et **aucun jeton n'a besoin d'exister** ;
   le script d'assemblage fait tout le reste (versions, ordre, pack), seul le `publish` est manuel ;
2. déclarer un publieur de confiance sur **chacun des 14** — même dépôt, même **nom de fichier** de
   workflow (saisi seul, extension incluse, **sensible à la casse** : première cause d'`ENEEDAUTH`
   citée par la doc) ; un seul publieur par paquet ;
3. `Settings → Publishing access → Require two-factor authentication and disallow tokens`.

Contraintes à respecter : npm CLI **≥ 11.5.1**, Node **≥ 22.14.0**, runners **hébergés** GitHub
(pas de self-hosted), `permissions: id-token: write` dans le workflow.

Confort : si le compte est en `auth-only`, un `npm login` suffit pour enchaîner les 13 ; en
`auth-and-writes`, npm réclame un code à chaque publication (`npm profile get` le dit).

Le workflow `.github/workflows/release-preflight.yml` vérifie tout ceci **avant** d'en avoir besoin,
et rend les valeurs exactes à recopier sur npmjs.com. `npm whoami` ne reflète jamais une
authentification OIDC — ne pas s'en servir comme preuve que la chaîne fonctionne.

### 7.3ter Paquets historiques — déprécier APRÈS avoir publié

Les paquets de l'ère « Bundle » restent installables et sans successeur annoncé. Ils se déprécient
par `npm deprecate <paquet> "<message>"` — un message affiché à l'installation, **réversible**
(message vide) et sans effet sur les installations existantes. `npm unpublish` est hors sujet
(fenêtre de 72 h).

🔴 **L'ordre n'est pas indifférent** : déprécier AVANT la publication renverrait les gens vers des
paquets qui n'existent pas encore. Cette table s'applique **une fois la 10 en ligne**.

| Historique (dernière version)           | Successeur en 10          | Nature                           |
| --------------------------------------- | ------------------------- | -------------------------------- |
| `@nodefony/http-bundle` (7.0.2)         | `@nodefony/http`          | renommage                        |
| `@nodefony/framework-bundle` (7.0.2)    | `@nodefony/framework`     | renommage                        |
| `@nodefony/security-bundle` (7.0.2)     | `@nodefony/security`      | renommage                        |
| `@nodefony/realtime-bundle` (7.0.2)     | `@nodefony/realtime`      | renommage                        |
| `@nodefony/redis-bundle` (7.0.2)        | `@nodefony/redis`         | renommage                        |
| `@nodefony/mongoose-bundle` (7.0.2)     | `@nodefony/mongoose`      | renommage                        |
| `@nodefony/mongo-bundle` (6.8.1)        | `@nodefony/mongoose`      | fusion                           |
| `@nodefony/documentation-bundle` (6.12) | `@nodefony/documentation` | renommage                        |
| `@nodefony/sequelize-bundle` (7.0.2)    | `@nodefony/drizzle`       | **changement de moteur**         |
| `@nodefony/unittests-bundle` (7.0.2)    | — (vitest)                | fin de vie                       |
| `@nodefony/mail-bundle` (7.0.2)         | **à trancher**            | aucun module mail en 10          |
| `@nodefony/elastic-bundle` (7.0.2)      | **à trancher**            | aucun équivalent publié          |
| `@nodefony/monitoring-bundle` (7.0.2)   | **à trancher**            | `@nodefony/studio` ? à décider   |
| `@nodefony/demo-bundle` (4.3.1)         | — (`create app`)          | fin de vie                       |
| `@nodefony/stage` (0.2.4)               | **à trancher**            | —                                |
| `@nodefony/passport-wrapper` (4.0.0)    | **à trancher**            | `@nodefony/security` ? à décider |

**Deux exclusions, à ne pas déprécier** :

- **`nodefony-client` (6.0.3)** — en PRODUCTION sur du télécom (SIP + médias). Ce n'est pas un
  vestige ; il a sa propre trajectoire (P15).
- **`nodefony` (7.0.2)** — même nom, nouvelle majeure : c'est `10.0.0` qui le remplace, npm s'en
  charge. Déprécier le paquet déprécierait aussi la 10.

Un message de dépréciation dit **où aller**, pas seulement que c'est fini. Pour un renommage :
`npm deprecate @nodefony/http-bundle "Nodefony 10 : ce paquet devient @nodefony/http (voir https://github.com/nodefony/nodefony-core)"`.

### 7.4 Squelette (à titre indicatif)

```yaml
# .github/workflows/release.yml (MINCE)
on: { push: { tags: ["v10.*"] }, workflow_dispatch: {} }
jobs:
  release:
    runs-on: ubuntu-latest
    # `id-token: write` est CE qui remplace le jeton npm : sans elle, aucune
    # assertion d'identité n'est délivrée et le publish répond « ENEEDAUTH ».
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24 # trusted publishing exige Node >= 22.14.0
          registry-url: "https://registry.npmjs.org"
          package-manager-cache: false # jamais de cache dans un build de release
      - run: npm ci
      # AUCUN NODE_AUTH_TOKEN : le CLI (>= 11.5.1) détecte l'environnement OIDC
      # et échange une assertion signée contre un jeton de quelques minutes.
      - run: node scripts/release.mjs --publish
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

---

## 8. Critères de release 10.0.0 (Definition of Done)

> **Gate = migration complète SAUF IA + média/SIP ; cloud-native en BASELINE.**
> Cadrage : 10.0.0 = **framework fullstack complet** (web + realtime + ORM + sécurité +
> cloud-native baseline). L'IA et le télécom (média/SIP) arrivent en **10.x / 11**.

### ✅ INCLUS — doivent être prêts pour 10.0.0

<!-- prettier-ignore -->
| Domaine | Phase | Gate précis |
| --- | --- | --- |
| **Sécurité** | P6 | **Complète** (firewall, auth, JWT, RBAC `@IsGranted`). **Bloqueur #1, non négociable.** |
| **ORM** | P5/P7 | **Core stable** (✅) + **Drizzle production-ready = multi-dialecte sqlite/pg/mysql** (🔶 cf §6bis-A : seul sqlite + idempotence-pg faits ; pg/mysql repo générique à porter+prouver ; **comparatif ORM froid ✅ Drizzle confirmé** `a370b5a1`). Adapter Mongoose (NoSQL) = **acceptable en 10.x** (ne bloque pas). |
| **Cloud-native** | P16 (**baseline**) | ✅ **Dockerfile livré** (gabarit de `create app`, prouvé par `smoke-docker.sh` sur une app GÉNÉRÉE) + **graceful shutdown complet** (drain 3 serveurs, probes `/livez` `/readyz` natives, bascule readiness au SIGTERM, `shutdownDeadline` kernel) — Phase 0.7. Config par env (12-factor) : `defineEnv` + `NF__*` déjà en place. **PAS** le P16 complet (HPA, opérateurs k8s, secret managers = **10.x**). |
| **Reste** | P10/P11/P13/P14 | Studio, CLI, **realtime base** (socket/hub/AIMD/granularité ; backplane Redis si prêt, sinon 10.x), frontend. |
| **Preset Svelte** | P14 — **en DERNIER** | Ajouter `svelte5-vite` aux presets de `@nodefony/frontend` (aujourd'hui `react19`, `vue3`, `angular`, `vanilla`) + branchement `nodefony create module --frontend svelte`. **Placé volontairement juste avant la release** : coût faible (le builder Vite est agnostique, `@sveltejs/vite-plugin-svelte` est un plugin standard) et **aucune dépendance amont** — le faire tôt ne débloque rien, le faire en dernier le fait sortir sur la version définitive des presets. **Studio reste React 19 + Mantine**, mais pas faute d'écosystème : Svelte a des kits sérieux (Carbon Components Svelte côté enterprise/DataTable, shadcn-svelte sur Bits UI, Skeleton v3, Flowbite Svelte), et notre grille vient déjà de **TanStack Table headless** — qui a un adaptateur Svelte. La vraie raison est le coût de réécriture d'une app admin qui marche, pas une limite du framework. |

### ✅ INCLUS aussi — socle AGENT-READY (devkit, ajouté 2026-07-24)

> POURQUOI dans 10.0.0 : la première impression de l'écosystème ; l'espace backend Node
> agent-ready est VIDE (NestJS/Fastify/Hono : rien d'officiel) ; et le code généré par le
> scaffold est COPIÉ dans l'app à la création — il ne se met pas à jour par npm, donc tout
> ce qui touche les templates doit sortir exemplaire dès la première version.

<!-- prettier-ignore -->
| Domaine | Contenu | Gate précis |
| --- | --- | --- |
| **Scaffold v2** | vagues `devkit S1`→`S4` (design VALIDÉ 2026-07-24, cahier des charges = mémoire IA `project_scaffold_v2_design_kit`) : mécanique sûre (refus AVANT écriture, dry-run, mode machine `--describe-json`/`--answers-json`), app agent-ready (`AGENTS.md` généré + zone `app-notes`, accueil `/`, tests francs), exemples exemplaires (5 saveurs controller, vitrines sur façade client), entity bout-en-bout (pagination `IPage`+tri stable, PATCH, relations réelles, 409 unique, grammaire enum/défauts, test HTTP généré, contexte projet par dialecte) | banc de découvrabilité SCRIPTÉ : app témoin `--link` + 3 tâches (« CRUD produit », « protège une route », « canal temps réel ») — compte les endroits où l'agent DEVINE ; `create.test.ts` étendu (AGENTS.md, non-écrasement) |
| **Module `@nodefony/devkit`** | nom TRANCHÉ (pas de `ai`/`agent` dans le nom — la collision avec P12 est évitée par construction ; commandes IA namespacées `ai:*`) ; `policy:"dev"` = coût nul en prod | — (lots 2+4+5 du devkit = 10.1) |
| **L'application possède son entité `User`** | volet A du kit `project_user_entity_roles_kit` (GO user 2026-07-25). Symfony, Laravel, Django et Rails donnent tous la table `User` à l'application ; ici c'est l'adapter ORM qui la possède, et `create entity User` la refuse depuis 2026-07-25 (sinon le boot casse sur « colonne inconnue ») — donc un utilisateur métier avec des champs en plus n'a **aucune voie de première classe**. À livrer : le générateur (`create entity User --extends framework`), la spec de colonnes DÉRIVABLE (recopier la table la ferait diverger au premier changement du framework), la vérification AU BOOT (colonne du contrat absente → message franc, pas une erreur SQL à la première connexion), les deux adapters (drizzle + mongoose), et l'émission des FOREIGN KEY (décision RÉVISÉE 2026-07-25 : PRAGMA SQLite + tri topologique + cycle annoncé — ne PAS les émettre crée la divergence dev/prod, la production les posera par ses migrations). **Pourquoi dans 10.0.0 et pas 10.1** : même raison que le reste de ce tableau — le code d'une application est FIGÉ à sa création, un correctif ultérieur ne réparerait aucune app née en 10.0.0. Le volet B (source de hiérarchie de rôles pluggable) reste en 10.1 : la config statique demeure le défaut, personne n'est cassé. | une app témoin qui POSSÈDE son `User` avec deux champs métier démarre, se connecte, et les écrans Sessions/Users de Studio répondent encore ; une app dont l'entité OUBLIE une colonne du contrat échoue AU BOOT avec le nom de la colonne et de son lecteur ; chaque garde éprouvée par sa preuve négative (débrancher, vérifier que quelque chose tombe) |
| **Pipeline pack au service du devkit** | symbols shippés + résolution corrigée (10.1), TSDoc préservé dans `dist/` (ne jamais minifier), `files` = `dist`+`docs` partout, smoke test ÉTENDU en banc de découvrabilité | une régression de découvrabilité se détecte AVANT publication |

**Étagement devkit** : 10.0.0 = Scaffold v2 S1-S4 (absorbe les lots AGENTS.md + exemples) **+ volet A « l'app possède son entité `User` »** (GO user 2026-07-25 — même critère d'asymétrie de support) ·
10.1 = `inspect --json`, symbols shippés, 4-6 skills npm + marketplaces, vague S5 (formulaire
entity Studio contextuel — Studio suit npm, remontable au GO) · 10.x conditionnel = `ai:prompt`,
MCP (spec 2026-07-28+, seulement si maintenu comme un produit).

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

## 10. Plan d'exécution — distribution, vitrine et image

> **Ordre R1 → R2 → R3 — TENU, et la séquence est close.** `examples/minimal-app` portait le seul
> décor du seul gate prouvant le modèle B : le supprimer avant que le smoke sache générer le sien
> aurait retiré la preuve « artefact reçu » du dépôt. Le smoke génère désormais son décor (R2), le
> dossier a été supprimé (R3). Le reste des lots peut s'intercaler.

### 10.1 Décisions

<!-- prettier-ignore -->
| # | Décision | Pourquoi |
| --- | --- | --- |
| **D1** | `nodefony/nodefony` = **vitrine GÉNÉRÉE**, poussée par la CI au tag, jamais éditée à la main | Un template à cloner serait une seconde source face aux gabarits du cœur → la dérive qu'on vient de constater sur `minimal-app` |
| **D2** | Le framework reste sur `nodefony-core` ; **tous** les `repository` npm y pointent | npmjs.com affiche le lien « Repository » : un utilisateur qui clique doit atteindre les sources, pas une application de démonstration |
| **D3** | Le `Dockerfile` a **une seule source** : les gabarits de `create app` | Sa doctrine (forme **exec** → node PID 1 → SIGTERM reçu) ne survit pas à une réécriture par l'utilisateur, et son absence ne produit aucune erreur — juste la fin silencieuse de l'arrêt gracieux |
| **D4** | L'image se construit **depuis une application générée** | Elle prouve alors le générateur au lieu de vivre à côté de lui |
| **D5** | `npm create nodefony` = **shim mince** qui délègue à `nodefony create app` | Deux portes d'entrée, UNE implémentation de scaffold — et l'`npm i -g` que le §6bis-B nomme comme le bloqueur d'onboarding disparaît |
| **D6** | Les deux dépôts Docker sont **archivés** | `nodefony-docker` ET `docker-nodefony` existent, même dernier push (2023-11-13) : un doublon, et plus aucune source à héberger une fois D3 appliqué |
| **D7** | Un tag `v10.*` déclenche **tout** | Un seul déclencheur, aucune étape manuelle à oublier |

**Pourquoi PAS de submodule** (option écartée) : un submodule sert à **consommer** un dépôt tiers à
une révision figée (parent → dépendance) ; ici `nodefony-core` **produit** le contenu des deux
dépôts — c'est une **publication**, au même titre que npm. Conséquences : `git clone` sans
`--recursive` rend des dossiers vides (friction n°1 pour un projet dont l'enjeu est l'onboarding) ;
deux commits par régénération ; et le contenu reste éditable des deux côtés, donc **la dérive
demeure**. C'est de plus le montage qu'employait le v7 (`.gitmodules` à sa racine).

### 10.2 R0 — hygiène de la surface publiée (aucun impact fonctionnel)

Terrain relevé : sur les 13 publiables, **aucun** `repository` n'est exploitable — 7 pointent vers
`git://github.com/nodefony/nodefony.git` (le futur dépôt VITRINE) avec un `directory`
(`src/packages/@nodefony/…`) qui n'existe pas dans ce dépôt, 3 portent `repository: ""`
(**framework, http, security** — le cœur), 3 n'ont aucun champ ; `homepage` est absent partout ; et
le protocole `git://` est mort depuis 2022 (port 9418 fermé par GitHub).

<!-- prettier-ignore -->
| Lot | Geste | Preuve |
| --- | --- | --- |
| **R0.1** | `repository` + `homepage` + `bugs` sur les 18 `package.json` du périmètre (`src/nodefony` + `src/packages/@nodefony/*`) | relevé avant/après ; `…/tree/HEAD/<location>` vérifié 200 (**`HEAD`** et non `main` : survit à un renommage de branche) |
| **R0.2** | **Gate au pack** (`pack-all.mjs`) : un publiable sans `repository`, ou dont le `directory` n'existe pas sur disque, fait ÉCHOUER le pack | **vu ROUGE d'abord** — vider un champ, vérifier que le pack tombe |
| **R0.3** | `@nodefony/frontend` déclare `"vite": "8.1.5"` en peer **exact** → passer en intervalle | toute application qui l'installe entre en conflit au prochain patch de vite |

> R0.2 est le vrai livrable : sans lui, le trou se rejoue à la création du prochain paquet.

### 10.3 R1 — Docker entre dans le générateur

| Lot         | Geste                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R1.1** ✅ | `Dockerfile` + `.dockerignore` deviennent des gabarits de `create app` — repris de `minimal-app`, doctrine intégralement préservée (multi-stage, forme exec, `USER node`, HEALTHCHECK `/readyz`) |
| **R1.2** ✅ | `compose.yaml` généré avec **le seul** service SQL retenu au scaffold (`--database`) — le générateur connaît le dialecte, l'app ne reçoit pas les deux bases qu'elle n'utilisera pas             |
| **R1.3** ✅ | **Pas** de `Dockerfile.dev` en 10.0.0 : le développement tourne en local, et un conteneur de dev (volumes + `node_modules` + HMR) coûte plus qu'il ne rend                                       |

**Preuve R1** : application générée → `docker build` → `run` → `/livez` `/readyz` → `docker stop`
pendant une requête lente → la requête aboutit, sortie en 0, drain visible dans les journaux.

**R1.1 fait** — gabarits `templates/app/base/{Dockerfile,dockerignore}.tpl`, rendus pour **les deux
presets** (la doctrine n'est pas une option de la vitrine). Preuve tenue de bout en bout sur une app
générée : image construite, `readyz`/`livez` 200, `/api/hello` répondu **avec `pid: 1`** (la forme
exec constatée, pas supposée), requête de 2 s drainée pendant `docker stop`, sortie 0, `SHUTDOWN`
dans les journaux.

Un écart au patron habituel, et il est délibéré : le `COPY . ./` précède l'installation au lieu du
`COPY package.json` seul. Une dépendance d'application Nodefony peut être **locale** — workspaces
`modules/*` posés par `create module`, archive `file:` avant publication — et le patron canonique
échoue sur elles. Le cache de couche perdu est repris par un **cache mount npm**
(`--mount=type=cache,target=/root/.npm`), qui garde l'installation vierge sans repayer le réseau.
Conséquence pour R2 : le smoke n'aura **rien à patcher** dans le Dockerfile généré pour y injecter
ses tarballs.

**R1.2 fait** — question `database` dans la spec du scaffold + flag `--database`
(`sqlite` | `postgres` | `mariadb` | `mysql`, défaut `sqlite`). Le `compose.yaml` généré ne porte
plus trois bases derrière des profils : il porte **celle qui a été retenue**, sans `profiles:` —
ce n'est pas une option, c'est la base que `NF_DATABASE_URL` joint, donc `docker compose up -d`
doit la monter. `DATABASE_PARAMS` + `resolveDatabase` (`scaffold/engine.ts`) sont la source unique
du service, du port et de l'URL : les trois fichiers qui en parlent (`compose.yaml`, `.env`,
`README.md`) ne peuvent plus diverger — un écart entre le port publié et celui de l'URL ne se
verrait qu'à la connexion refusée. En `sqlite`, aucun service SQL n'est rendu et l'URL reste
commentée : l'app démarre sans rien allumer, ce qui reste le chemin par défaut.

Deux effets de bord assumés : MySQL est publié sur **3306** (le 3307 n'existait que pour cohabiter
avec MariaDB dans un compose qui portait les deux), et `.env` porte l'URL **active** quand une base
docker est retenue — le récap de `create app` place donc `npm run infra:up` avant `npm run dev`.
Un choix explicite à la création est un contrat : laisser la ligne commentée reviendrait à ignorer
la réponse.

Gate vu ROUGE : `db` forcé à `null` dans le moteur → les trois contrôles par dialecte tombent ;
clause `askWhen` débranchée → le contrôle « preset minimal retombe à sqlite » tombe.

### 10.4 R2 — le smoke GÉNÈRE son décor (cœur du chantier)

<!-- prettier-ignore -->
| Lot | Geste |
| --- | --- |
| **R2.1** ✅ | `smoke-docker.sh` : `nodefony create app` **remplace** la copie de `examples/minimal-app` (`APP_SRC`) |
| **R2.2** ✅ | Étapes **nommées séparément** — « scaffold en échec » ne doit jamais se lire comme « tarballs en échec » |
| **R2.3** 🔶 | Étendre aux 3 scénarios front que le §6bis réclame déjà : **(a)** app à front → tags `/_assets/…` ; **(b)** `public/dist` supprimé → auto-build annoncé, et ERROR nommée dans l'image sans devDependencies ; **(c)** Studio `static` + `mandatory` → `/nodefony` 200 |

Bénéfice structurel : le smoke éprouve alors **le générateur** — c'est-à-dire ce que reçoit
réellement un nouvel utilisateur — et les variantes qu'exige R2.3 sont impossibles avec un dossier
figé, naturelles avec un générateur.

**Preuve R2** : smoke vert de bout en bout. C'est le seul gate qui débloque R3.

**R2.1 + R2.2 faits.** Le décor est généré, et il l'est **depuis le tarball** : le paquet
`nodefony` s'installe dans un dossier jetable, et c'est CE binaire qui produit l'application
témoin (`create app`, puis `create controller` pour la route lente). Un pas de plus que ce que
le lot demandait, et c'est là qu'est la valeur : les **gabarits sont éprouvés tels qu'ils sont
publiés** — un fichier oublié dans `files` ne se voit d'aucune autre façon. Le smoke exerce
maintenant deux générateurs au lieu de zéro.

Trois gardes attribuent la faute au bon maillon (R2.2) : fichiers attendus après `create app`,
`CMD` en forme exec dans le Dockerfile généré, et au moins une dépendance réécrite vers les
tarballs. La forme exec est en outre **constatée à l'exécution** (`/api/hello` doit rendre
`pid: 1`), pas seulement lue dans le fichier.

Gate vu MORDRE : gabarit `Dockerfile.tpl` retiré → le smoke échoue à l'étape **« create app »**
en nommant le gabarit absent, et non à `docker build` — ce que le lot R2.2 demandait exactement.

**R2.3 fait, sauf une moitié de cas — et c'est un résultat.** Le script porte trois scénarios
sélectionnables (`--scenario base|front|studio`) :

| Scénario | Verdict    | Ce qu'il a établi                                                                                 |
| -------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `base`   | ✅         | sondes, node en PID 1 constaté, drain sous `docker stop`, sortie 0                                |
| `front`  | ✅ (a)(b1) | tags `/_assets/…` servis · `public/dist` effacé avec Vite présent → reconstruit ET annoncé        |
| `studio` | ✅         | `/nodefony` 200 **et** un asset pris DANS la page en 200 → l'UI pré-buildée voyage dans le paquet |

**(b2) est INATTEIGNABLE, mesuré.** Le cahier réclamait « image sans devDependencies → ERREUR
nommée ». Cette image n'existe pas : le plugin Vite est une devDependency, il SATISFAIT la
dépendance de pair optionnelle de `@nodefony/frontend`, donc `npm prune --omit=dev` le garde et tire
Vite. Refaire l'arbre depuis zéro n'y change rien — le `package-lock.json` l'a figé : **161 Mo dans
les deux cas**. Le script ANNONCE ce trou au lieu de le taire (règle : un gate qui rétrécit le dit).

➡️ **Dette produit ouverte — symétrie des drivers et de Vite.** Deux déclarations mentent
aujourd'hui : `better-sqlite3` est une dépendance DURE de `@nodefony/drizzle` importée
STATIQUEMENT (`DrizzleOrm.ts:4`) pendant que `pg` et `mysql2`, chargés dynamiquement, ne sont
déclarés NULLE PART — npm n'avertit donc personne de leur absence ; et Vite est une dépendance de
pair de `@nodefony/frontend` que rien ne rend optionnelle à la source. SQLite en production est un
choix légitime (mono-pod, edge, embarqué) : il ne s'agit pas de le sortir, mais de rendre les trois
dialectes symétriques — pair optionnelle + import dynamique pour chacun. C'est ce qui rendrait (b2)
atteignable et allégerait les images.

**Podman** : le Dockerfile généré s'y construit et s'y exécute tel quel (build 0, `readyz` 200,
`pid: 1`, `podman stop` en 0 avec drain). Une seule perte, SILENCIEUSE : `HEALTHCHECK` est une
extension du format _Docker_ absente de la spec **OCI**, que Podman produit par défaut — la sonde
disparaît sans erreur. Remède vérifié `--format docker`, avertissement écrit dans le gabarit.

### 10.5 R3 ✅ — `examples/` a disparu

**Fait.** Le dossier est supprimé, et la prose qui le décrivait au présent est corrigée (le flux du
smoke § « Smoke test de parité », la ligne Cloud-native du tableau des phases, l'encadré d'ordre
ci-dessus, `MIGRATION_STATUS`). Les mentions restantes sont **historiques** et le restent : elles
racontent d'où viennent les gabarits (R1.1) et ce que R2.1 a remplacé — les effacer réécrirait
l'histoire au lieu de la dater.

La condition posée était que le smoke sache générer son décor : elle est remplie depuis R2.1, et
plus aucun script ne lisait `examples/`. Le dépôt n'a donc plus **aucune** application témoin figée
— toute preuve part désormais d'une application **générée par le paquet publié**.

### 10.6 R4 — `create-nodefony`

14ᵉ paquet, ~50 lignes, versionné en lockstep : il résout le binaire `nodefony` et lui passe la
main. **Preuve** : `npm create nodefony@<version> app-test` depuis les tarballs, en conteneur vierge.

### 10.7 R5 — la CI porte tout

```
tag v10.x ─► build + tests ─► pack (14 tarballs) ─► smoke sur app GÉNÉRÉE
          ├─► npm publish (lockstep)
          ├─► create app ──► push vitrine + tag
          ├─► docker build (depuis l'app générée) ──► push
          └─► gh release + changelog
```

Secrets : **aucun pour npm** (trusted publishing, §7.3bis), jeton d'écriture sur la vitrine,
identifiants du registre d'images.
**Manque criant que ce lot comble** : aucun job ne construit l'image aujourd'hui, et
`smoke-docker.sh` n'est déclenché par aucun automate — la preuve la plus proche de la production
n'existe que si quelqu'un pense à la taper.

### 10.8 R6 — dépôts externes (gestes GitHub, hors dépôt)

1. `nodefony/nodefony` : **branche `v7` + tag `v7.0.2` AVANT** d'écraser la branche par défaut —
   19 ★ et des liens entrants pointent vers ce code (framework JS 7.0.2, dernier commit 2025-02-05).
2. `nodefony-docker` **et** `docker-nodefony` : archiver les deux (D6).
3. Image publiée sous `nodefony/nodefony`.

### 10.9 Ce que ce plan NE couvre PAS — et qui bloque encore la release

Le DoD du §8 n'est pas atteint : **ORM multi-dialecte S5** (DDL prod) · **preset Svelte** (figé
comme dernier geste avant release) · **devkit S1→S4** + volet A « l'application possède son
`User` » · les **rouges CI jamais diagnostiqués** (« Tests intégration », « Filet CLI (windows) ») ·
et le fait que **la CI n'a jamais tourné sur un runner réel**, aucun run complet des 16 tâches
n'ayant eu lieu.

---

## Journal des décisions

<!-- prettier-ignore -->
| Date | Décision | Statut |
| --- | --- | --- |
| 2026-05-24 | Périmètre = `src/nodefony` + `src/packages/@nodefony/*` (modules/\* + racine exclus) | ✅ acté |
| 2026-05-24 | **Version UNIQUE** + build embarque les dist (fini les N packages indépendants) | ✅ acté (vision) |
| 2026-05-24 | App utilisateur = **repo dev-ready** (DX du repo de dev, sans source framework) | ✅ acté (vision) |
| 2026-05-24 | Modèle mono-package subpaths + deps lourdes optionnelles | 🔶 proposé, à confirmer |
| 2026-05-24 | Résolution types par `exports[...].types` par subpath + attw + tsc témoin | 🔶 proposé |
| 2026-05-24 | **Pipeline = script Node** (logique, runnable local) + **GH Action mince** (wrapper) | ✅ acté (vision) |
| 2026-05-24 | Déclencheur tag `v10.*`/`workflow_dispatch` ; assemblage N→1 = MAISON ; version via commitlint | 🔶 proposé |
| 2026-05-24 | **DoD 10.0.0** = P6 sécu + ORM(core+Drizzle) + cloud-native BASELINE (Dockerfile + env), tout SAUF IA(P12) + média/SIP(P15) | ✅ acté |
| 2026-05-24 | Cloud-native gate = **Dockerfile + config par env** seulement (PAS tout P16) | ✅ acté |
| 2026-05-24 | **Couche client SIP exclue** de 10.0.0 (avec mediasoup + IA) → 10.x | ✅ acté |
| 2026-05-30 | Audit `private` vérifié terrain : **6** packages `private:true` = http, framework, security, frontend, **realtime**, studio (realtime manquait §3). IA (agent/llm/rag/vector/memory) = `private` absent. | ✅ constaté |
| 2026-07-02 | **MODÈLE DE RELEASE = (B) N-packages + changesets `fixed`/lockstep** ; mono-distrib (A) abandonnée ; scope `@nodefony/*` conservé ; POC comparatif → recadré en **smoke test de validation** (avant release) | ✅ acté |
| 2026-07-02 | Pipeline publish : bascule `exports.types` source→`dist/types` au pack (7 packages cœur) + `peerDependenciesMeta.optional` sur adapters lourds | ✅ acté (contrainte) |
| 2026-07-03 | **Phase 0.4 APPLIQUÉE** — (a) toolchain build hors deps runtime du core (rollup/@rollup/terser→devDeps, lodash×2 supprimés, DevSupervisor+figlet lazy) ; (b) `private` recadré (cœur+studio+documentation libérés, IA gelée `private:true`), versions lockstep 10.0.0, `files` dist-only (+`bin` core, +`public` studio, +`docs` partout — parité portail doc Studio), `publishConfig.access:public` ×12 scopés. Périmètre réel = **13 publiables** (§3 datait de mai : +`documentation` ; `agent-guard`/`mcp` = squelettes sans package.json, hors scope). Adapters : deps lourdes restent par-package (modèle B) ; peer-optional ne concernera que les drivers multi-dialecte drizzle (chantier 2.1) | ✅ fait |
| 2026-07-03 | **Phase 0.6 — revue red-team realtime (PARTIEL)** : threat-first (matrice de menace avant lecture) + 3 sondes de câblage. **F4** révocation asymétrique `subscribe` FIXÉ (`14629f69`, blue B = re-validation `isValid()` périodique dans le hub, close 4001, verrou sync préservé) · **F7** prototype pollution des frames SAIN (`3091cfd7`, 0 finding) · **F1** policy de canal silencieuse sans frameAuthorizer → fail-loud (`5873ceec`). Reste = chantier `project_realtime_dos_limits_kit` : **F5/F6** DoS (rate-limit handshake WS hors module + caps connexions/canaux/messages ; banc de charge + décision framework/infra), **F2** plancher config, **F3** docstring « ≤ GET ». Gates vertes (tsc + tests realtime/security + `memory.test` http). | 🔶 partiel |
| 2026-07-03 | **Phase 0.6 — volet DoS handshake (F5)** : banc de charge threat-first (200 sockets anonymes floodant → latence HTTP tail p95 ~57 s = famine event-loop). Le vrai vecteur est au PÉRIMÈTRE, pas au débit. **F5** handshake WS échappait au rate-limit IP → FIXÉ (`870ddca6`, `@nodefony/http`) : garde en tête `onWebsocketRequest` AVANT scope/ALS, MÊME compteur que HTTP, IP forwarded-aware (le framework tient l'IP fiable), close 1013 au dépassement, 0 log/rejet. Banc versionné `ws-handshake-ratelimit-e2e.mjs`. **F6b** (throttle messages/conn) **ABANDONNÉ** (contredit la North Star : un socket authentifié pousse fort = légitime). **F6a** cap canaux/conn (`02406ac9`, realtime, défaut 256 configurable `null`=illimité, refus observable `realtime:denied`) + **F9** `slowConsumer.bytes` (clé morte câblée). **F2** plancher irréductible `authenticated` sur namespaces réservés (`2db12d35`, security : une config ne peut plus ouvrir `security:`/`syslog:` à l'anonyme ; anti-bypass prefixe court) + **F3** docstring api.request corrigé. **F6c** cap connexions concurrentes/IP (`a074f8a4`, http) = **backstop OPT-IN par-process** (défaut OFF) : décision archi = le cap concurrent/IP est le rôle de l'INGRESS/LB (nginx `limit_conn`, k8s), pas du framework ; backstop documenté pour bare-metal sans ingress ; prouvé live (cap=3 → 3 vivantes/5 close 1013). **Volet DoS 0.6 COMPLET.** Gates : http 536+560+memory 9/9 · realtime 312 · security 781. | ✅ fait |
| 2026-07-03 | **Phase 0.5 CLÔTURÉE — ADR-0007 ClientKernel isomorphe** (`docs/adr/0007`, `cb186179`) : contrat runtime client gelé AVANT publication (périmètre infra-jamais-la-vue, contrat d'abord, pas de DI décorateurs client, opt-in strict, observabilité full-stack `traceparent`+`syslog:front`, sécurité d'identité structurelle, budgets bundle + gate size-limit à câbler au pipeline, convergence debug-client→Studio). **Volet 10.0.0 APPLIQUÉ** (`8928c558`) : `IClientKernel` publié types-only + façade client named-only (export default supprimé, 0 consommateur) + legacy `api/Storage`/`transport/websocket` sortis de la surface et du bundle (49,4 KB gzip, −0,6). Implémentation → Phase 3.2 | ✅ fait |
| 2026-07-04 | **Phase 0.8 lot 1 — AUTO-REGISTER des stores framework** (fin de l'« approche B ») : charger un module adapter (drizzle/mongoose/redis) = ses backends sélectionnables par simple nom + son schéma framework déclaré (`registerStores.ts` par adapter, appelé à `onKernelRegister`, AVANT connect). Drizzle : entités token/audit/webauthn/webhook/idempotency + 5 fabriques (registres security+framework) selon le dialecte du connecteur `default` (non porté = ni déclaré ni fabricable → `listXStores()` reflète le RÉEL, échec franc à la sélection). Mongoose : token/webauthn/webhook (couverture partielle assumée). Redis : token/webauthn (client lazy). Guards partout (entité `has`, fabrique `get`) = l'app garde la main ; opt-out `frameworkEntities:false`. Câblages app SUPPRIMÉS (`nodefony/security/{idempotencyStore,webhookStore}.ts`) — `NF_IDEMPOTENCY_STORE=drizzle`/`NF_WEBHOOK_STORE=drizzle` marchent out-of-the-box (prouvé au boot : 8 tables framework créées, store idempotence résolu). PeerDeps : drizzle+=security,framework · mongoose+=security · redis+=security. Gates : builds 4/4 · drizzle 114 · mongoose 84 · redis 42 · http intégration 565 · memory 9/9. Plan 0.8 = modèle « 3 rôles » (database/cache/logs) + dérivation, lots 2-6 à suivre | ✅ fait |
| 2026-07-04 | **Phase 0.8 lot 2 — UNIFORMISATION CONFIG de tous les modules** : (a) structure « 2 fichiers mêmes noms partout » appliquée aux 9 modules à schéma — fusion `schema.ts`→`config.ts` (http 957 l, framework, mongoose, redis, realtime, frontend, documentation ; security : Zod extrait de defineSecurityConfig.ts→config.ts) + `define<X>Config.ts`→`defineModuleConfig.ts` (git mv, fonctions préfixées inchangées) ; (b) **`.meta()` NATIF zod 4 remplace la machinerie maison** (POC prouvé : flags typés via `declare module "zod" { interface GlobalMeta }` dans le core `configMeta.ts`, recopiés dans `z.toJSONSchema` → sert le lot 5 provenance ; piège gravé : `.meta()` TOUJOURS dernier de la chaîne sinon meta PERDUE) — helper `meta()`/`INodefonyFieldMeta` de http SUPPRIMÉ, `redis.password`/`redis.url` flaggés `secret` ; (c) vocabulaire **données = `store`** : `session.handler`→`session.store`, `tokenStore.driver`→`.store`, `audit.driver`→`.store` (config + code + tests + .md ; shapes data plane `driver` = lot 5) ; (d) env `NF_*` : `NODEFONY_REALTIME_DRIVER`→`NF_REALTIME_DRIVER`, `LOKI_URL`→`NF_LOKI_URL`, `OPENSEARCH_URL`→`NF_OPENSEARCH_URL`. Gates : clean build 19/19 · core 1771 · http 536+565 intégration · security 781 · framework 429 · drizzle 108 · mongoose 77 · redis 42 · realtime 312 · frontend 35 · documentation 32 · boot réel 0 erreur (`SESSION STORAGE active : drizzle` via la clé `store`) | ✅ fait |
| 2026-07-04 | **Phase 0.8 lot 3 — INFRA DÉCLARÉE (database/cache/logs) + dérivation** (⚠️ vocabulaire : « infra », JAMAIS « rôle » — collision avec les rôles security `ROLE_*`, recadré par CCI en cours de lot) : (a) core `src/config/infra.ts` — `resolveInfra(env)` PURE (URLs `NF_DATABASE_URL`/`NF_REDIS_URL` + alias plateforme `DATABASE_URL`/`REDIS_URL`, dialecte déduit du scheme sqlite:/postgres/mysql/mongodb, scheme inconnu = throw fail-loud) + `resolveAutoStore(kind, infra, available, fallback)` (préférences durable/ephemeral/session bornées aux backends ENREGISTRÉS `listXStores()` → repli toujours ANNONCÉ) + `AUTO_STORE`/`EMPTY_INFRA` ; exposée `kernel.infra` (mémoïsé) + `ctx.infra` (gating manifeste) ; (b) **sentinel `store:"auto"` = DÉFAUT partout** : session (http), tokenStore/passkeys/audit/webhooks (security), idempotency (framework), `NF_USER_STORE` (+ branche mongoose provisionUsers, repli persistant drizzle) — chaque consommateur logge le choix + provenance ; (c) **fix `DrizzleService.#connectOne`** : propage `dialect`/`url` à `DrizzleOrm` (avant : sqlite silencieux), mkdir/defaultFilename sqlite-only, log URL rédigée ; `DRIZZLE_DB_FILE` SUPPRIMÉ (→ `NF_DATABASE_URL=sqlite:…`) ; mongoose suit l'infra mongo (`MONGODB_URI` prioritaire) ; (d) logs : `resolveQueryDriver` dérive le driver de l'URL déclarée (1 knob ; 2 URLs sans choix explicite = throw) ; (e) module redis gaté `when: !!ctx.infra.cache` (plus de magie localhost ; store redis sans URL = échec franc). Preuve terrain : boot avec `NF_DATABASE_URL=sqlite:<fichier>` → ORM sur CE fichier + tokens/audit/webhooks/idempotence/users basculés drizzle, provenance loggée. Gates : clean build 19/19 · core 1792 (+21 infra) · security 781 · framework 429 · drizzle 117 · mongoose 84 · redis 42 · http 536 unit + 565 intégration · memory 9/9 · boot réel 0 erreur | ✅ fait |
| 2026-07-04 | **Phase 0.8 lot 4 — DOCTRINE D'ÉCHEC + PROD-GUARD des stores** (aligné sur l'idempotence, seule brique déjà conforme) : (a) **store EXPLICITE introuvable = config erronée → prod = throw au boot** (fail-loud, le kernel avorte via `isBootErrorFatal`) **· dev = dégradation ANNONCÉE** — session (http) : repli `"files"` WARNING (l'app reste utilisable ; storage=null silencieux supprimé) ; tokenStore/passkeys/audit/webhooks (security) : brique désactivée CRITIC nommant l'impact (audit uniformisé WARNING→CRITIC) ; messages citent les backends enregistrés `listXStores()` ; (b) **prod-guard : brique sécu durable résolue sur `"memory"` en PRODUCTION → WARNING appuyé nommant l'impact** (couvre `auto` sans infra ET memory explicite) — tokenStore (denylist JWT/refresh/clés API per-pod volatils, révocation non partagée), passkeys (credentials perdus au restart = users verrouillés), audit (rétention conformité impossible), webhooks (abonnements volatils), idempotence (dédup per-pod = double-effet multi-pod), `NF_USER_STORE=memory` (annuaire volatil) ; le cas « auto sans impl sur l'infra déclarée » restait déjà annoncé par `resolveAutoStore` (lot 3). Gates : security 787 (+6 tests doctrine : dev désactivé / prod throw / prod memory accepté+WARNING sur tokenService & auditService) · http 536 unit + 565 intégration · framework 429 · memory 9/9 · terrain : boot dev store bidon → `WARNING … repli "files"` + HEALTH 200, config nominale re-prouvée (`SESSION STORAGE active : drizzle`) | ✅ fait |
| 2026-07-24 | **DEVKIT INTÉGRÉ À LA RELEASE + DESIGN SCAFFOLD v2 VALIDÉ (GO user)** : 10.0.0 embarque le socle agent-ready = Scaffold v2 COMPLET vagues `devkit S1`→`S4` (cahier des charges audité 4 sous-agents + revérifié, mémoire `project_scaffold_v2_design_kit` ; UNE nomenclature publique `devkit S<n>`) ; S5 (UX Studio, formulaire entity contextuel par dialecte) = 10.1 remontable ; nom du module TRANCHÉ `@nodefony/devkit` (pas de `ai`/`agent` dans le nom — anti-collision P12 par construction, commandes IA en `ai:*`) ; 🔴 trouvaille d'audit : le moteur scaffold ÉCRIT avant de refuser (controller/entity) — fix en S1 ; § « INCLUS aussi — socle AGENT-READY » ajouté au DoD | ✅ acté |
| 2026-07-07 | **Gate « comparatif ORM froid » PASSÉE** (`a370b5a1`, mémoire IA `core-dev/audits/orm-comparatif-froid-2026-07.md`) : panel élargi Drizzle 0.45/Kysely 0.29/Prisma 7.8/TypeORM 1.0 (GA 05-19)/MikroORM 7.1, données npm+GitHub du jour → **Drizzle CONFIRMÉ** — aucun candidat ne couvre « entités livrées par le framework, dialecte choisi par l'app au runtime » sans céder sur type-safety (TypeORM), perf (ORM runtime) ou modèle de livraison (Prisma codegen) ; Kysely gagne l'intrinsèque d'un cheveu mais swap = 8-12 sessions + re-preuve sécu pour gain ≈ nul. Garde-fous : G1 confinement dialectal (~200 l. colKit+factories+queryKit) · G2 plan B Kysely nommé (entités framework seules) · G3 `rowid`→PK-subquery d'abord (sqlite-only ×3 dans `DrizzleRepository`, découvert à l'étude). P7.10 débloqué, plan S1-S4 (7 entités + mysql) | ✅ fait |
| 2026-07-24 | **Preset Svelte 5 = DERNIER geste avant la release** (figé user). Ajout `svelte5-vite` aux presets `@nodefony/frontend` + `create module --frontend svelte`. Raison du placement : zéro dépendance amont, coût faible, et sortir sur la version finale des presets. Studio **reste** React 19 (pas d'équivalent Mantine côté Svelte pour l'admin). | ✅ acté |
| 2026-07-25 | **VOLET A « l'entité `User` appartient à l'APPLICATION » INTÉGRÉ À 10.0.0 (GO user)** : le framework possède aujourd'hui la table `User` (adapter ORM) là où Symfony, Laravel, Django et Rails la donnent à l'app — le profil séparé avec clé étrangère n'est la norme que chez les services managés (Supabase), pas chez une bibliothèque. Le mécanisme d'appropriation EXISTE déjà (le module s'efface devant une entité déclarée par l'app) ; manquent le générateur, la spec dérivable et la vérification au boot. Entre en 10.0.0 parce que le code d'une app est figé à sa création. Décision FK RÉVISÉE au passage (les émettre, sous conditions). Volet B (hiérarchie de rôles pluggable) = 10.1, sans rupture. Kit : mémoire IA `project_user_entity_roles_kit` | ✅ acté |
| 2026-07-30 | **DISTRIBUTION TRANCHÉE (GO user) — cf §10 « Plan d'exécution »** : `nodefony/nodefony` devient la **vitrine GÉNÉRÉE** poussée par la CI (D1) ; les `repository` npm pointent tous vers `nodefony-core` (D2) ; le `Dockerfile` n'a qu'UNE source, les gabarits de `create app` (D3), et l'image se bâtit **depuis une application générée** (D4) ; `npm create nodefony` = shim déléguant à `nodefony create app` (D5) ; les deux dépôts Docker en doublon sont archivés (D6) ; un tag `v10.*` déclenche tout (D7). **Submodule ÉCARTÉ** : le flux est une PUBLICATION, pas une dépendance — et un clone sans `--recursive` rendrait des dossiers vides. `examples/minimal-app` est supprimé, mais **seulement après** que le smoke sache générer son décor (ordre R1→R2→R3) : il porte aujourd'hui le seul gate qui prouve le modèle B. Terrain relevé au passage : **aucun** des 13 publiables n'a de `repository` exploitable (7 pointent vers la future vitrine avec un `directory` inexistant, 3 vides — dont http, framework, security —, 3 absents ; `homepage` nulle part ; protocole `git://` mort depuis 2022) | ✅ acté |
