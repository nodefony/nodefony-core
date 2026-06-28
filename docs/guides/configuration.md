---
title: Configurer une application Nodefony (defineConfig)
audience: humain
date: 2026-06-05
related: project_config_chantier_defineconfig_kit, project_module_loading_architecture, project_app_config_refonte_chantier, feedback_config_docs
---

# Configurer une application Nodefony

> Modèle `defineConfig` (depuis 2026-06-05). La config d'une app tient dans **un fichier
> racine** auto-documenté, et grandit par **composition** — sans jamais subir le découpage.

## L'idée en une phrase

**Commencer minuscule comme Vite. Pouvoir grandir structuré. Sans jamais subir le découpage.**

Tout ce que vous n'écrivez pas prend le **défaut du framework** (`defaultAppConfig`, dans le core).
Votre `nodefony.config.ts` ne contient donc QUE vos écarts.

## Vue d'ensemble — comprendre TOUTE la config en 1 minute

La config se lit sur **trois couches**, classées par une **échelle de précédence unique** (le plus bas perd, le plus haut gagne) :

| #   | Couche                 | Qui décide | Où                                                                                 |
| --- | ---------------------- | ---------- | ---------------------------------------------------------------------------------- |
| 1   | **Défaut** (framework) | Nodefony   | schéma Zod du core (`defaultAppConfig`) + de chaque module                         |
| 2   | **Config du projet**   | vous       | `nodefony.config.ts` (vos écarts, par-env via `ctx` ; inclut `ctx.env` = `env.ts`) |
| 3   | **Déploiement**        | le devops  | variables d'env — catalogue `NF_X` + override générique `NF__*` + secrets `*_FILE` |
| 4   | **Invocation**         | la CLI     | flags (`--workers`, …)                                                             |

> **La seule règle à retenir** : ce que vous n'écrivez pas prend le **défaut du framework**. Vous
> n'écrivez que vos **écarts** dans `nodefony.config.ts`. Le déploiement (Docker/k8s) surcharge par
> **variable d'environnement**, sans toucher au code. Studio affiche la **provenance** de chaque valeur.

Décision d'architecture complète : [ADR-0006](../adr/0006-configuration-unifiee-env-override.md).

## Les deux fichiers racine

| Fichier              | Rôle                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `nodefony.config.ts` | La config : `defineConfig((ctx) => …)` + manifeste `modules`                             |
| `env.ts`             | Le catalogue des variables d'environnement (`defineEnv`) — SEUL lecteur de `process.env` |

`index.ts` (racine) importe le descripteur et ré-exporte `env` :

```typescript
import config from "./nodefony.config";
export { env } from "./env";
// … le Module App reçoit `config` via super(...)
```

## `nodefony.config.ts` — l'orchestrateur

```typescript
import { defineConfig, use } from "nodefony";
import type { env } from "./env";

export default defineConfig<typeof env>((ctx) => ({
  domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1", // par-env via ctx
  log: { debug: ctx.isProd ? [] : "*", driver: ctx.env.NF_LOG_DRIVER },
  modules: [
    use(
      "@nodefony/http",
      { trustedHosts: ["localhost"] },
      { policy: "mandatory" },
    ),
    "@nodefony/framework",
    { name: "@nodefony/test", policy: "dev" },
  ],
}));
```

`ctx` est passé au boot : `{ env, appEnv, runtimeEnv, isProd, isDev, isTest }`.

- `env` = le catalogue typé de `env.ts` (`ctx.env.NF_LOG_DRIVER` est auto-complété + documenté en hover).
- `runtimeEnv` = `NODE_ENV` canonisé ; `appEnv` = axe de déploiement libre (`APP_ENV`/`NODEFONY_ENV`).

## `env.ts` — le catalogue d'environnement

```typescript
import { defineEnv, envEnum, envBoolean, envString } from "nodefony";

export const env = defineEnv({
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),
  NF_LOG_FILE_SYNC: envBoolean({ default: false }),
  LOKI_URL: envString({ optional: true }),
});
```

