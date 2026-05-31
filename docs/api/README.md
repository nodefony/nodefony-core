---
title: "API souveraine par construction — vision & POC (DRAFT)"
type: draft
status: draft — NON FIGÉ, document de travail
audience: architecte, contributeurs Nodefony
auteur: Christophe Camensuli
date: 2026-05-31
version: 0.1 (draft)
---

# API souveraine par construction — vision & POC

> ⚠️ **DRAFT, rien n'est figé.** Ce document retrace une discussion de design (2026-05-31).
> Il est volontairement **très complet** et **liste tous les doutes** (§11). Il sert à cadrer
> un **POC en branche** (§9) qui validera — ou invalidera — ces idées. Tant que le POC n'a pas
> tranché, **aucune** décision ici n'est définitive.

---

## 0. Avertissement « pas d'usine à gaz »

La promesse est **simple** et sert justement à **éviter** la complexité : on écrit la logique
**une seule fois** (le service), et on y accède par plusieurs portes (REST, temps réel, GraphQL)
**sans la réécrire**. Tout le reste (`ResourceController`, GraphQL auto, offline) est **optionnel** :
on commence avec un service + un controller REST, on ajoute une porte **seulement si le besoin arrive**.

---

## 1. La thèse

> **Un schéma d'entité est l'unique source de vérité d'où dérivent — par projection — toutes les
> surfaces API (REST, GraphQL, temps réel), chacune isomorphe, observable et gouvernée. La même
> donnée est lue par un humain (REST), un navigateur (WS), un dashboard et un agent IA, à travers
> le même plan, sous la même garde.**

Positionnement (à confirmer par le POC) : aucun framework ne fait *tout* ça nativement.
Hasura/PostGraphile = DB→GraphQL ; tRPC = RPC typé ; NestJS = serveur ; LangChain = IA.
Nodefony viserait **les 3 surfaces + observabilité + gouvernance AI Act/RGPD, depuis une déclaration unique**.

---

## 2. Les concepts (vocabulaire commun)

| Terme | Analogie | Rôle |
| ----- | -------- | ---- |
| **Service** | la cuisine | la logique métier, écrite **une fois** (`AbstractCrudService`) |
| **Controller** | le guichet | porte d'entrée web ; appelle le service, ne contient **aucune** logique |
| **`ResourceController`** | guichet pré-équipé | controller livré avec le **CRUD** déjà monté sur les 3 portes |
| **Intention** | une commande | une méthode du service (`create`, `list`…) = le point de contrôle unique |
| **La Socket** | le standard téléphonique | le lien temps réel isomorphe client↔serveur (`subscribe`/`request`) |

Règle d'or : **la logique vit dans le service. Le controller ne fait que `parse → service → render`.**

---

## 3. `Controller` vs `ResourceController`

- `extends Controller` = **cuisine vide** : tu écris chaque action (cas sur-mesure, non-CRUD).
- `extends ResourceController` = **cuisine équipée** : les 5 commandes CRUD sont **déjà là**, sur les 3 portes.

```ts
// sur-mesure
class FooController extends Controller { /* tes actions */ }

// CRUD multi-surface — 2 lignes, rien d'autre à écrire
@controller("/api/books")
class BookResource extends ResourceController<Book, BookService> {
  @Inject("bookService") protected service!: BookService;
  // list / get / create / update / delete : hérités (REST + WS + GraphQL)
  // + actions custom possibles par-dessus
}
```

Décision (à valider POC) : **classe de base** `ResourceController extends Controller`, **pas** un
décorateur `@Resource`. Raisons : convention-frère (`AbstractCrudService extends Service`), type-safe
(génériques `<T,S>`), explicite, override naturel (`super.create()`), zéro métaprogrammation au boot.

> **Doute ouvert** : nommage `ResourceController` (anglais, 1 `s`) confirmé. Le `<T,S>` générique
> sert au typage/confort éditeur.

---

## 4. Une action = N transports (le cœur)

Une **même** action sert REST + WS + GraphQL. Le framework **normalise l'entrée** : `@Param/@Query/@Body`
sont remplis quel que soit le transport. **L'action ne voit jamais le HTTP** — que des params.

```ts
@route("books-by-author", { path: "/by-author/{authorId}",
                            requirements: { methods: ["GET", "WEBSOCKET"] } })  // REST + WS
@GqlQuery("booksByAuthor")                                                       // GraphQL
byAuthor(@Param("authorId") authorId: string) {
  return this.service.find({ authorId });   // 0 info transport
}
```

