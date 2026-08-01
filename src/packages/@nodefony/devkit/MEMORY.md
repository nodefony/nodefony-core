# MEMORY.md — @nodefony/devkit

> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

Outillage de developpement d une application Nodefony : carte de visite et portes de decouverte pour un agent

## Core Components

| Symbole              | Fichier                                 | Rôle                                                  |
| -------------------- | --------------------------------------- | ----------------------------------------------------- |
| `Devkit`             | `index.ts`                              | classe Module — déclare `@services`, valide la config |
| `DevkitService`      | `nodefony/service/DevkitService.ts`     | service injectable, clé conteneur `devkit`            |
| `devkitConfigSchema` | `nodefony/config/config.ts`             | schéma Zod = source unique des défauts                |
| `defineDevkitConfig` | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot                                |
| `DevkitError`        | `nodefony/src/errors/DevkitError.ts`    | erreurs typées du module                              |

## Config

- Surcharge par l'app : `use("@nodefony/devkit", { … })` dans son `nodefony.config.ts`.
- Surcharge par l'environnement : `NF__DEVKIT__<CHEMIN>`.
- Défauts matérialisés par `devkitConfigSchema.parse({})` — ne jamais les retaper.

## Behaviors

- `onKernelRegister` valide la config et réassigne `this.options` AVANT que les
  `@services` ne soient instanciés (`onBoot`).

## Gotchas

- La clé de CONTENEUR (`super("devkit", …)`) n'est pas le nom de la CLASSE :
  `container.get("devkit")`.
- Ne jamais déréférencer le Kernel au top-level d'un fichier chargé à l'import
  (`Nodefony.getKernel()` rend `null` avant le boot) — passer par un getter.
