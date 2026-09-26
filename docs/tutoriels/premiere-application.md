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
updated: 2026-09-26
source: "docs/tutoriels/premiere-application.md"
tests: none
---

# Ta première application Nodefony

> Un tutoriel qui se **fait**, pas qui se lit : à la fin, tu auras une application qui répond en HTTP,
> répond aussi en WebSocket **depuis le même code**, et persiste des données — le tout lancé en
> développement avec rechargement à chaud. On avance par petites étapes, chacune se termine par
> **quelque chose que tu observes**. Aucune connaissance préalable de Nodefony n'est requise.

📍 [Documentation](../index.md) › **Ta première application**

## 🎯 Que vas-tu construire

Une petite application `mon-app`, du néant jusqu'à :

1. une **page** qui répond `GET /api/hello` en JSON ;
2. le **différenciateur Nodefony** : la même classe controller sert HTTP **et** WebSocket ;
3. ta **propre route** ajoutée à la main ;
4. un **service par requête** — et la preuve que deux requêtes simultanées ne se mélangent jamais ;
5. une **entité** `Article` persistée, avec son CRUD REST généré.

**Prérequis** : Node.js 24+ et `npm`. Rien d'autre — la base de données du tutoriel est un fichier
SQLite créé pour toi. Compte 15 minutes.

## 📖 Lexique

Les mots qui reviennent (le vocabulaire complet est dans le [lexique général](../lexique.md)) :

| Terme               | En clair                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| **scaffold**        | Génération de code à partir de gabarits (`nodefony create …`). Tu lances, le code apparaît.     |
| **controller**      | La classe qui répond à une route. Chez Nodefony, une seule classe peut répondre HTTP **et** WS. |
| **service**         | Une classe de logique réutilisable, que le framework construit et te donne (`@inject`).         |
| **scope**           | Le conteneur propre à UNE requête : un calque posé sur celui de l'application, jeté à la fin.   |
| **entité**          | Une table de base de données décrite en TypeScript, avec son service et son CRUD.               |
| **HMR**             | Hot Module Replacement : le serveur de dev recharge ton code à chaud, sans redémarrage manuel.  |
| **zone / firewall** | Un préfixe d'URL et sa politique de sécurité (ici `^/api`, visiteur « anonyme » autorisé).      |

## 1. Créer l'application

Depuis un dossier vide, échafaude un projet. `--preset minimal` garde le strict nécessaire (HTTP +
framework) — tu ajouteras le reste quand tu en auras besoin.

```bash
npx nodefony create app mon-app --preset minimal
cd mon-app
```

Tu obtiens un projet prêt à tourner :

```
mon-app/
├── nodefony.config.ts        # l'orchestrateur : quels modules, quelle config
├── env.ts                    # le seul lecteur des variables d'environnement
├── index.ts                  # le point d'entrée (passe la config au kernel)
├── tests/
│   └── GreetingService.test.ts
└── nodefony/
    ├── controllers/
    │   ├── HomeController.ts  # répond à `GET /` — sans frontend, la racine
    │   │                      #   renverrait 404 sans lui
    │   └── HelloController.ts # une route HTTP + un echo WebSocket, déjà écrits
    ├── service/
    │   └── GreetingService.ts # un service d'exemple : le patron à imiter
    └── interfaces/
        └── IGreetingService.ts
```

Le fichier central est `nodefony.config.ts` : son tableau `modules` est **ordonné** et décide de ce
qui est chargé. Tout le reste s'y greffe.

## 2. La lancer en développement

```bash
npm run dev
```

Le serveur démarre sur le port **5151** ; le journal annonce chaque phase du boot, module par module.
Dans un autre terminal, appelle la route livrée d'origine :

```bash
curl http://127.0.0.1:5151/api/hello
```

```json
{ "hello": "mon-app", "pid": 12345, "who": "anonyme" }
```

Tu es « anonyme » parce que la route est publique — la zone `^/api` autorise le visiteur non connecté,
et `@CurrentUser()` te rend alors un utilisateur anonyme (jamais `null`). Laisse le serveur tourner :
grâce au **HMR**, chaque modification de code que tu vas faire est prise en compte à chaud.

