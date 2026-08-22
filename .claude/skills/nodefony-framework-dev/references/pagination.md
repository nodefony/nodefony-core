# Pagination, tri, filtres, facettes — le contrat de page

> **Maintenance** : édition EN PLACE, vérité courante uniquement. Pas de date, pas de section
> « historique » — `git log` la porte. Un fait contredit par le code se **corrige** à son ancrage.

Tout ce qui rend une liste dans Nodefony passe par ce contrat — stores, data planes admin, routes
générées par le scaffold. Il n'y a **pas** de pagination maison par ressource.

Tout est exporté depuis le paquet racine `nodefony` (donc disponible tel quel dans une application
installée depuis npm) :

```ts
import {
  parsePageQuery,
  parseFilters,
  countFacets,
  facetDimensions,
  pickOrder,
  compareByOrder,
  renameOrderFields,
  assertPageQuery,
  PageQueryError,
  PaginationModeError,
  PAGE_QUERY_KEYS,
  UNKNOWN_COUNT,
} from "nodefony";
import type {
  IPage,
  IPageQuery,
  ISortableSource,
  PaginationMode,
  IFilterSpec,
  FilterValues,
  IParsePageQueryOptions,
  IParseFiltersOptions,
  IFacetSpec,
  FacetCount,
  FacetCounts,
  IAdminEndpoint,
  IAdminPageCapabilities,
} from "nodefony";
```

## Sommaire

