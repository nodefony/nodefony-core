---
title: "Ta première application Nodefony"
lang: fr
module: "global"
topic: tutoriel-premiere-app
section: "Tutoriels"
audience: [developer]
tags:
  [tutoriel, demarrage, create-app, controller, entite, temps-reel, onboarding]
version: "doc"
status: stable
updated: 2026-10-17
source: "docs/tutoriels/premiere-application.md"
tests: none
---

# Ta première application Nodefony

> Un tutoriel qui se **fait**, pas qui se lit : à la fin, tu auras une application qui répond en HTTP,
> répond aussi en WebSocket **depuis le même code**, et enregistre des données — le tout lancé en
> développement, reconstruit à chaque sauvegarde. Chaque étape se termine par **quelque chose que tu
> observes**. Aucune connaissance préalable de Nodefony n'est requise.

📍 [Documentation](../index.md) › **Ta première application**

## 🎯 Que vas-tu construire

Une petite application `mon-app`, du dossier vide jusqu'à :

1. une route qui répond `GET /api/hello` en JSON ;
2. le **différenciateur Nodefony** : la même classe sert HTTP **et** WebSocket ;
3. ta **propre route**, ajoutée à la main ;
4. un **service** qui sait quelle requête il sert — et la preuve que deux requêtes simultanées ne se
   mélangent pas ;
5. une **entité** `Article` enregistrée en base, avec son API REST générée.

**Prérequis** : Node.js 24 ou plus, et `npm`. Rien d'autre : la base de données est un fichier SQLite
créé pour toi. Compte un quart d'heure.

## 📖 Lexique

Les mots qui reviennent (le vocabulaire complet est dans le [lexique général](../lexique.md)) :

| Terme               | En clair                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **générateur**      | Une commande `nodefony create …` qui écrit le code pour toi, déjà branché.                        |
| **contrôleur**      | La classe qui répond à une route. Chez Nodefony, une seule classe répond en HTTP **et** en WS.    |
| **service**         | Une classe de logique réutilisable, que le framework construit et te donne (`@Inject`).           |
| **entité**          | Une table de base de données décrite en TypeScript, avec son service et son API.                  |
| **migration**       | Le fichier SQL qui fait évoluer la base ; il s'écrit et s'applique par une commande.              |
| **superviseur**     | Le processus de développement qui reconstruit ton code et relance le serveur à chaque sauvegarde. |
| **zone / pare-feu** | Un préfixe d'URL et sa politique de sécurité (ici `^/api`, visiteur « anonyme » autorisé).        |

## 1. Créer l'application

Depuis un dossier vide :

```bash
npm create nodefony@beta mon-app
cd mon-app
```

> ⚠️ **Le `@beta` n'est pas décoratif.** Tant que Nodefony 10 n'est pas sorti en version stable, c'est
> lui qui te donne la 10. Sans lui — et de même avec `npx nodefony create app` lancé hors d'un
> projet — npm sert l'ancienne version 7, écrite en JavaScript, qui n'a rien à voir avec cette page.

