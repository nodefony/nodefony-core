# CLAUDE.md — @nodefony/mongoose

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA · [`README.md`](./README.md) — usage humain · [`docs/`](./docs/) — surfacé Studio
- [`../drizzle/CLAUDE.md`](../drizzle/CLAUDE.md) — adapter SQL frère (référence) · [`../orm-core/CLAUDE.md`](../orm-core/CLAUDE.md) — socle
- Audit config ORM : [`../../../../docs/audits/orm-config-pattern-2026-06.md`](../../../../docs/audits/orm-config-pattern-2026-06.md)
- Mémoires : `project_orm_hardening_kit`, `project_orm_audit_state`, `feedback_config_validation_zod`, `feedback_orm_default_first`

## Rôle

Driver **NoSQL Mongoose** sur `@nodefony/orm-core`. 2ᵉ adapter du banc multi-ORM (store documentaire
hétérogène, parité de contrat avec Drizzle SQL). **Module bootable + opt-in** (`critical = false`) —
non chargé par défaut (Drizzle = ORM SQL par défaut).

## Nature : Module bootable + adapter lib

1. **Module bootable** : `MongooseService extends Service` connecte au `onBoot` un `MongooseOrm` par
   connecteur (config). `onKernelBoot` câble le data plane ORM + l'adapter d'erreurs. Ferme au `onTerminate`.
2. **Adapter lib** : `MongooseOrm`/`Repository`/`Transaction` exportés (named) pour un usage direct / banc-test.

## Décisions figées (refonte Ph.2, 2026-06-08)

- **`extends Service`, PAS `extends Orm` core** : la refonte a supprimé l'`Orm` legacy du core. Le
  service orchestre des adapters orm-core autonomes (modèle `DrizzleService`). Le core ne connaît plus l'ORM.
- **Config = Zod** (`nodefony/config/config.ts`, source de vérité) → builder `defineMongooseConfig`
  (parse + env + freeze) → validée au `onKernelRegister`, exposée au container sous `mongooseConfig`.
  Augmente `NodefonyModuleConfig` → `use("@nodefony/mongoose", …)` typé. Réf : audit config ORM.
- **Connecteur défaut = `nodefony`** (≠ `default` de Drizzle) → `SESSION_CONNECTOR = "nodefony"`. **Raison** :
  l'entité `session` est enregistrée dans le `entityRegistry` **process-wide** sous `(connector, name)` ;
  un nom de connecteur distinct évite la collision si Drizzle + Mongoose cohabitent. **Gotcha non évident.**
- **Connexion isolée** (`mongoose.createConnection`, pas le singleton global) → multi-ORM.
- **Session portable** : `SessionStorage` strictement identique au store Drizzle (timestamps ms, GC `$lt`).
- **`critical = false`** : driver externe opt-in → un échec de connexion ne tue pas le process (dégradation gracieuse).

## Sondes Studio (data plane)

`describeEntity` (`schema.paths`, `_id`=PK) · `describeConnection` (driver `mongodb` + cible SANS
credentials + version) · `ping` (`admin().command({ping:1})`) · `probe` (`serverStatus`→pool) ·
**flow tap** (`MongooseRepository` → `queryFlowMonitor` + buffer ALS, coût nul hors observation).

## Interdits

- `any`, `@ts-ignore`, `require()`. ESM only, préfixe `node:`.
- Importer `@nodefony/framework` (orm = couche basse). Logique métier.
- Lire `process.env` dans `config.ts` (le schéma reste pur → env dans `defineMongooseConfig`).
- Déréférencer `Nodefony.getKernel()` au top-level d'un fichier d'import.

## Gotchas

- **PK `_id` (ObjectId) ≠ `id`** : `{id}`→`{_id}` en critère, virtuel `id` (hex) en sortie.
- **Transactions = replica set obligatoire** (`session.withTransaction`). Standalone = pas de tx.
- **virtuals** : schéma `{toObject:{virtuals:true}, toJSON:{virtuals:true}}`.
- **`describeConnection` est SYNC** → `safeTarget()` nettoie l'URI (strip `user:pass`). Version serveur indispo en sync.

## Build / Test

- deps : `mongoose` 9.6.3, `mongodb` 7.2.0, `zod` ^4.4.3. peerDeps : `@nodefony/http`/`@nodefony/orm-core`/`nodefony`.
- `npm run build` (rolldown preserveModules → `dist/` + `dist/types/`). `zod` dans `external`.
- `npm test` (`vitest run`) — **24 tests** : `tests/unit/config` (Zod) + `tests/integration/`
  (orm-core ReplSet + session-storage hybride). **`MONGO_TEST_URI`** = conteneur Mongo CI/Docker ;
  sinon `mongodb-memory-server` (binaire mongod téléchargé 1×, ~84 Mo). Banc orm-core = `MongoMemoryReplSet` (tx).

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rolldown.config.ts` / `tsconfig.json` (`zod` ajouté à `external` le 2026-06-08).
- Éditer les valeurs de `config.ts` à la main → modifier les `.default(...)` du **schéma**.
