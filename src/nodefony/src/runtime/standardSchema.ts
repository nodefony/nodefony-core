/**
 * Standard Schema (https://standardschema.dev) — l'interface commune que
 * Zod, Valibot, ArkType… implémentent sous la clé `~standard`.
 *
 * Les types sont RECOPIÉS de `@standard-schema/spec` 1.1.0 (ce que la
 * spécification autorise) plutôt que pris en dépendance : ils entrent dans les
 * `.d.ts` publiés de Nodefony (`RouteInput`), et un type importé d'un paquet
 * que l'installeur n'a pas serait introuvable chez lui. L'assignabilité est
 * STRUCTURELLE : un schéma Zod satisfait cette copie sans import.
 *
 * Le fichier est NEUTRE — ni Node, ni DOM : le contrat temps réel partagé par
 * le navigateur et le serveur (#628) le lira tel quel. Aucune valeur n'y est
 * sérialisée ni copiée : un schéma valide la valeur DÉCODÉE par le transport,
 * qu'elle vienne d'un corps JSON, d'un formulaire ou d'une trame binaire
 * (`Uint8Array`).
 */

/** Un segment de chemin d'anomalie, sous sa forme objet. */
export interface IStandardSchemaPathSegment {
  /** La clé du segment. */
  readonly key: PropertyKey;
}

/** Une anomalie rendue par un schéma en échec. */
export interface IStandardSchemaIssue {
  /** Message lisible de l'anomalie. */
  readonly message: string;
  /** Chemin de la valeur fautive, s'il y en a un. */
  readonly path?:
    ReadonlyArray<PropertyKey | IStandardSchemaPathSegment> | undefined;
}

/** Résultat d'une validation réussie. */
export interface IStandardSchemaSuccess<Output> {
  /** La valeur validée, éventuellement transformée par le schéma. */
  readonly value: Output;
  /** Absent en cas de succès. */
  readonly issues?: undefined;
}

/** Résultat d'une validation en échec. */
export interface IStandardSchemaFailure {
  /** Les anomalies relevées. */
  readonly issues: ReadonlyArray<IStandardSchemaIssue>;
}

/** Résultat de `~standard.validate`. */
export type StandardSchemaResult<Output> =
  IStandardSchemaSuccess<Output> | IStandardSchemaFailure;

/** Types portés par un schéma (présents à la compilation seulement). */
export interface IStandardSchemaTypes<Input = unknown, Output = Input> {
  /** Le type accepté en entrée. */
  readonly input: Input;
  /** Le type rendu après validation. */
  readonly output: Output;
}

/** Les propriétés `~standard` d'un schéma. */
export interface IStandardSchemaProps<Input = unknown, Output = Input> {
  /** Version de la spécification. */
  readonly version: 1;
  /** Bibliothèque qui implémente le schéma (`zod`, `valibot`…). */
  readonly vendor: string;
  /** Valide une valeur inconnue ; synchrone, sauf si le schéma est asynchrone. */
  readonly validate: (
    value: unknown,
    options?: { readonly libraryOptions?: Record<string, unknown> | undefined },
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  /** Types inférés, pour la compilation. */
  readonly types?: IStandardSchemaTypes<Input, Output> | undefined;
}

/**
 * Un schéma conforme à Standard Schema v1 — Zod 4, Valibot, ArkType…
 *
 * @typeParam Input - ce que le schéma accepte.
 * @typeParam Output - ce qu'il rend après validation.
 */
export interface IStandardSchemaV1<Input = unknown, Output = Input> {
  /** Les propriétés de la spécification. */
  readonly "~standard": IStandardSchemaProps<Input, Output>;
}

/** Le type que rend un schéma validé. */
export type InferSchemaOutput<S extends IStandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];

/** Le type qu'accepte un schéma. */
export type InferSchemaInput<S extends IStandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["input"];

/**
 * Convertisseur JSON Schema optionnel (Standard JSON Schema v1), exposé par
 * certaines bibliothèques sous `~standard.jsonSchema` (Zod 4 le fait). Sert à
 * DÉCRIRE un schéma — console d'administration, documentation —, jamais à
 * valider.
 */
