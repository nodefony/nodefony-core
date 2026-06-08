---
audit: orm-state-and-hardening
date: 2026-06-08
status: working
author: Christophe CAMENSULI
scope: orm-core, drizzle, sequelize, mongoose, kernel/orm (core legacy)
tags: [orm, audit, hardening, drizzle, sequelize, mongoose, migrations, p5, p7]
related:
  - docs/adr/0003-orm-core-abstraction-repository-multi-orm.md
  - docs/migration/AUDIT-verite-2026-06.md
  - memory: project_orm_hardening_kit, project_decisions_p5_p6_orm, project_orm_default_positioning
---

# Audit ORM global — état réel + vision du durcissement (2026-06-08)

> Audit pré-chantier demandé avant d'exécuter le **virage ORM** (décidé 2026-06-02).
> Confronte le **code réel** (grep/lecture source), **toutes les mémoires IA ORM**, les
> **docs/ADR internes** et un **benchmark externe** (Drizzle Kit, Flyway/Liquibase/Atlas/Prisma,
> tendances ORM TS 2025-2026). But : image complète de l'existant **et** plan d'exécution figé.

---

## 0. Résumé exécutif (l'image en 12 lignes)

- L'ORM Nodefony tient en **5 briques** : `@nodefony/orm-core` (socle moderne, **à garder**),
  `@nodefony/drizzle` (**référence**, 100 % propre), `@nodefony/sequelize` (**à supprimer**),
  `@nodefony/mongoose` (**à refaire**), et `src/nodefony/src/kernel/orm/*` (**legacy core, à retirer**).
- **Le smell central = DEUX classes `Orm` homonymes** : l'ancienne (`kernel/orm/Orm.ts`, dans le core
  `nodefony`) et la moderne (`@nodefony/orm-core/.../Orm.ts`, `abstract … implements IOrm`). La 1ʳᵉ ne
  survit QUE parce que Sequelize/Mongoose `extends` elle. C'est exactement ce que le virage tue.
- **Architecture orm-core = SOLIDE et validée** (ADR-0003 clôturé : 4 risques traités sur 3 adapters).
  Le durcissement ne touche PAS au design ; il **retire le legacy** et **aligne les adapters** sur Drizzle.
