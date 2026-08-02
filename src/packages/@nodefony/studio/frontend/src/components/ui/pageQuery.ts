import type { IPage } from "nodefony";
import type { DataGridServerQuery, DataGridServerResult } from "./DataGrid";

/**
 * Traduit la requête d'un `<DataGrid mode="server">` en paramètres du contrat de
 * page `IPageQuery` — **le seul endroit du front qui écrit une query string de
 * pagination**.
 *
 * Le grid raisonne en pages (`page`, `pageSize`) et en tri d'une colonne
 * (`sort`), le serveur en fenêtre (`limit`, `offset`) et en couples de tri
 * (`order`). Cette fonction est cette conversion, et rien d'autre : chaque
 * loader qui la refaisait à la main a produit un dialecte de plus.
 *
 * | Grid                    | Fil                       |
 * | ----------------------- | ------------------------- |
 * | `page` + `pageSize`     | `limit` + `offset`        |
 * | `sort: {key, dir}`      | `order=key:ASC`           |
 * | `search`                | `q`                       |
 * | `columnFilters`         | `filters` (JSON)          |
 *
 * `filters` est une **extension du UI kit**, hors contrat core : les filtres par
 * colonne sont produits ici, donc leur sérialisation appartient ici. Un back qui
 * ne les implémente pas les ignore — ils ne sont émis que s'il y en a.
 *
 * @param q - la requête émise par le DataGrid.
 * @returns les paramètres prêts à concaténer (`?${params}`).
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
export function toPageParams(q: DataGridServerQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("limit", String(q.pageSize));
  params.set("offset", String((q.page - 1) * q.pageSize));
  if (q.sort) {
    params.set("order", `${q.sort.key}:${q.sort.dir.toUpperCase()}`);
  }
  if (q.search) params.set("q", q.search);
  if (q.columnFilters.length) {
    params.set("filters", JSON.stringify(q.columnFilters));
  }
  return params;
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
