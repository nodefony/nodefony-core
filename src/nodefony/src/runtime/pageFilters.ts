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
 * Un filtre à valeurs **multiples** : la clé peut être répétée dans l'URL
 * (`?severity=ERROR&severity=CRITIC`), chaque occurrence étant validée par
 * `each`.
 *
 * C'est une AUTORISATION explicite, jamais un hasard de query string : hors
 * `{ each }`, un paramètre répété est refusé en `400` (`singleValue`). Le sens
 * du OU entre les valeurs appartient au store, pas au lecteur.
 *
 * @remarks Une valeur invalide fait échouer la LISTE ENTIÈRE. Le réflexe
 *   inverse — garder les valeurs valides et jeter les autres — est celui que
 *   les data planes appliquaient à la main, et il ment : `?flow=nimporte`
 *   laissait le critère vide, donc rendait le journal ENTIER sous un `200`.
 */
export interface FilterEach {
  /** La nature de CHAQUE valeur : une liste fermée, ou un type scalaire. */
  readonly each: FilterKind | readonly string[];
}

/**
 * Définition d'UN filtre : sa nature, la **liste fermée** de ses valeurs, ou
 * l'une des deux répétée ({@link FilterEach}).
 *
 * Une liste vaut énumération — `["auth", "authz", "token"]` — et devient
 * l'allowlist qui la valide, exactement comme `sortable` pour le tri.
 */
export type FilterDef = FilterKind | readonly string[] | FilterEach;

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

/** Le type d'UNE valeur, sans la répétition — brique de {@link FilterValue}. */
type ScalarFilterValue<D> = D extends "string"
  ? string
  : D extends "boolean"
    ? boolean
    : D extends "int"
      ? number
      : D extends readonly (infer V)[]
        ? V
        : never;

/**
 * Le type JavaScript qu'une définition de filtre produit une fois lue — un
 * **tableau** pour un filtre `{ each }`, la valeur seule sinon.
 */
export type FilterValue<D extends FilterDef> = D extends { each: infer E }
  ? ScalarFilterValue<E>[]
  : ScalarFilterValue<D>;

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

/** Une définition est-elle répétable ? (discriminant de {@link FilterEach}) */
const isEach = (def: FilterDef): def is FilterEach =>
  typeof def === "object" && !Array.isArray(def);

/**
 * Valide et convertit UNE valeur brute selon une nature scalaire — le cœur de
 * la lecture, partagé par les filtres simples et par chaque occurrence d'un
 * filtre `{ each }`. Les écrire deux fois les aurait fait diverger : c'est
 * exactement ce qui s'était produit dans les data planes, où la variante
 * multi-valeurs validait moins que la variante simple.
 *
 * @throws {@link PageQueryError} (`code` 400) si la valeur ne correspond pas.
 */
function coerce(
  raw: string,
  def: FilterKind | readonly string[],
  name: string,
): string | boolean | number {
  if (Array.isArray(def)) {
    if (!def.includes(raw)) {
      throw new PageQueryError(
        `Invalid value "${raw}" for "${name}". Accepted: ${def.join(", ")}.`,
      );
    }
    return raw;
  }

  if (def === "boolean") {
    if (raw !== "true" && raw !== "false") {
      throw new PageQueryError(
        `Invalid value "${raw}" for "${name}" (expected true or false).`,
      );
    }
    return raw === "true";
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
    return n;
  }

  return raw;
}

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
  const out: Record<
    string,
    string | boolean | number | (string | boolean | number)[]
  > = {};
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
    // Filtre RÉPÉTABLE : la clé est lue en entier, chaque occurrence passant la
    // MÊME validation qu'une valeur seule (`coerce`) — une règle, un exemplaire.
    if (isEach(def)) {
      const raw = source[name];
      if (raw === undefined) continue;
      const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== "");
      // Tout vide = aucune intention : la clé n'est pas posée, comme pour un
      // filtre simple à valeur vide.
      if (values.length === 0) continue;
      out[name] = values.map((v) => coerce(v, def.each, name));
      continue;
    }

    const raw = singleValue(source, name);
    if (raw === undefined || raw === "") continue;
    out[name] = coerce(raw, def, name);
  }

  // La sortie est construite EN SUIVANT `spec`, donc chaque clé porte déjà la
  // nature déclarée ; TypeScript ne peut pas le relier à travers la boucle (le
  // rapprochement `def === "boolean"` ⇒ `out[name]: boolean` lui échappe), d'où
  // cette assertion unique — la seule du fichier, adossée aux tests de nature.
  return out as FilterValues<S>;
}
