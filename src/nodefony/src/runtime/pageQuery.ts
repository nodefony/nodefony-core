import nodefonyError from "../Error";
import type { IPageQuery } from "../types/IPage";

/**
 * Source d'où extraire une requête de page, **agnostique de sa provenance** :
 * une query string déjà parsée (`?limit=20&offset=40`), le corps JSON d'une
 * requête `QUERY` (RFC 10008), ou tout autre porteur clé→valeur.
 *
 * C'est le point de toute la conception : {@link parsePageQuery} ne connaît pas
 * HTTP. Le jour où le transport change, seul l'appelant change — pas le contrat,
 * pas les stores.
 */
export type PageQuerySource = Readonly<
  Record<string, string | string[] | undefined>
>;

/**
 * Réglages d'un point d'entrée paginé : ses bornes et ce qu'il accepte de trier.
 *
 * Les défauts (`50` / `200`) sont ceux que tous les data planes admin du dépôt
 * appliquaient déjà chacun de leur côté — ils deviennent ici la valeur unique.
 */
export interface IParsePageQueryOptions {
  /** Taille de page quand le client n'en demande pas. Défaut `50`. */
  defaultLimit?: number;

  /**
   * Cap dur : une demande supérieure est **ramenée** à ce plafond (jamais
   * refusée — un client qui demande trop ne mérite pas une erreur, il mérite
   * une page). Défaut `200`.
   */
  maxLimit?: number;

  /**
   * Champs sur lesquels ce point d'entrée sait trier — l'**allowlist** qui rend
   * `order` exploitable.
   *
   * @remarks Absente, tout `order` reçu est **refusé** (`400`) au lieu d'être
   *   ignoré : un tri accepté puis jeté fait croire au client que la page est
   *   triée alors qu'elle ne l'est pas. Elle borne aussi ce qui peut atteindre
   *   un store — un nom de champ arbitraire n'a rien à faire dans une requête.
   */
  sortable?: readonly string[];

  /**
   * Ce point d'entrée sait-il **chercher** (`?q=`) — c'est-à-dire relayer `q`
   * jusqu'à un store qui l'honore. Défaut `false`.
   *
   * @remarks Défaut symétrique de {@link IParsePageQueryOptions.sortable} : non
   *   déclarée, la recherche est **refusée** (`400`) au lieu d'être ignorée. Le
   *   défaut inverse aurait été le péché habituel — deux data planes du dépôt
   *   acceptaient `?q=` sans jamais le transmettre à leur store, et rendaient
   *   donc la collection ENTIÈRE à qui croyait lire un résultat de recherche.
   *   Comme le tri, la recherche est une capacité du **backend branché** (un
   *   store en curseur ne balaie pas), donc elle se constate et se déclare —
   *   jamais elle ne se suppose.
   */
  searchable?: boolean;
}

/**
 * Erreur d'une requête de page mal formée ou non honorable par le point
 * d'entrée : `order` sur un endpoint qui ne trie pas, champ hors allowlist,
 * sens de tri inconnu.
 *
 * `code = 400` : la faute est au client. Le data plane admin
 * (`AdminApiController`) traduit ce `code` en statut HTTP, comme il le fait
 * déjà pour {@link PaginationModeError}.
 */
