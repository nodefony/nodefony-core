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
  npx nodefony doctor
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

Neuf outils : **`nodefony_inspect`** (ce qui est monté), **`nodefony_check`**
(ce qui manque — la commande s'appelle `doctor`), **`nodefony_symbols`** (ce qu'une
API du framework signifie), **`nodefony_card`** (par où commencer),
**`nodefony_docs`** (la documentation des modules installés), **`nodefony_admin_list`**
et **`nodefony_admin_call`** (lectures du data plane d'administration, jeton porteur
du scope `admin:read` exigé), **`nodefony_observe`** (ce que l'application fait réellement de ses requêtes, mesuré pendant qu'elle tourne) et **`nodefony_profile_route`** (une route mesurée par l'outil lui-même, au nom d'un compte s'il le faut). Ce sont les mêmes
briques que les commandes — une source, plusieurs portes.

### Mesurer l'application qui tourne — `nodefony_observe`

L'outil observe l'application pendant une fenêtre de 1 à 50 secondes (10 par
défaut) et rend ce que son profileur de développement a mesuré : où part le
temps de chaque route, les requêtes SQL répétées dans une boucle (N+1), les
erreurs `5xx` avec leurs lignes de journal, et les blocages de la boucle
d'événements. **Il ne génère aucun trafic** : on ouvre la page, on joue les
tests ou on envoie des requêtes pendant que la fenêtre court.

```jsonc
// tools/call
{ "name": "nodefony_observe", "arguments": { "durationSec": 10 } }
// optionnel : "route": "<nom de la route>", "includeTooling": true
```

Extrait d'un rapport réel (une route qui plante, sur une application démarrée
depuis dix secondes) :

```text
Verdict : anomalies (2) — observation complète
Fenêtre : 6.0 s sur 6.0 s · 3 relevé(s) · 39 requête(s) (39 HTTP, 0 WebSocket) · 0 perdue(s) · 0 de l'outillage écartée(s)
Process : pid 46402, démarré il y a 10 s · boucle d'événements : retard moyen 4.0 ms, pire blocage 665 ms · tas -10.0 Mo (indicatif, sans GC)

Anomalies (les plus coûteuses d'abord) :
1. Erreurs — route `crash-sync` (DefaultController.crashSync) : 13 sur 13 — « simulated sync crash ». requestId : d706bfef-…, 577adac2-…, 207f8121-… — journal ci-dessous.
2. Boucle d'événements bloquée — jusqu'à 665 ms d'un tenant (retard moyen 4.0 ms) : […] Le process a démarré il y a 10 s : ce blocage peut venir du démarrage […]

Journal des requêtes en erreur (syslog de l'application, lu au relevé qui les a vues) :
- requestId d706bfef-… — route `crash-sync`, statut 500 :
    ERROR [req] GET 500 http://127.0.0.1:5151/nodefony/test/crash/sync 1.4ms 127.0.0.1 [d706bfef] simulated sync crash
```

C'est un outil **long** : un instantané part en progression toutes les deux
secondes, un client qui ferme le flux de la réponse (l'annulation selon la révision courante de MCP) l'arrête au relevé suivant — un client qui annule par notification sans fermer le flux ne l'arrête pas encore, et un
rechargement du serveur pendant la fenêtre rend un rapport partiel qui le dit.
Ce qu'il faut savoir pour s'en servir sans conclure à tort :

- les durées et le temps « par requête » portent sur les requêtes **servies** ;
  les refus `401`/`403` sont comptés à part ;
- `action.self` est le temps de l'action et des services qu'elle appelle, une
  fois retirés le rendu, l'initialisation et le SQL ; « SQL (cumul) » additionne
  les requêtes, même lancées en parallèle ;
- les valeurs SQL sont masquées (`?`) : le rapport montre la forme d'une requête,
  jamais une donnée ; le journal n'en garde que les lignes WARNING et plus graves ;
- le journal des erreurs n'est lu que pour un appel **authentifié** (scope
  `admin:read`) ; les routes `/nodefony/…` (outillage) sont écartées, sauf
  `includeTooling`.

