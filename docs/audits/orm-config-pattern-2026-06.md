---
title: Audit — logique de configuration des modules ORM
audience: humain + IA
date: 2026-06-08
related: project_orm_audit_state, project_orm_hardening_kit, feedback_config_validation_zod, feedback_config_docs
status: audit
---

# Audit — logique de config ORM (et pattern config transverse)

> Déclencheur : la refonte Mongoose (Ph.2) a rendu **mongoose** Zod-moderne alors que
> **drizzle** reste en config legacy → incohérence dans la **famille ORM**. Objectif : une
> logique de config **propre et identique entre ORM**, posée sur le pattern config transverse.

## 0. Cadrage — deux couches à NE PAS confondre

| Couche                           | Périmètre                                                         | Membres                                                            |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A. Pattern config transverse** | Comment TOUT module porte/valide sa config (Zod + builder + boot) | http, framework, realtime, **redis**, security, documentation, ORM |
| **B. Logique config ORM**        | Ce qui est SPÉCIFIQUE à la famille ORM (connecteurs, session…)    | **drizzle (SQL)** + **mongoose (NoSQL)** uniquement                |

> ⚠️ **Redis n'est PAS un ORM** — c'est un module d'**infra** (connexions génériques :
> cache/sessions/pub-sub). Il sert ici de **référence du pattern A**, rien de plus. Il
> n'appartient PAS à la couche B.

---

## 1. La vérité terrain — comment la config arrive au module

`use("@nodefony/x", cfg)` (`src/nodefony/src/config/use.ts`) construit `{ name, config: cfg }`.
Au boot, le Kernel **deep-merge `cfg` À PLAT dans `mod.options`** :

```ts
// src/nodefony/src/kernel/Kernel.ts:948-953
if (entry.config) {
  mod.options = extend(true, {}, mod.options, entry.config);
}
```

**Conséquence : `this.options` d'un module est FLAT** — les clés de la config (`debug`,
`connectors`, …) sont au **top-level** de `this.options`. Pas de namespace sous le nom du module.

### 🐞 Bug latent détecté — redis lit un namespace inexistant

`@nodefony/redis` valide `defineRedisConfig(this.options?.redis ?? {})` → la clé `this.options.redis`
**n'existe pas** (la config est à plat) → redis valide **`{}`** = **défauts seuls** → **toute config
app passée via `use("@nodefony/redis", …)` est IGNORÉE silencieusement.** `realtime` et `mongoose`
lisent `this.options` (flat) = **correct**. → **À corriger** : redis `this.options?.redis` → `this.options`.

---

## 2. Couche A — pattern config transverse (le standard)

Recette canonique (réf `@nodefony/realtime`, `@nodefony/redis`, doc `docs/guides/configuration.md`) :

| Élément                           | Rôle                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `nodefony/config/schema.ts`       | Zod, **PUR** (0 `process.env`, 0 deref kernel). `.describe()` par champ. `z.infer` = type. |
| `nodefony/config/defineX.ts`      | builder : `schema.parse()` + surcharge **ENV** + `Object.freeze` + `xConfigJsonSchema()`.  |
| `nodefony/interfaces/IXConfig.ts` | `IXConfig = z.infer`, `IXConfigInput = z.input`. Jamais de champ écrit à la main.          |
| `nodefony/config/config.ts`       | défauts = `schema.parse({})`.                                                              |
| `index.ts` `onKernelRegister`     | valide `this.options` (FLAT) → `this.set("xConfig", validated)`.                           |
| `index.ts` `declare module`       | augmente `NodefonyModuleConfig` → `use("@nodefony/x", …)` typé.                            |
| service                           | lit la config validée via `this.module.get("xConfig")` (PAS `this.options` brut).          |

### État par module (couche A)

| Module        | schema.ts | defineX | valide onKernelRegister |   lit options   | `declare module` | Verdict             |
| ------------- | :-------: | :-----: | :---------------------: | :-------------: | :--------------: | ------------------- |
| http          |    ✅     |   ✅    |           ✅            |      flat       |        ❌        | OK (augment manque) |
| realtime      |    ✅     |   ✅    |           ✅            |   **flat ✅**   |        ❌        | OK (réf flat)       |
| redis (infra) |    ✅     |   ✅    |           ✅            | **`.redis` 🐞** |        ❌        | **bug namespace**   |
| security      |    ❌     |   ✅    |            ~            |        —        |        ❌        | define sans schema  |
| documentation |    ✅     |   ✅    |           ✅            |      flat       |        ❌        | OK                  |
| **mongoose**  |  **✅**   | **✅**  |       **✅ flat**       |    **flat**     |      **✅**      | **complet (réf)**   |
| **drizzle**   |  **❌**   | **❌**  |         **❌**          |  **flat brut**  |      **❌**      | **legacy**          |

> **Personne n'augmente `NodefonyModuleConfig`** aujourd'hui — mongoose est le **1ᵉʳ** à le faire
> (le pattern est documenté `configuration.md` mais jamais appliqué). À généraliser.

---