- Une variable **présente mais invalide** (enum hors liste, nombre malformé, requise manquante)
  fait **échouer le boot** avec un message clair nommant la variable — pas de fallback silencieux.
- Une variable **absente** prend le défaut déclaré.
- ⚠️ **`as const`** sur les valeurs d'`envEnum([...])` : sinon l'union littérale (`"stdout" | "file" | "null"`)
  est élargie en `string`, et un champ qui attend l'union (ex. `log.driver`) ne typecheck plus.

## Les 6 recettes (faire grandir la config)

1. **Ajouter un module** → ajouter son nom dans `modules`.
2. **Configurer un module** → `use("@nodefony/security", { firewalls: { … } })`.
3. **Module dev/conditionnel** → `{ name, policy: "dev" }` ou `use(name, config, { when: (c) => … })`.
4. **Réglage par-env** → tester `ctx.isProd` / `ctx.isDev` dans la fonction.
5. **Lire une variable d'env** → la déclarer dans `env.ts`, lire `ctx.env.X` (jamais `process.env`).
6. **Extraire un domaine** quand un bloc grossit → `import { servers } from "./config/servers"` (un CHOIX, pas une obligation).

## Le manifeste `modules`

L'ordre du tableau = **ordre (priorité) de chargement**. Trois formes :

| Forme                                 | Signification                               |
| ------------------------------------- | ------------------------------------------- |
| `"@nodefony/http"`                    | string nue = `{ name, policy: "optional" }` |
| `{ name, policy, when }`              | entrée détaillée (gating)                   |
| `use(name, config, { policy, when })` | entrée + **config colocalisée** du module   |