export class PageQueryError extends nodefonyError {
  constructor(message: string) {
    super(message, 400);
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Les clés que le contrat de page revendique sur le fil — **source unique**.
 *
 * Elle existe pour un consommateur : `parseFilters`, qui doit distinguer un
 * paramètre de pagination d'un filtre inconnu, et refuse le second. Recopier
 * cette liste là-bas aurait suffi à ce qu'un `?tenantId=` légitime devienne un
 * `400` le jour où le contrat gagne une clé ici et pas là.
 *
 * `tenantId` y figure bien qu'il ne soit pas encore lu (réserve multi-tenant du
 * contrat, `IPageQuery.tenantId`) : le front l'émet déjà sur les sessions.
 */
export const PAGE_QUERY_KEYS: ReadonlySet<string> = new Set([
  "limit",
  "offset",
  "cursor",
  "order",
  "withTotal",
  "q",
  "tenantId",
]);

/**
 * **La** lecture d'une valeur unique dans une source de page — partagée par
 * {@link parsePageQuery} et `parseFilters`.
 *
 * Une {@link PageQuerySource} peut porter plusieurs valeurs par clé (query
 * string répétée, tableau JSON d'un corps `QUERY`) : c'est le polymorphisme du
 * transport. Aucun des deux lecteurs ne sait quoi faire d'une seconde valeur —
 * ni le contrat de page, ni une spec de filtre n'expriment l'appartenance à un
 * ensemble. Prendre la première et **jeter les autres en silence** rendait une
 * page filtrée sur `a` à qui avait demandé `a` **et** `b`, sans rien dire : la
 * faute exacte que ce contrat bannit partout ailleurs.
 *
 * D'où le refus. Le jour où un point d'entrée doit accepter plusieurs valeurs,
 * ce sera une nature de filtre déclarée (`["in", …]`), pas une tolérance
 * implicite du lecteur.
 *
 * @throws {@link PageQueryError} (`400`) si la clé porte plus d'une valeur.
 */
export const singleValue = (
  source: PageQuerySource,
  key: string,
): string | undefined => {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return value;
  if (value.length > 1) {
    throw new PageQueryError(
      `Parameter "${key}" was given ${value.length} values; this endpoint reads a single value per parameter.`,
    );
  }
  return value[0];
};

/** Alias interne — la lecture unique, sous le nom court du fichier. */
const one = singleValue;

/** Entier décimal strict — `undefined` si absent, vide ou non numérique. */
const int = (source: PageQuerySource, key: string): number | undefined => {
  const raw = one(source, key);
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Lit le tri `champ:sens[,champ:sens]*` et le valide contre l'allowlist.
 *
 * @throws {@link PageQueryError} si l'endpoint ne trie pas, si un champ n'est
 *   pas dans `sortable`, ou si un sens n'est ni `ASC` ni `DESC`.
 */
const parseOrder = (
  raw: string,
  sortable: readonly string[] | undefined,
): IPageQuery["order"] => {
  if (!sortable || sortable.length === 0) {
    throw new PageQueryError(
      `This endpoint does not support sorting; drop the "order" parameter.`,
    );
  }
  const order: Array<[string, "ASC" | "DESC"]> = [];
  for (const part of raw.split(",")) {
    const spec = part.trim();
    if (spec === "") continue;
    const sep = spec.lastIndexOf(":");
    const field = sep === -1 ? spec : spec.slice(0, sep);
    const rawDir = sep === -1 ? "ASC" : spec.slice(sep + 1);
    if (!sortable.includes(field)) {
      throw new PageQueryError(
        `Unsortable field "${field}". Sortable fields: ${sortable.join(", ")}.`,
      );
    }
    const dir = rawDir.toUpperCase();
    if (dir !== "ASC" && dir !== "DESC") {
      throw new PageQueryError(
        `Invalid sort direction "${rawDir}" for field "${field}" (expected ASC or DESC).`,
      );
    }
    order.push([field, dir]);
  }
  return order.length ? order : undefined;
};

/**
 * **Le** traducteur d'une requête de page : transforme une source clé→valeur en
 * {@link IPageQuery} borné et validé. Fonction **pure** — aucun accès au kernel,
 * à l'ALS ni à la requête HTTP.
 *
 * Il remplace les parseurs `limit`/`offset` que chaque data plane réécrivait
 * pour lui-même. Ces copies avaient déjà divergé (`Number.isNaN` d'un côté,
 * `Number.isFinite` de l'autre : `?limit=abc` bornait à `50` ici et plantait à
 * `NaN` là), et aucune ne validait le tri.
 *
 * Ce qui est lu, et rien d'autre — un paramètre inconnu est laissé à l'appelant,
 * qui compose ses propres filtres par-dessus (`interface XQuery extends
 * IPageQuery`) :
 *
 * | Paramètre    | Forme sur le fil            | Résultat                                    |
 * | ------------ | --------------------------- | ------------------------------------------- |
 * | `limit`      | `?limit=20`                 | borné à `[1, maxLimit]`, défaut `defaultLimit` |
 * | `offset`     | `?offset=40`                | `≥ 0` (négatif ou invalide → absent)        |
 * | `cursor`     | `?cursor=abc`               | posé si non vide                            |
 * | `order`      | `?order=name:ASC,age:DESC`  | validé contre `sortable`                    |
 * | `withTotal`  | `?withTotal=false`          | posé **seulement** si `false` (défaut `true`) |
 * | `q`          | `?q=jean`                   | trimé, posé si non vide — **refusé** sans `searchable` |
 *
 * `offset` et `cursor` peuvent tous deux être présents ici : ce n'est pas à ce
 * traducteur d'arbitrer, mais au store, qui seul connaît son mode — il l'énonce
 * en appelant `assertPageQuery(query, mode)` en première ligne de son `listPage`.
 *
 * @param source - la query string parsée, ou le corps d'une requête `QUERY`.
 * @param options - bornes et champs triables de ce point d'entrée.
 * @returns une requête de page conforme au contrat, prête pour un store.
 * @throws {@link PageQueryError} (`code` 400) si le tri demandé n'est pas
 *   honorable par ce point d'entrée.
 *
 * @example
 * ```ts
 * const query = parsePageQuery(request.query, {
 *   maxLimit: 200,
 *   sortable: ["username", "createdAt"],
 * });
 * return repository.listPage({ ...query, enabled: true });
 * ```
 */
export function parsePageQuery(
  source: PageQuerySource,
  options: IParsePageQueryOptions = {},
): IPageQuery {
  const maxLimit = options.maxLimit ?? MAX_LIMIT;
  const defaultLimit = Math.min(
    options.defaultLimit ?? DEFAULT_LIMIT,
    maxLimit,
  );

  const rawLimit = int(source, "limit");
  const query: IPageQuery = {
    limit:
      rawLimit === undefined
        ? defaultLimit
        : Math.min(Math.max(rawLimit, 1), maxLimit),
  };

  const offset = int(source, "offset");
  if (offset !== undefined && offset >= 0) query.offset = offset;

  const cursor = one(source, "cursor");
  if (cursor) query.cursor = cursor;

  const rawOrder = one(source, "order");
  if (rawOrder) {
    const order = parseOrder(rawOrder, options.sortable);
    if (order) query.order = order;
  }

  // Seul `false` explicite désactive le total : toute autre valeur laisse le
  // défaut du contrat (`true`) en place plutôt que d'inventer un comportement.
  if (one(source, "withTotal") === "false") query.withTotal = false;

  const q = one(source, "q")?.trim();
  if (q) {
    if (!options.searchable) {
      throw new PageQueryError(
        `This endpoint does not support full-text search ("q"). ` +
          `Use the declared filters instead.`,
      );
    }
    query.q = q;
  }

  return query;
}