## 3. Couche B — logique config ORM (drizzle ↔ mongoose)

Ce qui doit être **identique entre les 2 ORM** (au-delà du pattern A) :

| Aspect                      | drizzle (SQL)                            | mongoose (NoSQL)                         | Cohérence cible            |
| --------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------------- |
| Modèle de connexions        | `connectors: Record<string, …>`          | `connectors: Record<string, …>`          | ✅ **déjà identique**      |
| ConnectorConfig             | `{ filename? }`                          | `{ uri? \| host/port/dbname, options? }` | driver-spécifique (OK)     |
| Connecteur par défaut       | **`default`**                            | **`nodefony`**                           | ⚠️ noms divergents (§3.1)  |
| `SESSION_ORM`               | `"default"`                              | `"nodefony"`                             | = nom du connecteur défaut |
| ORM → `ormRegistry`         | 1 `DrizzleOrm`/connecteur au `onBoot`    | 1 `MongooseOrm`/connecteur au `onBoot`   | ✅ identique               |
| SessionStorage              | auto-register `"drizzle"`                | auto-register `"mongoose"`               | ✅ identique (IoC)         |
| Sondes (describe/ping/flow) | ✅                                       | ✅ (Ph.2)                                | ✅ identique               |
| **Config style**            | **legacy (interface + getter lazy)**     | **Zod complet**                          | ❌ **à aligner (drizzle)** |
| `critical`                  | (défaut true — SQLite local toujours là) | **false** (Mongo externe, opt-in)        | divergence **assumée**     |

### 3.1 Décision — nom du connecteur par défaut

Les noms divergent (`default` vs `nodefony`) **volontairement** : l'entité `session` est enregistrée
dans le `entityRegistry` **process-wide** sous `(orm, name)`. Si les 2 modules cohabitent avec le
**même** nom de connecteur, on aurait **deux** entités `session` pour le même `orm` → collision
(`MongooseOrm` compilerait la table Drizzle). Noms distincts = isolation garantie.
→ **Garder distinct, mais documenter explicitement** (gotcha non évident).

### 3.2 Le point dur — défaut dépendant du kernel (drizzle `filename`)

`drizzle/config.ts` a un **getter lazy** `filename` qui déréf `Nodefony.getKernel().path` (le fichier
SQLite vit sous `<app>/nodefony/databases/`). Un schéma Zod **pur** ne peut PAS porter ce défaut
(le kernel n'existe pas à l'évaluation du schéma). **Solution** (préserve la pureté du schéma) :

- `filename` **optionnel** dans le schéma (pas de défaut kernel-dépendant) ;
- la **résolution du chemin réel** se fait dans `DrizzleService.connectAll()` (au `onBoot`, kernel
  présent) : `filename ??= path.resolve(kernel.path, "nodefony/databases", "<connector>.db")`.

→ schéma pur + défaut résolu au bon moment. Même esprit que la règle « jamais de deref kernel au
top-level » du `CLAUDE.md`.

---

## 4. Plan d'alignement

1. **Drizzle → Zod** (couche A) : créer `schema.ts` (pur, `filename` optionnel) + `defineDrizzleConfig.ts`
   - `interfaces/IDrizzleConfig.ts` + `config.ts = parse({})` + `onKernelRegister` (valide `this.options`
     flat → `this.set("drizzleConfig")`) + `declare module` augment + `critical` (laisser défaut). Résoudre
     le chemin SQLite dans `DrizzleService` (§3.2). Ajouter `zod` (dep + external rollup). Test config unit.
2. **Fix redis** (couche A, bug) : `this.options?.redis` → `this.options` (1 ligne ; sinon config app ignorée).
3. **Mongoose** : déjà conforme (référence ORM Zod). Rien à refaire.
4. **Généraliser `declare module`** (couche A) : ajouter l'augmentation à http/realtime/redis/documentation
   (chacun publie son `IXConfigInput`). Hors chemin critique ORM — backlog.
5. **Documenter la couche B** : section « config ORM » dans le guide + gotcha connecteur défaut (§3.1).

### Périmètre proposé (cette session)

- **Faire** : #2 (fix redis, 1 ligne) + #1 (drizzle → Zod) → les 2 ORM identiques + redis correct.
- **Backlog** : #4 (augment générale), #5 (doc couche B).

---

## 5. Cible — « config ORM propre » en une phrase

> Les **deux** ORM (drizzle, mongoose) portent leur config en **Zod pur** (schema → builder → freeze),
> la **valident au boot** (`onKernelRegister`, lecture `this.options` FLAT), l'**exposent** au service
> via le container (`this.set("<orm>Config")`), **augmentent** `NodefonyModuleConfig` pour le typage
> de `use()`, et partagent le **même modèle de connecteurs** (`connectors: Record<string, …>`). Le seul
> écart légitime : le **driver** (filename SQL vs uri Mongo) et le **nom du connecteur défaut** (isolation
> d'entité). Redis reste **hors famille ORM** (infra), mais doit suivre le **même pattern config** (et son
> bug de namespace est corrigé).
