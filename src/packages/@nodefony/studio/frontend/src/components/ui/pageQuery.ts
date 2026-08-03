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