## 3. Le différenciateur — HTTP et WebSocket dans le même controller

Ouvre `nodefony/controllers/HelloController.ts`. La classe porte **deux** routes : `GET /api/hello`
(ce que tu viens d'appeler) et un echo WebSocket sur `/api/echo` — **la même classe**, le même
pipeline (firewall, journaux, audit). C'est le pari de Nodefony : HTTP et WebSocket sont co-citoyens,
pas deux mondes séparés.

Teste le canal WebSocket (installe `wscat` si besoin : `npm i -g wscat`) :

```bash
wscat -c ws://127.0.0.1:5151/api/echo
> bonjour
< {"echo":"bonjour"}
```

Le message repasse par le même contrôle d'accès que la requête HTTP. Tu n'as rien câblé de spécial :
une méthode marquée `methods: ["WEBSOCKET"]` suffit.

## 4. Ajouter ta propre route

Dans la classe `HelloController`, ajoute une méthode. Le décorateur `@route` déclare l'URL et la
méthode HTTP ; `renderJson` renvoie du JSON.

```ts
// dans nodefony/controllers/HelloController.ts, à l'intérieur de la classe
@route("route-ping", { path: "/ping", method: "GET" })
async ping() {
  return this.renderJson({ pong: true, app: "mon-app" });
}
```

Sauvegarde. Le HMR recharge tout seul — pas de redémarrage. Vérifie :

```bash
curl http://127.0.0.1:5151/api/ping
# { "pong": true, "app": "mon-app" }
```

La route est préfixée par `/api` parce que la classe est déclarée `@controller("/api")` : le chemin de
la classe et celui de la méthode se composent.

## 5. Un service, et ce que voit ta requête

Ton serveur est **un seul processus** qui sert toutes les requêtes en même temps : pendant qu'une
requête attend (une base de données, un appel réseau), il en traite une autre. Une variable globale
serait donc écrasée par la requête voisine. Nodefony règle ce problème une fois pour toutes :
**chaque requête reçoit son propre conteneur de services** — un calque transparent posé sur celui de
l'application. Elle lit tout à travers, n'écrit que sur le sien, et le calque part à la poubelle
quand la réponse est envoyée.

Crée un service qui vit le temps d'**une** requête — la portée `request` :

```ts
// nodefony/service/RequestStamp.ts
import { Service, injectable, RequestContext } from "nodefony";
import type { Scope } from "nodefony";

// Un exemplaire PAR REQUÊTE : créé quand la requête le demande, jeté avec elle.
@injectable({ name: "requestStamp", scope: "request" })
export class RequestStamp extends Service {
  readonly requestId: string;

  constructor(scope: Scope) {
    super("requestStamp", scope, false);
    this.requestId = RequestContext.getRequestId() ?? "?";
  }
}
```

Puis demande-le dans le constructeur de `HelloController`, et ajoute une route qui attend un peu —
comme le ferait une vraie requête SQL :

```ts
// dans nodefony/controllers/HelloController.ts
import { inject, RequestContext } from "nodefony";
import { RequestStamp } from "../service/RequestStamp";

// … le constructeur de la classe reçoit le service en plus du contexte :
constructor(
  context: ContextType,
  @inject("requestStamp") private stamp: RequestStamp,
) {
  super("hello", context);
}

// … et une nouvelle méthode, à l'intérieur de la classe :
@route("route-stamp", { path: "/stamp", method: "GET" })
async stampRoute() {
  await new Promise((resolve) => setTimeout(resolve, 300)); // une attente
  return this.renderJson({
    requestId: this.stamp.requestId,
    // le scope de CETTE requête, retrouvé sans rien recevoir en argument
    onMyLayer: RequestContext.getScope()?.get("requestStamp") === this.stamp,
  });
}
```

Lance deux requêtes **en même temps** — elles attendent toutes les deux pendant que l'autre tourne :

```bash
curl -s http://127.0.0.1:5151/api/stamp & curl -s http://127.0.0.1:5151/api/stamp & wait
# {"requestId":"…a1","onMyLayer":true}
# {"requestId":"…b2","onMyLayer":true}
```

Deux identifiants différents : chaque requête a eu **son** exemplaire, même en se chevauchant. Et
`RequestContext.getScope()` a retrouvé le bon calque sans qu'on lui passe quoi que ce soit — c'est ce
qui permet à n'importe quel code (un utilitaire, un service partagé) de savoir « quelle requête suis-je
en train de servir ».

> Un service **sans** `scope` est partagé par toute l'application (une seule instance) : c'est ce que
> tu veux pour un cache ou un client de base de données. La portée `request` sert à ce qui doit
> **naître et mourir avec** la requête. Les trois durées de vie, et comment choisir :
> [Injection & portées](../architecture/injection-portees.md).

## 6. Persister des données — une entité

Pour stocker des données, il faut un module de base de données. Ajoute l'ORM par défaut (Drizzle,
adossé à SQLite en développement) au tableau `modules` de `nodefony.config.ts` :