Policies : `mandatory` (socle, jamais gaté) · `optional` (défaut, gaté par `when`) · `dev` (chargé hors production).
`when(config)` reçoit la config résolue ; `false` → module non chargé (0 coût — en ESM un module non importé n'existe pas).

> Le manifeste **remplace** le décorateur `@modules` (retiré 2026-06-03) et les clés `module-<name>` à la racine.

## Typage par module — `use()` propose les bonnes clés

Pour que `use("@nodefony/x", …)` auto-complète les clés du module x, **le module augmente le registre**
du core (declaration merging, pattern Nuxt/Pinia) :

```typescript
// dans @nodefony/x
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/x": IXConfig;
  }
}
```

Sans augmentation, `use()` accepte quand même la config (`Record<string, unknown>`) — jamais bloquant,
juste moins d'auto-complétion. **Convention** : tout module qui expose une config publie son `IXConfig`
et augmente ce registre (`nodefony-create-module` le scaffolde).

## Réactivité : `hot` vs `boot`

Chaque champ porte un tag TSDoc `@reactivity hot | boot` (visible en hover) :

- **`hot`** : applicable à chaud (futur `Kernel.applyConfigPatch`) — ex. `log.active`, `log.debug`, `log.requestFormat`.
- **`boot`** : figé au boot, un changement exige un redémarrage — ex. ports, `protocol`, liste `modules`, `domain`.

Un champ non classé = `boot` (conservateur). Studio affichera un badge `🔥 à chaud` / `🔒 redémarrage` par champ.

## Cas particulier : la topologie cluster

`nodefony/config/cluster/cluster.config.ts` reste un **fichier séparé, kernel-free** : le process master
le lit **standalone, AVANT de booter le moindre Kernel**, pour décider du nombre de workers. Ne PAS le
mettre dans `nodefony.config.ts`. Override runtime : CLI `--workers` > `NODEFONY_WORKERS` > ce fichier.

## Quand la config est invalide

Le boot **échoue proprement** (il ne peut pas deviner vos ports/modules) : un diagnostic clair
(titre + cause + champ Zod nommé + **valeurs par défaut du framework explicitées**), **sans stack brute**,
et un code de sortie **`EX_CONFIG` (78)** pour que l'orchestrateur distingue « mauvaise config » d'un crash.

```
✖ Configuration de l'application invalide
  La résolution de la configuration (`defineConfig`) a échoué.
  Cause : servers.http.port: Expected number, received string
  …
  Configuration PAR DÉFAUT du framework (appliquée à tout champ omis) :
    • servers = {"statics":true,"http":{"port":5151}, …}
```

## En développement : rebuild après une modif de config

Le boot lit la config depuis le **dist** (`dist/index.js`, `dist/nodefony.config.js`, `dist/env.js`),
pas la source. Après avoir édité `nodefony.config.ts` / `env.ts`, **rebuilder le root** avant de relancer :
`npx rollup -c` à la racine (le `start.sh` du skill ne rebuilde que le module test en dev).
Voir le skill `nodefony-start-server`.

## Voir la config résolue

`nodefony config:show` (CLI) ou l'onglet **Configuration** de Studio (introspection via `z.toJSONSchema`).

## Surcharger en déploiement — Docker / variables d'env

> 🔜 **Cible actée — [ADR-0006](../adr/0006-configuration-unifiee-env-override.md)**, implémentation par slices. Le **catalogue `env.ts` est déjà en place** ; l'override générique `NF__*` et `*_FILE` sont la spec à livrer.

Deux façons d'agir par l'environnement, rôles **distincts** :

- **Catalogue** (`env.ts`, forme `NF_X`) — secrets, choix structurants, défauts à logique, exposés
  **typés** dans `ctx.env`. Expérience **développeur**.
- **Override générique** (forme `NF__<MODULE>__<CHEMIN>`) — surcharge de **n'importe quel** champ d'un
  module, **sans code**, coercée + **validée par le schéma Zod** du module. Expérience **devops**.

`__` (double underscore) = séparateur de niveau (choix .NET/Docker, sans ambiguïté avec le camelCase) ;
segments **insensibles à la casse**, résolus contre les clés réelles du schéma :

```bash
NF__SECURITY__JWT__ACCESSTTLS=300
NF__HTTP__SERVERS__HTTPS__PORT=8443
NF__SECURITY__CORS__ORIGINS=https://a.com,https://b.com   # CSV → array
NF_WEBHOOK_KEY_FILE=/run/secrets/webhook_key             # secret depuis un fichier monté (*_FILE)
```

Une valeur invalide fait **échouer le boot** avec un message nommant la variable (jamais de fallback
silencieux). Non-chevauchement : un champ qui a une variable dédiée au catalogue n'est pas aussi piloté
par `NF__*` (la variable nommée fait foi).

## Structure d'un module — une source de vérité (règle d'or)

Chaque module porte sa config dans **un schéma Zod commenté** = la **seule** source de : type
(`z.infer`), validation, **défaut** (`.default()`), doc (`.describe()`) et formulaire Studio
(`z.toJSONSchema`). **Un défaut n'est jamais re-tapé ailleurs.** Forme : `config.ts` (le schéma = QUOI,
lisible) + `defineXConfig.ts` (builder pur = COMMENT, ~15 lignes). `@nodefony/security` = module de
référence. Voir [ADR-0006](../adr/0006-configuration-unifiee-env-override.md) (D1/D2).

## Héritage quand Nodefony est une dépendance

Un projet qui fait `npm i nodefony` a **les mêmes** `nodefony.config.ts` + `env.ts`, **hérite**
automatiquement des défauts du core et de chaque module (deep-merge au boot), n'écrit que ses
**écarts**, et son devops surcharge par `NF__*`/`*_FILE` en Docker — **sans toucher au code** du
projet ni du framework. C'est le modèle Spring Boot starter / Symfony bundle, transposé en TS.

## Voir aussi

- `CLAUDE.md` racine § « Configuration de l'APPLICATION — `defineConfig` » (règles figées).
- Skill `nodefony-framework-dev` § « Config de l'APPLICATION ».
- Architecture du chargement de modules : mémoire IA `project_module_loading_architecture`.
