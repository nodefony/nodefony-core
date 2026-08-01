# MEMORY.md — <%= it.pkgName %>


> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

<%= it.description %>


## Core Components

| Symbole | Fichier | Rôle |
| --- | --- | --- |
| `<%= it.pascal %>` | `index.ts` | classe Module — déclare `@services`, valide la config |
| `<%= it.pascal %>Service` | `nodefony/service/<%= it.pascal %>Service.ts` | service injectable, clé conteneur `<%= it.name %>` |
| `<%= it.camel %>ConfigSchema` | `nodefony/config/config.ts` | schéma Zod = source unique des défauts |
| `define<%= it.pascal %>Config` | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot |
| `<%= it.pascal %>Error` | `nodefony/src/errors/<%= it.pascal %>Error.ts` | erreurs typées du module |

## Config

- Surcharge par l'app : `use("<%= it.pkgName %>", { … })` dans son `nodefony.config.ts`.
- Surcharge par l'environnement : `NF__<%= it.upper %>__<CHEMIN>`.
- Défauts matérialisés par `<%= it.camel %>ConfigSchema.parse({})` — ne jamais les retaper.

## Behaviors

- `onKernelRegister` valide la config et réassigne `this.options` AVANT que les
  `@services` ne soient instanciés (`onBoot`).

## Gotchas

- La clé de CONTENEUR (`super("<%= it.name %>", …)`) n'est pas le nom de la CLASSE :
  `container.get("<%= it.name %>")`.
- Ne jamais déréférencer le Kernel au top-level d'un fichier chargé à l'import
  (`Nodefony.getKernel()` rend `null` avant le boot) — passer par un getter.