La façon de lire chaque anomalie et le geste qui la corrige sont dans le skill
d'agent `nodefony-troubleshoot` (§ « Mesurer l'application qui tourne »).

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

### Mesurer une route — `nodefony_profile_route`

Là où `nodefony_observe` attend le trafic, `nodefony_profile_route` le **produit** :
il envoie lui-même N requêtes `GET` (ou `HEAD`) sur un chemin de l'application,
retrouve leurs profils par l'identifiant qu'il pose (`x-request-id`) et rend le
même rapport. C'est la boucle « je modifie → je mesure » en un appel.

```jsonc
// tools/call
{
  "name": "nodefony_profile_route",
  "arguments": { "path": "/orders?page=2", "count": 50 },
}
// optionnel : "concurrency" (défaut 4, max 8), "warmup" (défaut 3, hors mesures),
//             "method": "HEAD", "as": "<identifiant>", "anonymous": true
```

`path` est un **chemin**, jamais une URL : hôte, schéma et `//` sont refusés,
l'outil ne vise que l'application elle-même. Au plus 200 requêtes par appel —
sous les 500 profils que garde le profileur — et 45 secondes de tir.

**Au nom de qui.** Une page protégée vue sans compte ne rend que des refus.
Quand le jeton MCP porte le scope `admin:write`, l'outil joue son
**propriétaire** : il ouvre une vraie session à son nom par le flux de connexion
de l'application (un ticket à usage unique, présenté en boucle locale à
`POST /nodefony/devkit/profile-session`), tire avec, puis la détruit — l'audit
l'écrit sous la raison `devkit`. `as` joue un autre compte, à condition que ses
rôles soient inclus dans ceux du propriétaire, hiérarchie comprise : jouer un
compte ne monte jamais en droits. Sans ce scope, l'outil joue l'anonyme et le
rapport donne la commande :

```bash
npx nodefony security:mcp:token --scope "admin:read admin:write" --write
```

Extrait de deux appels réels, avant puis après la correction d'un N+1 (la même
lecture, une requête par compte, puis une seule requête `$in`) :

```text
Verdict : anomalies (1) — observation complète
Tir : 30/30 requête(s) GET /nodefony/test/db/n-plus-one · concurrence 4 · 106 ms · chauffe de 3 requête(s) hors mesures (p50 1.5 ms, max 2.5 ms)
Joué en tant que : `admin` (ROLE_ADMIN, ROLE_NODEFONY_ADMIN, ROLE_DEV, ROLE_SUPERVISOR)
Reçu par le client : 2xx 30 · 3xx 0 · 401 0 · 403 0 · autres 4xx 0 · 5xx 0 · sans réponse 0

Anomalies (les plus coûteuses d'abord) :
1. N+1 — route `DbController::nPlusOne` (DbController.nPlusOne) : `select … from "User" where "User"."id" = ? …` répétée ×16 dans une requête (30 requête(s) touchée(s), 14 ms cumulés). […] Remède habituel : charger la relation en une requête (`relations`, `$in`).

route | type | n | p50 | p95 | max | 2xx/3xx/4xx/5xx | SQL par requête moy/max | temps par requête
`DbController::nPlusOne` (DbController.nPlusOne) | http | 30 | 1.2 ms | 1.7 ms | 1.7 ms | 30/0/0/0 | 18.0/18 | SQL (cumul) 0.7 ms · action.self 0.2 ms · send 0.1 ms

— après correction —
Verdict : ok — observation complète
`DbController::nPlusOneFixed` (DbController.nPlusOneFixed) | http | 30 | 0.7 ms | 0.9 ms | 2.1 ms | 30/0/0/0 | 3.0/3 | SQL (cumul) 0.4 ms · send 0.1 ms · action.self 0.1 ms
```

