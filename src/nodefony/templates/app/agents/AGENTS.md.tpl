# AGENTS.md — <%= it.appName %>

> **N'invente jamais du code Nodefony : génère-le, imite-le, vérifie-le.**
> Trois actes pour toute tâche : **LIRE** (ce fichier, puis la doc pointée) →
> **GÉNÉRER** (`nodefony create …` produit du vrai code, à imiter) →
> **VÉRIFIER** (`npm test` d'abord, puis `npm run typecheck`).
>
> **Le réflexe, avant d'écrire le MOINDRE fichier** : un générateur le
> produit-il ? Écrire à la main un CRUD, un controller, une entité ou un
> squelette de module, c'est le signal que tu as raté une commande de la
> table ci-dessous — arrête-toi et lance-la.
>
> Fichier 100 % généré (nodefony <%= it.nodefonyVersion %>) — régénéré par les
> commandes `create`, il ne peut pas mentir. Tes leçons propres à CETTE app
> vont dans la zone « Notes » en bas : elle survit à la régénération.

## Générateurs — appelle-les, ne recompose jamais leur sortie de mémoire

| Besoin | Commande |
| --- | --- |
| Module applicatif (workspace npm) | `nodefony create module <nom>` |
| Controller HTTP **et** WebSocket (même classe) | `nodefony create controller <nom> --kind hello\|rest\|realtime\|duplex\|example` |
| Ressource REST **complète** — entité + service + controller CRUD + tests (ne JAMAIS l'écrire à la main) | `nodefony create entity <Nom> --fields "sku:string! price:float"` |
| Frontend Vite (React/Vue/Angular) | `nodefony create front <nom> [--module <m>]` |

Chaque commande se décrit à une machine : `--describe-json` (questions + options
en JSON), `--answers-json <fichier|->` (réponses en JSON), `--dry-run` (plan et
diffs, zéro écriture). Un refus n'écrit jamais rien (transaction).

## Vérités du framework (anti-préjugés — ce que tu crois savoir est faux ici)

- **Le cœur `nodefony` est ISOMORPHE** : le même paquet se charge côté Node
  ET navigateur. La porte client EXPLICITE est le subpath `nodefony/client`
  (`RealtimeClient`, notices, rôles — résolu à l'identique par Vite, Node et
  le typecheck) ; les hooks React vivent dans `nodefony/react`. Ne réécris
  JAMAIS un client WebSocket/JSON-RPC, ne duplique JAMAIS un type entre front
  et back : un seul contrat, vérifié par le compilateur des deux bouts.
- **Le container DI est PROTOTYPAL** : les services vivent sur une chaîne de
  prototypes — un scope de requête VOIT tous les services du kernel sans
  aucune copie (coût d'un scope ≈ un `Object.create`), et ce qu'on `set()`
  dans un scope MEURT avec la requête. Ne fabrique donc ni cache de services
  par requête, ni singleton maison : `container.get("<nom>")` remonte la
  chaîne, c'est le mécanisme.
- **Le WS métier passe par la socket Nodefony** (`--kind realtime` : canaux
  pub/sub + actions RPC + policies). L'echo WS brut des exemples est une démo
  du pipeline partagé, pas un modèle à imiter.

## Où lire AVANT de coder (tâche → doc installée)

La référence est INSTALLÉE avec les paquets — lis CIBLÉ, jamais tout le dossier.

| Tâche | Doc |
| --- | --- |
| Kernel, cycle de vie, CLI | `node_modules/nodefony/docs/kernel.md` + `cli.md` |
| Service, DI, container, scopes | `node_modules/nodefony/docs/service.md` |
| Client isomorphe (navigateur), hooks React | `node_modules/nodefony/docs/client.md` + `react-hooks.md` |
| Serveurs, sessions, cookies, upload, rate-limit | `node_modules/@nodefony/http/docs/` |
| Routing, controllers, décorateurs, idempotence | `node_modules/@nodefony/framework/docs/` |
<% if (it.hasSecurity) { %>| Firewall, authenticators, CSRF, CORS, clés d'API | `node_modules/@nodefony/security/docs/` |
<% } %><% if (it.hasOrm) { %>| Entités, repositories, requêtes (ORM) | `node_modules/@nodefony/orm-core/docs/` |
<% } %><% if (it.hasRealtime) { %>| Canaux temps réel, actions, protocole WS | `node_modules/@nodefony/realtime/docs/` |
<% } %><% if (it.front) { %>| Builder Vite, entries, HMR | `node_modules/@nodefony/frontend/docs/` |
<% } %><% if (it.hasStudio) { %>| Console d'admin Studio (dev) | `node_modules/@nodefony/studio/docs/` + http://127.0.0.1:5151/nodefony |
<% } %>
La config de l'app vit dans `nodefony.config.ts` (modules chargés) et `env.ts`
(variables d'environnement, seul lecteur de `process.env`) — pointe-les, ne les
recopie pas.

**Les clés de configuration d'un module, avec leurs défauts, sont LISIBLES :**
`node_modules/@nodefony/<module>/dist/nodefony/config/config.js` porte le schéma
Zod du module — chaque clé, son `.default(…)` et sa `.describe(…)`. C'est la
source, pas une copie : la lire évite d'inventer une option qui n'existe pas
(une clé inconnue est retirée en silence à la validation). Ne recopie jamais ces
valeurs dans la doc du projet ; elles bougeront sans toi.

Pour ce que le PROJET offre comme choix (connecteurs déclarés, entités déjà
créées, types de colonnes de ton moteur) :
`npx nodefony create entity --describe-json` — c'est la même source que le
formulaire de Studio, à jour par construction.

## Modules du projet

<% if (it.modules.length === 0) { %>Aucun — `nodefony create module <nom>` en pose un (workspace npm sous `modules/`).
<% } else { %><% it.modules.forEach(function (m) { %>- `<%= m.dir %>/` — `<%= m.name %>` (son `AGENTS.md` local prime quand tu travailles dedans)
<% }) %><% } %>
## Gates — vérifier avant de dire « fait »

```bash
npm test              # 1ᵉʳ diagnostic — unitaires, rapides, zéro serveur
npm run typecheck     # le bundler ne type-check PAS : gate séparé, obligatoire
npm run test:e2e      # boot RÉEL de l'app + HTTP/WS (build inclus)
npm run check         # cohérence du projet (config, modules, wiring)
```

## Méthode de travail

1. **Budget tokens = une règle de conception** : lire ciblé via les tables
   ci-dessus ; ne jamais scanner le projet entier.
2. **Sous-agents au bon modèle** (si ton outil en a) : inventaire/mécanique →
   modèle léger ; architecture/synthèse → modèle fort.
3. **Une règle = une source** : ce fichier POINTE la doc, il ne la recopie
   pas ; n'y recopie rien non plus.
4. **Batcher les modifs serveur** puis UN SEUL cycle build/restart ; le
   frontend passe en HMR, zéro restart.
5. **Vérifier avant de dire « fait »** : `npm test` + `npm run typecheck` ; un
   vert ne couvre que le diff qui l'a produit ; suspecte ton propre diff.
6. **La mémoire de l'app est ci-dessous** : accumule les leçons DURABLES dans
   la zone Notes — pas dans des commentaires éparpillés.

## Notes de cette app (zone préservée à la régénération)

<!-- app-notes:start -->

_(vide — leçons, gotchas et conventions propres à cette app, au fil des sessions)_

<!-- app-notes:end -->
