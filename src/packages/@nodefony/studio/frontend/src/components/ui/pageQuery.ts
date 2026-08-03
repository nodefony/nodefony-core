import type { IPage } from "nodefony";
import type {
  DataGridColumnFilter,
  DataGridServerQuery,
  DataGridServerResult,
} from "./DataGrid";

/**
 * Le seul opérateur de filtre qu'un paramètre nommé porte sans mentir.
 *
 * Le contrat de filtre du framework (`parseFilters`, cœur) est `nom=valeur` : il
 * n'a pas de grammaire d'opérateurs, et c'est délibéré — `contains`, `in`,
 * `startsWith` forment un langage de requête, qui appartient au store (seul à
 * savoir ce qu'il indexe), pas au fil. `?enabled=false` dit exactement ce qu'il
 * demande ; `?enabled=<contains>false` ne veut rien dire pour qui le lit.
 */
const TRANSPORTABLE_OP = "equals";

/** Tableau vide partagé — aucune allocation par requête de page. */
const EMPTY_FILTERS: DataGridColumnFilter[] = [];

/**
 * Traduit la requête d'un `<DataGrid mode="server">` en paramètres du contrat de
 * page — **le seul endroit du front qui écrit une query string de pagination**.
 *
 * Le grid raisonne en pages (`page`, `pageSize`) et en tri d'une colonne
 * (`sort`), le serveur en fenêtre (`limit`, `offset`) et en couples de tri
 * (`order`). Cette fonction est cette conversion, et rien d'autre : chaque
 * loader qui la refaisait à la main a produit un dialecte de plus.
 *
 * | Grid                            | Fil                  | Lu par         |
 * | ------------------------------- | -------------------- | -------------- |
 * | `page` + `pageSize`             | `limit` + `offset`   | `parsePageQuery` |
 * | `sort: {key, dir}`              | `order=key:ASC`      | `parsePageQuery` |
 * | `search`                        | `q`                  | `parsePageQuery` |
 * | `columnFilters` (`equals` seul) | `key=value`          | `parseFilters` |
 *
 * **La clé de colonne EST le nom public du filtre.** `key: "enabled"` produit
 * `?enabled=…`, que le back valide contre le vocabulaire déclaré de la ressource
 * (`WEBHOOK_FILTERS`, `USER_FILTERS`…). Les deux noms doivent coïncider : s'ils
 * divergent, le back répond `400` en nommant les filtres qu'il connaît — un
 * écart se voit, il ne se devine pas.
 *
 * **Tout autre opérateur est REFUSÉ, jamais transporté approximativement.** Une
 * colonne `filterable` en mode serveur avec `contains` produirait soit un
 * paramètre que le back ne comprend pas, soit — pire — un `?path=/api` lu comme
 * une égalité, donc une page vide présentée comme le résultat d'une recherche.
 * L'erreur remonte dans le bandeau du grid, au premier filtre posé.
 *
 * Un data plane qui parle vraiment un langage d'opérateurs (le cas de
 * `framework/api/routes/page`, qui implémente son propre `matchOp`) sérialise
 * ses filtres **dans son loader** : ce dialecte lui appartient et doit se voir
 * là où il est parlé, pas être émis par défaut pour tout le monde.
 *
 * **Les filtres NOMMÉS de la vue** (barre `PageFilters`, alimentée par le
 * vocabulaire que l'endpoint publie) se passent en second argument plutôt que
 * de se concaténer après coup : ils partent ainsi par le même chemin que le
 * reste, et une valeur vide est écartée ici une bonne fois — `?enabled=` n'est
 * pas « tous », c'est une valeur mal formée que le contrat refuse en `400`.
 *
 * @param q - la requête émise par le DataGrid.
 * @param filters - filtres nommés de la vue (nom public → valeur), facultatif.
 * @returns les paramètres prêts à concaténer (`?${params}`).
 * @throws si un filtre de colonne porte un opérateur non transportable.
 *
 * @example
 * ```ts
 * const loader = useCallback(async (q: DataGridServerQuery) => {
 *   const params = toPageParams(q);
 *   params.set("role", role);            // filtres propres à la vue
 *   const page = await store.api.getAbsolute<IPage<UserRow>>(
 *     `/nodefony/user/api/users?${params}`,
 *   );
 *   return fromPage(page);
 * }, [store, role]);
 * ```
 */
export function toPageParams(
  q: DataGridServerQuery,
  filters?: Readonly<Record<string, string>>,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("limit", String(q.pageSize));
  params.set("offset", String((q.page - 1) * q.pageSize));
  if (q.sort) {
    params.set("order", `${q.sort.key}:${q.sort.dir.toUpperCase()}`);
  }
  if (q.search) params.set("q", q.search);
  for (const f of q.columnFilters) {
    if (f.op !== TRANSPORTABLE_OP) {
      throw new Error(
        `Colonne « ${f.key} » : l'opérateur « ${f.op} » ne se transporte pas ` +
          `dans le contrat de page (qui ne connaît que l'égalité). Déclarez la ` +
          `colonne en filterType "select" avec les valeurs du vocabulaire du ` +
          `back, ou sérialisez ce filtre dans le loader de la vue.`,
      );
    }
    params.set(f.key, f.value);
  }
  if (filters) {
    for (const [name, v] of Object.entries(filters)) {
      if (v !== "") params.set(name, v);
    }
  }
  return params;
}

