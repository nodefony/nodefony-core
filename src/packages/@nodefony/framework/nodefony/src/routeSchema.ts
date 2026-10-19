import type { Readable } from "node:stream";
import {
  isStandardSchema,
  BootConfigurationError,
  SchemaValidationError,
  toSchemaValidationIssues,
} from "nodefony";
import type {
  ISchemaValidationIssue,
  IStandardSchemaV1,
  InferSchemaOutput,
  MaybePromise,
  StandardSchemaResult,
} from "nodefony";

/**
 * Le schéma d'une route : un Standard Schema par partie de l'entrée (Zod,
 * Valibot, ArkType…). Chaque partie est facultative ; une partie déclarée est
 * validée AVANT l'action, une partie omise est servie brute.
 *
 * @example
 * ```ts
 * \@Post("/posts", { schema: { body: z.object({ title: z.string() }) } })
 * create(input: RouteInput<{ body: typeof createPost }>) {
 *   return this.createResource(input.body);
 * }
 * ```
 */
export interface IRouteSchema {
  /** Variables de route (`/posts/{id}`). */
  readonly params?: IStandardSchemaV1 | undefined;
  /** Query (`?page=2`) — celle du chemin INVOQUÉ sur le pont WebSocket. */
  readonly query?: IStandardSchemaV1 | undefined;
  /**
   * Corps DÉCODÉ par le transport : JSON, formulaire, ou octets (`Uint8Array`
   * — un `Buffer` HTTP en est un). Jamais re-sérialisé pour être validé.
   */
  readonly body?: IStandardSchemaV1 | undefined;
  /** En-têtes (clés en minuscules) ; sur WebSocket, ceux du handshake. */
  readonly headers?: IStandardSchemaV1 | undefined;
}

/**
 * Options de route propres aux DÉCORATEURS (`@route`, `@Get`, `@Post`…) : elles
 * décrivent l'entrée de l'action et se rangent sur sa méthode. Une route créée
 * par programme (`Router.createRoute`) ne les accepte pas — elle n'a pas de
 * décorateur pour les ranger, et les ignorer en silence mentirait.
 */
export interface IRouteSchemaOptions {
  /**
   * Schéma de l'entrée de l'action. Les parties déclarées sont validées AVANT
   * l'action (422 sinon), et l'action reçoit un argument unique, `RouteInput`.
   * Exclusif des décorateurs de paramètre (`@Body`…) sur la même action : le
   * mélange est refusé au démarrage.
   */
  schema?: IRouteSchema | undefined;
  /**
   * L'action lit le corps en FLUX (`input.body` est le flux brut de la
   * requête) : le pipeline ne le lit pas en mémoire — gros envoi sans pic de
   * mémoire. Remplace `@Body({ stream: true })` pour une action à schéma : il
   * EXIGE un `schema` (sans lui, le flux ne serait livré à personne) et exclut
   * `schema.body`. Défaut `false`.
   */
  bodyStream?: boolean | undefined;
}

/** Parties de l'entrée d'une route, dans l'ordre où elles sont validées. */
export type RoutePart = keyof IRouteSchema;

/** Variables de route brutes (une valeur par défaut n'est pas forcément une chaîne). */
export type RawRouteParams = Readonly<Record<string, unknown>>;
/** Query brute. */
export type RawRouteQuery = Readonly<Record<string, unknown>>;
/** En-têtes bruts, clés en minuscules. */
export type RawRouteHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

/** Type d'une partie : la sortie de son schéma s'il est déclaré, la forme brute sinon. */
type RoutePartOf<
  S extends IRouteSchema,
  K extends RoutePart,
  Raw,
> = S[K] extends IStandardSchemaV1 ? InferSchemaOutput<S[K]> : Raw;

/**
 * L'argument UNIQUE d'une action à schéma : les quatre apports de la
 * requête, toujours présents — validés et typés par le schéma quand il les
 * déclare, servis bruts et typés large sinon.
 *
 * @typeParam S - le schéma de la route.
 * @typeParam Stream - `true` quand la route déclare `bodyStream: true` :
 *   `body` est alors le flux brut de la requête, jamais lu en mémoire.
 */
export type RouteInput<
  S extends IRouteSchema = IRouteSchema,
  Stream extends boolean = false,
> = {
  params: RoutePartOf<S, "params", RawRouteParams>;
  query: RoutePartOf<S, "query", RawRouteQuery>;
  body: Stream extends true
    ? Readable | undefined
    : RoutePartOf<S, "body", unknown>;
  headers: RoutePartOf<S, "headers", RawRouteHeaders>;
};

/** L'entrée brute d'une action, avant validation. */
export type RawRouteInput = {
  params: unknown;
  query: unknown;
  body: unknown;
  headers: unknown;
};

const ROUTE_PARTS: readonly RoutePart[] = [
  "params",
  "query",
  "body",
  "headers",
];
/** Les noms des parties, pour reconnaître une clé lue sur un objet inconnu. */
const ROUTE_PART_NAMES: ReadonlySet<string> = new Set<string>(ROUTE_PARTS);