1. [La règle qui gouverne tout — une capacité non déclarée se REFUSE](#1)
2. [Le contrat — `IPageQuery` / `IPage`, deux modes](#2)
3. [`parsePageQuery` — le traducteur unique](#3)
4. [`parseFilters` + `IFilterSpec` — l'obligation](#4)
5. [`countFacets` + `IFacetSpec` — les cartes de tête d'écran](#5)
6. [Capacité de backend ou obligation du contrat — le critère](#6)
7. [Écrire un `listPage` de store](#7)
8. [Publier la capacité — `IAdminEndpoint.page`](#8)
9. [Recette complète — un data plane paginé de bout en bout](#9)
10. [Pièges](#10)

---

<a id="1"></a>

## 1. La règle qui gouverne tout — une capacité non déclarée se REFUSE

Les trois dimensions (**tri**, **filtres**, **recherche**) ont le même défaut : **refus en 400**.
Jamais « accepté puis ignoré ».

Le motif n'est pas la sévérité, c'est l'**honnêteté de la réponse**. Un paramètre accepté puis jeté
rend une page **non filtrée** que le client lit comme le résultat de son filtre :

| Ce que le client envoie                  | Sans refus, il reçoit             | Ce qu'il croit lire                    |
| ---------------------------------------- | --------------------------------- | -------------------------------------- |
| `?revoked=oui` (au lieu de `true`)       | la collection entière             | « aucune clé révoquée n'a été exclue » |
| `?enbaled=true` (faute de frappe)        | la collection entière             | le résultat de son filtre              |
| `?outcome=deneid` sur un journal d'audit | **tout le journal**               | « aucun incident »                     |
| `?order=nom:ASC` non honoré              | une page dans un ordre arbitraire | une page triée                         |
| `?q=dupont` non transmis au store        | la collection entière             | un résultat de recherche               |

Confondre **autorisation** (« l'endpoint est déjà gardé, on peut être permissif ») et **honnêteté**
(« ce que la réponse prétend être ») est l'erreur qui produit ces cinq lignes.

<a id="2"></a>

## 2. Le contrat — `IPageQuery` / `IPage`, deux modes

`src/nodefony/src/types/IPage.ts`

**Entrée** `IPageQuery` — `limit` (obligatoire, jamais « tout »), `offset` **ou** `cursor`, `order`
(tableau de couples `[champ, sens]`), `withTotal`, `q`, `tenantId` (**réservé** multi-tenant, non
appliqué : le passer ne filtre rien, `IPage.ts:56-64`).

**Sortie** `IPage<T>` — `items`, `limit`, `hasNext` (toujours fiable), `total` (mode **Page**,
absent en mode **Slice** quand `withTotal: false`), `offset` ou `nextCursor` selon le mode.

Les deux modes sont **mutuellement exclusifs**, et c'est le **store** qui déclare le sien :

| Mode    | Champ    | Pour quels backends                                      |
| ------- | -------- | -------------------------------------------------------- |
| offset  | `offset` | SQL `LIMIT/OFFSET`, Mongo `skip/limit`, mémoire, fichier |
| curseur | `cursor` | Redis `SCAN`, flux ordonnés (journal d'audit)            |

`parsePageQuery` **n'arbitre pas** entre les deux — il peut rendre les deux champs. C'est le store
qui tranche, en première ligne de son `listPage` :

```ts
assertPageQuery(query, "offset"); // lève PaginationModeError (400) si un `cursor` arrive
```

Sans cette garde, le champ hors-mode était avalé en silence et **un client curseur bouclait
indéfiniment sur la page 1** d'un store offset (`pageGuard.ts:23-35`).

Les filtres propres à une ressource **n'entrent pas** dans `IPageQuery` : chaque store l'étend —
`interface ISessionListQuery extends IPageQuery { authenticated?: boolean }`.

<a id="3"></a>

## 3. `parsePageQuery` — le traducteur unique

`src/nodefony/src/runtime/pageQuery.ts:224`

Fonction **pure** : aucun accès au kernel, à l'ALS ni à la requête HTTP. Elle ne connaît pas HTTP —
sa source est un `PageQuerySource` (`Record<string, string | string[] | undefined>`), donc une query
string parsée **ou** le corps d'une requête `QUERY` (RFC 10008). Le jour où le transport change,
seul l'appelant change.

Un data plane qui relit `request.query` lui-même refabrique un dialecte : les copies avaient déjà
divergé (`Number.isNaN` d'un côté, `Number.isFinite` de l'autre → `?limit=abc` bornait à 50 ici et
plantait à `NaN` là), et **aucune** ne validait le tri.

| Paramètre   | Forme sur le fil           | Résultat                                            |
| ----------- | -------------------------- | --------------------------------------------------- |
| `limit`     | `?limit=20`                | borné à `[1, maxLimit]`, défaut `defaultLimit` (50) |
| `offset`    | `?offset=40`               | `≥ 0` (négatif ou invalide → absent)                |
| `cursor`    | `?cursor=abc`              | posé si non vide                                    |
| `order`     | `?order=name:ASC,age:DESC` | validé contre `sortable` — sinon **400**            |
| `withTotal` | `?withTotal=false`         | posé **seulement** si `false` (défaut `true`)       |
| `q`         | `?q=jean`                  | trimé, posé si non vide — **400** sans `searchable` |

Options (`IParsePageQueryOptions`, `pageQuery.ts:23`) :

- `defaultLimit` (50) · `maxLimit` (200) — une demande supérieure est **ramenée** au plafond, pas
  refusée : un client qui demande trop mérite une page, pas une erreur.
- `sortable?: readonly string[]` — **absente ⇒ tout `order` reçu est refusé.**
- `searchable?: boolean` — **absente ⇒ tout `?q=` reçu est refusé.**

Deux détails qui portent une décision :

- **Une clé à plusieurs valeurs est refusée** (`singleValue`, `pageQuery.ts:118`). Ni le contrat de
  page ni une spec de filtre n'expriment l'appartenance à un ensemble ; prendre la première valeur
  et jeter les autres rendrait une page filtrée sur `a` à qui a demandé `a` **et** `b`. Le jour où
  un endpoint doit accepter plusieurs valeurs, ce sera une **nature de filtre déclarée**, pas une
  tolérance du lecteur.
- **`PAGE_QUERY_KEYS`** (`pageQuery.ts:90`) est la source unique des clés que le contrat revendique
  sur le fil. Son consommateur est `parseFilters`, qui doit distinguer un paramètre de pagination
  d'un filtre inconnu. La recopier là-bas suffirait à ce qu'un paramètre légitime devienne un 400 le
  jour où le contrat gagne une clé ici et pas là.

<a id="4"></a>

## 4. `parseFilters` + `IFilterSpec` — l'obligation

`src/nodefony/src/runtime/pageFilters.ts:128`

Une **spec** déclare ce qu'un point d'entrée sait filtrer : nom public → nature ou liste fermée.
C'est une **donnée**, pas un comportement — une constante à côté du contrat de la ressource.

```ts
const TOKEN_FILTERS = {
  subjectId: "string",
  revoked: "boolean",
  kind: ["pat", "refresh"], // une liste vaut allowlist
} as const satisfies IFilterSpec;
```

Natures possibles (`FilterKind`) : `"string"`, `"boolean"`, `"int"`, ou `readonly string[]`
(énumération). Volontairement **clos et minuscule** : une grammaire d'opérateurs (`contains`, `in`,
`startsWith`) serait un langage de requête, pas un filtre — elle appartient au store, qui seul sait
ce qu'il peut indexer.

**`as const satisfies IFilterSpec` porte la validation ET le type.** `parseFilters` est générique
`<const S>` : il rend `FilterValues<S>`, soit `{ revoked?: boolean, kind?: "pat" | "refresh" }`.
Plus aucun `as AuditCategory` dans le data plane, et ajouter une valeur à une énumération met à jour
la validation et le type **d'un seul geste**.

Trois refus, tous en 400 :

| Cas                                | Exemple         |
| ---------------------------------- | --------------- |
| valeur mal formée                  | `?revoked=oui`  |
| valeur hors énumération            | `?kind=zzz`     |
| **paramètre reconnu par personne** | `?enbaled=true` |

Le troisième est le plus important et le moins évident. `PAGE_QUERY_KEYS` est bien sûr admise —
c'est la même URL qui porte les deux.

**`accepts`** (`IParseFiltersOptions`, `pageFilters.ts:39`) — les paramètres que l'appelant lit
lui-même, hors filtres : une projection (`?include=author`), un format de sortie. Sans cette liste,
`?include=author` deviendrait un 400 sur un paramètre légitime, et la seule échappatoire serait de
ne plus refuser du tout.

> ⚠️ **Une clé énoncée dans `accepts` est un ENGAGEMENT à la lire.** L'y mettre pour faire taire un
> refus, sans la traiter ensuite, recrée exactement le paramètre accepté puis jeté.

<a id="5"></a>

## 5. `countFacets` + `IFacetSpec` — les cartes de tête d'écran

`src/nodefony/src/runtime/pageFacets.ts:74`

Une **facette** est une question fermée posée à la collection **entière** — « combien de sessions
authentifiées ? ». C'est ce que les cartes en tête d'un écran d'administration prétendent afficher,
et ce qu'elles calculent trop souvent **sur la page chargée** : avec une fenêtre de 25 lignes, une
carte annonçant « 3 comptes actifs » décrit trois lignes visibles, pas l'annuaire. **Un nombre
présenté sans qualificatif est lu comme un total** ; le corriger d'une mention en petits caractères
ne le rend pas vrai.

```ts
const SESSION_FACETS = {
  total: {},
  authenticated: { authenticated: true },
  anonymous: { authenticated: false },
} as const satisfies IFacetSpec<ISessionListQuery>;

const counts = await countFacets(SESSION_FACETS, (q) =>
  storage.countSessions(q),
);
// → { total: 1204, authenticated: 87, anonymous: 1117 }   (Redis : que des null)
```

Trois règles portées par le type et l'algorithme :

- **`IFacetSpec<Q>` est paramétré par le contrat de liste de la ressource.** Une facette qui n'est
  pas exprimable comme un filtre du contrat **ne compile pas** — c'est la garde qui empêche de
  réintroduire le compteur approximatif. Elle exige alors soit d'étendre le contrat, soit une
  capacité déclarée à part (un décompte de valeurs **distinctes** n'est pas un `COUNT` filtré).
- **`null` n'est pas `0`.** Un store en curseur refuse le comptage exact et le dit en rendant
  `UNKNOWN_COUNT` (`-1`) ; `countFacets` le traduit en `null` (`FacetCount = number | null`). Sans
  ce canal distinct, la réponse arriverait au navigateur sous forme de zéro, et une console
  afficherait « 0 session » là où il y en a des milliers. Côté écran : afficher « — ».
- **Aucune facette n'est dérivée d'une autre** (`inactive = total - active`) : deux facettes peuvent
  se recouvrir (un compte peut être à la fois désactivé **et** verrouillé), et la soustraction
  rendrait un nombre que rien ne compte.

**`facetDimensions(facets)`** (`pageFacets.ts:109`) rend les champs qu'une table de facettes
décompose — donc ceux qu'un endpoint de statistiques **ne doit pas** accepter en filtre. Un client
envoie naturellement le même query string à la liste et aux compteurs ; sans cette garde, la réponse
se contredit (« 5 clés au total, dont 538 révoquées »). À vérifier par un test, par ressource.

> **Cold path.** Les facettes partent en parallèle, une requête `COUNT` chacune. Acceptable pour
> quatre questions à l'ouverture d'un écran ; **inacceptable dans un chemin de requête**. Ne pas les
> rejouer à chaque tour de page — elles ne dépendent ni de `limit`, ni de `offset`, ni de l'ordre.

<a id="6"></a>

## 6. Capacité de backend ou obligation du contrat — le critère

C'est **le** critère à appliquer avant de déclarer quoi que ce soit. Se tromper de côté produit deux
défauts symétriques : un tri déclaré globalement ment sur les backends qui ne trient pas ; un filtre
déclaré par store laisse croire qu'un filtre du contrat est facultatif.

|            | **Tri**                                             | **Filtre**                                                       | **Recherche**                        |
| ---------- | --------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Nature     | capacité du **backend branché**                     | **obligation** de tous les backends                              | capacité du **backend branché**      |
| Se déclare | sur le **store** (`ISortableSource.sortableFields`) | sur la **ressource** (`IFilterSpec`, une constante)              | sur le **store**, publié en fonction |
| Pourquoi   | un `SCAN` Redis n'a aucun ordre global              | inscrit dans `IXListQuery`, Redis l'honore inline dans son batch | un store en curseur ne balaie pas    |

**Le refus est gratuit.** Un backend qui ne sait pas trier laisse `sortableFields` absent — rien de
plus à écrire pour que le tri y soit refusé. Les capacités **peuvent** être inégales d'un backend à
l'autre : elles sont alors annoncées, jamais simulées.

`ISortableSource` (`IPage.ts:92`) existe pour qu'il n'y ait **qu'une** forme à connaître — nom de la
propriété, nullabilité et sémantique écrits une fois, au lieu d'être redéclarés dans chaque contrat
de store. Le mécanisme est le même pour toutes les ressources : le store **déclare**, le data plane
**demande** et passe en allowlist à `parsePageQuery`, tout `?order=` hors liste est **refusé**.

> **La FORME s'impose par une interface, l'ALGORITHME se factorise, la DONNÉE se déclare par
> ressource.** Le signe distinctif d'une règle dupliquée dans un fichier de vocabulaire : il contient
> une **fonction** au lieu d'une liste.

<a id="7"></a>

## 7. Écrire un `listPage` de store

```ts
async listPage(query: ISessionListQuery): Promise<IPage<Session>> {
  assertPageQuery(query, "offset");                          // 1. le mode, en PREMIÈRE ligne
  const order = pickOrder(query.order, SORTABLE, DEFAULT_ORDER); // 2. la garde de tri
  // 3. …requête au moteur…
}
```

**`pickOrder`** (`pageSort.ts:87`) retient les seuls couples déclarés triables et retombe sur
l'ordre par défaut s'il n'en reste aucun. Ce n'est **pas** redondant avec le refus 400 du data
plane : tout appelant interne (un autre service, un test, un futur endpoint) peut fabriquer un
`IPageQuery` à la main. Sans ce filtre, le backend mémoire trierait sur un champ jamais annoncé
quand le backend SQL l'ignorerait — le contrat partagé ne décrirait plus un comportement, mais deux.

> 🔒 **Côté SQL, `pickOrder` est une garde d'injection** : un nom de colonne ne se lie pas en
> paramètre, il se **concatène** dans le `ORDER BY`.

**`compareByOrder`** (`pageSort.ts`) est **le** tri en mémoire de Nodefony, pour les stores sans
moteur. Les couples s'appliquent dans l'ordre : le premier qui départage l'emporte. Les backends SQL
et Mongo n'en ont pas besoin — ils poussent l'`order` dans la requête, infiniment moins cher.

**`renameOrderFields`** (`pageSort.ts:54`) traduit les noms **publics** (ceux de l'URL) en noms de
colonnes internes. L'allowlist est toujours en vocabulaire public.

**Un ordre par défaut n'est pas décoratif** : sans ordre déterministe, la base rend les lignes dans
l'ordre qui l'arrange, et il peut changer entre deux requêtes — la page 2 remontre alors une ligne
déjà vue, ou en saute une, sans que rien ne le signale. Terminer le `DEFAULT_ORDER` par l'`id` pour
départager les ex æquo.

<a id="8"></a>

## 8. Publier la capacité — `IAdminEndpoint.page`

`src/nodefony/src/types/IAdminApi.ts:104` et `:182`

Le front **demande** la capacité, il ne l'invente pas. Un endpoint admin la publie dans le catalogue
(déjà chargé par la console) via `page?: IAdminPageCapabilities` :

```ts
{
  path: "sessions",
  summary: "Sessions actives",
  page: {
    // FONCTIONS — la réponse dépend du store branché au démarrage. Le motif réel
    // interroge le service, et rend une liste VIDE quand il ne sait pas faire
    // (cf HttpAdminApi.ts:344) — le refus est alors gratuit.
    sortable: () => {
      const svc = this.sessionService();
      return svc?.supportsEnumeration() ? svc.sortableFields() : [];
    },
    search: () => true,                 // ou une condition sur le store branché
    filters: SESSION_FILTERS,           // la spec, sérialisable telle quelle
    facets: SESSION_FACETS,             // le mapping carte → filtre
  },
  handler,
}
```

Il n'existe volontairement **pas** de propriété générique `supportsSearch` : chaque ressource
répond selon ce que son backend sait faire — `() => true` quand c'est inconditionnel
(`UserAdminApi.ts:349`), une condition sur le service quand ça ne l'est pas
(`WebhookAdminApi.ts:247`).

Pourquoi `sortable` et `search` sont des **fonctions** et pas des constantes : la réponse dépend du
store effectivement branché **au démarrage**, pas d'une valeur de compilation. Elles sont évaluées à
la lecture du catalogue.

Pourquoi `facets` est publié : pour que les cartes deviennent **cliquables** sans redéclarer côté
client ce que « actives » ou « en échec » veut dire. Une carte affiche un nombre, le clic pose
**exactement** le filtre qui l'a produit — sinon la liste montre autre chose que ce que la carte
annonce. Une console qui recomposerait ce mapping divergerait au premier changement de définition
(« utilisable » = sans échéance **ou** échéance à venir — une règle qui vit dans le vocabulaire de
la ressource, pas dans l'écran).

Corollaire : **une facette non publiée laisse sa carte inerte**, et c'est mieux qu'un clic qui
filtrerait autre chose que l'annoncé.

<a id="9"></a>

## 9. Recette complète — un data plane paginé de bout en bout

```ts
import {
  parsePageQuery,
  parseFilters,
  countFacets,
  facetDimensions,
} from "nodefony";
import type { IFilterSpec, IFacetSpec, IAdminEndpoint } from "nodefony";

/** Ce que cette route sait FILTRER — obligation de tous les backends. */
const SESSION_FILTERS = {
  authenticated: "boolean",
  userId: "string",
} as const satisfies IFilterSpec;

/** Ce que les cartes de tête annoncent — décompose `authenticated`. */
const SESSION_FACETS = {
  total: {},
  authenticated: { authenticated: true },
  anonymous: { authenticated: false },
} as const satisfies IFacetSpec<ISessionListQuery>;

const listEndpoint: IAdminEndpoint = {
  path: "sessions",
  page: {
    sortable: () => this.storage.sortableFields ?? [],
    search: () => true,
    filters: SESSION_FILTERS,
    facets: SESSION_FACETS,
  },
  handler: async (request) => {
    const page = parsePageQuery(request.query, {
      maxLimit: 200,
      sortable: this.storage.sortableFields, // absent ⇒ ?order= refusé en 400
      searchable: true, // absent ⇒ ?q= refusé en 400
    });
    const filters = parseFilters(request.query, SESSION_FILTERS);
    return this.storage.listPage({ ...page, ...filters });
  },
};

const statsEndpoint: IAdminEndpoint = {
  path: "sessions/stats",
  page: { facets: SESSION_FACETS },
  handler: async (request) => {
    // ⚠️ La spec de filtre d'un endpoint de STATS ne doit contenir AUCUNE
    // dimension décomposée par ses facettes — sinon la réponse se contredit.
    const filters = parseFilters(request.query, STATS_FILTERS);
    return countFacets(SESSION_FACETS, (q) =>
      this.storage.countSessions({ ...filters, ...q }),
    );
  },
};
```

Le test qui ferme la garde de la section 5, à écrire **par ressource** :

```ts
it("l'endpoint de stats ne filtre aucune dimension qu'il décompose", () => {
  for (const dim of facetDimensions(SESSION_FACETS)) {
    expect(Object.hasOwn(STATS_FILTERS, dim)).toBe(false);
  }
});
```

<a id="10"></a>

## 10. Pièges

- **🔴 Un test de tri est complaisant par défaut.** Vécu : un test neuf restait **vert avec le tri
  débranché**, parce qu'il lisait `record.createdAt` là où la donnée vit dans `record.data` — douze
  `undefined` forment une suite triée. Un test de tri se durcit en **trois** affirmations : le champ
  est **présent**, les valeurs sont **distinctes**, et `DESC` est l'**inverse exact** d'`ASC`.
  Corollaire : prouver le **refus** (400 sur un champ non déclaré) ne prouve **pas** que le tri
  trie. Ce sont deux tests.
- **Un filtre qui refuse n'est pas un filtre qui filtre.** Même raisonnement : une valeur valide
  doit **réduire** l'ensemble, et l'assertion doit le mesurer.
- **Un endpoint de statistiques qui accepte la dimension qu'il décompose** rend une réponse qui se
  contredit. Garde : `facetDimensions` + le test ci-dessus.
- **`tenantId` traverse le contrat mais n'est PAS appliqué** (`IPage.ts:56`). Le passer ne filtre
  rien. Ne pas s'en servir comme d'un scoping.
- **`accepts` non lu** = le paramètre accepté puis jeté, réintroduit par la porte de service.
- **Ne pas rejouer `countFacets` à chaque tour de page** — les facettes ne dépendent ni de `limit`,
  ni de `offset`, ni de l'ordre.
- **Ne pas basculer en `mode="server"` une liste bornée par construction.** Un endpoint self-service
  dont la réponse EST déjà tout le périmètre de l'appelant, et dont le volume est plafonné en amont,
  n'a rien à y gagner.

## Où le contrat n'est pas encore tenu

Points connus, à traiter quand on passe à côté — ne pas les prendre pour modèle :

- **`paginate()` de `@nodefony/orm-core` ignore `q`** (`paginate.ts` — le paramètre n'y est ni lu ni
  transmis). Un service CRUD qui s'appuie dessus ne cherche pas, quoi qu'il déclare.
- **`SyslogAdminApi` lit ses filtres hors `parseFilters`** (`:121`, `:130` — `Array.isArray(raw) ?
raw[0] : raw`, soit la tolérance « prendre la première valeur et jeter les autres » que
  `singleValue` refuse partout ailleurs ; `:166` compose un multi-valeurs pour `flow`).
- **`MemoryAuditStore` trie en dur** (`:85`, `matched.sort(…)` sans passer par `pickOrder`) — donc
  potentiellement sur un champ jamais déclaré, là où le backend SQL de la même ressource refuserait.
- **`routes/page` (`FrameworkAdminApi:174`) ne publie pas `page:`** dans le catalogue, et la vue
  Routes code donc ses colonnes en dur. Le reste y est **conforme et assumé** : `parsePageQuery`
  avec allowlist, `searchable: true` motivé (collection en mémoire), et
  `parseFilters(query, {}, { accepts: ["filters"] })` dont la clé est réellement lue. Son
  `filters` JSON est un **langage d'opérateurs propre à cet endpoint** — l'exception documentée, pas
  le patron à suivre.