La commande pose l'application, installe ses dépendances et la construit : compte une à deux
minutes. Sans question posée, elle prend la vitrine **complète** (comptes, sécurité, temps réel,
console d'administration) sur une base **SQLite**. Les fichiers que ce tutoriel touche :

```
mon-app/
├── nodefony.config.ts        # quels modules, dans quel ordre, avec quels réglages
├── env.ts                    # le seul lecteur des variables d'environnement
├── index.ts                  # le module de l'application : il déclare ses services
├── migrations/               # l'historique du schéma de la base, versionné
├── tests/
└── nodefony/
    ├── controllers/
    │   └── HelloController.ts  # une route HTTP + un écho WebSocket, déjà écrits
    ├── entity/                 # les tables (User est déjà là)
    └── service/                # les services de l'application
```

Le fichier central est `nodefony.config.ts` : son tableau `modules` est **ordonné** et décide de ce
qui est chargé. Tout le reste s'y greffe.

## 2. La lancer en développement

```bash
npm run dev
```

Le journal annonce chaque phase du démarrage, puis les adresses d'écoute : `http://127.0.0.1:5151`
pour l'API, et `https://localhost:5152/nodefony` pour la console d'administration. Dans un autre
terminal, appelle la route livrée d'origine :

```bash
curl http://127.0.0.1:5151/api/hello
```

```json
{ "hello": "mon-app", "pid": 31958, "who": "anonyme" }
```

Tu es « anonyme » parce que la route est publique — la zone `^/api` laisse passer le visiteur non
connecté, et `@CurrentUser()` te rend alors un utilisateur anonyme (jamais `null`). Laisse le serveur
tourner : grâce au **superviseur**, chaque modification est reconstruite et le serveur relancé tout
seul.

## 3. Le différenciateur — HTTP et WebSocket dans le même contrôleur

Ouvre `nodefony/controllers/HelloController.ts`. La classe porte, entre autres, `GET /api/hello` (ce
que tu viens d'appeler) et un écho WebSocket sur `/api/echo` — **la même classe**, le même pipeline
(pare-feu, journaux, audit). C'est le pari de Nodefony : HTTP et WebSocket sont co-citoyens, pas deux
mondes séparés.

Teste le canal WebSocket (`npx` télécharge l'outil `wscat` le temps de l'appel, rien n'est installé) :

```bash
npx wscat -c ws://127.0.0.1:5151/api/echo
< {"handshake":true}
> bonjour
< {"echo":"bonjour"}
```

Le premier message arrive **sans que tu aies rien envoyé** : à l'ouverture de la connexion, la méthode
est appelée une première fois sans message, et répond `{"handshake":true}`. Chaque message envoyé
ensuite repasse par la même méthode, et par le même contrôle d'accès que la requête HTTP. Tu n'as
rien câblé de spécial : la route est déclarée `methods: ["WEBSOCKET"]`, c'est tout. `Ctrl+C` pour
sortir.

## 4. Ajouter ta propre route

Dans la classe `HelloController`, juste avant l'accolade qui la ferme, ajoute une méthode. Le
décorateur `@route` déclare l'URL et la méthode HTTP ; `renderJson` renvoie du JSON.

```ts
  @route("route-ping", { path: "/ping", method: "GET" })
  async ping() {
    return this.renderJson({ pong: true, app: "mon-app" });
  }
```

Sauvegarde. Le superviseur reconstruit et relance le serveur en quelques secondes — le journal
affiche `rebuild app`, puis de nouveau `BOOT ok`. Vérifie :

```bash
curl http://127.0.0.1:5151/api/ping
# {"pong":true,"app":"mon-app"}
```

La route est préfixée par `/api` parce que la classe est déclarée `@controller("/api")` : le chemin de
la classe et celui de la méthode se composent.

## 5. Un service, et la requête qu'il sert

Ton serveur est **un seul processus** qui sert toutes les requêtes en même temps : pendant qu'une
requête attend (une base de données, un appel réseau), il en traite une autre. Une variable globale
« requête en cours » serait donc écrasée par la voisine. Nodefony suit chaque requête à travers tout
ton code : n'importe quelle fonction peut demander `RequestContext.getRequestId()` et obtenir celle
qu'elle est en train de servir, sans qu'on lui passe rien.

Fais écrire le service par le générateur — il crée la classe **et** la déclare dans `index.ts`
(`@services([…])`), sans quoi elle n'existerait pas pour le framework :

```bash
npx nodefony create service RequestStamp
```

Dans le fichier créé, `nodefony/service/RequestStampService.ts`, ajoute `RequestContext` à l'import
de `"nodefony"`, puis cette méthode dans la classe :

```ts
  /** L'identifiant de la requête EN COURS, retrouvé sans rien recevoir. */
  currentRequestId(): string {
    return RequestContext.getRequestId() ?? "?";
  }
```

Puis demande le service au contrôleur. Dans `HelloController.ts`, ajoute les deux imports en tête
du fichier, remplace le constructeur, et ajoute une route qui attend un peu — comme le ferait une
vraie requête SQL :

```ts
import { Inject } from "nodefony";
import RequestStampService from "../service/RequestStampService";

// … le constructeur de la classe, qui reçoit maintenant le service :
  constructor(
    context: ContextType,
    @Inject("RequestStampService") private stamp: RequestStampService,
  ) {
    super("hello", context);
  }

// … et une nouvelle méthode, dans la classe :
  @route("route-stamp", { path: "/stamp", method: "GET" })
  async stampRoute() {
    await new Promise((resolve) => setTimeout(resolve, 300)); // une attente
    return this.renderJson({ requestId: this.stamp.currentRequestId() });
  }
```

Sauvegarde, puis lance deux requêtes **en même temps** — chacune attend pendant que l'autre tourne :

```bash
curl -s http://127.0.0.1:5151/api/stamp & curl -s http://127.0.0.1:5151/api/stamp & wait
# {"requestId":"e8e95d40-e745-4d3a-8a77-f83982099a37"}
# {"requestId":"b14737d8-761a-4ac2-be0b-74ce6691f6db"}
```

Deux identifiants différents, alors que le service est **unique** pour toute l'application et que
les deux requêtes se chevauchaient. Une variable globale aurait rendu deux fois le même. C'est ce qui
permet à n'importe quel code — un utilitaire, un service partagé, un journal — de savoir « quelle
requête suis-je en train de servir ».

> Un service est par défaut **partagé** par toute l'application : c'est ce que tu veux pour un cache
> ou un client de base de données. Quand un objet doit **naître et mourir avec** la requête, il se
> déclare de portée `request`. Les trois durées de vie, et comment choisir :
> [Injection & portées](../architecture/injection-portees.md).

## 6. Enregistrer des données — une entité

La base est déjà là : l'application complète est née avec l'ORM et SQLite. Fais générer une entité
`Article` à deux champs — le générateur écrit la table, la validation, le service, le contrôleur
REST et ses tests :

```bash
npx nodefony create entity Article title:string body:text --route /api/articles
```

Ton application **versionne son schéma** : une table nouvelle n'apparaît en base qu'avec sa
migration. Écris-la et applique-la d'un seul geste :

```bash
npx nodefony orm:generate --name articles --apply
```

Ton API REST répond maintenant sur `/api/articles` :

```bash
# créer un article → 201 Created, avec l'adresse de l'article dans l'en-tête Location
curl -X POST http://127.0.0.1:5151/api/articles \
  -H 'content-type: application/json' \
  -d '{"title":"Bonjour","body":"mon premier article"}'

# lister → {"items":[…],"limit":25,"offset":0,"hasNext":false,"total":1}
curl http://127.0.0.1:5151/api/articles
```

Le même contrôleur sert aussi ces lectures en **WebSocket** (les méthodes de lecture sont déclarées
`GET` **et** `WEBSOCKET`) — encore le même code pour les deux transports.

> Chaque évolution du schéma suit le même chemin : modifier l'entité, puis
> `npx nodefony orm:generate --name <ce_qui_change> --apply`. En production, la migration s'applique
> **avant** le déploiement (`nodefony orm:migrate`), jamais depuis le processus qui sert le trafic.
> Le détail : [Drizzle — migrations](../../src/packages/@nodefony/drizzle/docs/migrations.md).

## ⚠️ Pièges (les erreurs de début)

| Symptôme                                                 | Cause                                       | Correction                                                                                             |
| -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| L'application créée ne ressemble en rien à cette page    | Créée sans `@beta` : npm a servi Nodefony 7 | Repars d'un dossier vide avec `npm create nodefony@beta mon-app`.                                      |
| Une route ajoutée répond `404`                           | La reconstruction n'est pas finie           | Attends `BOOT ok` dans le journal du serveur (quelques secondes après la sauvegarde).                  |
| `/api/articles` répond `500` : `no such table: articles` | L'entité est écrite, mais pas sa migration  | `npx nodefony orm:generate --name articles --apply`. Le journal du démarrage le dit aussi.             |
| `500` : `Cannot resolve service "RequestStampService"`   | Classe écrite à la main, jamais déclarée    | Passe par `npx nodefony create service <Nom>`, ou ajoute la classe à `@services([…])` dans `index.ts`. |

## 🔗 Pour aller plus loin

- ⬆️ **Retour** : [Toute la documentation](../index.md) · [Par où commencer](../demarrer.md)
- ⌨️ [La CLI](../../src/nodefony/docs/cli.md) — toutes les commandes (`create`, `dev`, `build`, `production`…)
- 🧩 [Contrôleurs](../../src/packages/@nodefony/framework/docs/controller.md) · [Routage](../../src/packages/@nodefony/framework/docs/routing.md) — pour aller plus loin que `@route`
- 🗄️ [orm-core](../../src/packages/@nodefony/orm-core/docs/index.md) · [Drizzle](../../src/packages/@nodefony/drizzle/docs/index.md) — entités, repositories, dialectes
- 🔐 [Sécurité](../../src/packages/@nodefony/security/docs/index.md) — protéger une zone, authentifier un utilisateur
- 📖 [Lexique général](../lexique.md)
