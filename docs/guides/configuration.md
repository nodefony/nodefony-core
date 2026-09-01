---
title: "Configurer une application Nodefony (defineConfig)"
navTitle: Configuration
lang: fr
topic: configuration
audience: humain
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/configuration.md"
related: project_config_chantier_defineconfig_kit, project_module_loading_architecture, project_app_config_refonte_chantier, feedback_config_docs
---

# Configurer une application Nodefony

> Modèle `defineConfig` (depuis 2026-06-05). La config d'une app tient dans **un fichier
> racine** auto-documenté, et grandit par **composition** — sans jamais subir le découpage.

📍 [Documentation](../index.md) › [Guides](README.md) › **Configuration**

## Le modèle — un fichier racine, qui grandit par composition

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
- `runtimeEnv` = `NODE_ENV` canonisé ; `appEnv` = axe de déploiement libre (`APP_ENV`/`NF_ENV`).

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

## L'écoute : ports et TLS

`servers` ne porte que des **écarts** ; laissé vide, le framework écoute en 5151 (HTTP) et 5152
(HTTPS, en HTTP/2).

**Un port appartient au DÉPLOIEMENT, pas au code.** En PaaS (Cloud Run, Heroku, Railway) la
plateforme IMPOSE le sien via `PORT` : un port écrit en dur donne un service qui écoute là où
personne n'appelle. D'où la lecture par l'environnement (`NF_PORT`, `NF_PORT_HTTPS`, `PORT`).
En développement, deux applications Nodefony peuvent tourner côte à côte : un port déjà pris
**glisse au suivant** et le décalage est ANNONCÉ (`portPolicy: "auto"`, défaut hors production).
En production et en test, `portPolicy: "strict"` → échec franc plutôt que port surprise.

**HTTPS est actif par défaut, même en développement.** Ce n'est pas du zèle : les API navigateur
modernes exigent un contexte sécurisé — WebRTC/`getUserMedia`, presse-papiers, service workers,
notifications. Un projet démarré en clair découvre le problème le jour où il ajoute la première de
ces fonctionnalités.

Au premier boot, un certificat de développement est généré tout seul : via **mkcert** s'il est
installé (autorité locale de confiance, zéro avertissement navigateur), sinon auto-signé.
Inspection et regénération : `npx nodefony http:certificates`.

En production, deux voies : fournir un vrai certificat, ou **terminer le TLS à l'ingress / au load
balancer** et n'exposer qu'un port en clair — `https: false` dans `servers` (HTTPS et WSS en
héritent tous deux). C'est le cas nominal en cloud.

## La console Studio en production

Studio est déclaré `policy: "dev"` par le scaffold : c'est une surface d'**administration**
(introspection de la config, des sessions, des logs), et elle disparaît de la production.

L'y garder est un choix **assumé**, en deux gestes qui vont ensemble : protéger `/nodefony` par une
zone du firewall, **puis** passer la policy à `"mandatory"`. Un `"optional"` fonctionnerait aussi,
mais dirait moins l'intention — une console d'admin volontairement exposée n'est pas un défaut de
configuration.