```ts
modules: [
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/drizzle", // ← l'ORM ; SQLite en dev, aucun serveur à installer
],
```

Installe la dépendance, puis échafaude une entité `Article` avec deux champs — le scaffold génère la
table, le service de validation, le controller CRUD et ses tests :

```bash
npm install
npx nodefony create entity Article title:string body:text --route /api/articles
```

Relance le serveur (`npm run dev`) : au démarrage, la table `article` est créée
(`CREATE TABLE IF NOT EXISTS`). Ton CRUD REST répond maintenant sur `/api/articles` :

```bash
# créer un article → 201 Created + en-tête Location
curl -X POST http://127.0.0.1:5151/api/articles \
  -H 'content-type: application/json' \
  -d '{"title":"Bonjour","body":"mon premier article"}'

# lister
curl http://127.0.0.1:5151/api/articles
```

Le même controller sert aussi ces lectures en **WebSocket** (les méthodes de lecture sont déclarées
`GET` **et** `WEBSOCKET`) — encore le même code pour les deux transports.

> Le scaffold **dit la vérité** : la table naît au boot suivant. Ajouter ensuite un champ **qui
> accepte le vide** le pose au démarrage d'après ; un champ **obligatoire**, non — la valeur des
> lignes déjà là ne s'invente pas. Pour repartir propre en dev : `nodefony orm:reset`.

## ⚠️ Pièges (les erreurs de début)

| Symptôme                             | Cause                                                     | Correction                                                                                                    |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `404` sur `/api/hello`               | Serveur lancé depuis un sous-dossier (« projet fantôme ») | Lance **depuis la racine** de `mon-app` (là où est `nodefony.config.ts`).                                     |
| Une route ajoutée n'apparaît pas     | Le `dist/` est périmé                                     | Le HMR suffit en dev ; sinon `npm run build` puis relance.                                                    |
| `create entity` refuse de s'exécuter | aucun ORM dans le projet                                  | Ajoute `@nodefony/drizzle` (SQL) ou `@nodefony/mongoose` (MongoDB) à `modules` + `npm install`, puis relance. |
| Le port 5151 est déjà pris           | Un serveur tourne déjà                                    | `npx nodefony stop`, ou change le port dans `nodefony.config.ts`.                                             |

## 🔗 Pour aller plus loin

- ⬆️ **Retour** : [Toute la documentation](../index.md) · [Par où commencer](../demarrer.md)
- ⌨️ [La CLI](../../src/nodefony/docs/cli.md) — toutes les commandes (`create`, `dev`, `build`, `production`…)
- 🧩 [Contrôleurs](../../src/packages/@nodefony/framework/docs/controller.md) · [Routage](../../src/packages/@nodefony/framework/docs/routing.md) — pour aller plus loin que `@route`
- 🗄️ [orm-core](../../src/packages/@nodefony/orm-core/docs/index.md) · [Drizzle](../../src/packages/@nodefony/drizzle/docs/index.md) — entités, repositories, dialectes
- 🔐 [Sécurité](../../src/packages/@nodefony/security/docs/index.md) — protéger une zone, authentifier un utilisateur
- 📖 [Lexique général](../lexique.md)
