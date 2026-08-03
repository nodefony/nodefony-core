import { PageQueryError, PAGE_QUERY_KEYS, singleValue } from "./pageQuery";
import type { PageQuerySource } from "./pageQuery";

/**
 * Nature d'un filtre — ce qui suffit à le lire depuis une source clé→valeur.
 *
 * Volontairement CLOS et minuscule : ces trois natures couvrent la totalité des
 * filtres exposés par les data planes du dépôt (`revoked`, `enabled`, `role`,
 * `actor`, `since`…). Une grammaire d'opérateurs (`contains`, `in`,
 * `startsWith`) serait un langage de requête, pas un filtre : elle appartient au
 * store, qui seul sait ce qu'il peut indexer.
 */
export type FilterKind = "string" | "boolean" | "int";

/**
 * Définition d'UN filtre : sa nature, ou la **liste fermée** de ses valeurs.
 *
 * Une liste vaut énumération — `["auth", "authz", "token"]` — et devient
 * l'allowlist qui la valide, exactement comme `sortable` pour le tri.
 */
export type FilterDef = FilterKind | readonly string[];

/**
 * Ce qu'un point d'entrée sait filtrer : nom public → définition.
 *
 * C'est une **donnée**, pas un comportement — une constante par ressource, à
 * côté de son contrat. Elle ne vit pas sur le store : contrairement au tri (que
 * Redis ne sait pas faire, d'où `sortableFields` par backend), un filtre déclaré
 * dans un `IXListQuery` est une **obligation** de tous les backends de cette
 * ressource. Le déclarer par store laisserait croire le contraire.
 *
 * Étant une donnée sérialisable, elle est **publiable** : un endpoint de
 * capacités peut la rendre telle quelle, et le front cesse de coder les filtres
 * en dur.
 */
export type IFilterSpec = Readonly<Record<string, FilterDef>>;

/** Réglages de lecture d'un point d'entrée qui porte plus que des filtres. */
export interface IParseFiltersOptions {
  /**
   * Paramètres que ce point d'entrée lit **lui-même**, hors filtres — une
   * projection (`?include=author`), un format de sortie, une clé propre au
   * transport.
   *
   * Ils sont laissés passer sans être validés ni rendus : c'est l'appelant qui
   * s'en occupe. Les déclarer ici est le seul moyen de garder le refus de
   * l'inconnu — sans cette liste, `?include=author` deviendrait un `400` sur un
   * paramètre parfaitement légitime, et la seule échappatoire serait de ne plus
   * refuser du tout.
   *
   * @remarks Une clé énoncée ici est un **engagement de l'appelant** à la
   *   traiter. L'y mettre pour faire taire un refus, sans la lire ensuite,
   *   recrée exactement le paramètre accepté puis jeté que ce contrat bannit.
   */
  accepts?: readonly string[];
}

/** Le type JavaScript qu'une définition de filtre produit une fois lue. */
export type FilterValue<D extends FilterDef> = D extends "string"
  ? string
  : D extends "boolean"
    ? boolean
    : D extends "int"
      ? number
      : D extends readonly (infer V)[]
        ? V
        : never;

/**
 * Les filtres lus, **typés depuis la spec** : une énumération rend son union de
 * littéraux, `boolean` rend un booléen, `int` un nombre.
 *
 * C'est ce qui permet de composer directement avec un `IXListQuery` — sans cast,
 * sans `as AuditCategory`. Une spec déclarée `as const satisfies IFilterSpec`
 * porte donc à la fois la validation à l'exécution et le type à la compilation :
 * ajouter une valeur à une énumération met les deux à jour d'un seul geste.
 */
export type FilterValues<S extends IFilterSpec> = {
  -readonly [K in keyof S]?: FilterValue<S[K]>;
};

