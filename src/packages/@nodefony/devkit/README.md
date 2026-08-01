# @nodefony/devkit

L'outillage de **développement** d'une application Nodefony : sa carte de visite,
et les portes qui mènent au reste.

Il répond à la question que tout le monde se pose en arrivant sur une application
— humain qui reprend un projet, agent qui code : **qui répond ici, et où faut-il
aller ensuite ?**

```bash
npx nodefony card               # -j pour du JSON (| jq)
```

> La commande est servie par le **cœur**, pas par ce module : elle doit répondre
> sur une application pas encore construite et dans un terminal sans `NODE_ENV`,
> deux cas où aucun module n'est chargé. Ce paquet, lui, sert la même carte en
> **HTTP** — et c'est la seule porte qui connaisse les modules réellement
> CHARGÉS.

```
ma-boutique 1.4.0 — development (nodefony 10.0.0)

Modules chargés (7) : drizzle, framework, frontend, http, security, studio, user

Où aller :
  AGENTS.md
      Les instructions de cette application — générateurs disponibles, table
      tâche → fichier, gates à passer. À lire AVANT d'écrire du code.
  node_modules/nodefony/docs/catalogue.md
      Le catalogue des briques — quel module prendre pour quel besoin.
  …

Quoi lancer :
  npx nodefony check
      diagnostic STATIQUE : il répond même quand l'application ne démarre plus.
  …
```

## Installation

`nodefony create app` l'ajoute déjà — en **`devDependencies`**, et déclaré
`policy: "dev"` :

```ts
// nodefony.config.ts
use("@nodefony/devkit", {}, { policy: "dev" }),
```

Les deux moitiés comptent : la `devDependency` fait qu'un `npm ci --omit=dev` ne
l'installe pas ; la `policy` fait qu'un déploiement qui installerait tout ne le
charge pas quand même. **En production, le module n'est même pas importé** — le
coût y est nul, pas « faible ».

Corollaire : **la route** n'existe que hors production. La **commande**, elle,
répond toujours — elle ne dépend pas de ce module.

## Ce qu'il expose

| Porte                           | Pour qui                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| `GET /nodefony/devkit/api/card` | Studio, un script authentifié — modules réellement CHARGÉS |
| `buildCard()` (export du cœur)  | une porte de plus, à écrire — rien à réimplémenter         |
| `npx nodefony card`             | un agent, un humain au terminal — **servie par le cœur**   |

La route HTTP vit sous `/nodefony`, que le pare-feu d'une application réelle
couvre : un agent qui code ne s'authentifie pas et n'a pas de navigateur — d'où
la commande, qui reste la porte utile.

## Configuration

| Clé       | Type      | Défaut | Rôle                   |
| --------- | --------- | ------ | ---------------------- |
| `enabled` | `boolean` | `true` | Interrupteur du module |

La source unique est le schéma Zod de `nodefony/config/config.ts` : c'est lui qui
porte les défauts, les descriptions et la validation. Une clé inconnue ou mal
typée fait échouer le **boot**, en nommant le champ fautif.

Surcharge par l'application : `use("@nodefony/devkit", { enabled: false })`.
Par l'environnement : `NF__DEVKIT__ENABLED=false`.

## Ce qu'il ne fait pas

- **Il n'invente rien.** Tout ce qu'il rend est DÉRIVÉ de l'état du Kernel,
  recalculé à chaque lecture, jamais mis en cache — une carte en cache mentirait
  au premier module ajouté.
- **Il ne crée rien.** Le scaffold (`nodefony create …`), le diagnostic
  (`nodefony check`) et l'introspection (`nodefony inspect`) vivent dans le
  cœur : ils doivent répondre sans qu'aucun module soit installé, et quand
  l'application est cassée.
- **Il ne dépend d'aucun fournisseur de modèle.** Son intérêt est de servir
  l'agent que vous avez déjà.

## Développer

```bash
npm run build       # rolldown → dist/ + déclarations .d.ts
npm run typecheck   # tsgo --noEmit (sources + tests)
npm test            # vitest
```

## Structure

```
@nodefony/devkit/
├── index.ts                          ← la classe Module + les exports publics
├── nodefony/
│   ├── config/config.ts              ← schéma Zod = source unique des défauts
│   ├── config/defineModuleConfig.ts  ← builder pur (valide, gèle)
│   ├── src/card.ts                   ← construction de la carte : fonction PURE
│   ├── service/DevkitService.ts      ← dérive la carte du Kernel (`container.get("devkit")`)
│   ├── controllers/DevkitController.ts ← la porte HTTP
│   ├── command/CardCommand.ts        ← la porte CLI
│   └── interfaces/                   ← l'API publique du service
├── docs/                             ← documentation, surfacée dans Studio
└── tests/
```
