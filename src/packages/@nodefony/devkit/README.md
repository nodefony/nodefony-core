# @nodefony/devkit

L'outillage de **développement** d'une application Nodefony : sa carte de visite,
les **skills d'agent** qui disent comment faire les tâches courantes, et les
portes qui mènent au reste.

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

| Porte                           | Pour qui                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| `GET /nodefony/devkit/api/card` | Studio, un script authentifié — modules réellement CHARGÉS   |
| **`POST /nodefony/mcp`**        | **un agent qui appelle des outils** (Model Context Protocol) |
| `buildCard()` (export du cœur)  | une porte de plus, à écrire — rien à réimplémenter           |
| `npx nodefony card`             | un agent, un humain au terminal — **servie par le cœur**     |
| `skills/` (dossier du paquet)   | l'agent de codage que vous utilisez déjà — voir ci-dessous   |

La route de la carte vit sous `/nodefony/<module>/api`, que le pare-feu d'une
application réelle couvre : un agent qui code ne s'authentifie pas et n'a pas de
navigateur — d'où la commande, qui reste la porte utile.

## Le serveur MCP — les mêmes réponses, en outils

```bash
npx nodefony ai:mcp        # écrit .mcp.json ; --dry-run pour voir sans écrire
```

Quatre outils : **`nodefony_inspect`** (ce qui est monté), **`nodefony_check`**
(ce qui manque), **`nodefony_symbols`** (ce qu'une API du framework signifie),
**`nodefony_card`** (par où commencer). Ce sont les mêmes briques que les
commandes du même nom — une source, plusieurs portes.

**Ce n'est pas un process de plus.** Depuis la révision `2026-07-28` du transport
« Streamable HTTP », un serveur MCP est un simple endpoint `POST` sans session :
c'est donc une **route de votre application**. Elle n'existe que pendant qu'elle
tourne, suit chaque rechargement du serveur de développement, et n'a aucun cache
à invalider.

**Ce qui la protège**, et il faut le savoir avant de s'étonner d'un `403` :

- toute **adresse non locale** est refusée (`mcp.allowRemote`) ;
- toute **origine de navigateur** non déclarée est refusée (`mcp.allowedOrigins`).
  Un client MCP natif n'envoie pas d'en-tête `Origin` ; une page web en envoie
  toujours un. C'est ce qui ferme le détournement DNS, seul vecteur réel contre
  un serveur local ;
- le module étant `policy: "dev"`, **la route n'existe pas en production** ;
- les outils sont en **lecture seule**, et la liste est une allowlist
  (`mcp.tools`).

> ⚠️ **Écart de conformité assumé** : la spec recommande une authentification
> (« Servers SHOULD implement proper authentication »). Nous ne l'implémentons
> pas — la faire selon la norme exigerait que Nodefony soit un serveur
> d'autorisation OAuth 2.1 complet. Ce qui borne le risque est le périmètre
> ci-dessus, pas un jeton.

Le serveur est **dual-ère** : il répond à `server/discover` et aux métadonnées
par requête des clients modernes, **et** au handshake `initialize` des clients
déployés aujourd'hui — ce que la spec autorise explicitement. Il sert cinq
révisions (`2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`,
`2024-11-05`) et **répond celle que le client demande** : annoncer la plus
récente à tous rendrait la porte injoignable par les clients dont le SDK ne la
connaît pas encore.

Éprouvé avec deux clients indépendants : Claude Code et Mistral Vibe.

### Vos propres outils

Ces quatre-là décrivent le framework ; ils ne savent rien de votre métier. Tout
module de votre application peut publier les siens en implémentant
`getMcpTools(): IMcpTool[]` :

```ts
import { Module, mcpText, type IMcpTool } from "nodefony";

class Shop extends Module {
  getMcpTools(): IMcpTool[] {
    return [
      {
        name: "shop_stock",
        description:
          "Stock réel d'une référence produit. À utiliser avant de proposer " +
          "une commande — la réponse vient de la base, pas d'un cache.",
        inputSchema: {
          type: "object",
          properties: { sku: { type: "string" } },
          required: ["sku"],
        },
        handler: async (args) => mcpText(await this.stock(String(args.sku))),
      },
    ];
  }
}
```

Rien ne s'enregistre au démarrage : la liste est relue à chaque requête, et
`mcp.tools` ne filtre que les outils **intégrés** — le vôtre est publié dès qu'il
est déclaré. Un outil écarté (nom hors forme, nom déjà pris, handler absent) le
dit en `WARNING`, jamais en silence. Détail et pièges :
[la documentation du module](./docs/index.md).

## Les skills d'agent

Le paquet livre quatre **skills** au format [Agent Skills](https://agentskills.io)
— la marche à suivre complète pour les tâches où un agent, sans eux, inventerait
du code : créer une ressource REST, ajouter un service injectable, réserver une
route à qui est habilité, ouvrir un canal temps réel. Ils sont lus par tout
client conforme (Claude Code, Cursor, Copilot, VS Code, Codex, Goose…).

`nodefony create app` les met à disposition à la création. Après un
`npm update`, une commande les remet à jour :

```bash
npx nodefony ai:sync            # --dry-run pour voir sans écrire, --json pour un script
```

```
  Skills d'agent — .agents/skills

  = nodefony-add-crud              @nodefony/devkit
  = nodefony-add-realtime-channel  @nodefony/devkit
  = nodefony-add-service           @nodefony/devkit
  = nodefony-protect-route         @nodefony/devkit
  = nodefony-browser            @nodefony/devkit

  0 posé(s) · 0 mis à jour · 5 inchangé(s)
```

**Le préfixe `nodefony-` vous laisse la place.** Ces pointeurs arrivent dans
`.agents/skills/`, le dossier où vous écrivez aussi les vôtres : sans namespace,
un `add-crud` propre à votre métier et le nôtre se disputeraient un nom — et
c'est `ai:sync` qui écraserait le vôtre à la synchronisation suivante. Vos skills
n'ont donc aucune contrainte de nommage, sauf à commencer par `nodefony-`.

**Ce qui est écrit chez vous est un POINTEUR, pas une copie.** Le contenu reste
dans le paquet et suit vos montées de version ; un skill recopié dans le projet
décrirait, six mois plus tard, un framework qui a changé — sans casser le build,
donc sans que personne le voie. Les pointeurs sont faits pour être **commités** :
votre équipe et votre intégration continue disposent alors des mêmes skills.

Le dossier visé, `.agents/skills/`, est celui que **tous** les clients conformes
lisent — pas le dossier propriétaire d'un seul. Si le vôtre ne scanne que le
sien, ajoutez-y ce chemin plutôt que de dupliquer un contenu qui divergerait.

Deux garanties de la commande : un pointeur déjà à jour n'est **pas réécrit**
(votre arbre git reste propre, l'horodatage ne bouge pas), et un pointeur que
plus aucun paquet ne livre est **signalé, jamais supprimé** — vous avez pu en
écrire un à la main sous le même nom.

> **Aucun `postinstall`** ne fait ce geste, volontairement : `--ignore-scripts`
> est courant, les scripts d'installation sont un vecteur d'attaque connu de
> l'écosystème npm, et écrire dans un dossier versionné à chaque installation
> produirait des différences surprises. La commande, elle, se lance quand vous
> le décidez. Un module tiers qui livre ses propres skills est servi par la même
> commande : elle scanne tout paquet `@nodefony/*` **et** les modules locaux de
> l'application, sans que le cœur ait à les connaître.

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
- **Il ne s'installe pas tout seul dans votre projet.** Aucun `postinstall` :
  les pointeurs de skills sont posés par `create app` à la création, et remis à
  jour par `ai:sync` quand vous le demandez.

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
│   ├── src/card.ts                   ← ré-export du cœur (la composition y vit)
│   ├── service/DevkitService.ts      ← dérive la carte du Kernel (`container.get("devkit")`)
│   ├── controllers/DevkitController.ts ← la porte HTTP
│   └── interfaces/                   ← l'API publique du service
├── skills/<nom>/SKILL.md             ← les skills d'agent livrés par npm
├── docs/                             ← documentation, surfacée dans Studio
└── tests/
```

`dist/`, `docs/` et `skills/` sont les trois dossiers publiés (`files`) : un
skill se corrige ici, et la correction arrive chez l'utilisateur par
`npm update`, sans qu'il ait un fichier à réécrire.
