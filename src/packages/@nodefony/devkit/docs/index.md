---
title: "@nodefony/devkit — l'outillage de développement d'une application"
navTitle: devkit
lang: fr
module: "@nodefony/devkit"
topic: overview
audience: [human, ai]
tags: [module, developpement, agent]
status: stable
updated: 2026-09-01
source: "src/packages/@nodefony/devkit/docs/index.md"
---

# devkit

> L'outillage de développement d'une application : sa carte de visite, les
> skills qui disent à un agent comment faire les tâches courantes, et les portes
> qui mènent au reste.

Cette page est **surfacée dans Studio** (onglet Docs du module).

📍 [Documentation](../../../../../docs/index.md) › **@nodefony/devkit**

## Par où commencer

```nodefony-cards
[
  { "icon": "🪪", "title": "La carte de visite", "href": "#le-problème-quil-résout",
    "desc": "`npx nodefony card` : qui répond ici, quels modules, où lire, quoi lancer. Servie par le cœur — elle marche même sans application construite." },
  { "icon": "🔌", "title": "Le serveur MCP", "href": "#le-serveur-mcp--les-mêmes-réponses-en-outils",
    "desc": "Les mêmes réponses, mais en outils qu'un agent appelle — dont l'autorisation OAuth 2.1 et vos propres outils." },
  { "icon": "🎓", "title": "Les skills d'agent", "href": "#les-skills-dagent--répondre-à--comment-fait-on-ça-ici--",
    "desc": "Ce qui répond à « comment fait-on ça, ici ? » sans que l'agent invente une convention." },
  { "icon": "🚫", "title": "Ce qu'il ne fait pas", "href": "#ce-quil-ne-fait-pas",
    "desc": "La frontière du module — et pourquoi il n'existe pas en production." }
]
```

## Le problème qu'il résout

Une application Nodefony sait beaucoup de choses sur elle-même — ses modules, ses
routes, sa configuration, la documentation installée avec chaque paquet. Mais
elle ne le **dit** à personne. Celui qui arrive — un développeur qui reprend le
projet, un agent qui code — n'a d'autre choix que de deviner : lire les sources,
supposer une convention, inventer une route.

Le devkit répond à la question d'ouverture, et à elle seule : **qui répond ici,
et où faut-il aller ensuite ?**

```bash
npx nodefony card               # -j pour du JSON (| jq)
```

La réponse tient en trois blocs : l'identité (nom, version, environnement, cœur),
les modules, puis **où lire** et **quoi lancer**.

Cette commande-là est servie par le **cœur**, pas par ce module : une carte de
visite qui exigerait une application déjà construite, ou une variable
d'environnement posée, serait fermée au moment exact où l'on en a besoin. Elle ne
lit que des fichiers — et quand rien n'a démarré, elle annonce des modules
**installés** plutôt que chargés, en renvoyant à `npx nodefony inspect modules`.

## Pourquoi il n'existe pas en production

Ce que la carte expose — modules chargés, chemins de documentation, commandes —
aide pendant le développement. En production, c'est une description de votre
architecture offerte à qui la demande : une divulgation, pas une fonctionnalité.

D'où la double protection, et les deux moitiés comptent :

```ts
// nodefony.config.ts — posé par `nodefony create app`
use("@nodefony/devkit", {}, { policy: "dev" }),
```

- **`devDependencies`** : `npm ci --omit=dev` ne l'installe pas ;
- **`policy: "dev"`** : un déploiement qui installerait tout ne le charge pas
  quand même. Un module non chargé n'est **même pas importé** — le coût en
  production est nul, pas « faible ».

Corollaire à connaître : hors développement, c'est **la route** qui n'existe pas.
La commande, elle, répond — elle ne passe pas par ce module.

## Quatre portes, une seule source

| Porte                           | Pour qui                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| `npx nodefony card`             | un agent, un humain au terminal — servie par le cœur         |
| `GET /nodefony/devkit/api/card` | Studio, un script authentifié — modules réellement CHARGÉS   |
| `POST /nodefony/mcp`            | un agent qui appelle des **outils** (Model Context Protocol) |
| `buildCard()` (export du cœur)  | une porte de plus, à écrire — rien à réimplémenter           |

**Ajouter une porte n'ajoute jamais une vérité** : toutes lisent le même
service, qui dérive le même Kernel. La construction elle-même vit dans une
fonction pure (`buildCard`) qui reçoit son état au lieu de le lire — c'est ce qui
la rend éprouvable sans serveur, et ce qui l'empêche d'inventer quoi que ce soit.