/**
 * **Le** lecteur de filtres : transforme une source clé→valeur en filtres
 * validés, selon la spec déclarée par la ressource. Fonction **pure**.
 *
 * Il remplace les lectures `one(query, "x")` que chaque data plane recopiait —
 * une vingtaine dans le dépôt, avec autant de coercitions maison. Ce n'est pas
 * la répétition qui coûtait, c'est ce qu'elles faisaient toutes : **accepter
 * puis jeter**. `?revoked=oui` posait le filtre à `undefined`, `?category=zzz`
 * tombait hors de l'énumération, `?enbaled=true` n'existait pour personne — et
 * dans les trois cas la réponse était une page NON filtrée, que le client lit
 * comme le résultat de son filtre. Le tri a cessé de faire ça ; les filtres le
 * faisaient encore.
 *
 * Trois refus, tous en `400` :
 *
 * | Cas                                | Exemple                    |
 * | ---------------------------------- | -------------------------- |
 * | valeur mal formée                  | `?revoked=oui`             |
 * | valeur hors énumération            | `?category=zzz`            |
 * | paramètre reconnu par personne     | `?enbaled=true`            |
 *
 * Le troisième est le plus important et le moins évident : sans lui, une faute
 * de frappe dans une URL d'administration rend silencieusement la collection
 * ENTIÈRE. Les clés du contrat de page ({@link PAGE_QUERY_KEYS}) sont bien sûr
 * admises — c'est le même URL qui porte les deux.
 *
 * @param source - la query string parsée, ou le corps d'une requête `QUERY`.
 * @param spec - ce que ce point d'entrée sait filtrer.
 * @param options - paramètres que l'appelant lit lui-même (voir
 *   {@link IParseFiltersOptions.accepts}).
 * @returns les filtres présents et valides (les absents ne sont pas posés).
 * @throws {@link PageQueryError} (`code` 400) sur l'un des trois cas ci-dessus.
 *
 * @example
 * ```ts
 * const TOKEN_FILTERS = {
 *   subjectId: "string",
 *   revoked: "boolean",
 *   kind: ["pat", "refresh"],
 * } as const satisfies IFilterSpec;
 *
 * const page = parsePageQuery(request.query, { sortable });
 * const filters = parseFilters(request.query, TOKEN_FILTERS);
 * return store.listPage({ ...page, ...filters });
 * ```
 */
export function parseFilters<const S extends IFilterSpec>(
  source: PageQuerySource,
  spec: S,
  options: IParseFiltersOptions = {},
): FilterValues<S> {
  const out: Record<string, string | boolean | number> = {};
  const accepts = options.accepts;

  for (const key of Object.keys(source)) {
    if (PAGE_QUERY_KEYS.has(key)) continue;
    if (accepts?.includes(key)) continue;
    if (!Object.hasOwn(spec, key)) {
      const known = Object.keys(spec);
      throw new PageQueryError(
        known.length
          ? `Unknown parameter "${key}". Filterable fields: ${known.join(", ")}.`
          : `Unknown parameter "${key}"; this endpoint has no filters.`,
      );
    }
  }

  for (const [name, def] of Object.entries(spec)) {
    const raw = singleValue(source, name);
    if (raw === undefined || raw === "") continue;

    if (Array.isArray(def)) {
      if (!def.includes(raw)) {
        throw new PageQueryError(
          `Invalid value "${raw}" for "${name}". Accepted: ${def.join(", ")}.`,
        );
      }
      out[name] = raw;
      continue;
    }

    if (def === "boolean") {
      if (raw !== "true" && raw !== "false") {
        throw new PageQueryError(
          `Invalid value "${raw}" for "${name}" (expected true or false).`,
        );
      }
      out[name] = raw === "true";
      continue;
    }

    if (def === "int") {
      const n = Number.parseInt(raw, 10);
      // `Number.parseInt("12abc")` rend 12 : comparer la forme rendue à
      // l'entrée est le seul moyen de refuser une valeur à moitié numérique,
      // qui filtrerait sur autre chose que ce qui a été demandé.
      if (!Number.isFinite(n) || String(n) !== raw.trim()) {
        throw new PageQueryError(
          `Invalid value "${raw}" for "${name}" (expected an integer).`,
        );
      }
      out[name] = n;
      continue;
    }

    out[name] = raw;
  }

  // La sortie est construite EN SUIVANT `spec`, donc chaque clé porte déjà la
  // nature déclarée ; TypeScript ne peut pas le relier à travers la boucle (le
  // rapprochement `def === "boolean"` ⇒ `out[name]: boolean` lui échappe), d'où
  // cette assertion unique — la seule du fichier, adossée aux tests de nature.
  return out as FilterValues<S>;
}
