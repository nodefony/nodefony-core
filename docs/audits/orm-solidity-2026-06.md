---
audit: orm-solidity
date: 2026-06-08
status: working
author: Christophe CAMENSULI
scope: orm-core, drizzle, mongoose, kernel/orm (legacy), AbstractCrudService, data plane
tags: [orm, audit, solidite, robustesse, perf, cycle-de-vie, p5, p7, api]
related:
  - docs/audits/orm-state-and-hardening-2026-06.md
  - docs/audits/orm-config-pattern-2026-06.md
  - docs/adr/0003-orm-core-abstraction-repository-multi-orm.md
  - docs/api/README.md
method: confrontation CODE RÉEL ↔ audits existants (lecture + grep), 2026-06-08
---

# Audit ORM — SOLIDITÉ (robustesse + perf + cycle de vie)

> **But** : le user veut une ORM « non pas solide mais **ultra solide** ». L'audit d'état
> (`orm-state-and-hardening`) répond à « QUOI sort / QUOI s'aligne » (dette + legacy). Ce
> document complémentaire répond à « EST-CE ROBUSTE ? » : on confronte chaque brique au **code
> réel** (pas aux audits — qui contiennent eux-mêmes des approximations, cf §0) et on cherche
> les **bugs, edge cases, divergences de portabilité et coûts** qui empêchent de dire « ultra ».
>
> **Règle posée** : on ne code RIEN avant ce point. On attaque Ph.3 (legacy OUT) **après** avoir
> tranché les corrections de contrat CRUD (§1) — sinon elles se propagent à l'API et à P6.

---

## 0. Résumé exécutif (l'image en 12 lignes)

- **L'architecture est SAINE** : contrats (`IOrm`/`IRepository`/`ITransaction`/`Criteria<T>`),
  registres lazy process-wide, monitors observabilité **exemplaires** (lazy alloc, EWMA, rings
  bornés, coût nul OFF), config Zod **symétrique** drizzle↔mongoose. Le durcissement **n'est pas
  une refonte**.
- **Mais « solide » ≠ « ultra solide »** : le **contrat CRUD** porte **2 bugs fonctionnels** (B1
  `update()`, B2 champ inconnu) + **1 risque sécu** (S1 `savepoint`) + des **divergences de
  portabilité** entre adapters qui cassent la promesse « swap d'ORM ». Ces défauts vivent dans le
  chemin le plus utilisé (le CRUD), pas dans les coins exotiques.
- **Ils se propagent vers le haut** : `AbstractCrudService` (la couture vers REST/WS/GraphQL)
  hérite du bug `update()` → event `onUpdated` (audit/cache/Studio) **silencieusement manqué**.
  → corriger le contrat **AVANT** l'API souveraine et P6.
- **Ph.3 (legacy OUT) est débloquée** (0 consommateur vivant) mais c'est une **chaîne de ~8
  points de suture**, pas « supprimer 3 fichiers » (§5).