> La route de la carte vit sous `/nodefony/<module>/api`, que le pare-feu d'une
> application réelle couvre : un agent qui code ne s'authentifie pas et n'a pas
> de navigateur. La porte qui compte pour lui est la commande — ou le serveur
> MCP ci-dessous.

## Le serveur MCP — les mêmes réponses, en outils

```bash
npx nodefony ai:mcp        # écrit .mcp.json ; --dry-run pour voir sans écrire
```

Quatre outils, qui sont les commandes que vous connaissez déjà :
`nodefony_inspect` (ce qui est monté), `nodefony_check` (ce qui manque),
`nodefony_symbols` (ce qu'une API signifie), `nodefony_card` (par où commencer).

**Il n'y a pas de process à lancer.** Depuis la révision `2026-07-28` du
transport, un serveur MCP est un endpoint `POST` sans session : c'est donc une
route de votre application. Elle vit tant qu'elle tourne, suit chaque
rechargement du serveur de développement, et n'a aucun cache à invalider.

**La déclaration reste dans VOTRE projet.** `ai:mcp` écrit `.mcp.json` à la
racine du projet — jamais dans une configuration globale. Ce n'est pas un détail
de rangement : l'URL porte un **port**, et deux applications Nodefony ouvertes en
même temps n'écoutent pas sur le même. Une déclaration globale en désignerait
forcément une, au hasard. (Pour Mistral Vibe, l'équivalent par projet est
`.vibe/config.toml`, section `[[mcp_servers]]`.)

**Cinq révisions servies** — `2026-07-28`, `2025-11-25`, `2025-06-18`,
`2025-03-26`, `2024-11-05` — et le serveur **répond celle que le client
demande**. Annoncer la plus récente à tout le monde rend la porte injoignable :
un SDK qui ne connaît pas encore cette révision raccroche, et le serveur le plus
conforme du monde ne parle alors à personne.

Trois choses à savoir avant de s'étonner d'un refus :

- une **adresse non locale** reçoit `403` (`mcp.allowRemote`) ;
- une **origine de navigateur** non déclarée reçoit `403` (`mcp.allowedOrigins`).
  Un client MCP natif n'envoie pas d'`Origin` ; une page web en envoie toujours
  un — c'est ce qui ferme le détournement DNS, seul vecteur réel contre un
  serveur local ;
- le module étant `policy: "dev"`, **la route n'existe pas en production**.

Les outils intégrés sont en lecture seule, et `mcp.tools` est une allowlist.

### Passer la porte sous autorisation OAuth 2.1

Le périmètre ci-dessus suffit à un poste de développement. Dès que la porte doit
répondre à quelqu'un d'autre, déclarez un serveur d'autorisation : elle devient
alors un **resource server** au sens de la spécification — elle publie ses
métadonnées ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)), valide
le porteur, refuse en `401`/`WWW-Authenticate`
([RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750)) et vérifie
l'audience ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)).

```ts
use("@nodefony/devkit", {
  mcp: {
    authorization: {
      authorizationServers: ["https://auth.example"],
      resource: "https://mon-app.example/nodefony/mcp",
    },
  },
});
```

| Ce qui se passe alors                                        | Où                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| Le document de métadonnées est publié                        | `GET /.well-known/oauth-protected-resource/nodefony/mcp` |
| Une requête sans jeton — ou sans jeton LISIBLE — est refusée | `401` + `WWW-Authenticate: Bearer resource_metadata="…"` |
| Un jeton d'une autre audience n'ouvre rien                   | `401` — ou servi en **anonyme** si `anonymous: true`     |
| Un outil déclarant des `scopes` devient atteignable          | pour qui présente **tous** ces scopes                    |
| Les scopes publiés sont l'**union** de ceux des outils       | `scopes_supported` du document, et `scope` du défi       |

Le serveur d'**autorisation** n'est jamais à écrire : la spécification le place
« beyond the scope […] or a separate entity ». N'importe quel émetteur OAuth 2.1
convient.

> 🔴 **Ce module ne valide pas les jetons lui-même** — il est `policy: "dev"` et
> ne porte aucune cryptographie. Il cherche un service `accessTokenVerifier` dans le
> conteneur (contrat `IAccessTokenVerifier`, exporté par `nodefony`). Sans lui,
> une porte déclarée protégée répond `503` et le journal le dit en `CRITIC` :
> accepter des porteurs sans les lire serait pire que rester anonyme.

