# MEMORY.md — @nodefony/ai

> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

La boîte à outils IA de Nodefony : serveur MCP, puis les services de la couche agentique

## Core Components

| Symbole           | Fichier                                 | Rôle                                                  |
| ----------------- | --------------------------------------- | ----------------------------------------------------- |
| `Ai`              | `index.ts`                              | classe Module — déclare `@services`, valide la config |
| `McpService`      | `nodefony/service/McpService.ts`        | service injectable, clé conteneur `mcp`               |
| `mcpConfigSchema` | `nodefony/config/config.ts`             | schéma `mcp.*` — SOURCE UNIQUE, importé par devkit    |
| `aiConfigSchema`  | `nodefony/config/config.ts`             | schéma Zod = source unique des défauts                |
| `defineAiConfig`  | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot                                |
| `AiError`         | `nodefony/src/errors/AiError.ts`        | erreurs typées du module                              |

## Config

- Surcharge par l'app : `use("@nodefony/ai", { … })` dans son `nodefony.config.ts`.
- Surcharge par l'environnement : `NF__AI__<CHEMIN>`.
- Défauts matérialisés par `aiConfigSchema.parse({})` — ne jamais les retaper.

## Behaviors

- `onKernelRegister` valide la config et réassigne `this.options` AVANT que les
  `@services` ne soient instanciés (`onBoot`).

## Gotchas

- La clé de CONTENEUR (`super("mcp", …)`) n'est pas le nom de la CLASSE :
  `container.get("mcp")`, `@inject("McpService")`.
- `@nodefony/devkit` étend `mcpConfigSchema` de `tools` (son allowlist) : le schéma de la porte n'existe qu'ici.
- Ne jamais déréférencer le Kernel au top-level d'un fichier chargé à l'import
  (`Nodefony.getKernel()` rend `null` avant le boot) — passer par un getter.