export interface IStandardJsonSchemaConverter {
  /** JSON Schema du type d'entrée ; peut lever si la conversion est impossible. */
  readonly input: (options: {
    readonly target: string;
  }) => Record<string, unknown>;
}

/**
 * Indique si une valeur implémente Standard Schema v1. Sert aux contrôles de
 * démarrage : un appelant JavaScript peut passer n'importe quoi.
 *
 * @param value - la valeur à examiner.
 * @returns `true` si `value["~standard"].validate` est une fonction de version 1.
 */
export function isStandardSchema(value: unknown): value is IStandardSchemaV1 {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }
  // `Reflect.get` lu en `unknown` : aucune forme supposée avant d'être vérifiée.
  const props: unknown = Reflect.get(value, "~standard");
  return (
    typeof props === "object" &&
    props !== null &&
    Reflect.get(props, "version") === 1 &&
    typeof Reflect.get(props, "validate") === "function"
  );
}

/** Garde : la valeur expose une conversion `input` (Standard JSON Schema). */
function isJsonSchemaConverter(
  value: unknown,
): value is IStandardJsonSchemaConverter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "input") === "function"
  );
}

/**
 * Le convertisseur JSON Schema d'un schéma, s'il en expose un.
 *
 * @param schema - le schéma.
 * @returns le convertisseur, ou `null` quand la bibliothèque n'en fournit pas.
 */
export function standardJsonSchemaOf(
  schema: IStandardSchemaV1,
): IStandardJsonSchemaConverter | null {
  const converter: unknown = Reflect.get(schema["~standard"], "jsonSchema");
  return isJsonSchemaConverter(converter) ? converter : null;
}

/**
 * Une anomalie de validation, normalisée : chemin en clés textuelles, et
 * partie de l'entrée qui l'a portée.
 */
export interface ISchemaValidationIssue {
  /** Message lisible. */
  readonly message: string;
  /** Chemin de la valeur fautive DANS sa partie (`["author", "email"]`). */
  readonly path: readonly string[];
  /** La partie de l'entrée : `body`, `query`, `params`, `headers`… */
  readonly in?: string | undefined;
}

/**
 * Erreur levée quand une entrée ne satisfait pas son schéma — l'unique erreur
 * de validation des routes à schéma.
 *
 * `code = 422` (RFC 9110 §15.5.21) : la requête a été lue, c'est son contenu
 * qui viole le contrat. Le rendu d'erreur de `@nodefony/http` la reconnaît par
 * son NOM, comme une `ZodError`, et la sert avec `error.fields` ; le pont
 * WebSocket `api.request` lit le même `code` et les mêmes champs. Classe
 * neutre (aucune dépendance Node) : elle peut naître côté navigateur.
 */
export class SchemaValidationError extends Error {
  /** Statut HTTP équivalent. */
  override readonly code = 422;
  /** Les anomalies, toutes parties confondues. */
  readonly issues: readonly ISchemaValidationIssue[];

  /** @param issues - les anomalies normalisées ({@link toSchemaValidationIssues}). */
  constructor(issues: readonly ISchemaValidationIssue[]) {
    super(
      `Validation failed — ${issues
        .map((i) => {
          const where = [i.in, ...i.path].filter(Boolean).join(".");
          return where ? `${where}: ${i.message}` : i.message;
        })
        .join(" · ")}`,
    );
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

/**
 * Normalise les anomalies d'un schéma : segments objet `{ key }` dépliés,
 * clés converties en texte (un `Symbol` ferait lever `Array.join`), partie
 * de l'entrée rattachée.
 *
 * @param issues - anomalies brutes de `~standard.validate`.
 * @param part - la partie validée (`body`, `query`…), ou rien.
 * @returns les anomalies normalisées.
 */
export function toSchemaValidationIssues(
  issues: ReadonlyArray<IStandardSchemaIssue>,
  part?: string,
): ISchemaValidationIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    path:
      issue.path?.map((segment) =>
        String(typeof segment === "object" ? segment.key : segment),
      ) ?? [],
    in: part,
  }));
}