### Ajouter VOS outils — ce que l'agent ne peut pas deviner

Les quatre outils ci-dessus décrivent le framework. Ils ne savent rien de votre
métier — et c'est précisément ce qu'un agent invente le plus mal. N'importe quel
module de votre application peut donc en publier :

```ts
import { Module, mcpText, type IMcpTool } from "nodefony";

class Shop extends Module {
  getMcpTools(): IMcpTool[] {
    return [
      {
        name: "shop_stock",
        // ⭐ La description est ce qui DÉCLENCHE l'outil. Dire ce qu'il rend
        // ET quand s'en servir — un modèle n'appelle pas ce qu'il ne
        // comprend pas.
        description:
          "Stock réel d'une référence produit. À utiliser avant de proposer " +
          "une commande — la réponse vient de la base, pas d'un cache.",
        inputSchema: {
          type: "object",
          properties: { sku: { type: "string", description: "Référence" } },
          required: ["sku"],
        },
        handler: async (args) => mcpText(await this.stock(String(args.sku))),
      },
    ];
  }
}
```

Trois choses à savoir :

- **rien ne s'enregistre au démarrage** : la liste est relue à chaque requête,
  donc un module ajouté apparaît sans redémarrer quoi que ce soit ;
- **`mcp.tools` ne filtre que les outils intégrés** — le vôtre est publié dès
  qu'il est déclaré, sans ligne de configuration supplémentaire ;
- un outil **écarté** (nom hors `[a-zA-Z0-9_-]{1,64}`, nom déjà pris, handler
  absent, déclaration qui lève) le dit en `WARNING` dans les journaux du
  serveur — il ne disparaît jamais en silence. Les outils intégrés gagnent
  toute collision : personne ne peut répondre à la place de `nodefony_inspect`.

### Réserver un outil à qui est autorisé

Un outil peut exiger des **scopes** (tous, pas au moins un) et/ou une identité
prouvée. Son handler reçoit alors l'appelant en second paramètre, pour borner ce
qu'il **rend** et pas seulement décider s'il répond :

```ts
{
  name: "shop_invoice",
  description: "Facture d'une commande.",
  inputSchema: { type: "object", properties: { id: { type: "string" } } },
  scopes: ["shop:read", "shop:billing"],   // ou : requiresAuth: true
  handler: async (args, caller) =>
    mcpText(await this.invoice(String(args.id), caller.subject)),
}
```

La spec le prévoit explicitement : le jeu d'outils « MAY vary by the
authorization presented on the request — for example, returning only the tools
the caller's granted scopes permit », précisément parce que les identifiants
sont une **entrée de requête, pas un état de connexion**. C'est pourquoi la
liste est recollectée à chaque appel.

Le filtre s'applique **à la collecte**, donc en un seul point : un outil retenu
est absent de `tools/list` **et** inappelable en le nommant, et le refus dit
« outil inconnu » plutôt qu'« interdit » — son existence même n'est pas révélée.

> 🔴 **Tant que la porte n'authentifie personne, un outil à scopes ne sortira
> jamais.** C'est le comportement voulu — fermé par défaut — mais il faut le
> savoir avant de chercher une panne : `caller` vaut `{ authenticated: false,
scopes: [] }` tant que le rôle _resource server_ décrit plus haut n'est pas
> branché. Le jour où il le sera, ces déclarations prendront effet sans qu'une
> ligne d'outil change.

> ⚠️ Cette porte n'est pas authentifiée (voir l'écart ci-dessus) et le module est
> `policy: "dev"`. Avant d'exposer une donnée par un outil, se demander si elle
> supporterait d'être lue **sans identification**, par qui a accès à la machine.

## Les skills d'agent — répondre à « comment fait-on ça, ici ? »

La carte dit **où aller**. Elle ne dit pas **comment faire**. Or c'est là qu'un
agent invente : faute d'une marche à suivre, il écrit un CRUD à la main, un
service à méthodes `static` que le conteneur ne voit pas, un contrôle de droits
dans le corps de l'action.