```
REST     GET /api/books/by-author/42        ─┐ routage par PATH (Router)
WS       request("/api/books/by-author/42") ─┤
GraphQL  query { booksByAuthor(authorId:42)}─┘ routage par NOM DE CHAMP (endpoint /graphql)
                                               ↓ enveloppe normalisée
                                         byAuthor(authorId) → service → données
```

> **Pourquoi GraphQL est à part** : REST/WS routent par **path** (le Router) ; GraphQL route par
> **nom de champ** (un seul endpoint `/graphql`, exécuté par graphql-js). Il lui faut donc un décorateur
> qui **nomme le champ** (`@GqlQuery`), pas un `methods:[...]`.

---

## 5. Les 3 portes en détail

### 5.1 REST (le plus mûr — existe)
`@Get/@Post/@route` + `@Param/@Body/@Query`. Retour brut → auto-JSON. `initialize()` = hook per-request
(session, plus tard auth). **C'est du REST standard, curl-able, testable sans client.**

### 5.2 Temps réel / la Socket
Une **mutation** (create/update/delete) publie sur un **canal** (`book:created`…). Les clients abonnés
reçoivent en direct. La même action peut aussi répondre à un `request` WS (req/resp corrélé via `JsonRpcPeer`).

### 5.3 GraphQL — deux écoles (à trancher au POC)
| | Point d'entrée | Conséquence |
|---|---|---|
| **A** décorateur sur l'action (`@GqlQuery`) | dans le controller | « 1 action = 3 transports » ; resolvers custom |
| **B** dérivé du service (`buildCrudResolvers(service)`) | **pas** dans le controller | CRUD gratuit, 0 SDL |
**Penchant : A + B** — B génère le CRUD, A ajoute le custom. (Design figé actuel = B seul.)
> ⚠️ Collision : `@Query` existe déjà comme **param** (querystring) → le GraphQL doit s'appeler
> `@GqlQuery/@GqlMutation/@GqlSubscription`.

---

## 6. Côté client

Deux façons d'interagir :

```js
// A) REQUÊTE — je demande, on répond UNE fois (REST standard, familier)
const books = await fetch("/api/books").then(r => r.json());
await fetch("/api/books", { method: "POST", body: JSON.stringify({ title: "Dune" }) });

// B) ABONNEMENT — on me prévient à CHAQUE changement (la Socket)
import { RealtimeClient } from "nodefony/realtime";
const socket = new RealtimeClient("wss://monsite/realtime");
socket.subscribe("book:created", (book) => ajouter(book));
socket.subscribe("book:*",       (evt)  => onChange(evt));   // tous les changements des livres
```

**Le lien** : un client fait un `POST` REST normal → le service publie → **tous** les autres clients
abonnés voient le résultat en temps réel. Rien à coder côté serveur pour ça (le `ResourceController` publie).

### 6.1 Le handshake (« s'abonner à un schéma »)
```
1. connexion socket
2. HANDSHAKE : "qui es-tu ?" (JWT)  →  "voici tes droits + le schéma autorisé"
3. abonné aux tables autorisées (changements en direct)
4. le front fait les appels qu'il veut — le SERVEUR garde la porte à chaque appel
```
Le handshake **authentifie** (qui) + **déclare les droits** (quoi). Ensuite, appels libres côté front,
**toujours bornés serveur**.

---

## 7. Sécurité — Zero Trust (P6)

> **La sécurité ne dépend JAMAIS du front.** Le client demande ce qu'il veut ; le **serveur** autorise/refuse.

- Garde posée **une fois** sur l'**intention** (la méthode du service), **héritée** par REST + WS + GraphQL
  **et** par les tools d'agent IA. Pas 4 règles par transport → pas de dérive.
- `@IsGranted`/`@CurrentUser` (P6), RBAC depuis l'ALS (le data plane le fait déjà : rôles vides → s'activent
  au JWT sans changer le code).
