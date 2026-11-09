<!-- @if core,npm -->
## Nodefony en bref

Nodefony est un framework serveur fullstack pour Node.js, écrit en TypeScript strict et bâti
directement sur les modules natifs de la plateforme — `node:http`, `node:http2`, WebSocket. Il
apporte un noyau à injection de dépendances qui donne à chaque requête son propre conteneur, un
système de modules, un pare-feu applicatif, une
persistance portable, une console d'administration et la construction des frontends.

Sa particularité tient en une propriété : **le WebSocket n'y est pas un ajout.** C'est un transport
de première classe, servi par le même pipeline, la même table de routes et la même sécurité que le
HTTP. Une application temps réel s'y écrit comme une application web ordinaire.

<div align="center">

```bash
npm create nodefony@beta mon-app
```

</div>

### Chaque requête a son propre conteneur

Un processus Node sert des centaines de requêtes **entrelacées** : pendant que l'une attend sa base
de données, une autre s'exécute. Nodefony donne donc à chaque requête **son propre conteneur de
services**, posé comme un **calque** sur celui de l'application.

- **Le mécanisme.** Le conteneur du kernel est la carte ; à l'entrée d'une requête, le pipeline pose
  un calque (`enterScope`) — un objet dont le prototype est la carte. À la fin, `leaveScope` le jette.
- **Ce qu'on y fait.** On lit toute la carte à travers le calque (les services de l'application
  s'héritent) ; on n'écrit que sur son calque. Deux requêtes concurrentes ont deux calques et ne se
  voient jamais ; rien de ce qui est posé sur un calque ne survit à la requête.
- **Le fil qui relie tout : `AsyncLocalStorage`.** Chaque requête s'exécute dans une bulle ALS de
  Node (`RequestContext`) : son identifiant, l'utilisateur, la trace W3C et le calque suivent chaque
  `await`, jusque dans un service ou un adaptateur ORM, sans qu'on les passe d'appel en appel.
- **Comment on l'atteint.** Depuis n'importe quel code de la requête, sans passer le contexte :
  `RequestContext.getScope()` rend le calque courant (ou `undefined`), `requireScope()` lève en
  nommant la cause. La bulle ALS de la requête dit **lequel** est le tien. Un hook
  `onAfterResponse` le voit encore ouvert ; une promesse non attendue qui continue après la réponse,
  non.
- **HTTP et WebSocket.** Une requête HTTP = un calque. Une connexion WebSocket = un calque, partagé
  par tous ses messages, concurrents compris.
- **Des services par requête.** `@injectable({ scope: "request" })` donne un exemplaire par requête,
  créé seulement si la requête le demande, et nettoyé (`clean()`, dans l'ordre inverse des
  créations) à sa fermeture. Un singleton qui en dépendrait est refusé dès le démarrage,
  plutôt que de devenir lui-même, sans qu'on l'ait écrit, un service par requête.
- **Le coût, avec son décor.** Poser puis jeter un calque ≈ 1,43 µs (sonde dans le serveur, un
  processus en production, paires alternées) ; une requête qui ne résout aucun service par requête
  ne paie rien de plus.

```ts
import { Service, injectable, RequestContext } from "nodefony";
import type { Scope } from "nodefony";

@injectable({ name: "requestStamp", scope: "request" })
export class RequestStamp extends Service {
  readonly requestId: string;
  constructor(scope: Scope) {
    super("requestStamp", scope, false); // un exemplaire pour CETTE requête
    this.requestId = RequestContext.getRequestId() ?? "?";
  }
}
```

Le détail — les trois durées de vie, l'accès par `RequestContext`, les pièges :
[Injection & portées](https://nodefony.net/docs/architecture/injection-portees/).

Les frontends ne sont pas laissés dehors. Nodefony pilote **Vite** : en développement il démarre
les serveurs de développement — React, Vue, Angular, Svelte —, les surveille, relaie leur rechargement à
chaud et sert leurs pages ; en production il construit les bundles et les distribue. Une
application peut en porter plusieurs, chacun monté sur sa route.

Le socle, lui, est **isomorphe** : le même paquet s'importe côté serveur et côté navigateur. Le
client temps réel, les règles d'autorisation, les types d'une ressource sont écrits une fois et
s'exécutent là où ils servent — une règle corrigée l'est des deux côtés.
<!-- @end -->

<!-- @if app -->
## Ce dépôt, et le framework

**Ce dépôt est une application.** Il ne contient pas Nodefony : il l'utilise, comme une
application React ne contient pas React. Le framework vit ailleurs, et c'est une distinction
qui évite beaucoup de temps perdu.

- **Comprendre ce que fait le framework** → [la documentation](https://nodefony.net/docs/), en
  commençant par [Par où commencer](https://nodefony.net/docs/demarrer/).
- **Ce qu'est Nodefony, et ce que ses partis pris coûtent** →
  [l'architecture en vue d'ensemble](https://nodefony.net/docs/architecture/vue-ensemble/).
- **Le code d'un paquet que cette app importe** → [`nodefony/nodefony-core`](https://github.com/nodefony/nodefony-core),
  dans `src/packages/@nodefony/<nom>`.
- **Brancher TON implémentation** — authentification, stockage, bus temps réel →
  [Étendre le framework](https://nodefony.net/docs/guides/etendre/), quatorze points d'accroche.
- **Signaler un défaut, demander une évolution** → [les issues de `nodefony-core`](https://github.com/nodefony/nodefony-core/issues).
- **Qui décide, et comment** → [la gouvernance](https://github.com/nodefony/nodefony-core/blob/main/GOVERNANCE.md).

⚠️ **Ce dont tu n'hérites PAS.** `nodefony-core` est un monorepo de développement : il porte les
paquets du framework, mais aussi ses bancs de mesure, ses gabarits, ses suites de test et son
outillage d'agent. **Rien de tout cela n'entre dans cette application** — le lire donne
l'implémentation du framework, jamais ce que ton application embarque. Ce qu'elle embarque
vraiment se lit dans **son** `package.json`, ici même.
<!-- @end -->