- État de migration des 3 adapters vers orm-core : **Drizzle 100 %**, **Sequelize hybride** (moderne +
  legacy qui traîne), **Mongoose legacy** (boote encore sur l'ancien `Orm`).
- **Couplage core↔ORM résiduel** = 2 vrais points (legacy `kernel/orm/*` exporté + adapter d'erreur
  nominal dans `Error.ts`) + 1 union de type à généraliser (`config/types.ts`). Tout est nettoyable.
- **Benchmark externe** : le marché 2026 valide les choix Nodefony (Drizzle/anti-magic/SQL natif). Pour
  **les migrations** (encore absentes), le standard prod = **versioned** (Flyway/Liquibase/`drizzle-kit
generate+migrate`) ; reco = déléguer `drizzle-kit` + façade mince `IMigrator` pour Studio.
- **Studio + sondes realtime** (§2bis) : chaîne complète sonde→seam core→montage→realtime→front (~5300 L
  front). La sonde **lean est agnostique** (robuste) ; la suppression Sequelize est **transparente**
  (registry-driven) ; le vrai travail observabilité = **Mongoose-refait réimplémente 4 sondes**
  (`describeEntity`/`describeConnection`/`ping`/tap flux). Dette révélée **C5** : le montage du data
  plane ORM est **déclenché par Drizzle** → à factoriser (`wireOrmAdminPlane`) pour les apps sans Drizzle.

**Verdict** : le chantier est un **retrait de dette + alignement**, pas une refonte. Risque faible,
périmètre net. ~2 080 lignes mortes à supprimer, ~1 250 à réécrire.

---

## 1. Cartographie de l'état actuel

### 1.1 Les 5 briques (mesures réelles `find`/`wc`)

| Brique         | Emplacement                        |                   Taille | Nature                                              | Verdict durcissement       |
| -------------- | ---------------------------------- | -----------------------: | --------------------------------------------------- | -------------------------- |
| **orm-core**   | `src/packages/@nodefony/orm-core`  | 26 fichiers / **2788 L** | Lib pure (contrats + registres + CRUD + data plane) | ✅ **GARDER** (socle)      |
| **drizzle**    | `src/packages/@nodefony/drizzle`   | 15 fichiers / **1723 L** | Module bootable + adapter orm-core                  | ✅ **RÉFÉRENCE**           |
| **sequelize**  | `src/packages/@nodefony/sequelize` | 14 fichiers / **1822 L** | Module + adapter + **service legacy**               | ❌ **SUPPRIMER**           |
| **mongoose**   | `src/packages/@nodefony/mongoose`  | 11 fichiers / **1254 L** | Module **legacy** + adapter orm-core (tests only)   | 🔨 **REFAIRE** sur Drizzle |
| **kernel/orm** | `src/nodefony/src/kernel/orm`      |   3 fichiers / **254 L** | `Orm`/`Connector`/`Entity` **legacy** dans le core  | ❌ **RETIRER du core**     |

### 1.2 ⚠️ Désambiguïsation CAPITALE — deux `Orm`, deux `Entity`

La mémoire `project_orm_hardening_kit` dit « retirer le **Orm core** ». **Attention au piège de nom** :

| Symbole            | Fichier                                          | Rôle                                                                                                                                        | Sort ?                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `Orm` (legacy)     | `src/nodefony/src/kernel/orm/Orm.ts` (88 L)      | `class Orm extends Service` — `entities{}`, `connections{}`, `createConnection()` = **`console.log` vide**                                  | ❌ **OUI** (mort)             |
| `Orm` (moderne)    | `@nodefony/orm-core/nodefony/src/Orm.ts` (122 L) | `abstract class Orm extends Service implements IOrm` — template `connect()`→`onConnect()`, auto-register `ormRegistry`, `connectionMonitor` | ✅ **NON** (c'est le contrat) |
| `Entity` (legacy)  | `src/nodefony/src/kernel/orm/Entity.ts` (88 L)   | ancien binding entité↔connecteur sur events                                                                                                 | ❌ **OUI**                    |
| `Entity` (moderne) | `@nodefony/orm-core/nodefony/src/Entity.ts`      | descripteur `@entity` (registry, schema-as-code)                                                                                            | ✅ **NON**                    |

> **« Retirer le Orm core » = retirer `src/nodefony/src/kernel/orm/{Orm,Connector,Entity}` (le legacy
> DANS le workspace `nodefony`), PAS le package `@nodefony/orm-core`** (qui est précisément la cible).
> Cette confusion de vocabulaire est le principal risque d'erreur du chantier — gravée ici.

Le legacy est exporté par le core : `src/nodefony/src/index.ts:226-228` →
`export { default as Orm/Entity/Connector } from "./kernel/orm/…"`.

### 1.3 État de migration des 3 adapters vers orm-core

Tous les adapters ont une classe `XxxOrm extends Orm(orm-core) implements IOrm` sous
`nodefony/src/orm-core/`. La **différence vit dans le SERVICE bootable** (le point d'entrée du Module) :

| Adapter       | Service bootable (`@services([…])`) | Étend               | Statut migration                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drizzle**   | `DrizzleService`                    | `Service` (moderne) | ✅ **100 % propre** — crée `DrizzleOrm` par connecteur, `queryFlowMonitor`, hooks `onBoot`/`onTerminate`, `Map #orms`. **0 ligne legacy.**                                                                                                                  |
| **Sequelize** | `SequelizeService`                  | `Service` (moderne) | 🟠 **Hybride** — boote moderne (`SequelizeOrm`), MAIS `service/orm.ts` (349 L, `class Sequelize extends Orm` legacy + `ConnectorSequelise extends Connector` legacy + **`@ts-ignore` l.213** + `[key]:any`) **traîne encore** et garde `kernel/orm` vivant. |
| **Mongoose**  | `orm` (= `service/orm.ts`)          | `Orm` **legacy**    | 🔴 **Legacy** — `@services([orm])` boote `class Mongoose extends Orm` (kernel/orm). Le `MongooseOrm` (orm-core) **existe mais n'est utilisé qu'en tests**, jamais booté. Le plus en retard des trois.                                                       |

**Conséquence** : `kernel/orm/*` (legacy) est maintenu vivant par **2 consommateurs** —
le `service/orm.ts` de **sequelize** (`Orm`+`Connector`+`Entity`) et celui de **mongoose**
(`Orm`+`Entity`). Supprimer sequelize + refaire mongoose sur `DrizzleService` ⇒ **0 consommateur** ⇒
`kernel/orm` retirable + exports `index.ts:226-228` retirables. **C'est la séquence du virage.**

### 1.4 Couplage core ↔ ORM résiduel (les points à nettoyer)

| #   | Lieu                                                                                        | Nature du couplage                                                                                                                                                                                                     | Sévérité                        | Action                                                                               |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| C1  | `kernel/orm/{Orm,Connector,Entity}` + `index.ts:226-228`                                    | legacy exporté depuis `nodefony`                                                                                                                                                                                       | **bloquante** (objet du virage) | retirer après §2.1/§2.2                                                              |
| C2  | `Error.ts:79-126`                                                                           | `_sequelizeAdapter`/`_mongooseAdapter` + `registerSequelizeAdapter`/`registerMongooseAdapter` — **inversion déjà en place** (l'ORM s'enregistre, le core ne dépend pas) mais **nominal en dur** ; TODO déjà écrit l.79 | moyenne                         | généraliser en **registre `IErrorAdapter`** (clé = nom ORM)                          |
| C3  | `config/types.ts:33-35`                                                                     | union littérale `"@nodefony/drizzle" \| "@nodefony/mongoose" \| "@nodefony/sequelize"`                                                                                                                                 | faible                          | retirer `sequelize` (a minima) ; idéalement ouvrir au registre                       |
| C4  | `Kernel.ts:1626` `get … { return this.options.orm }` + `config/types.ts:217` `orm?: string` | champ ORM générique sur l'AppConfig                                                                                                                                                                                    | faible                          | à auditer (legacy probable) ; conserver si utile au gating `when c.orm?.driver`      |
| C5  | `drizzle/index.ts:40-59` (`onKernelBoot`)                                                   | **montage du data plane ORM + sondes santé déclenché par le module Drizzle** (seam core OK, mais déclencheur couplé)                                                                                                   | moyenne                         | factoriser `wireOrmAdminPlane(kernel)` appelé par chaque service driver — cf §2bis.2 |

> **Bonne nouvelle** : le couplage « dur » est limité à **C1**. `Error.ts` (C2) est déjà conçu pour
> que **le core ne dépende pas de l'ORM** (registre inversé) — il reste à le rendre générique, pas à
> inverser une dépendance. Aucun `import "sequelize"` dans le core.

### 1.5 Câblage applicatif (consommateurs à mettre à jour)

- **`nodefony.config.ts`** : `use("@nodefony/sequelize", { … nodefony-sequelize.db })` **actif** (l.82) →
  à retirer. `"@nodefony/drizzle"` actif (l.101, ORM défaut). `session.handler:"drizzle"` (l.158).
  `use("@nodefony/mongoose", …)` **commenté** (l.212, pas de MongoDB local).
- **Tests/stubs** : `framework` + `http` ont des `vitest.*.config.ts` + `tests/stubs/sequelize.ts` +
  `tests/stubs/mongoose.ts` (externalisation rollup) → MAJ aux deux endroits.
- **Bancs** : `src/modules/mediasoup/tests/integration/orm-mediasoup-sequelize.test.ts` (banc Seq) →
  supprimer ; `orm-mediasoup.test.ts` (Drizzle) conservé. `src/modules/test/nodefony/entity/auditEntity.ts`
  importe `@nodefony/sequelize` → à reporter sur Drizzle ou retirer.
- **peerDeps à retirer avec sequelize** : `sequelize`, `mysql2`, `pg`, `pg-hstore`, `pgtools`,
  `@alt3/sequelize-to-json-schemas`. ⚠️ Vérifier que Drizzle Postgres/MySQL (futur) ne réclame pas
  `pg`/`mysql2` — Drizzle a ses propres drivers, mais le besoin réapparaîtra à l'ajout PG/MySQL.
- **MikroORM** : **aucun code** (module jamais créé). Traces résiduelles en **docs/types seulement**
  (`studio/frontend/src/types/orm.ts`, `orm-core/{CLAUDE,README,docs}`, ADR-0003, MIGRATION_STATUS) →
  nettoyage documentaire (le « 4ᵉ ORM » est officiellement abandonné).

---

## 2. Le socle à garder — `@nodefony/orm-core` (ADR-0003)

Architecture **ports & adapters (hexagonale)**, pattern **Repository** (pas Active Record), pour
**changer d'ORM sans réécrire le métier** (portabilité dans le **temps**, pas dans l'espace).

**Contrats** : `IOrm` (connect/disconnect/getRepository/transaction/**getNativeConnection** + sondes
optionnelles `describeEntity`/`describeConnection`/`ping`/`probe`), `IEntity`, `IRepository<T>`
(+ `Criteria<T>` typé + opérateurs riches `$`-préfixés), `ITransaction`.

**ADR-0003 : 4 risques TRAITÉS sur 3 adapters hétérogènes** (SQL classique / SQL type-safe / NoSQL) :

1. **Abstraction qui fuit** → eager-load portable (`{relations}`) + **trappe native** assumée pour le reste.
2. **Multi-ORM simultané** → YAGNI ; valeur officielle = **swap d'ORM**, pas N ORM concurrents.
3. **Criteria typé vs Drizzle** → `FieldOperators<V>` (`$eq $ne $gt $gte $lt $lte $in $nin $like`),
   détection centralisée `isFieldOperators`, mappé par les 3 (`Op.*` / `$regex` / `eq()/inArray()`).
4. **Repo non tx-aware** → `repo.withTransaction(tx)` (sans CLS/ALS global).

**Data plane Studio déjà livré** (à préserver) : `OrmAdminApi` (`buildOrmGraph`/`toDbml`/`toJsonSchema`),
`/nodefony/orm/api/{orms,entities,entity,graph,counts,connection/health,flow,export}`, sonde lean
cluster `realtime:health.totals.orm` + verdict santé 3 états, `QueryFlowMonitor`, `ConnectionMonitor`,
profiling SQL par `requestId` (ALS). **Ces briques consomment `IOrm` — l'alignement des adapters ne
doit rien y casser** (Mongoose refait devra réimplémenter `describeEntity`/`describeConnection`).

> **Le durcissement ne remet PAS en cause orm-core.** Il supprime le legacy qui le double.

---

## 2bis. Surface d'observabilité — Studio + sondes realtime ORM (chaîne complète)

> Demande explicite : « tu as regardé aussi Studio ? les sondes realtime aussi, il faut tout. »
> Voici la chaîne **de bout en bout** + l'impact du durcissement sur chaque maillon.

### 2bis.1 La chaîne (back sonde → seam core → montage → realtime → front)

```
orm-core (lib pure)                core nodefony (seam)         module driver           realtime               Studio React
─────────────────────              ────────────────────        ─────────────           ────────               ────────────
buildOrmLeanHealth() ┐                                          drizzle/index.ts
buildConnectionHealth│  setOrmHealthProvider(fn)  ◄──────────── onKernelBoot():
buildOrmFlow()       ├─►instanceProbe.ts          setOrmRichProvider(fn) ◄──────         ClusterProbeClient    realtimeHealth.ts
QueryFlowMonitor     │  _ormHealthProvider          registerOrmAdminApi(broker)          .totals.orm (Σ)       (normalize)
ConnectionMonitor    │  _ormRichProvider                                                 .instances[].orm  ──► OrmWidget / OrmOverview
OrmAdminApi (544 L) ─┘  getOrmHealth()────────────────────────────────────────────────► RealtimeAdminApi      OrmWorker / Database
  /nodefony/orm/api/*                                                                     health.orm           ConnectorCard
```

1. **Sondes (orm-core, lib pure)** :
   - `buildOrmLeanHealth.ts` (54 L) — **lean, adapter-AGNOSTIQUE** : lit `ormRegistry.isConnected()` +
     `connectionMonitor` (erreurs/reconnexions) + `queryFlowMonitor` (total/slow/EWMA). **0 ping, 0
     `toSQL()`**, O(N connecteurs). Robuste par construction.
   - `buildConnectionHealth` / `buildOrmFlow` (via `OrmAdminApi`, 544 L) — **riches**, lisent les
     méthodes **optionnelles** d'`IOrm` : `ping?()`, `probe?()`, `describeConnection?()`, `describeEntity?()`.
   - `QueryFlowMonitor` (146 L) + `ConnectionMonitor` (197 L) — compteurs process-wide alimentés par le
     **tap par-requête** de chaque adapter (`DrizzleRepository.#prof`) et par `connect()`/`recordError`.
   - Data plane `OrmAdminApi` : `/nodefony/orm/api/{orms,entities,entity,graph,counts,connection/health,flow,export}`,
     bâti sur `ormRegistry` + `entityRegistry` (registres GLOBAUX) → **couvre tous les ORM présents**.
2. **Seam CORE** (`src/nodefony/src/service/cluster/instanceProbe.ts`) : `setOrmHealthProvider(fn)` /
   `setOrmRichProvider(fn)` + `getOrmHealth()`. **Inversion de dépendance PROPRE** — le core expose des
   setters typés (`IOrmLeanHealth`), l'adapter y branche les fonctions orm-core. **Le core ne dépend
   PAS de orm-core** (0 import). C'est un bon design, à conserver tel quel.
3. **Montage = module Drizzle** (`drizzle/index.ts:40-59`, `onKernelBoot`) : `registerOrmAdminApi(broker)`
   - `setOrmHealthProvider(buildOrmLeanHealth)` + `setOrmRichProvider(...)`. Les fonctions sont GLOBALES
     (itèrent `ormRegistry`) et idempotentes → **couvrent Mongoose aussi**, MAIS **c'est le module Drizzle
     qui déclenche le montage**.
4. **Realtime** (`@nodefony/realtime`) : `instanceProbe` injecte `.orm` (lean) dans le report par worker ;
   `ClusterProbeClient.ts:83-112` agrège `totals.orm` (Σ connectors/query/slow/error/reconnect, **max**
   EWMA) + `instances[].orm` ; `RealtimeAdminApi.ts:60` pose `health.orm` ; `IRealtimeProbe.ts:124`
   documente le champ optionnel (« présent si un driver a branché sa sonde »).
5. **Frontend Studio** (~5300 L sur la surface ORM) : `routes/Database.tsx` (ERD React Flow `@xyflow`),
   `OrmOverview.tsx`, `OrmWorker.tsx` (drill `/nodefony/orm/:pid`), `OrmEntity.tsx`, `routes/orm/ConnectorCard.tsx`,
   `types/orm.ts` (miroir data plane), `utils/{ormFormat,realtimeHealth}.ts`, et **`workspace/widgets/OrmWidget.tsx`**
   (bureau composable : source `channel:"realtime:health"` + `endpoint:/nodefony/realtime/api/health`, drill → `/nodefony/orm`).

### 2bis.2 ⚠️ Couplage critique révélé — le montage dépend de Drizzle (dette C5)

Le data plane ORM **et** les providers de santé ne sont montés **que si le module Drizzle boote**. Les
fonctions sont globales (couvrent tous les ORM), mais le **déclencheur** est Drizzle. Conséquence :

- **App qui charge Drizzle** (cas de l'app dev) → Studio ORM + sondes realtime OK pour **tous** les ORM
  présents (Mongoose inclus). **Pas de régression tant que Drizzle = défaut.**
- **App Mongoose-only** (sans Drizzle) → `registerOrmAdminApi`/`setOrmHealthProvider`/`setOrmRichProvider`
  **jamais appelés** → Studio ORM **muet**, `realtime:health.orm` **absent**. Aujourd'hui masqué (Drizzle
  toujours là), demain réel.

> **Reco durcissement (dette C5)** : extraire un helper `wireOrmAdminPlane(kernel)` (orm-core ou seam
> core) appelé par **chaque service driver** à `onKernelBoot` (idempotent, dernier gagne). Drizzle **et**
> Mongoose-refait l'appellent → l'observabilité ORM **cesse de dépendre de la présence de Drizzle**.

### 2bis.3 Impact du durcissement sur l'observabilité

| Maillon                                  | Suppression Sequelize                                                      | Refonte Mongoose                                                                                 | Retrait kernel/orm                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `buildOrmLeanHealth` (lean/cluster)      | ∅ (registry-driven : `SequelizeOrm` ne s'enregistre plus → disparaît seul) | ✅ **agnostique** — fonctionne dès que `MongooseOrm` est dans `ormRegistry`                      | ∅                                                      |
| ERD / `describeEntity` (`OrmAdminApi`)   | ∅                                                                          | 🔨 **Mongoose-refait DOIT réimplémenter** `describeEntity` (`schema.paths`) sinon colonnes vides | ∅                                                      |
| `connection/health` / `ping` / `probe`   | ∅                                                                          | 🔨 réimplémenter `ping` (`admin().ping`) + `describeConnection`                                  | ∅                                                      |
| Flux ORM (`QueryFlowMonitor`)            | ∅                                                                          | 🔨 câbler le **tap** Mongoose (`connection.set("debug")`) sinon débit = 0                        | ∅                                                      |
| Montage data plane                       | ∅ (Drizzle monte)                                                          | ⚠️ **appliquer dette C5** (Mongoose monte aussi)                                                 | ∅                                                      |
| Front `types/orm.ts` `VENDOR_LABEL`      | retirer `sequelize` (l.51, label mort)                                     | conserver `mongoose`                                                                             | —                                                      |
| Front MikroORM                           | —                                                                          | —                                                                                                | retirer `mikroorm:"MikroORM"` (l.53, jamais de driver) |
| Tests realtime `ClusterProbeClient.test` | ∅ (agnostique)                                                             | ∅                                                                                                | ∅                                                      |

**Lecture** : la suppression Sequelize est **transparente** pour Studio/realtime (tout est
registry/registre-driven — l'adapter sort, ses lignes disparaissent seules). Le **vrai travail** est
sur **Mongoose-refait** : il doit **réimplémenter les 4 sondes adapter-spécifiques** (`describeEntity`,
`describeConnection`, `ping`, tap `flow`) — déjà partiellement présentes dans le `MongooseOrm` orm-core
des tests P5.4, à reprendre. Plus le nettoyage des 2 labels front (`sequelize`, `mikroorm`).

---

## 3. Benchmark externe — comment font les autres

> Demandé explicitement. Il n'existe pas de « RFC IETF » pour les ORM ; les **standards de facto** du
> domaine sont les outils de migration (Flyway/Liquibase) et la norme **ISO/IEC 9075 (SQL)** pour le DDL.

### 3.1 Migrations DB — deux paradigmes

| Paradigme                                  | Principe                                                                                      | Outils                                                                                                         | Source de vérité                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Versioned** (impératif, migration-based) | chaque changement = 1 fichier SQL **versionné**, commité, revu en PR ; on rejoue dans l'ordre | Flyway, Liquibase, Alembic, Rails, **Umzug** (Sequelize), **`drizzle-kit generate`+`migrate`**, Prisma Migrate | rejouer toutes les migrations sur base vide |
| **Declarative** (state-based)              | on déclare l'**état cible**, l'outil **diffe** schéma↔base et calcule le plan                 | **Atlas** (HCL/SQL/**modèle ORM**), Prisma (DSL), **`drizzle-kit push`**                                       | le schéma déclaré                           |

**Consensus prod** : **versioned** (auditable, reviewable, rollback explicite). Le **declarative** sert
au **prototypage** (itération locale rapide) — jamais en prod (drop silencieux, pas d'historique).

### 3.2 Drizzle Kit (l'ORM de référence Nodefony) — le modèle à suivre

- **`push`** = dev/prototypage : applique direct, **0 historique**, peut **drop une colonne
  silencieusement**. → **JAMAIS en prod** (consensus communautaire net).
- **`generate` + `migrate`** = prod : génère des **fichiers SQL versionnés**, **reviewables en PR**,
  câblés dans le pipeline de déploiement. Toujours **relire le SQL** (un rename peut sortir en
  drop+add). Fichiers **éditables** avant `migrate` (data migrations, index custom).
- Reflète exactement le choix Nodefony/Drizzle déjà acté (CLAUDE.md drizzle) : **schema-as-code**, DDL
  dérivé via `getTableConfig()` pour **dev/test**, **prod = `drizzle-kit`**.

### 3.3 Tendances ORM TS 2025-2026 (validation des choix Nodefony)

- **Drizzle monte** sur une « **fatigue des abstractions lourdes / du magic** » : on veut le type-safe
  **sans** masquer le SQL. → conforte « Drizzle par défaut » + trappe `getNativeConnection()`.
- **Prisma 7** (fin 2025) : moteur Rust **supprimé**, client **100 % TypeScript** (fix cold-start
  serverless). Converge vers l'approche TS-pure que Nodefony tient déjà.
- **TypeORM** : Data Mapper + decorators (proche du Repository orm-core) mais **en retrait** sur la
  type-safety. → justifie de **ne pas** copier TypeORM, et l'abandon de MikroORM (même créneau).
- **Atlas** : intéressant car il prend un **modèle ORM** comme source déclarative — compatible
  schema-as-code Drizzle. À garder en **option** future, mais le **versioned reste le défaut prod**.

### 3.4 Ce que Nodefony doit en retenir pour les migrations (encore absentes)

1. **Déléguer le natif** : `drizzle-kit` (Drizzle), pas de moteur de diff maison (Atlas/drizzle-kit
   le font mieux). NoSQL Mongoose = scripts/no-DDL.
2. **Façade `IMigrator` mince** (option A de `project_orm_migrations_flyway`) : unifie l'**état**
   (applied/pending/checksum) pour **Studio** (`/nodefony/orm/api/migrations`, apply **DEV-only**),
   délègue l'exécution au tooling natif par adapter. **Pas** de runner cross-ORM maison (option B).
3. **Modèle versioned** (Flyway-like) : fichiers commitable + table d'historique. C'est ce que
   `drizzle-kit migrate` fait déjà → l'`IMigrator` **lit/orchestre**, ne réinvente pas.
4. Câbler au futur **`nodefony orm:migrate`** (CLI P11) + readyz (un schéma en retard = signal).

---

## 4. Vision du durcissement — plan d'exécution séquencé

> Ordre **impératif** : chaque phase retire un maillon qui débloque la suivante. Une seule session/phase.
> Gates communes : `npm run clean && npm run build` (0 TS), banc adapter Vitest, **`memory.test`** si on
> touche au pipeline session (SessionStorage), runtime serveur dev (route sécurisée + session).

### Phase 1 — Sequelize : SUPPRESSION COMPLÈTE (~1822 L + peerDeps)

- Retirer le workspace `src/packages/@nodefony/sequelize` (package, dist, **6 peerDeps**).
- Retirer `use("@nodefony/sequelize", …)` de `nodefony.config.ts`.
- Retirer les consommateurs : stubs/configs `framework`+`http`, banc `orm-mediasoup-sequelize.test.ts`,
  `modules/test/.../auditEntity.ts` (reporter sur Drizzle ou supprimer), refs docs/MIGRATION_STATUS.
- Lignes P5.7 / P7.1 / P7.3 → **caduques**.
- **Effet de bord clé** : retire 1 des 2 consommateurs de `kernel/orm` (`Connector` n'a plus QUE
  sequelize → mort dès cette phase).

### Phase 2 — Mongoose : REFAIT NEUF sur le modèle Drizzle (~1254 L réécrites)

- Cible = `class MongooseService extends Service` **calqué sur `DrizzleService`** (ctor
  `super(name, module.container, module.notificationsCenter, module.options)` + hooks
  `kernel.once("onBoot"|"onTerminate")` + `Map #orms` + `connectAll`/`disconnectAll`).
- **Supprimer** `service/orm.ts` (`class Mongoose extends Orm` legacy) ; `@services([orm])` →
  `@services([MongooseService])`. Réutiliser/finir le `MongooseOrm` (orm-core) **déjà écrit** (tests P5.4).
- Réimplémenter les sondes data plane (`describeEntity` via `schema.paths`, `describeConnection`, `ping`
  via `admin().ping`) pour ne pas régresser l'ERD/santé Studio.
- `SessionStorage` Mongoose : aligner sur le pattern Drizzle (tolérance shutdown `#repo()→null` si
  `!isConnected()`), résoudre le **TS2345 `ISessionStorage`** (dette commune aux 3 adapters).
- **Observabilité (§2bis.3)** : réimplémenter les **4 sondes adapter-spécifiques** sur le `MongooseOrm`
  refait — `describeEntity` (`schema.paths`), `describeConnection`, `ping` (`admin().ping`), **tap flux**
  (`connection.set("debug")` → `queryFlowMonitor`). Sinon ERD/connecteur/débit Mongoose vides dans Studio.
  Base déjà présente dans le `MongooseOrm` orm-core des tests P5.4 (`describeEntity` notamment) — reprendre.
- **Appliquer la dette C5** : `MongooseService` doit appeler `wireOrmAdminPlane(kernel)` à `onKernelBoot`
  (idempotent) → l'app Mongoose-only garde Studio ORM même sans Drizzle.
- Lignes P5.8 / P7.2 / P7.5 → **refaites**. P5.10 (User cross-ORM) → recadrer Drizzle + Mongoose.

### Phase 3 — `kernel/orm` legacy : RETIRER du core (~254 L)

- Plus aucun consommateur après Ph.1+2 → supprimer `src/nodefony/src/kernel/orm/{Orm,Connector,Entity}`.
- Retirer les exports `src/nodefony/src/index.ts:226-228`.
- Auditer `Kernel.ts:1626` (`this.options.orm`) + l'import éventuel ; retirer si orphelin.
- **Principe acté** : _le core ne connaît pas l'ORM_ (Drizzle l'a déjà prouvé via `extends Service`).

### Phase 4 — Nettoyage du couplage core (C2/C3/C4)

- **`Error.ts`** : remplacer `_sequelizeAdapter`/`_mongooseAdapter` par un **registre `IErrorAdapter`**
  générique (`Map<ormName, IErrorAdapter>`), `registerOrmErrorAdapter(name, adapter)` ; chaque adapter
  s'enregistre au boot (Drizzle inclus). Tue le TODO l.79 + le nominal en dur.
- **`config/types.ts`** : retirer `"@nodefony/sequelize"` de l'union ; décider si on ouvre au registre
  de modules ou on garde une union (drizzle/mongoose).
- **Dette C5 — factoriser le montage data plane** : extraire `wireOrmAdminPlane(kernel)` (helper
  orm-core ou seam core) = `registerOrmAdminApi` + `setOrmHealthProvider(buildOrmLeanHealth)` +
  `setOrmRichProvider(...)`, appelé par **Drizzle ET Mongoose-refait** (idempotent). Découple
  l'observabilité ORM de la présence de Drizzle (cf §2bis.2).
- **Front Studio** : `types/orm.ts` `VENDOR_LABEL` → retirer `sequelize` (l.51) + `mikroorm` (l.53).
- Nettoyage **documentaire** MikroORM (types Studio + ADR/docs).

### Dette transverse (à traiter dans la vague)

- **`counts` sync = footgun** → async/timeout/circuit-breaker (boussole `project_hardening_before_p6` #4).
- **TS2345 `SessionStorage`** (warning build, 3 adapters) → typer `SessionStorageCtor` proprement.
- **PK figée à `id`** (`DrizzleOrm.#resolveOne` localKey/targetKey en dur) → lever pour PK arbitraires
  (finding banc mediasoup).
- **Bancs ORM** : déjà Vitest (2026-05-28) ; vérifier l'**exécution réelle** post-suppression sequelize.

### Après le durcissement

→ **API souveraine** (POC : 1 service → N surfaces REST+WS+GraphQL via `ResourceController`,
`AbstractRestController<T>` + `buildCrudResolvers`, cf `project_crud_pattern_decision` /
`project_graphql_design`) → **P6 Security** (le firewall se greffe sur des fondations ORM saines).
**Migrations** (`IMigrator` + `drizzle-kit`, §3.4) = chantier séparé connecté à la CLI P11 + Studio.

---

## 5. Ordre recommandé (chemin critique)

```
Ph.1 Sequelize OUT ──┐
                     ├─► Ph.3 kernel/orm OUT ──► Ph.4 nettoyage couplage ──► API souveraine ──► P6
Ph.2 Mongoose REFAIT ┘
```

Ph.1 et Ph.2 sont **parallélisables** (modules indépendants) mais **Ph.3 exige les deux finies**
(0 consommateur de `kernel/orm`). Ph.4 après Ph.3. Migrations = hors chemin critique (connecté plus tard).

**Une session = une phase** (règle projet). Commit à chaque phase verte. `memory.test` obligatoire dès
qu'on touche `SessionStorage`/pipeline session.

---

## Sources externes

- [Drizzle ORM — Migrations](https://orm.drizzle.team/docs/migrations) · [Kit overview](https://orm.drizzle.team/docs/kit-overview) · [push](https://orm.drizzle.team/docs/drizzle-kit-push)
- [Atlas — Declarative vs Versioned](https://atlasgo.io/concepts/declarative-vs-versioned) · [Atlas vs Flyway/Liquibase/ORMs](https://atlasgo.io/atlas-vs-others)
- [Bytebase — Database as Code landscape](https://www.bytebase.com/blog/database-as-code-landscape/) · [Top TypeScript ORM](https://www.bytebase.com/blog/top-typescript-orm/)
- [TheDataGuy — Node.js ORMs in 2025 (Prisma/Drizzle/TypeORM)](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/)
- [Codelit — Database Migration Tools Compared](https://codelit.io/blog/database-migration-tools-comparison)

## Sources internes

- `docs/adr/0003-orm-core-abstraction-repository-multi-orm.md` (architecture, 4 risques)
- Mémoires IA : `project_orm_hardening_kit`, `project_decisions_p5_p6_orm`, `project_orm_default_positioning`,
  `project_crud_pattern_decision`, `project_graphql_design`, `project_orm_migrations_flyway`,
  `project_studio_orm_panel`, `project_orm_flow_probe`, `project_mediasoup_test_db`, `feedback_orm_default_first`.
- `docs/migration/AUDIT-verite-2026-06.md` (P5/P7), `MIGRATION_STATUS.md`.
