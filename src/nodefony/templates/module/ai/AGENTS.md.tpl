# AGENTS.md — <%= it.pkgName %>

> Instructions agent de CE module. Standard AGENTS.md : **le fichier le plus
> proche gagne** — quand tu travailles dans ce dossier, il prime sur celui de
> l'app. Vérité COURANTE, jamais un journal : pas de dates, pas de TODO ni
> d'historique (ça vit dans `git log`) ; un fait périmé se CORRIGE.

## Rôle

<%= it.description %>

## Composants

- `index.ts` — `<%= it.pascal %>Module extends Module`, nom kernel `<%= it.name %>`. Valide sa config à `onKernelRegister`.
<% if (it.service) { %>- `<%= it.pascal %>Service` — `@injectable`, nom `<%= it.name %>`. Se récupère par `container.get("<%= it.name %>")`.
<% } %><% if (it.command) { %>- `<%= it.pascal %>Command` — CLI `nodefony <%= it.name %>:hello`, `kernelEvent: onReady` (zéro serveur).
<% } %>- `nodefony/config/config.ts` — schéma Zod = **source unique des défauts**. `defineModuleConfig.ts` = builder pur (valide et gèle, ne retape jamais une valeur).

## Config

| Clé        | Type      | Défaut                        |
| ---------- | --------- | ----------------------------- |
| `enabled`  | `boolean` | `true`                        |
| `greeting` | `string`  | `"Bonjour de <%= it.name %>"` |

Chargement : `use("<%= it.pkgName %>", { … })` dans le `nodefony.config.ts` de
l'app. Config invalide → boot FATAL, champ nommé.

## Décisions figées

- **La logique vit dans le service**, pas dans les controllers : un controller
  traduit du HTTP/WS, un service est réutilisable (CLI, job, autre module).
- **Jamais `Nodefony.getKernel()` au top-level** d'un fichier chargé à l'import :
  le module deviendrait impossible à importer — donc à tester — sans serveur.
- Workspace npm (`modules/<%= it.name %>/`) : le Kernel charge le module PAR SON
  NOM → il doit rester résolvable (symlink npm workspaces).

## Interdits sans accord

- Modifier `rolldown.config.ts` / `tsconfig.json`.
- Ajouter une dépendance npm runtime sans en peser le coût.
- Allouer par requête ce qui ne sert qu'à une minorité de requêtes (préférer
  `null` + init au premier usage), ou attacher un listener sans prévoir son retrait.

## Gotchas

- Ne pas redéclarer `options` dans le service (la classe `Service` l'assigne via `super()`).
- Ajouter un controller/front : `nodefony create controller|front <nom> --module <%= it.name %>` (câble l'`index.ts` seul).
- Build : `rolldown` → `dist/index.js` (chargé par le Kernel). En dev, le superviseur rebuild tout seul.

## Gates avant commit

```bash
npm run typecheck && npm test && npm run build
```