Ce que le rapport dit **en tête**, avant tout chiffre : les requêtes refusées
(`401`/`403` — verdict « rien à juger »), redirigées (vers la page de
connexion), restées sans réponse, et les profils non retrouvés. Une mesure qui ne
porte pas sur ce qui était demandé le dit d'abord.

À savoir :

- ce sont de **vraies requêtes** : une page qui écrit en `GET` écrit N fois — un
  compteur, ou une session créée pour chaque visiteur anonyme ;
- les zones à jeton (`jwt`, `external-jwt`) ne sont pas jouées : leurs requêtes
  rendent `401`, et le rapport le dit ;
- un tir plus court que cinq périodes de la sonde laisse la boucle d'événements
  « non mesurée » plutôt que d'afficher un zéro trompeur.

### Protéger la porte par OAuth 2.1

Par défaut la porte est anonyme, et ce qui la borne est le périmètre ci-dessus.
Déclarez un serveur d'autorisation, et elle prend son rôle de **resource
server** : elle publie ses métadonnées, valide le porteur présenté, et refuse en
disant où obtenir un jeton.

```ts
use("@nodefony/devkit", {
  mcp: {
    authorization: {
      // Un seul réglage commande : vide = porte anonyme, comme avant.
      authorizationServers: ["https://auth.example"],
      // L'URI PUBLIQUE de la porte — l'audience que les jetons doivent porter.
      // Elle s'écrit : la déduire de l'en-tête `Host` permettrait à un Host
      // forgé d'obtenir un jeton d'audience arbitraire ET de passer la
      // vérification.
      resource: "https://mon-app.example/nodefony/mcp",
    },
  },
});
```

> **Les scopes ne s'écrivent pas ici.** Ce que la porte publie
> (`scopes_supported`) et nomme dans son défi est **dérivé** des outils qu'elle
> sert : l'union de leurs `IMcpTool.scopes`. Pour qu'un scope soit publié, le
> poser sur l'outil qu'il ouvre — le seul endroit où il a un effet. Une liste
> écrite à côté du code annonçait au client autre chose que ce qu'on exige de
> lui, dans les deux sens et sans qu'aucun contrôle ne s'en aperçoive.