- Le POC **pose les seams** ; **P6 branche** la vraie sécu après (d'où : POC avant P6).

### 7.1 Sécurité des DONNÉES — classification & cloisonnement (CRUCIAL, métiers régulés)

Le RBAC (« peux-tu faire l'action ? ») **ne suffit jamais** pour les métiers régulés (défense, santé,
banque/assurance, gestion de patrimoine). **4 questions distinctes** :

| Question | Modèle | Exemple |
|----------|--------|---------|
| Peux-tu faire l'**action** ? | RBAC (rôles) | seul un `médecin` crée un dossier |
| Quelles **lignes** voir ? | row-level / **ABAC** (appartenance) | le conseiller voit **ses** clients ; le médecin **ses** patients |
| Jusqu'à quel **niveau** ? | **MAC / classification** (MLS, Bell-LaPadula) | habilitation C2 → C1/C2 oui, **C3/C4 non** ; + compartiments need-to-know |
| Quels **champs** ? | field-level (PII) | n° de sécu visible que par le médecin traitant |

**LE principe à ne pas rater** : la sécu des données vit au niveau **SERVICE / donnée**, **jamais** au niveau
porte/transport. Sinon une porte (WS, GraphQL, tool IA) **contourne** le filtre REST → fuite. La seule couche
traversée par les 4 portes = le service/repository.

```
find(criteria)  →  find( criteria ET scopeSécurité(user ALS) )
   scope = appartenance(owner/tenant) · classification(niveau_donnée <= habilitation) · compartiment(need-to-know)
```

- **Deny by default** (Zero Trust) : pas de scope → **rien**, pas tout.
- **Projection** : champs au-dessus de l'habilitation retirés **avant** la réponse (field-level).
- **Audit** non-répudiable : qui a vu quoi, corrélé `requestId` (exigence défense/santé).
- **Souveraineté** (livre blanc §3.1) : santé/défense → air-gap, **pas de LLM externe** ; la classification décide
  aussi *ce qui a le droit de sortir* (le filtre PII bloque le transit vers un modèle).

**Existe** : `@IsGranted` (RBAC), Voters `IAccessVoter` (ABAC, différé P6.8), zones de confiance (§3.4 livre blanc),
PII (§3.3), ALS, `Criteria<T>` (point d'injection du scope), audit syslog `requestId`.
**À concevoir 🎯** : modèle classification multi-niveaux (C1–C4 + compartiments), row-level **systématique**
(scope auto service), field-level (projection par habilitation). **Pas** dans le design figé actuel.

**Cadres** : RGPD art. 9 (santé) · secret médical/bancaire · classification défense (IGI 1300 FR) · AI Act.

---

## 8. Observabilité unifiée (cohérent livre blanc IA §2.3 / §6.3)

Généraliser le **Log Backplane** (livré 2026-05-31) à **toutes** les sondes (logs, ORM-flow, HTTP, realtime) :
même contrat **write / query / bus**, driver pluggable. Le **même data plane** est consommé par le
**dashboard ET l'agent IA**. SQL **paramétré/expurgé** à la source (RGPD by design). Couture universelle =
le `requestId` (ALS) → trace **front → HTTP → ORM → LLM**.
> Hors POC v1 (sauf la sonde ORM-flow déjà prévue). Documenté ici pour cohérence.

---

## 9. Le POC (en branche) — ce qu'on valide

**Branche** dédiée (ex. `poc/api-souveraine`). Objectif : **valider ou invalider** §1–§7 sur du concret.

1. **`ResourceController`** (classe de base) + routage multi-transport `methods:["GET","WEBSOCKET"]` +
   normalisation de l'enveloppe WS → `@Param/@Query/@Body`.
2. **Migration du data plane Studio en WS** : aujourd'hui en AJAX (`GET /nodefony/*/api/*`) → ajouter
   l'abonnement WS (snapshot ≡ GET REST + flux de deltas). Le panneau Logs (console Backplane) sert de patron.
3. **Test grandeur nature — tables mediasoup** : banc ORM riche (`/repository/nodefony-mediasoup` :
   N-N, CASCADE, ENUM, JSON, UUID) → scaffold `ResourceController` sur ces tables, vérifier REST + WS + relations.
4. **Test GraphQL** : câbler `buildCrudResolvers` (qui manque) sur une de ces tables → query/mutation,
   `contextValue = Context`, et brancher `Subscription` = canal de la Socket.

**Critères de réussite (à compléter)** : 0 régression mémoire (`memory.test`), 1 action ne se réécrit pas
par transport, le data plane Studio marche en AJAX **et** WS (même snapshot), GraphQL CRUD dérivé fonctionne.

---

## 10. Le cas « Google » — collaboratif & hors-ligne (exploratoire)

Trois niveaux, du facile au dur :

| Niveau | Difficulté | Note |
|--------|-----------|------|
| Voir les données changer en direct, à plusieurs | ✅ facile | = `subscribe`, gratuit avec l'archi |
| Lire hors ligne + resync à la reconnexion | 🟡 moyen | cache local + « cursor de reprise » (rejoue les changements ratés) |
| **Éditer** à plusieurs / hors ligne **sans conflit** | 🔴 dur | = **CRDT** (ou OT) — le vrai morceau Google, des années de R&D |

→ Un **« Dolibarr temps réel »** (tout le monde voit tout, appels sécurisés) = **atteignable**.
Le **« Google Sheets complet »** (édition concurrente + offline sans conflit) = **chantier à part (CRDT)**,
**hors POC v1**, à explorer **seulement si** le métier l'exige.
> **Doute majeur** : CRDT vs OT, stockage local (IndexedDB ?), réconciliation, taille mémoire. Non tranché.

---

## 11. Doutes & questions ouvertes (à trancher au POC)

1. `ResourceController` : comment le **registre de routes remonte la chaîne de prototype** pour collecter
   les routes CRUD décorées sur la base ? (parcours `Object.getPrototypeOf` à l'enregistrement).
2. **Enveloppe WS** : forme exacte d'un appel WS-RPC qui mappe une route HTTP — `{path, query, body}` vs
   `{channel, params}` ? Comment `@Body` (pas de corps en WS) se mappe au payload ?
3. **GraphQL** : école A, B, ou A+B ? Fédération multi-modules (`mergeResolvers`) — qui monte `/graphql` ?
4. **Subscription GraphQL = canal Socket** : pont propre ou couplage caché ?
5. **Handshake** : négociation de capacités (cadence, projection, policy backpressure) — protocole exact ?
6. **Sécurité** : la garde « au niveau intention » tient-elle pour les 3 transports d'un coup ? (à prouver P6).
7. **Offline/CRDT** : faisabilité réelle, coût mémoire, périmètre. Très incertain.
8. **Perf** : le multi-transport ne doit pas alourdir le hot path REST/WS (budget borné, lazy, 0 alloc/req).
9. **Classification & cloisonnement** (§7.1) : modèle de classification multi-niveaux (C1–C4 + compartiments),
   row-level systématique (scope auto dans le service), field-level (projection). Où exactement s'injecte le
   scope (`Criteria` repository ? Voter qui réécrit la requête ?) ? Coût perf du scope sur le hot path lecture ?
   Comment l'agent IA hérite du même cloisonnement sans fuite ? **Crucial pour défense/santé/banque — non tranché.**

---

## 12. Existe ✅ vs à construire 🎯

| Brique | État |
| ------ | ---- |
| `Controller` HTTP+WS co-citoyen, `@route/@Get/@Post`, `@Param/@Body/@Query`, `initialize()` | ✅ |
| `AbstractCrudService` (find/create/update/delete + events `onCreated…`) | ✅ |
| `@entity`/`@repository`, `Criteria<T>` opérateurs riches | ✅ |
| La Socket client (`RealtimeClient`, `subscribe`/`request`), `JsonRpcPeer` req/resp | ✅ |
| Data plane REST (`IAdminApi`/`AdminBroker`), Log Backplane (write/query/bus) | ✅ |
| `ResourceController` (CRUD multi-surface) | 🎯 |
| Routage **invoke WS** vers une action + enveloppe normalisée `@Param/@Query/@Body` | 🎯 |
| `buildCrudResolvers` (GraphQL dérivé) + `@GqlQuery/@GqlMutation/@GqlSubscription` | 🎯 |
| Data plane Studio **en WS** (snapshot + deltas) | 🎯 |
| Observability Backplane généralisé / offline-CRDT | 🎯 exploratoire |

---

## 13. Séquencement (migration)

```
durcissement ORM  →  (Realtime, déjà quasi durci : reste S1)  →  POC « API souveraine »  →  P6 Security
```

**Pourquoi POC avant P6** : il pose les seams (controller multi-transport, handshake, sécu Zero Trust
esquissée) sur lesquels P6 se branche proprement — valider l'archi **avant** que la sécu s'y greffe.
**Pourquoi après ORM** : le POC s'appuie sur l'ORM (scaffold, `ResourceController` dérive du service CRUD,
tables mediasoup).

---

## 14. Liens

- Vision IA & gouvernance : [`docs/ia/livre-blanc-couche-ia.md`](../ia/livre-blanc-couche-ia.md) (§2.3, §3, §6.3, §6.4)
- Mémoires : `project_crud_pattern_decision`, `project_graphql_design`, `project_admin_data_plane_iadminapi`,
  `project_realtime_nodefony_socket_vision`, `project_log_backplane_vision`, `project_studio_probes_hub_vision`,
  `project_mediasoup_test_db`, `project_api_souveraine_poc` (cadrage POC).
- Banc test : `/repository/nodefony-mediasoup`.