- **Les audits existants contiennent des approximations** (attendu, le user l'a signalé) : la dette
  « TS2345 `SessionStorage` » est **déjà résolue** ; le couplage Kernel↔ORM legacy est **plus large**
  qu'indiqué (3 méthodes + 1 chaîne `@entities`, pas juste `getOrm`).
- **Redis = hors périmètre ORM** (infra). Le fix de config de la session précédente y est
  **incomplet** (le service lit encore `.redis`) → **sujet séparé** (§4.3), pas dans ce chantier.

**Verdict** : fondations solides, **CRUD à durcir** (contrat + portabilité + sécu) **avant** de
retirer le legacy et d'ouvrir l'API. Risque maîtrisé, périmètre net.

---

## 1. Findings de robustesse — classés par sévérité

> Tous vérifiés dans le code (références `fichier:ligne`). Sévérité = impact × probabilité.

### 🔴 B1 — `update()` renvoie `null` à tort + sémantique pluriel/singulier incohérente

**Les deux adapters.** `DrizzleRepository.update` (`DrizzleRepository.ts:327-338`) fait
`UPDATE … WHERE criteria` **puis** `return this.findOne(criteria)`. `MongooseRepository.update`
(`MongooseRepository.ts:220-231`) fait `updateMany(filter, data)` **puis** `return findOne(criteria)`.

Deux défauts cumulés :

1. **Bug fonctionnel** : si le critère porte sur un champ **modifié par l'update**, le `findOne`
   d'après ne retrouve plus rien → renvoie `null` **alors que l'update a réussi**. Cas typique et
   fréquent : `update({ status: "pending" }, { status: "done" })` → renvoie toujours `null`.
2. **Sémantique contradictoire** : le critère peut matcher **N lignes** (`updateMany` côté Mongo),
   mais le contrat renvoie **une** entité (`T | null`). On modifie plusieurs documents et on en
   retourne un seul, sans ordre garanti.

**Propagation** : `AbstractCrudService.update` (`AbstractCrudService.ts:123-131`) garde
`if (updated !== null) { fire("onUpdated") }` → l'event de cycle de vie **ne part pas** quand B1
frappe → audit / invalidation de cache / push Studio **manqués silencieusement**. Le bug remonte
jusqu'à la couche métier et atteindra **toutes les surfaces API**.

**Correction (à trancher)** : opération **atomique** + contrat clarifié.

- Drizzle : `UPDATE … RETURNING` (supporté par `better-sqlite3`) en **une** requête.
- Mongoose : `findOneAndUpdate(filter, data, { new: true })` (1 doc) ou `updateMany` + relecture par PK.
- **Décision de contrat** : séparer `updateOne(criteria, data): T | null` (atomique, retourne la
  ligne modifiée) de `updateMany(criteria, data): number` (comme `delete`). L'actuel mélange les deux.

### 🔴 B2 — Champ de critère inconnu : comportement **opposé** entre adapters

- **Drizzle** (`DrizzleRepository.ts:184-188`) : `if (!col) continue` → le champ inconnu est
  **ignoré** → le `WHERE` perd une condition → la requête **renvoie plus de lignes que prévu**
  (au pire **toute la table** si c'était le seul critère).
- **Mongoose** (`MongooseRepository.ts:134-138`) : le champ est **conservé** tel quel dans le
  filtre Mongo → **0 résultat**.

Donc `find({ emial: "x@y" })` (typo de `email`) : **toute la table** sous Drizzle, **rien** sous
Mongo. Cela :

- **casse la promesse « swap d'ORM »** (ADR-0003) : le même code donne des résultats opposés ;
- est un **risque de fuite de données** côté Drizzle (un filtre mal typé désactive le filtre) ;
- est **rendu possible par le typage** : `Criteria<T> = { [K in keyof T]?… } & OrmCriteria` —
  l'intersection avec `OrmCriteria` (`Record<string, unknown>`, l'échappatoire, `IRepository.ts:66-68`)
  fait passer **n'importe quelle clé** au compilateur. La type-safety « par champ » est en partie
  illusoire.

**Correction (à trancher)** : politique **unique** sur les 2 adapters pour une clé non résolue —
soit **strict** (throw `UnknownCriteriaField`, recommandé pour « ultra solide » + sécu), soit
**lax documenté** (mais alors identique des deux côtés). Aujourd'hui ce n'est ni l'un ni l'autre.

### 🟠 S1 — `savepoint(name)` interpole le nom dans le SQL (Drizzle)

`DrizzleTransaction.savepoint` (`DrizzleTransaction.ts:59-66`) :
`this.#client.exec(\`SAVEPOINT "${name}"\`)` et `ROLLBACK TO SAVEPOINT "${name}"`. Le `name`du
contrat`ITransaction.savepoint(name: string)` est **arbitraire** et **injecté brut** : les
guillemets ne protègent pas (`a" ; DROP …`). Injection SQL si un nom non contrôlé y arrive.
**Correction** : valider le nom (`^[A-Za-z\_][A-Za-z0-9_]\*$`) ou le quoter proprement. Exigence
RFC/OWASP du projet → blocker sécu même si l'usage actuel est interne.

### 🟠 R1 — Cycle de vie asymétrique : `register` au ctor, **jamais** `unregister`

`Orm` (base) s'enregistre dans `ormRegistry` **au constructeur** (`Orm.ts:44`). Mais
`DrizzleOrm.disconnect`/`MongooseOrm.disconnect` (et `DrizzleService.disconnectAll` /
`MongooseService.disconnectAll`) **ne font jamais** `ormRegistry.unregister(name)`. Conséquences :

- le `ormRegistry` **ne se vide jamais** ; après un `onTerminate`, il contient des ORM
  déconnectés (les sondes les voient `isConnected()===false` — pas faux, mais le registre ment sur
  « ce qui existe ») ;
- **re-boot dans le même process** (tests, hot-reload, certains scénarios cluster) → recréer
  `DrizzleOrm("default")` **throw** « already registered ». La méthode `unregister` **existe**
  (`OrmRegistry.ts:77`) mais n'est câblée nulle part en prod.

**Correction** : `disconnect()` (ou le service) appelle `ormRegistry.unregister(this.name)`. Cycle
symétrique `connect↔register` / `disconnect↔unregister`.

### 🟠 R2 — Transactions imbriquées non gérées (Drizzle)

`DrizzleOrm.transaction` (`DrizzleOrm.ts:224-242`) fait `client.exec("BEGIN")` sans détecter une
transaction déjà ouverte. `better-sqlite3` rejette un 2ᵉ `BEGIN` (« cannot start a transaction
within a transaction »). Un `service.transaction(() => otherService.transaction(...))` casse.
**Correction** : détecter la réentrance → utiliser un `SAVEPOINT` imbriqué, ou documenter +
garde explicite (throw clair `NestedTransactionNotSupported`).

### 🟠 R3 — Idempotence transactionnelle divergente

`DrizzleTransaction.commit/rollback` sont **idempotents** (drapeau `#done`,
`DrizzleTransaction.ts:24,41-56`). `MongooseTransaction.commit/rollback` (`MongooseTransaction.ts:26-33`)
appellent directement `session.commitTransaction()` / `abortTransaction()` **sans garde** — et la tx
Mongoose est déjà **managée** par `session.withTransaction` (`MongooseOrm.ts:204`). Un `tx.commit()`
manuel dans la closure entre en conflit. Comportement non portable entre les deux adapters.
**Correction** : aligner — soit les deux idempotents/no-op en mode managé, soit interdire le commit
manuel des deux côtés.

### 🟡 R4 — Clé primaire figée à `id` (eager-load Drizzle + `findById`)

`DrizzleOrm.#resolveOne` (`DrizzleOrm.ts:120-151`) code `localKey: "id"` / `targetKey: "id"` **en
dur** → l'eager-load casse pour une entité à PK non-`id`. `AbstractCrudService.findById`
(`AbstractCrudService.ts:84-89`) suppose aussi `{ id }`. Convention assumée (UUID `id` string)
mais à **lever** pour les PK arbitraires (finding banc mediasoup). Déjà connu (audit d'état).

### 🟡 R5 — `counts` = footgun synchrone (data plane)

`OrmAdminApi` endpoint `counts` (`OrmAdminApi.ts:462-482`) : `await getRepository(e).count()` en
**boucle séquentielle** sur toutes les entités, **sans** timeout / cache / limite. `COUNT(*)` sur
une grosse table = full scan coûteux ; séquentiel = latence cumulée. Un appel Studio peut peser sur
la prod. **Correction** : timeout + cache court (TTL) + parallélisation bornée, ou estimation
(`sqlite_stat`, `estimatedDocumentCount` Mongo). Déjà sur la boussole `project_hardening_before_p6` #4.

### ✅ Déjà résolu (l'audit d'état est périmé sur ce point)

- **TS2345 `SessionStorage`** : les 2 stores `implements ISessionStorage` **directement** (contrat
  unifié, « plus de cast » — `drizzle/.../SessionStorage.ts:17,176`, idem mongoose). Le warning
  listé en « dette transverse » de l'audit d'état n'existe plus.

---

## 2. Cycle de vie ORM — validé bout en bout

```
Module.onKernelRegister     →  valide config Zod (this.options FLAT) → this.set("<x>Config")
        │
DrizzleService/MongooseService (ctor)  →  kernel.once("onBoot")  +  kernel.once("onTerminate")
        │
onBoot ─► queryFlowMonitor.setEnabled(env≠prod)  ─►  connectAll()
        │        └─ par connecteur : new XxxOrm(name,…)  →  orm.connect()
        │                                                     │ template Orm.connect():
        │                                                     │  t0 → onConnect() (compile entités)
        │                                                     │  connectionMonitor.recordConnect()
        │                                                     │  fire("onOrmReady")   ⚠️ register au CTOR (R1)
usage ─► getRepository(name) [mémoïsé]  →  find/findOne/create/update/delete/count
        │   └─ tap #prof : lit ALS(queries) + queryFlowMonitor.enabled — 0 alloc si les 2 OFF
        │
onTerminate ─► disconnectAll()  →  orm.disconnect()  →  #client.close() / connection.close()
                                     ⚠️ PAS de ormRegistry.unregister (R1)
```

**Maillons sains** : config validée au bon moment (kernel présent), `filename` SQLite résolu au
boot (pas de deref top-level), connexion instrumentée (latence + erreur), repositories mémoïsés
(lazy), fermeture branchée sur `onTerminate`, sonde de flux gatée par environnement.

**Le seul trou du cycle** = **R1** (pas d'`unregister`). Tout le reste est cohérent et symétrique
entre les deux adapters.

---

## 3. Perf — la règle absolue est respectée

- **`QueryFlowMonitor`** (`QueryFlowMonitor.ts`) : `enabled=false` par défaut, `Map` lazy, ring
  `slow` alloué au 1ᵉʳ lent (borné 20), EWMA α=0.2, **`toSQL()` jamais** au cas nominal (uniquement
  chemin lent). Coût nul en prod.
- **`ConnectionMonitor`** (`ConnectionMonitor.ts`) : lazy, rings bornés (12 erreurs / 30 latences),
  aucun coût tant qu'aucune connexion/erreur.
- **Tap `#prof`** (Drizzle + Mongoose) : **deux drapeaux lus avant toute allocation**
  (`RequestContext.get()?.queries` + `queryFlowMonitor.enabled`) → `return exec()` direct si les
  deux sont OFF. Le descripteur Mongoose est un **thunk** (jamais évalué hors observation). SQL
  paramétré + `redactSecrets` (pas de credential).
- **`buildOrmLeanHealth`** : lecture pure des singletons, **0 ping / 0 `toSQL()`**, try/catch par
  connecteur (jamais throw).

**Seul écart perf** = **R5** (`counts` sync). Le hot path CRUD lui-même est propre.

---

## 4. Config de la famille ORM

### 4.1 drizzle + mongoose = sains et symétriques

Même recette Zod : `schema.ts` pur → `defineXConfig` (parse + env + `Object.freeze`) → validé au
`onKernelRegister` (lecture `this.options` **FLAT**) → `this.set("<x>Config")` → service lit le
**container** (`this.module.get("<x>Config")`, jamais `this.options` brut). **`declare module
NodefonyModuleConfig`** présent sur les **deux** (`drizzle/index.ts:36`, `mongoose/index.ts:42`) →
`use()` typé. Connecteur défaut divergent (`default`/`nodefony`) **volontaire** (isolation d'entité
dans le `entityRegistry` process-wide) et documenté.

### 4.2 Double-parse (transverse) — inoffensif côté ORM

`config.ts = schema.parse({})` est passé au ctor du Module, puis re-parsé au `onKernelRegister`
(`defineXConfig(this.options)`). Idempotent pour drizzle/mongoose (pas de détection sur l'input
brut). Coût CPU négligeable au boot. À connaître, pas à corriger pour l'ORM.

### 4.3 Redis — HORS périmètre ORM (sujet infra séparé)

Redis n'est **pas** un ORM (cache / sessions / pub-sub). Mais le fix de config de la session
précédente y est **incomplet** :

- `index.ts:54` corrigé (`this.options` flat) ✅ ;
- **`service/redis.ts:43`** (ctor : `module.options?.redis`) **et `:74`** (`#resolveConfig` fallback :
  `this.module.options?.redis`) lisent **encore** le namespace `.redis` **inexistant** → le service
  est construit avec `{}` et son fallback re-valide depuis vide ;
- le **double-parse** (§4.2) neutralise `applyResilienceDefaults` (`defineRedisConfig.ts:60-72`) :
  la détection « `maxRetries` non surchargé » se fait sur l'**input** qui n'est plus brut (déjà
  parsé à `0`) → le plafond dev (5) **n'est jamais appliqué** → risque de boot qui pend si Redis
  absent (le bug que ce code était censé prévenir).

→ **À traiter dans un chantier infra/session distinct**, pas dans le durcissement ORM.

---

## 5. Verdict Ph.3 (legacy `kernel/orm` OUT) — la chaîne exacte

**Débloquée** : aucun module externe n'importe `kernel/orm` (Sequelize supprimé, Mongoose refait —
grep confirmé). Les 3 fichiers legacy sont **morts** (`Orm.createConnection` = `console.log`,
`Connector.connect` = `console.log("must be override")`).

**Mais ce n'est pas « supprimer 3 fichiers »** : le **core s'auto-référence** via une chaîne
**orpheline mais branchée** (0 consommateur vivant — grep confirmé). Inventaire des points de
suture :

| #   | Lieu                                                            | Nature                                                             |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `src/nodefony/src/kernel/orm/{Orm,Connector,Entity}.ts` (254 L) | les 3 classes legacy                                               |
| 2   | `index.ts:226-228`                                              | exports `Orm` / `Entity` / `Connector`                             |
| 3   | `index.ts:334` + `Kernel.ts:266-269`                            | type `EntityConstructor` (référence `Entity` legacy)               |
| 4   | `Kernel.ts:10,32`                                               | `import Orm` / `import Entity`                                     |
| 5   | `Kernel.ts:1625-1635`                                           | `getOrm()` / `getORM()` / `getOrmStrategy()` (orphelins)           |
| 6   | `Module.ts:6,380,383`                                           | `addEntity(EntityConstructor)` + `loadEntities`                    |
| 7   | `kernel/decorators/kernelDecorator.ts:65,82,89`                 | décorateur `@entities` → `addEntity` (0 module l'utilise)          |
| 8   | `config/types.ts:216` `orm?: string`                            | champ ORM par défaut (gating `when c.orm?.driver`) — décision Ph.4 |

**Tout est orphelin** (vérifié : `getORM`/`getOrmStrategy`/`@entities([…])` = 0 appel hors
définition ; les ORM modernes utilisent `@entity` singulier + `entityRegistry`). Donc retirable
**sans casse**, mais c'est **~8 sutures** à faire dans l'ordre, pas une suppression triviale. La PK
de `@entities`/`addEntity`/`EntityConstructor` est une **seconde chaîne** à démêler en même temps
que `Orm`/`Connector`/`Entity`.

> ⚠️ **Décision avant de couper** : faut-il garder un getter `kernel.orm` (retypé `IOrm` orm-core)
> pour la DX, ou le supprimer franchement (les services exposent déjà `getOrm(name)`) ? Idem
> `config.orm?: string` (utile au gating env, ou mort ?). À trancher avant Ph.3.

---

## 6. Articulation ORM ↔ API (« ne pas refaire »)

**Ce qui EXISTE et est sain** :

- **`AbstractCrudService<T, R>`** (`orm-core`) = la **couture** : service = source de vérité,
  transport-agnostique, lectures en délégation pure (hot path), mutations à hooks template-method
  - events (`onCreated`/`onUpdated`/`onDeleted`). **`UserService` l'étend déjà** (réel, testé).
- Le contrat `IRepository`/`Criteria<T>` est la **surface de projection** sur laquelle REST/GraphQL/WS
  se brancheront.

**Ce qui N'EXISTE PAS encore** (vision `docs/api/README.md`, DRAFT 2026-05-31) : `ResourceController`,
`AbstractRestController<T>`, `buildCrudResolvers` — **aucun code** (grep confirmé). C'est un **POC à
venir**, pas un acquis à préserver.

**Conséquence pour le durcissement** :

1. **Ne pas refaire la couture** : `AbstractCrudService` est la bonne abstraction — les adaptateurs
   API se grefferont dessus sans réécrire la logique.
2. **MAIS corriger B1/B2 AVANT le POC API** : le bug `update()`/`onUpdated` (B1) et la divergence de
   portabilité (B2) sont dans le **contrat** que l'API va projeter. Si on ouvre REST+WS+GraphQL
   d'abord, on **fige les bugs dans 3 surfaces** + les abonnements temps réel ratent les updates.
   Le contrat CRUD doit être **figé et correct** avant d'être multiplexé.

---

## 7. Plan de durcissement révisé (ordre proposé)

```
Ph.2.5  CONTRAT CRUD (NOUVEAU, AVANT legacy) ─ corrige B1 + B2 + S1, aligne R3
   │      (update atomique/contrat clarifié · politique champ inconnu unique · savepoint sûr)
   ▼
Ph.3    legacy kernel/orm OUT ─ démêler la chaîne de 8 sutures (§5) + décisions getter/config.orm
   ▼
Ph.4    couplage core ─ C2 IErrorAdapter générique · C5 wireOrmAdminPlane · R1 unregister · R5 counts
   ▼
API souveraine (POC) ─ adaptateurs REST/WS/GraphQL sur AbstractCrudService (contrat déjà figé)
   ▼
P6 Security ─ firewall sur fondations ORM saines
```

**Nouveauté vs audit d'état** : on **insère une Ph.2.5 « contrat CRUD »** avant le retrait du
legacy. Raison : « ultra solide » se joue sur le **contrat de données**, et ce contrat doit être
correct **avant** d'être figé par le legacy-removal puis multiplexé par l'API. R4 (PK) et R5
(counts) restent en Ph.4 (limites connues, pas bloquantes pour le contrat).

**Décisions à trancher avec le user avant de coder** :

1. **B1** — `updateOne` (atomique, `T|null`) **vs** garder `update` + le rendre atomique (RETURNING /
   findOneAndUpdate) ? Et ajouter `updateMany(): number` ?
2. **B2** — champ inconnu = **strict** (throw, recommandé) **vs** lax identique sur les 2 ?
3. **Ph.3** — garder `kernel.orm` (retypé `IOrm`) **vs** suppression franche ? `config.orm?: string`
   utile au gating **vs** mort ?

---

## Sources

- Code lu : `orm-core/{IOrm,IRepository,ITransaction,Orm,OrmRegistry,EntityRegistry,criteria,
QueryFlowMonitor,ConnectionMonitor,AbstractCrudService,buildOrmLeanHealth,OrmAdminApi}`,
  `drizzle/{DrizzleOrm,DrizzleRepository,DrizzleTransaction,DrizzleService,config/*}`,
  `mongoose/{MongooseOrm,MongooseRepository,MongooseTransaction,MongooseService,config/*}`,
  `nodefony/{Kernel,Module,kernel/orm/*,config/types}`, `redis/{index,service,config/*}`.
- Audits : `orm-state-and-hardening-2026-06.md`, `orm-config-pattern-2026-06.md`. ADR-0003.
- Vision API : `docs/api/README.md` (DRAFT).
