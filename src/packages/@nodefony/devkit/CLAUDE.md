# CLAUDE.md — @nodefony/devkit

> Fiche d'INSTRUCTIONS pour une IA qui va coder dans ce paquet. À lire AVANT
> d'éditer. Compléments : [`MEMORY.md`](./MEMORY.md) (internals, gotchas),
> [`README.md`](./README.md) (usage humain), [`AGENTS.md`](./AGENTS.md)
> (contexte agent, standard « le plus proche gagne »).

## Rôle du module

Trois choses : la porte **HTTP** de la carte de visite d'une application, **le
CONTENU des skills d'agent** distribués par npm (`skills/`), et le **serveur
MCP** de l'application (`POST /nodefony/mcp`). Module `policy: "dev"` — il aide
pendant le développement et n'existe pas en production.

⚠️ **La porte CLI n'est PLUS ici.** `nodefony card` est servie par le cœur
(fast-path standalone, `CliKernel.start` → `cli/card.ts`), qui ne lit que des
fichiers. C'est l'application de la règle ci-dessous : une carte de visite doit
répondre sur une application non construite et dans un terminal sans `NODE_ENV`
— or ce module, `policy: "dev"`, n'est chargé dans aucun des deux cas. La
composition (`buildCard`) et le rendu (`renderCard`) vivent donc au cœur ; ce
module les importe pour sa route, où il ajoute ce que lui seul sait : les
modules réellement CHARGÉS.

## Structure

```
devkit/
├── index.ts                                      ← classe Module + @services + @controllers + exports
├── nodefony/
│   ├── config/{config.ts,defineModuleConfig.ts}  ← schéma Zod (source unique) + builder
│   ├── src/card.ts                               ← construction de la carte : fonction PURE
│   ├── service/DevkitService.ts                  ← dérive la carte du Kernel
│   ├── controllers/DevkitController.ts           ← porte HTTP
│   ├── interfaces/IDevkitService.ts              ← contrat public
│   └── src/errors/DevkitError.ts                 ← erreurs typées
├── skills/<nom>/SKILL.md                         ← CONTENU des skills d'agent (publié tel quel)
│   └── scripts/                                  ← outils que le skill fait EXÉCUTER (see-screen : sondes Playwright)
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
- 🔴 **Le serveur MCP est une ROUTE, jamais un process.** La révision
  `2026-07-28` du transport a supprimé les sessions : un endpoint `POST` suffit,
  donc il n'y a rien à lancer ni à resynchroniser quand le serveur de
  développement recharge. Tout le protocole vit en fonctions PURES
  (`nodefony/src/mcp/`) ; le controller ne fait que traduire HTTP ↔ JSON-RPC.
- 🔴 **`/nodefony/mcp` échappe à la zone admin** (dont le pattern exige un
  segment `api`). C'est nécessaire — un client MCP ne sait pas présenter une
  session — mais cela veut dire que la garde `Origin`/localité et la `policy`
  sont **la seule protection**. Avant d'exposer une donnée par un outil MCP,
  se demander si elle supporterait d'être lue sans authentification.
- **Un outil MCP n'invente rien** : il appelle la brique qui répond déjà à une
  autre porte (`readAdminSubject`, `collectCheckReport`, `readSymbolsGraph`,
  `buildCard` — toutes exportées par `nodefony`). Ajouter un outil qui
  recalculerait sa réponse le ferait diverger de la commande du même nom.
- **Ce module ne porte NI scaffold NI diagnostic** — `create`, `check` et
  `inspect` vivent dans le cœur : ils doivent répondre sans qu'aucun module soit
  installé, et quand l'application est cassée.
- **Le VERBE au cœur, le CONTENU ici** — le même critère que pour `card` :
  `ai:sync` est un fast-path du cœur (il doit répondre sans `NODE_ENV`), les
  skills se corrigent ici et repartent par `npm update`. Détail : `MEMORY.md`.
- **Un skill n'est JAMAIS copié dans l'application** — `ai:sync` y pose un
  POINTEUR. Une copie décrit, six mois plus tard, un framework qui a changé,
  sans rien casser : donc sans que personne le voie.
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
- Ajouter un `postinstall` (ou tout script d'installation).
- Sortir les skills du paquet — ils ne se mettraient plus à jour, c'est leur
  seule raison de vivre ici.

## Tests / build

```bash
npm test        # vitest run
npm run build   # rolldown + déclarations .d.ts
npm run typecheck
```