/**
 * La requête de page **sans ses filtres de colonne** — pour une vue dont le back
 * parle son propre langage de filtre et les sérialise lui-même.
 *
 * Elle existe pour rendre ce cas VISIBLE. Émettre les filtres d'office (ce que
 * faisait un sac `filters` JSON posé par {@link toPageParams}) revenait à
 * envoyer à tous les data planes un dialecte qu'un seul comprenait ; le jour où
 * l'un d'eux valide ses paramètres, il refuse un sac qu'il n'a jamais demandé.
 *
 * @param q - la requête émise par le DataGrid.
 * @returns la même requête, avec `columnFilters` vidé.
 *
 * @example
 * ```ts
 * // routes/page implémente son propre `matchOp` : le dialecte reste ici.
 * const params = toPageParams(withoutColumnFilters(q));
 * if (q.columnFilters.length) {
 *   params.set("filters", JSON.stringify(q.columnFilters));
 * }
 * ```
 */
export function withoutColumnFilters(
  q: DataGridServerQuery,
): DataGridServerQuery {
  return { ...q, columnFilters: EMPTY_FILTERS };
}

/**
 * Traduit une page du serveur en résultat de `<DataGrid mode="server">`.
 *
 * Le grid a besoin d'un `total` pour dessiner sa pagination, alors que le
 * contrat le rend **facultatif** (mode « Slice » : on saute le `COUNT` coûteux,
 * `hasNext` suffit). Sans total, on rend le seul minorant honnête — ce qui a été
 * servi jusqu'ici, plus une page s'il y a une suite : la barre reste navigable
 * sans prétendre connaître un compte qu'on n'a pas demandé.
 *
 * @param page - la page rendue par un data plane.
 * @returns les lignes et le total attendus par le grid.
 */
export function fromPage<T>(page: IPage<T>): DataGridServerResult<T> {
  const seen = (page.offset ?? 0) + page.items.length;
  return {
    rows: page.items,
    total: page.total ?? (page.hasNext ? seen + page.limit : seen),
  };
}

/**
 * Ne garde d'un jeu de filtres que ceux qu'un endpoint DÉCLARE accepter.
 *
 * Elle existe pour un cas précis, et fréquent : les **compteurs de tête**
 * (`<ressource>/stats`) acceptent les filtres de la liste **moins la dimension
 * qu'ils décomposent** — demander `?status=active` à un endpoint qui rend
 * `{actives, expirées, révoquées}` reviendrait à lui faire écraser sa propre
 * ventilation. La console envoie donc à `/stats` l'intersection de ce qu'a
 * choisi l'utilisateur et de ce que cet endpoint-là publie ; le reste part à la
 * liste seule.
 *
 * Renvoyer tout en bloc rendrait un `400` sur un écran par ailleurs valide ;
 * n'envoyer rien ferait décrire la collection entière par des cartes posées
 * au-dessus d'un tableau filtré — deux vérités contradictoires côte à côte.
 *
 * @param filters - les filtres actifs de la vue.
 * @param spec - le vocabulaire publié par l'endpoint destinataire, ou `null`.
 * @returns le sous-ensemble acceptable, vide si la spec est inconnue.
 */
export function pickFilters(
  filters: Readonly<Record<string, string>>,
  spec: Readonly<Record<string, string | string[]>> | null | undefined,
): Record<string, string> {
  if (!spec) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(filters)) {
    if (value !== "" && name in spec) out[name] = value;
  }
  return out;
}

/**
 * Ce qu'un endpoint de compteurs publie et dont la query string dépend — forme
 * structurelle minimale, pour que le UI kit ne dépende pas du store d'admin.
 */
interface StatsCapabilities {
  filters?: Readonly<Record<string, string | string[]>>;
  search?: boolean;
}