Le paquet livre donc cinq **skills** au format [Agent Skills](https://agentskills.io),
un par tâche où l'invention coûte cher :

| Skill                           | Le besoin qu'il couvre                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `nodefony-add-crud`             | exposer une ressource REST complète, entité comprise        |
| `nodefony-add-service`          | ajouter de la logique métier réutilisable, vue du conteneur |
| `nodefony-protect-route`        | réserver une route à qui est habilité                       |
| `nodefony-add-realtime-channel` | ouvrir un canal temps réel où le serveur pousse             |
| `nodefony-browser`              | voir **et mesurer** un écran, sans navigateur sur le poste  |

Tous portent le préfixe `nodefony-` : leurs pointeurs arrivent dans le dossier où
vous écrivez aussi les vôtres, et sans namespace un skill maison du même nom
serait écrasé à la synchronisation suivante.

`nodefony create app` les met à disposition à la création ; après une montée de
version, `npx nodefony ai:sync` les remet à jour (`--dry-run` montre sans
écrire).

**Ce qui est écrit dans le projet est un pointeur, jamais une copie.** Le contenu
reste dans le paquet installé et suit `npm update` : une recette recopiée dans un
projet décrit, six mois plus tard, un framework qui a changé — et comme rien ne
casse, personne ne s'en aperçoit. C'est le même principe que le reste du devkit :
**rien de figé n'est copié chez l'utilisateur.**

Le dossier visé — `.agents/skills/` — est celui que tous les clients conformes
lisent, plutôt que le dossier propriétaire d'un seul d'entre eux. Ces fichiers
sont faits pour être commités : l'équipe entière et l'intégration continue
travaillent alors avec les mêmes recettes.

> Aucun `postinstall` ne les pose : `--ignore-scripts` est courant, les scripts
> d'installation sont un vecteur d'attaque connu de l'écosystème npm, et écrire
> dans un dossier versionné à chaque installation produirait des différences
> surprises.

## Ce qu'il ne fait pas

Le scaffold (`nodefony create …`), le diagnostic (`nodefony check`) et
l'introspection (`nodefony inspect`) **ne sont pas ici** : ils vivent dans le
cœur, parce qu'ils doivent répondre sans qu'aucun module soit installé — et
surtout quand l'application est cassée. Un outil de diagnostic qui exige que
l'application démarre ne sert pas au moment où on en a besoin.

Même partage pour les skills, et il se retient en une phrase : **le VERBE vit
dans le cœur, le CONTENU dans ce paquet.** `ai:sync` doit répondre dans un
terminal qui n'a rien posé (portée par un module `policy: "dev"`, elle serait
absente sans `NODE_ENV`) ; les skills, eux, doivent se mettre à jour par npm.

## Configuration

| Clé                  | Type       | Défaut                                 | Rôle                                           |
| -------------------- | ---------- | -------------------------------------- | ---------------------------------------------- |
| `enabled`            | `boolean`  | `true`                                 | Interrupteur du module                         |
| `mcp.enabled`        | `boolean`  | `true`                                 | Répond-on aux requêtes MCP ? Coupé → `404`     |
| `mcp.allowedOrigins` | `string[]` | `[]`                                   | Origines de navigateur admises ; vide = aucune |
| `mcp.allowRemote`    | `boolean`  | `false`                                | Accepter un appel d'une adresse non locale     |
| `mcp.tools`          | `string[]` | `["inspect","check","symbols","card"]` | Allowlist des outils — lecture seule           |

Les clés, leurs types et leurs défauts viennent du schéma Zod
(`nodefony/config/config.ts`) — **source unique** dont dérivent la
documentation, la validation au boot et le formulaire d'édition de Studio.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [documentation Nodefony](../../../../../docs/index.md) — et
  [par où commencer](../../../../../docs/demarrer.md) si vous arrivez sur le framework.
- 🏗️ **Générer du code plutôt que l'écrire** :
  [`nodefony create`](../../../../../docs/guides/generer-du-code.md) — voir ce qui va changer
  avant que ça change, et l'appeler depuis un agent.
- 🧪 **Ce que vaut cet outillage, mesuré** :
  [éprouver un framework avec un agent](../../../../../docs/guides/eprouver-loutillage-agent.md).
- 🖥️ **Les commandes du cœur** : [la CLI](../../../../nodefony/docs/cli.md) — `card` et `inspect`
  y sont servies, pas ici.
- 📚 **La documentation installée avec les paquets** :
  [`@nodefony/documentation`](../../documentation/docs/index.md).
- 📖 [Lexique général](../../../../../docs/lexique.md) du framework.