La molette `ui` décide de la livraison de l'interface : `"static"` (épinglé par le scaffold) sert
les assets pré-buildés du paquet npm — Studio marche sans rien recompiler. `"auto"` / `"vite"`
feraient passer l'UI Studio (React) par **ton** serveur Vite : utile uniquement pour développer
Studio lui-même, et cela exigerait ses plugins dans **tes** devDependencies — une application
Vue ou Angular n'a pas `@vitejs/plugin-react`.

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
    "@nodefony/x": IXConfigInput; // ⚠️ le type d'ENTRÉE, pas celui de sortie
  }
}
```

⚠️ **Le type d'ENTRÉE** (`z.input` du schéma — tout optionnel), **jamais celui de sortie**
(`z.infer`) : après application des défauts, les champs sont requis. Surcharger une seule clé
obligerait alors l'app à réécrire toute la configuration du module.

**Ce que l'augmentation évite vraiment.** Sans elle, `use()` accepte `Record<string, unknown>` : une
clé **mal orthographiée compile**, puis Zod la retire au boot **sans un mot**. La configuration a
l'air prise en compte, elle ne l'est pas — et rien, ni au build ni au démarrage, ne le signale.
L'augmentation transforme cette panne silencieuse en erreur de compilation :

```typescript
use("@nodefony/redis", { enabledd: false });
//                       ^^^^^^^^ erreur de compilation, au lieu d'un silence au boot
```

Un module tiers qui ne l'applique pas reste **fonctionnel** (jamais bloquant) — il perd simplement ce
filet. **Convention** : tout module qui expose une config publie son type d'entrée et augmente ce
registre. `nodefony create module` le génère déjà : un module neuf naît conforme.

## Réactivité : `hot` vs `boot`

La réactivité n'est **pas** déduite d'un tag posé sur chaque champ : elle vient d'une **liste
explicite**, `configReactivity` (`src/nodefony/src/config/reactivity.ts:27`), interrogée par
`getConfigReactivity(path)`.

- **`hot`** — applicable à chaud. Aujourd'hui **trois chemins exactement** : `log.active`,
  `log.debug`, `log.requestFormat` (le cadre de la « fenêtre d'audit » : élever la verbosité en
  production, sans redémarrer).
- **`boot`** — figé au boot, un changement exige un redémarrage : **tout le reste**, ports,
  `protocol`, liste `modules`, `domain` compris.

Un champ absent de la liste est donc `boot` — c'est le défaut sûr. L'application à chaud se fait par
le data plane `PATCH /nodefony/kernel/api/config/{module}` (`KernelAdminApi.ts:891`), qu'utilise
l'onglet **Configuration** de Studio, lequel badge chaque champ `🔥 à chaud` / `🔒 redémarrage`.

## Cas particulier : la topologie cluster

`nodefony/config/cluster/cluster.config.ts` reste un **fichier séparé, kernel-free** : le process master
le lit **standalone, AVANT de booter le moindre Kernel**, pour décider du nombre de workers. Ne PAS le
mettre dans `nodefony.config.ts`. Override runtime : CLI `--workers` > `NF_WORKERS` > ce fichier.

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
`npm run build` à la racine (le `start.sh` du skill ne rebuilde que le module test en dev).
Voir le skill `nodefony-start-server`.

## Voir la config résolue

L'onglet **Configuration** de Studio (introspection via `z.toJSONSchema`), alimenté par
`GET /nodefony/kernel/api/config` : valeurs effectives (secrets masqués), schéma JSON et
**provenance par champ** (qui a posé la valeur — défaut du module, `nodefony.config.ts`, `NF__*`).

> Il n'existe **pas** de commande `nodefony config:show` : la config résolue se lit par le data
> plane ci-dessus, pas par la CLI.

## Surcharger en déploiement — Docker / variables d'env

> ✅ **Livré** ([ADR-0006](../adr/0006-configuration-unifiee-env-override.md)). Catalogue `env.ts`, override générique `NF__*` et secrets `*_FILE` sont opérationnels : résolus **1× au boot**, validés par le schéma Zod du module (chemin/valeur invalide → boot rejeté, jamais de surcharge silencieuse).

Deux façons d'agir par l'environnement, rôles **distincts** :

- **Catalogue** (`env.ts`, forme `NF_X`) — secrets, choix structurants, défauts à logique, exposés
  **typés** dans `ctx.env`. Expérience **développeur**.
- **Override générique** (forme `NF__<MODULE>__<CHEMIN>`) — surcharge de **n'importe quel** champ d'un
  module, **sans code**, coercée + **validée par le schéma Zod** du module. Expérience **devops**.
- **Override de la config APP** (forme `NF__APP__<CHEMIN>`) — même mécanique, segment réservé `app`
  (jamais un nom de module → 0 collision). Surcharge `domain`, `servers.*`, `log.*`… **validés par le
  Zod app** au resolve. Plus de « comment je surcharge le port / le domaine / le driver de log ? ».

`__` (double underscore) = séparateur de niveau (choix .NET/Docker, sans ambiguïté avec le camelCase) ;
segments **insensibles à la casse**, résolus contre les clés réelles du schéma :

```bash
NF__SECURITY__JWT__ACCESSTTLS=300
NF__HTTP__SERVERS__HTTPS__PORT=8443
NF__SECURITY__CORS__ORIGINS=https://a.com,https://b.com   # CSV → array
NF__APP__DOMAIN=0.0.0.0                                   # config APP (segment réservé `app`)
NF__APP__SERVERS__HTTP__PORT=8080
NF__APP__LOG__DRIVER=file
NF_WEBHOOK_KEY_FILE=/run/secrets/webhook_key             # secret depuis un fichier monté (*_FILE)
```

Une valeur invalide fait **échouer le boot** avec un message nommant la variable (jamais de fallback
silencieux). Un segment mal orthographié (module, app, ou chemin) déclenche un **« vouliez-vous dire
X ? »** façon git, avec les clés disponibles. Non-chevauchement : un champ qui a une variable dédiée au
catalogue n'est pas aussi piloté par `NF__*` (la variable nommée fait foi).

> **Limite assumée pour `NF__APP__*`** : seuls les champs qui ont un **défaut framework** (`domain`,
> `servers.*`, `log.*`) sont surchargeables génériquement. Un champ app **opt-in sans défaut**
> (`domainCheck`, `domainAlias`) doit être déclaré dans `nodefony.config.ts` (ou câblé au catalogue
> `ctx.env`) pour devenir adressable — sinon WARNING + suggestion, jamais de clé fantôme.

## Structure d'un module — une source de vérité (règle d'or)

Chaque module porte sa config dans **un schéma Zod commenté** = la **seule** source de : type
(`z.infer`), validation, **défaut** (`.default()`), doc (`.describe()`) et formulaire Studio
(`z.toJSONSchema`). **Un défaut n'est jamais re-tapé ailleurs.** Forme : `config.ts` (le schéma = QUOI,
lisible) + `defineXConfig.ts` (builder pur = COMMENT, ~15 lignes). **`@nodefony/drizzle` = module de
référence** de cette forme à deux fichiers. Voir
[ADR-0006](../adr/0006-configuration-unifiee-env-override.md) (D1/D2).

## Héritage quand Nodefony est une dépendance

Un projet qui fait `npm i nodefony` a **les mêmes** `nodefony.config.ts` + `env.ts`, **hérite**
automatiquement des défauts du core et de chaque module (deep-merge au boot), n'écrit que ses
**écarts**, et son devops surcharge par `NF__*`/`*_FILE` en Docker — **sans toucher au code** du
projet ni du framework. C'est le modèle Spring Boot starter / Symfony bundle, transposé en TS.

## 📖 Lexique

| Terme               | Ce que c'est                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`defineConfig`**  | La fonction qui compose la configuration de l'application (`defineConfig.ts:178`). Elle ne lit jamais l'environnement — elle assemble.             |
| **`env.ts`**        | Le **seul** endroit qui lit l'environnement. Tout le reste reçoit des valeurs déjà résolues, ce qui rend la configuration testable sans variables. |
| **`use()`**         | Déclarer un module et le configurer **avec ses types** (`use.ts:88`) : une clé mal orthographiée ne compile pas.                                   |
| **Fusion profonde** | Les défauts du cœur et de chaque module servent de socle ; votre fichier n'écrit que les **écarts**.                                               |
| **Provenance**      | D'où vient chaque valeur retenue : défaut, fichier, variable d'environnement. Elle reste consultable après le boot.                                |
| **`hot` / `boot`**  | Une clé est soit relue à chaud, soit figée au démarrage. Confondre les deux fait croire qu'un réglage « ne prend pas ».                            |

## ⚠️ Pièges

- **Une clé qu'un module n'a pas déclarée est retirée en silence.** La validation ne se contente
  pas de refuser l'invalide : elle **écarte l'inconnu**. Une faute de frappe ne lève donc pas
  d'erreur, la valeur disparaît — d'où l'intérêt de passer par `use()`, qui la fait échouer à la
  compilation plutôt qu'au silence.
- **Ne jamais déréférencer le kernel à l'évaluation d'un fichier de configuration.** Il n'existe pas
  encore au moment de l'import : le module devient non importable et non testable. Utilisez un
  accesseur (`get filename() { … }`), résolu à la lecture.
- **Modifier une clé `boot` sans redémarrer ne change rien**, et rien ne le signale. Vérifiez le
  régime de la clé avant de conclure que la configuration est ignorée.
- **En développement, une modification de configuration demande une reconstruction** — la section
  dédiée ci-dessus dit laquelle. Un réglage qui « ne prend pas » vient souvent de là.
- **Les variables d'environnement du framework se préfixent `NF_`.** Les noms génériques
  appartiennent à d'autres outils, et une collision ne se manifeste jamais par une erreur : juste
  par un comportement inexplicable.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée depuis vitest — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (composition) | `nodefony` `defineConfig.test.ts`, `configUse.test.ts`, `configBoot.test.ts` | l'assemblage, le typage par module, ce qui est figé au démarrage |
| Unitaires (environnement) | `nodefony` `defineEnv.test.ts`, `loadEnv.test.ts`, `envOverride.test.ts`, `envExample.test.ts` | la lecture unique de l'environnement, les surcharges `NF__*`, le fichier d'exemple engendré |
| Unitaires (provenance) | `nodefony` `configProvenance.test.ts`, `infra.test.ts`, `podEnvironment.test.ts` | d'où vient chaque valeur retenue, et ce que le pod ajoute |
| Unitaires (par module) | `@nodefony/framework` `config.test.ts`, `configMutation.test.ts` · `@nodefony/http` `httpConfig.test.ts` · `@nodefony/security` `defineSecurityConfig.test.ts` · `@nodefony/realtime` `defineRealtimeConfig.test.ts` | que chaque module valide bien la sienne |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🏛️ **Le concept, et non la recette** :
  [architecture — configuration](../architecture/configuration.md)
- 🗄️ **Déclarer son infrastructure plutôt que huit backends** :
  [`persistence.md`](./persistence.md)
- 🐳 **Surcharger en conteneur** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 🔄 **Le moment où la configuration est lue** :
  [cycle de boot du Kernel](../architecture/cycle-boot-kernel.md)
- 📖 [Lexique général](../lexique.md) du framework.
