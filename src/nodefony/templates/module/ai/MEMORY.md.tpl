# MEMORY.md — <%= it.pkgName %>

> Audience IA. Ultra-concis, mots-clés, zéro prose. Vérité courante — jamais un journal.

## Purpose

<%= it.description %>

## Core Components

- `index.ts` — `<%= it.pascal %>Module extends Module`, nom kernel `<%= it.name %>`. Valide sa config à `onKernelRegister`.
<% if (it.service) { %>- `<%= it.pascal %>Service` — `@injectable`, nom `<%= it.name %>`. `container.get("<%= it.name %>")`.
<% } %><% if (it.command) { %>- `<%= it.pascal %>Command` — CLI `nodefony <%= it.name %>:hello`, `kernelEvent: onReady` (0 serveur).
<% } %>- `nodefony/config/config.ts` — schéma Zod = source unique des défauts. `defineModuleConfig.ts` = builder pur.

## Config

| Clé        | Type      | Défaut                        |
| ---------- | --------- | ----------------------------- |
| `enabled`  | `boolean` | `true`                        |
| `greeting` | `string`  | `"Bonjour de <%= it.name %>"` |

Chargement : `use("<%= it.pkgName %>", { … })` dans `nodefony.config.ts`. Config invalide → boot FATAL, champ nommé.

## Behaviors

- Workspace npm (`modules/<%= it.name %>/`) : le Kernel importe le module PAR SON NOM → il doit être résolvable (symlink npm workspaces).
- Build : `rolldown` → `dist/index.js` (chargé par le Kernel). Dev : rebuild automatique par le superviseur.

## Gotchas

- Ne pas redéclarer `options` dans le service (la classe `Service` l'assigne via `super()`).
- Pas de `Nodefony.getKernel()` au top-level d'un fichier chargé à l'import → module intestable.
- Ajouter un controller/front : `nodefony create controller|front <nom> --module <%= it.name %>` (câble l'`index.ts` seul).