/**
 * Valide l'entrée d'une action contre son schéma — synchrone tant que chaque
 * validateur l'est, asynchrone seulement si l'un d'eux rend une promesse.
 *
 * Les quatre parties sont toutes validées avant de conclure : un échec rend
 * en une fois TOUTES les anomalies, chacune rattachée à sa partie. La valeur
 * d'une partie validée est remplacée par la SORTIE de son schéma (valeurs par
 * défaut, coercitions) ; la valeur reçue n'est ni copiée ni sérialisée — des
 * octets décodés par le transport arrivent tels quels au validateur.
 *
 * @param schema - le schéma de la route.
 * @param raw - l'entrée brute, mutée en place (objet propre à la requête).
 * @returns l'entrée validée, ou sa promesse.
 * @throws SchemaValidationError (statut 422) quand une partie est invalide —
 *   de façon synchrone, ou par la promesse rendue.
 */
export function validateRouteInput(
  schema: IRouteSchema,
  raw: RawRouteInput,
): MaybePromise<RawRouteInput> {
  // Chemin nominal (validateurs synchrones, entrée valide) : AUCUNE
  // allocation ici — chaque résultat s'applique sur place. Les anomalies et
  // les attentes ne s'allouent qu'à leur première occurrence.
  let failures: (ISchemaValidationIssue[] | undefined)[] | null = null;
  let pending: Promise<unknown>[] | null = null;
  for (let i = 0; i < ROUTE_PARTS.length; i++) {
    const part = ROUTE_PARTS[i];
    const partSchema = part === undefined ? undefined : schema[part];
    if (part === undefined || partSchema === undefined) continue;
    const result = partSchema["~standard"].validate(raw[part]);
    if (result instanceof Promise) {
      pending ??= [];
      pending.push(
        result.then(
          (settled) =>
            (failures = applyPartResult(raw, part, i, settled, failures)),
        ),
      );
    } else {
      failures = applyPartResult(raw, part, i, result, failures);
    }
  }
  if (pending === null) return concludeRouteInput(raw, failures);
  return Promise.all(pending).then(() => concludeRouteInput(raw, failures));
}

/**
 * Applique le résultat d'une partie : sa sortie remplace la valeur brute, ou
 * ses anomalies sont rangées à SON rang — l'erreur les rend dans l'ordre des
 * parties, que leurs validateurs aient attendu ou non.
 */
function applyPartResult(
  raw: RawRouteInput,
  part: RoutePart,
  rank: number,
  result: StandardSchemaResult<unknown>,
  failures: (ISchemaValidationIssue[] | undefined)[] | null,
): (ISchemaValidationIssue[] | undefined)[] | null {
  if (result.issues === undefined) {
    raw[part] = result.value;
    return failures;
  }
  const ranked = failures ?? [];
  ranked[rank] = toSchemaValidationIssues(result.issues, part);
  return ranked;
}

/** Rend l'entrée validée, ou lève l'erreur unique qui porte toutes les anomalies. */
function concludeRouteInput(
  raw: RawRouteInput,
  failures: readonly (ISchemaValidationIssue[] | undefined)[] | null,
): RawRouteInput {
  if (failures === null) return raw;
  const issues: ISchemaValidationIssue[] = [];
  for (const partIssues of failures) {
    if (partIssues !== undefined) issues.push(...partIssues);
  }
  throw new SchemaValidationError(issues);
}

/**
 * Refuse, au démarrage, un schéma de route mal formé : partie inconnue (une
 * faute de frappe — `bodies` — serait sinon ignorée sans un mot), ou valeur
 * qui n'implémente pas Standard Schema (un appelant JavaScript peut passer
 * n'importe quoi).
 *
 * @param schema - le schéma déclaré.
 * @param routeName - la route, nommée dans l'erreur.
 * @throws BootConfigurationError sur la première faute trouvée.
 */
export function assertRouteSchemaShape(
  schema: unknown,
  routeName: string,
): asserts schema is IRouteSchema {
  if (typeof schema !== "object" || schema === null) {
    throw new BootConfigurationError(
      `Route "${routeName}" : l'option « schema » doit être un objet ` +
        `{ params, query, body, headers }.`,
    );
  }
  for (const [part, value] of Object.entries(schema)) {
    if (!ROUTE_PART_NAMES.has(part)) {
      throw new BootConfigurationError(
        `Route "${routeName}" : partie de schéma inconnue « ${part} » ` +
          `(attendu : ${ROUTE_PARTS.join(", ")}).`,
      );
    }
    if (value !== undefined && !isStandardSchema(value)) {
      throw new BootConfigurationError(
        `Route "${routeName}" : « schema.${part} » n'implémente pas ` +
          `Standard Schema (Zod, Valibot, ArkType…).`,
      );
    }
  }
}
