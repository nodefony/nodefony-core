<div align="center">

# NODEFONY

**Framework Node.js fullstack, en TypeScript strict — pour le temps réel, et demain les agents IA.**

_HTTP et WebSocket : même contrôleur, même contexte, même session._

[![Licence : CeCILL-B](https://img.shields.io/badge/licence-CeCILL--B-blue.svg?style=flat-square)](http://www.cecill.info/licences/Licence_CeCILL-B_V1-fr.html)
[![Version](https://img.shields.io/badge/version-10.0.0--alpha-blueviolet?style=flat-square)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6%20·%20strict-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-green?style=flat-square)](https://nodejs.org/)
[![ESM](https://img.shields.io/badge/ESM-only-orange?style=flat-square)](https://nodejs.org/api/esm.html)
[![Tests](https://img.shields.io/badge/tests-4885%20verts-success?style=flat-square)](#qualité--ce-qui-est-réellement-verrouillé)

</div>

---

## En une phrase

Nodefony est un framework serveur **bâti directement sur les modules natifs de Node**
(`node:http`, `node:http2`, WebSocket) — ni Express, ni Fastify en dessous. Il fournit un noyau, un
conteneur d'injection de dépendances, un système de modules, un pare-feu applicatif, une couche de
persistance portable, un tableau de bord d'administration et un builder frontend. Le tout en
**TypeScript strict, ESM uniquement**.

Sa particularité tient en une propriété que peu de frameworks Node offrent nativement : **le
WebSocket n'est pas un ajout — c'est un transport de première classe, servi par le même pipeline que
le HTTP.**

---

## Le différenciateur, en un fichier

Cette action est écrite **une seule fois**. Elle ne voit **aucune** information de transport. Elle est
joignable en REST _et_ par appel de procédure WebSocket :

```ts
import { Controller, controller, route, Param } from "@nodefony/framework";
import { Context } from "@nodefony/http";

@controller("/books")
class BookController extends Controller {
  constructor(context: Context) {
    super("BookController", context);
  }

  @route("books-by-author", {
    path: "/by-author/{authorId}",
    requirements: { methods: ["GET", "WEBSOCKET"] }, // ← les deux portes
  })
  byAuthor(@Param("authorId") authorId: string) {
    return bookService.byAuthor(authorId);
    // retour brut : REST le sérialise en JSON, le pont WebSocket l'enveloppe en JSON-RPC
  }
}
```

Ce n'est pas du sucre syntaxique. Dans le code :

- `WebsocketContext.getMethod()` renvoie la pseudo-méthode `"WEBSOCKET"`, traitée comme un verbe HTTP
  ordinaire → **une seule table de routes** pour les deux transports ;
- **le même `Resolver.callController()`** sert les deux pipelines ;
- le WebSocket ouvre **la même bulle `AsyncLocalStorage`** que le HTTP, et `AsyncResource.bind` la
  propage à chaque _frame_ : le `requestId` et l'utilisateur restent stables du _handshake_ jusqu'à la
  fermeture de la socket.

**Ce que ça change concrètement :** un `@IsGranted` protège une action aussi bien en HTTP qu'en
WebSocket, et une session ouverte en HTTP est celle que voit la socket. Pas de passerelle, pas de
seconde pile d'authentification, pas de logique dupliquée.

C'est aussi ce qui fait du **streaming d'un modèle de langage** un cas d'usage naturel plutôt qu'un
bricolage : un `AsyncGenerator` branché sur un canal, dans le même contexte de sécurité que le reste
de l'application.

---

## Ce qu'il y a dans la boîte

| Domaine                                                                   | Contenu                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cœur** — `nodefony`                                                     | Noyau à 11 événements de cycle de vie · conteneur d'injection · `AsyncLocalStorage` corrélé (`requestId`, utilisateur) · journalisation structurée RFC 5424 avec 5 pilotes interrogeables (mémoire, fichier, cluster, Loki, OpenSearch) · configuration validée par Zod avec surcharge par variables d'environnement · CLI à 11 commandes |
| **Transport** — `@nodefony/http`                                          | HTTP, HTTPS, HTTP/2 **natifs `node:`** · WebSocket · sessions (mémoire, Redis, SQL, Mongo) avec cookie `__Host-` · certificats TLS conformes RFC 5280/6125 · `Forwarded` RFC 7239 et _trust proxy_                                                                                                                                        |
| **Applicatif** — `@nodefony/framework`                                    | Routeur à index statique/dynamique · une trentaine de décorateurs · vues Eta · `ResourceController` : un service exposé en REST **et** en WebSocket                                                                                                                                                                                       |
| **Sécurité** — `@nodefony/security`, `@nodefony/user`                     | Pare-feu à zones · session serveur _ou_ JWT selon la surface · OAuth2/OIDC · WebAuthn/Passkeys · TOTP · clés d'API · RBAC à _voters_ · CSRF · journal d'audit · webhooks signés                                                                                                                                                           |
| **Persistance** — `@nodefony/orm-core` + `drizzle` / `mongoose` / `redis` | Contrat _Repository_ portable (14 méthodes, critères typés) · Drizzle sur SQLite, PostgreSQL et MySQL · Mongoose · Redis                                                                                                                                                                                                                  |
| **Temps réel** — `@nodefony/realtime`                                     | JSON-RPC 2.0 bidirectionnel · canaux · _back-pressure_ · _backplane_ cluster (IPC) et Redis · client navigateur **isomorphe** : le même contrat typé des deux côtés                                                                                                                                                                       |
| **Front** — `studio`, `frontend`, `documentation`                         | Tableau de bord d'administration (une trentaine d'écrans) · builder Vite supervisé (React 19, Vue 3, Angular) · portail de documentation                                                                                                                                                                                                  |

---

## Le Studio — le framework se regarde tourner

`@nodefony/studio` est un tableau de bord d'administration livré avec le framework (React 19,
Mantine, MobX) : topologie du runtime cliquable, journaux en direct avec rejeu, suivi d'une requête par
`requestId`, graphe ERD de la base, graphe des classes par module, gouvernance de la sécurité (audit,
pare-feu, rôles, sessions, clés d'API), et un générateur de code dont la sortie est **streamée comme un
terminal**.

Sa vraie force est en dessous : **il ne consomme aucune API privée.** Toutes ses données proviennent
d'un _data plane_ d'environ **78 points d'accès JSON**, protégés par RBAC, **auto-décrits** (un appel
en renvoie le catalogue complet) et **duplex** — le même point d'accès répond en HTTP et via le pont
WebSocket-RPC.

> C'est la fondation de la vision IA : **un agent pourra consommer exactement les mêmes points d'accès
> que le tableau de bord** — lire l'état du système, corréler, expliquer. Ce n'est pas du HTML à
> gratter, c'est un contrat introspectable.

---

## Sécurité — la partie la plus travaillée

Le pare-feu découpe l'application en **zones**, chacune associée à une chaîne d'authentificateurs. Il
est _fail-closed_ : une configuration invalide capture tout le trafic et répond 401.

- **Authentification** — anonyme, identifiant/mot de passe, session, JWT, clé d'API ; plus OAuth2/OIDC
  (**PKCE S256 obligatoire**), WebAuthn/Passkeys et TOTP.
- **Modèle hybride assumé** — **session serveur** (cookie opaque `HttpOnly`, identifiant régénéré au
  login) pour le web et le Studio ; **JWT en `Authorization: Bearer`**, _jamais_ en cookie ni en URL,
  pour les API et les agents. Jeton de rafraîchissement opaque avec **rotation et détection de
  réutilisation** : un jeton rejoué révoque toute la famille.
- **Cryptographie** — **Argon2id** (RFC 9106) par défaut ; bcrypt conservé en _legacy_ avec re-hachage
  transparent. Jetons signés en **EdDSA/Ed25519**. Secrets chiffrés en AES-256-GCM + HKDF.
- **Autorisation** — hiérarchie de rôles avec détection de cycles au démarrage, _voters_, refus par
  défaut.
- **CSRF** — _Fetch Metadata_ en défense primaire, repli sur `Origin`/`Referer`, double-soumission
  signée HMAC-SHA256 comparée en temps constant.

### Équipe rouge, équipe bleue

La sécurité n'est pas testée par des cas nominaux (« le login fonctionne ») mais par des **campagnes
d'attaque**, en deux passes dont l'ordre est le cœur du dispositif :

1. **Passe rouge — _threat-first_** : la matrice d'attaque est construite depuis OWASP et les RFC
   **avant d'avoir lu le code**. C'est un garde-fou anti-biais : qui lit l'implémentation d'abord ne
   teste que ce que le code prévoit — et rate précisément ce qu'il a oublié.
2. **Passe bleue — _code-first_** : on lit l'implémentation, puis on couvre les branches restantes.
3. **Cycle rouge → bleue** : faille trouvée → corrigée → **re-prouvée par un test qui échouait avant**.

**120 cas d'attaque sur 15 fichiers** — et le cycle est traçable dans le journal git : canaux réservés
franchissables (F2/F3), socket survivant à la révocation de sa session (F4), absence de cap de canaux
par connexion (F6a/F9), pollution de prototype par _frame_ WebSocket (F7) — chacune trouvée, corrigée,
puis verrouillée par un test.

Ce qui distingue ces attaques d'un scan générique : beaucoup visent des vecteurs **propres à
l'architecture** — le scope d'injection de dépendances, les frames du pipeline WebSocket partagé, le
pont `api.request`, le jeton porté par l'`AsyncLocalStorage`. Aucun outil sur étagère ne connaît ces
surfaces : il a fallu **concevoir** les attaques.

> ⚠️ **À savoir avant de concevoir votre application.** Le refus par défaut opère **par zone du
> pare-feu**, pas route par route : une route située hors de toute zone déclarée est **publique**.
> Déclarez vos zones.

---

## Qualité — ce qui est réellement verrouillé

|                                             |                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4 885 tests verts**                       | `npm test`, 15 espaces de travail, dont 120 cas d'attaque — auxquels s'ajoutent les suites lancées à part (`test:memory`, `test:load`, `test:integration`) |
| **TypeScript strict**                       | dans les 14 espaces de travail ; aucun ne le désactive                                                                                                     |
| **0 `@ts-ignore`**                          | aucun avertissement du compilateur n'est mis sous le tapis                                                                                                 |
| **`@ts-expect-error` : uniquement en test** | ils y sont des **assertions** — ils prouvent qu'un type _refuse_ ce qu'il doit refuser                                                                     |
| **ESM à 100 %**                             | préfixe `node:` sur 99,5 % des imports natifs                                                                                                              |
| **0 FIXME**                                 | et une poignée de `TODO`, tous rattachés à une phase de la feuille de route                                                                                |
| **Intégration continue**                    | Linux / macOS / Windows × Node 24 et 26 — build, typecheck, tests unitaires, intégration sur serveur réel, CodeQL quotidien                                |

**Une méthode peu commune, qui mérite d'être signalée :** le dépôt **versionne des seuils de fuite
mémoire et de charge**, opposables à chaque exécution — 1 000 requêtes HTTP sous 35 Mo de _heap_ ;
500 connexions WebSocket sous 60 Mo ; p99 sous 100 ms sur 500 _frames_ ; 100 _crashs_ sans fuite ; zéro
_scope_ `AsyncLocalStorage` fuité après 500 erreurs. Point de rupture mesuré : **16 372 connexions
WebSocket simultanées**.

_Ces suites tournent aujourd'hui en local, pas encore en intégration continue — c'est un chantier
ouvert._

---

## Démarrage

```bash
git clone https://github.com/nodefony/nodefony-core.git
cd nodefony-core
npm install
npm run build
npm run dev            # http://localhost:5151 · Studio sur /nodefony
```

Générer une application, un module, un contrôleur ou une entité :

```bash
nodefony create app <nom>
nodefony create module <nom> [--frontend react|vue|angular]
nodefony create entity <nom> --fields "title:string,published:boolean"
```

Le même générateur est pilotable depuis le Studio, la sortie étant streamée en direct.

---

## État du projet — sans enrobage

Nodefony est né en **2017** en JavaScript et a mûri jusqu'à sa version 7. Ce dépôt est une
**réécriture complète**, entamée fin 2023 : TypeScript strict, ESM, décorateurs, pensée pour le
cloud-native. Elle vise la **version 10**, aujourd'hui en `alpha`.

**Solide et testé** — le noyau, le pipeline HTTP/WebSocket, le routeur, la sécurité, le temps réel, la
persistance, le Studio, le builder frontend.

**Ce qui manque, et qu'il faut savoir avant de bâtir dessus :**

- **Aucun système de migration de base de données.** Le schéma est dérivé au démarrage
  (`CREATE TABLE IF NOT EXISTS`) : confortable en développement, insuffisant en production. Le design
  est arrêté, l'implémentation reste à faire.
- **Les transactions Drizzle ne fonctionnent qu'en SQLite** — correctif prioritaire.
- **Pas de validation d'entrée déclarative** : `@Body()` injecte la charge utile brute. Zod ne valide
  aujourd'hui que la configuration.
- **Les décorateurs sont en mode _legacy_** (`experimentalDecorators`), pas encore TC39.
- **Le Studio n'a aucun test de composant** : ses écrans ne sont couverts que par le typecheck.

### Performance — et la seule comparaison qui vaille

Un banc comparatif oppose souvent Nodefony à une application Express qui tient en une ligne
(`app.get(path, (_req, res) => res.json(state))`). Cette comparaison est trompeuse : cet Express-là ne
fait **ni `AsyncLocalStorage`, ni `requestId`, ni `traceparent`, ni en-têtes de sécurité, ni CORS, ni
contrôle CSRF, ni pare-feu**. Nodefony fait tout cela à chaque requête.

Le banc a donc été rejoué en juillet 2026 avec une troisième application : **le même Express, équipé des
middlewares qui font le même travail** (ALS, helmet, cors, CSRF par Fetch Metadata, matching des zones).
Même machine, même fenêtre, 186 routes, `wrk -t4 -c128 -d12s`, médiane — dérive contrôlée sous 3 % :

|                                        | requêtes/s |
| -------------------------------------- | ---------: |
| `node:http` nu                         |    ~20 700 |
| Fastify 5                              |    ~18 800 |
| Express 5 — **nu**                     |    ~10 200 |
| Express 5 — **équipé du même travail** |     ~8 000 |
| **Nodefony**                           | **~5 300** |

**Équiper Express coûte 22 % de son débit.** L'écart réel, à travail égal, tombe donc de **×1,94 à
×1,52** — et c'est une _borne haute_, l'Express équipé ne faisant toujours ni profiling, ni contrôle
d'idempotence, ni `domainCheck`.

Nodefony reste néanmoins le plus lent, et c'est assumé. Le profil CPU est sans ambiguïté : **le routage
ne pèse que 0,9 %** du temps. Le surcoût vient de l'observabilité placée sur le chemin critique et du
cycle de vie des sockets — des choix d'implémentation, _pas_ un défaut d'architecture. Deux
optimisations récentes ont déjà rendu +15,3 % et +10,8 %.

### Dimensionnement

Constantes mesurées en production (profiler éteint), pour dimensionner une infrastructure :

| Unité de travail            | Coût en boucle d'événements              |
| --------------------------- | ---------------------------------------- |
| 1 requête `http/1.1`        | 207 µs                                   |
| 1 requête `h2` (multiplexé) | 154 µs                                   |
| 1 message WebSocket         | **70 µs** — 3× moins cher qu'une requête |
| 1 socket                    | ~17,5 Ko de _heap_                       |

Débit soutenable à 70 % de charge (au-delà, la p99 décroche) : **~3 400 req/s** en HTTP,
**~4 500 req/s** en HTTP/2, **~10 000 msg/s** en WebSocket, par processus. Le _fan-out_ est ~100× moins
cher qu'un aller-retour : un canal se dimensionne sur les **livraisons**
(`publications × abonnés`), pas sur les publications.

> Ces chiffres valent pour une route **sans session ni ORM** — le pipeline nu. Une route authentifiée
> paie en plus le store de session, **qui domine tout le reste**. Rejouez le banc sur vos routes.

---

## La vision IA — une intention, pas une fonctionnalité

Le projet porte une thèse : **serveur, orchestration IA et gouvernance des données devraient être le
même framework, dans le même runtime.** Le streaming d'un modèle est le cas d'usage idéal du duo
HTTP/WebSocket ; un agent est un service injectable comme un autre ; et un agent d'entreprise est
d'abord un problème de gouvernance — souveraineté, traçabilité des sources, filtrage des données
personnelles, validation humaine avant action.

**Soyons nets sur l'état du code : cette couche n'existe pas encore.** Ce qui existe aujourd'hui, ce
sont environ 2 300 lignes d'esquisses, dont un `@nodefony/llm` fonctionnel (fournisseurs Claude et
Ollama, streaming réel par `AsyncGenerator` et `AbortSignal`). **Il n'y a aucun agent, aucune
gouvernance, aucun serveur MCP.**

Deux fondations, en revanche, sont bien réelles et rendent la suite crédible :

- le **data plane introspectable** du Studio — 78 points d'accès qu'un agent peut consommer tels quels ;
- un **graphe symbolique** du code — plus de 2 200 symboles avec leurs relations inverses (qui étend
  quoi, qui implémente quoi, qui utilise quoi), régénéré à chaque commit, qu'un agent interroge en O(1)
  au lieu de faire du `grep`.

Une décision est déjà prise et tenue : **l'inférence est orchestrée, jamais embarquée.** Le cœur ne
fera jamais tourner un modèle dans son processus — il supervise un backend externe (Ollama, vLLM, une
API distante), exactement comme il supervise déjà Vite. Un serveur web et un GPU ne montent pas en
charge de la même façon.

📄 [Livre blanc — la couche IA](docs/ia/livre-blanc-couche-ia.md)

---

## Documentation

- [Guides](docs/guides/) — configuration, persistance, sessions, frontend React, Docker
- [Architecture](docs/architecture/) — builder frontend, socket temps réel
- [Décisions d'architecture (ADR)](docs/adr/) — les 7 décisions structurantes et leur _pourquoi_
- Le portail de documentation est également servi par le Studio, sur `/nodefony/documentation`

---

## Contribuer

Les contributions sont bienvenues. Le dépôt impose les _Conventional Commits_ (vérifiés au commit) et
un `build` + `typecheck` complet avant chaque _push_.

```bash
npm test              # 4 885 cas, sur les 15 espaces de travail
npm run typecheck
npm run test:memory   # seuils de fuite mémoire
npm run test:load     # charge HTTP et WebSocket (serveur requis)
```

La branche `claude-ts` est la ligne de développement active. Pour toute contribution substantielle,
ouvrez d'abord une discussion sur l'architecture.

---

## Licence

**[CeCILL-B](http://www.cecill.info/licences/Licence_CeCILL-B_V1-fr.html)** — licence libre de droit
français, compatible BSD.

**Christophe Camensuli** — [ccamensuli@gmail.com](mailto:ccamensuli@gmail.com) ·
[github.com/ccamensuli](https://github.com/ccamensuli)
Nodefony depuis 2017. En solo, pour tout le monde. Libre et open source.
