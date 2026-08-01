# CLAUDE.md — @nodefony/devkit

> Fiche d'INSTRUCTIONS pour une IA qui va coder dans ce paquet. À lire AVANT
> d'éditer. Compléments : [`MEMORY.md`](./MEMORY.md) (internals, gotchas),
> [`README.md`](./README.md) (usage humain), [`AGENTS.md`](./AGENTS.md)
> (contexte agent, standard « le plus proche gagne »).

## Rôle du module

La carte de visite d'une application et les portes qui mènent au reste. Module
`policy: "dev"` — il aide pendant le développement et n'existe pas en production.

## Structure

```
devkit/
├── index.ts                                      ← classe Module + @services + @controllers + exports
├── nodefony/
│   ├── config/{config.ts,defineModuleConfig.ts}  ← schéma Zod (source unique) + builder
│   ├── src/card.ts                               ← construction de la carte : fonction PURE
│   ├── service/DevkitService.ts                  ← dérive la carte du Kernel
│   ├── controllers/DevkitController.ts           ← porte HTTP
│   ├── command/CardCommand.ts                    ← porte CLI (`devkit:card`)
│   ├── interfaces/IDevkitService.ts              ← contrat public
│   └── src/errors/DevkitError.ts                 ← erreurs typées
├── tests/                                        ← vitest
└── docs/                                         ← doc du module (surfacée dans Studio)
```

## Décisions figées

- **Rien n'est stocké, tout est DÉRIVÉ.** La carte se recalcule à chaque lecture
  depuis l'état du Kernel. Un cache mentirait au premier module ajouté — et un
  outil de découverte qui ment coûte plus cher que pas d'outil du tout.
- **La composition de la carte est PURE** (`src/card.ts`) : elle reçoit son état,
  elle ne le lit pas. C'est ce qui la rend éprouvable sans Kernel ni serveur, et
  ce qui garantit qu'elle ne peut rien inventer. Une porte de plus se branche
  dessus, jamais sur le service.
- **Aucune garde `@IsGranted`** sur le controller : ce serait imposer
  `@nodefony/security` à toute application qui installe le devkit. C'est la
  `policy` qui protège, pas un rôle.
- **Ce module ne porte NI scaffold NI diagnostic** — `create`, `check` et
  `inspect` vivent dans le cœur : ils doivent répondre sans qu'aucun module soit
  installé, et quand l'application est cassée.
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
- Faire dépendre ce module d'un fournisseur de modèle (LLM) : son intérêt est de
  servir l'agent que l'utilisateur a DÉJÀ.
- Y déplacer une capacité qui doit marcher **sans installation** ou **application
  cassée** — sa place est le cœur.

## Tests / build

```bash
npm test        # vitest run
npm run build   # rolldown + déclarations .d.ts
npm run typecheck
```
