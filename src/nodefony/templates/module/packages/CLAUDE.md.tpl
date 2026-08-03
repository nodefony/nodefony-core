# CLAUDE.md — <%= it.pkgName %>


> Fiche d'INSTRUCTIONS pour une IA qui va coder dans ce paquet. À lire AVANT
> d'éditer. Compléments : [`MEMORY.md`](./MEMORY.md) (internals, gotchas),
> [`README.md`](./README.md) (usage humain), [`AGENTS.md`](./AGENTS.md)
> (contexte agent, standard « le plus proche gagne »).

## Rôle du module

<%= it.description %>


## Structure

```
<%= it.name %>/
├── index.ts                                   ← classe Module + @services + re-exports publics
├── nodefony/
│   ├── config/{config.ts,defineModuleConfig.ts}  ← schéma Zod (source unique) + builder
│   ├── service/<%= it.pascal %>Service.ts        ← service injectable
│   ├── interfaces/I<%= it.pascal %>Service.ts    ← contrat public
│   └── src/errors/<%= it.pascal %>Error.ts       ← erreurs typées
├── tests/                                      ← vitest
└── docs/                                       ← doc du module (surfacée dans Studio)
```

## Décisions figées

- **Paquet PUBLIABLE** : `exports`/`types` pointent vers du GÉNÉRÉ (`dist/`,
  `dist/types/`) — jamais un `.d.ts` écrit à la main. `files` borne ce qui part
  sur npm.
- **Config Zod** : `config/config.ts` est la SOURCE UNIQUE (type + validation +
  défaut + doc). Un défaut ne se retape nulle part ailleurs. Validée au boot
  (`onKernelRegister`) → plante propre, jamais un `undefined.x` silencieux.
- **TypeScript strict** — zéro `any`, zéro `@ts-ignore`, ESM seul, imports Node
  préfixés `node:`, interfaces préfixées `I`.

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rolldown.config.ts` / `tsconfig*.json`.
- Retaper un défaut de config ailleurs que dans le schéma Zod.
- Ajouter une dépendance runtime sans peser son coût (taille + mémoire).

## Tests / build

```bash
npm test        # vitest run
npm run build   # rolldown + déclarations .d.ts
npm run typecheck
```