/**
 * Compose la query string d'un endpoint de **compteurs** (`<ressource>/stats`)
 * — le seul endroit du front qui l'écrit.
 *
 * Un écran pose la même question à deux endroits : « montre-moi ces lignes » à
 * la liste, « combien y en a-t-il » aux compteurs. Les deux doivent porter la
 * MÊME sélection, sinon les cartes de tête décrivent une population que le
 * tableau en dessous ne montre pas. Ce qui varie entre les deux appels n'est pas
 * la sélection mais ce que chaque endpoint ACCEPTE :
 *
 * - les **filtres** : l'intersection avec ce que `/stats` publie ({@link
 *   pickFilters}) — il refuse la dimension qu'il ventile en cartes ;
 * - la **recherche** : envoyée seulement s'il déclare `search`, faute de quoi le
 *   contrat la refuse en `400` (défaut REFUS, symétrique du tri).
 *
 * @param filters - filtres actifs de la vue.
 * @param caps - capacités publiées par l'endpoint de compteurs, ou `null` tant
 *   que le catalogue n'est pas chargé (→ aucun paramètre, jamais une devinette).
 * @param search - terme cherché dans le tableau, remonté par le grid
 *   (`onSearchChange`). Vide ou absent = pas de recherche.
 * @returns les paramètres prêts à concaténer (vides si rien à envoyer).
 *
 * @example
 * ```ts
 * const params = toStatsParams(filters, statsCaps, search);
 * const url = params.size ? `${STATS_ENDPOINT}?${params}` : STATS_ENDPOINT;
 * ```
 */
export function toStatsParams(
  filters: Readonly<Record<string, string>>,
  caps: StatsCapabilities | null | undefined,
  search?: string,
): URLSearchParams {
  const params = new URLSearchParams(pickFilters(filters, caps?.filters));
  const term = search?.trim() ?? "";
  if (term !== "" && caps?.search) params.set("q", term);
  return params;
}

/**
 * Une facette est-elle ACTIVE dans les filtres courants ?
 *
 * Vrai quand chacune de ses paires est présente à l'identique : une carte
 * « Verrouillés » n'est allumée que si `locked=true` est effectivement posé,
 * pas si un autre filtre l'englobe par hasard.
 *
 * @param filters - filtres actifs de la vue.
 * @param criteria - le critère publié de la facette.
 * @returns `false` pour un critère vide (« total » n'est jamais « actif » : il
 *   décrit l'absence de sélection, pas une sélection).
 */
export function isFacetActive(
  filters: Readonly<Record<string, string>>,
  criteria: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(criteria);
  if (keys.length === 0) return false;
  return keys.every((k) => filters[k] === String(criteria[k]));
}

/**
 * Bascule une facette dans les filtres — **la** règle du clic sur une carte de
 * tête, en un seul exemplaire pour les quatre écrans.
 *
 * Trois comportements, et chacun répond à une question que l'écran pose déjà :
 *
 * | Le clic porte sur…                | Résultat                                    |
 * | --------------------------------- | ------------------------------------------- |
 * | une facette **déjà active**       | ses clés sont retirées (on rouvre la vue)   |
 * | une facette **inactive**          | ses clés sont posées, les AUTRES filtres restent |
 * | une facette **au critère vide** (`total`) | toutes les clés de facettes tombent, les filtres saisis à la main restent |
 *
 * Le choix de FUSIONNER plutôt que de remplacer est ce qui rend l'écran
 * composable : filtrer sur un utilisateur puis cliquer « anonymes » pose la
 * question « ce compte a-t-il des sessions anonymes ? », et la réponse — souvent
 * vide — est exacte. Remplacer aurait silencieusement effacé la première moitié
 * de la question.
 *
 * `total` ne touche pas aux filtres saisis à la main : sa carte annonce « tout »
 * au sens des facettes, pas « oublie ce que tu as tapé ».
 *
 * @param filters - filtres actifs de la vue.
 * @param criteria - critère de la facette cliquée.
 * @param allFacets - toutes les facettes publiées (pour connaître les clés
 *   qu'un retour à « total » doit effacer).
 * @returns le nouveau jeu de filtres, à passer tel quel à l'état de la page.
 */
export function toggleFacet(
  filters: Readonly<Record<string, string>>,
  criteria: Readonly<Record<string, unknown>>,
  allFacets: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Record<string, string> {
  const next: Record<string, string> = { ...filters };
  const keys = Object.keys(criteria);

  if (keys.length === 0) {
    // « Total » : on retire ce que les facettes savent poser, et rien d'autre.
    for (const facet of Object.values(allFacets)) {
      for (const k of Object.keys(facet)) delete next[k];
    }
    return next;
  }

  if (isFacetActive(filters, criteria)) {
    for (const k of keys) delete next[k];
    return next;
  }

  for (const k of keys) next[k] = String(criteria[k]);
  return next;
}

/**
 * Rend un compteur de facette pour l'affichage — `null` devient « — ».
 *
 * Vit ici, avec le traducteur du contrat de page, parce que c'est la MÊME
 * convention qui traverse : un data plane rend `null` quand le backend branché
 * ne sait pas compter (`FacetCount`, cœur), et une console qui l'afficherait en
 * `0` transformerait une ignorance en absence — « aucune session » là où il y en
 * a des milliers. Une seule fonction pour les quatre écrans, sinon le troisième
 * réinventera le tiret.
 *
 * @param n - le compteur reçu, ou `null` si le backend ne sait pas.
 * @returns le nombre en clair (séparateurs de milliers) ou « — ».
 */
export function fmtFacet(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("fr-FR");
}