Le document est alors servi sur
`GET /.well-known/oauth-protected-resource/nodefony/mcp` (RFC 9728 — le suffixe
s'**insère** entre l'hôte et le chemin, ce qui permet plusieurs ressources par
hôte), et une requête sans jeton reçoit :

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mon-app.example/.well-known/oauth-protected-resource/nodefony/mcp", scope="admin:read"
```

C'est cet en-tête qui rend l'autorisation **apprenable** : sans lui, un refus
est un mur — le client ignore qu'un jeton existe et où le demander.

> 🔴 **La vérification du jeton est fournie par l'application.** Ce module est
> `policy: "dev"` et ne porte aucune cryptographie : il cherche un service
> `accessTokenVerifier` dans le conteneur (contrat `IAccessTokenVerifier` du cœur).
> Déclarer un serveur d'autorisation **sans** ce service fait répondre `503` à
> la porte, avec un journal `CRITIC` — accepter des porteurs sans les lire
> serait pire que rester anonyme.
>
> `anonymous: true` laisse la porte ouverte aux outils publics tout en gardant
> les outils réservés retenus. C'est un choix qui s'écrit, jamais un défaut.

Le serveur est **dual-ère** : il répond à `server/discover` et aux métadonnées
par requête des clients modernes, **et** au handshake `initialize` des clients
déployés aujourd'hui — ce que la spec autorise explicitement. Il sert cinq
révisions (`2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`,
`2024-11-05`) et **répond celle que le client demande** : annoncer la plus
récente à tous rendrait la porte injoignable par les clients dont le SDK ne la
connaît pas encore.

Éprouvé avec deux clients indépendants : Claude Code et Mistral Vibe.

### Vos propres outils

Ces outils intégrés décrivent le framework ; ils ne savent rien de votre métier. Tout
module de votre application peut publier les siens en implémentant
`getMcpTools(): IMcpTool[]` :

```ts
import { Module, type IMcpTool } from "nodefony";
import { mcpText } from "@nodefony/ai";

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
        // Lecture dans la base de l'application : rien n'est modifié.
        annotations: { readOnlyHint: true, openWorldHint: false },
        handler: async (args) => mcpText(await this.stock(String(args.sku))),
      },
    ];
  }
}
```

Rien ne s'enregistre au démarrage : la liste est relue à chaque requête, et
`mcp.tools` ne filtre que les outils **intégrés** — le vôtre est publié dès qu'il
est déclaré. Un outil écarté (nom hors forme, nom déjà pris, handler absent) le
dit en `WARNING`, jamais en silence.

Chaque outil **dit ce qu'il fait** par ses `annotations` : `readOnlyHint: true`
pour une lecture, et un outil qui modifie quoi que ce soit DOIT se déclarer
`readOnlyHint: false`, avec `destructiveHint` (`true` s'il efface ou écrase).
Sans annotation, la spécification MCP tient l'outil pour une écriture
destructive : l'agent de code demande alors confirmation pour la moindre
lecture. Les sept outils intégrés se publient `readOnlyHint: true`,
`openWorldHint: false`. Grille de choix et erreurs à éviter :
`node_modules/@nodefony/ai/docs/mcp.md`, « Dire ce que fait l'outil ».

Un outil peut aussi se **réserver** — `scopes: ["shop:read"]` (tous exigés) ou
`requiresAuth: true` — et son handler reçoit alors l'appelant en second
paramètre. Il est alors absent de `tools/list` **et** inappelable en le nommant.
🔴 Tant que la porte n'authentifie personne, un tel outil ne sortira jamais :
c'est fermé par défaut, et c'est voulu. Détail et pièges :
[la documentation du module](./docs/index.md).

## Les skills d'agent

Le paquet livre huit **skills** au format [Agent Skills](https://agentskills.io)
— la marche à suivre complète pour les tâches où un agent, sans eux, inventerait
du code : créer une ressource REST, ajouter un service injectable, réserver une
route à qui est habilité, ouvrir un canal temps réel, faire évoluer le schéma
d'une base sans la détruire, voir puis MESURER un écran dans un navigateur
piloté — plus un skill qui conduit toute tâche de développement et un qui décrit
l'exploitation en conteneur. Ils sont lus par tout client conforme (Claude Code, Cursor, Copilot,
VS Code, Codex, Goose…).

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
  = nodefony-authentication        @nodefony/devkit
  = nodefony-browser               @nodefony/devkit
  = nodefony-dev                   @nodefony/devkit
  = nodefony-devops                @nodefony/devkit
  = nodefony-migrate-schema        @nodefony/devkit
  = nodefony-protect-route         @nodefony/devkit
  = nodefony-security-review       @nodefony/devkit
  = nodefony-troubleshoot          @nodefony/devkit
  = nodefony-upgrade               @nodefony/devkit

  0 posé(s) · 0 mis à jour · 12 inchangé(s)
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

| Clé                  | Type       | Défaut          | Rôle                                                  |
| -------------------- | ---------- | --------------- | ----------------------------------------------------- |
| `enabled`            | `boolean`  | `true`          | Interrupteur du module                                |
| `mcp.enabled`        | `boolean`  | `true`          | Interrupteur de la porte MCP                          |
| `mcp.allowedOrigins` | `string[]` | `[]`            | Origines navigateur admises sur la porte MCP          |
| `mcp.allowRemote`    | `boolean`  | `false`         | Accepte un client hors de la boucle locale            |
| `mcp.tools`          | `string[]` | les sept outils | Outils exposés                                        |
| `mcp.authorization`  | objet      | —               | Autorisation OAuth de la porte (voir `docs/index.md`) |

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
  (`nodefony doctor`) et l'introspection (`nodefony inspect`) vivent dans le
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
