/**
 * Standard Schema (https://standardschema.dev) — les TYPES seuls de l'interface
 * commune que Zod, Valibot, ArkType… implémentent sous la clé `~standard`.
 *
 * Les types sont RECOPIÉS de `@standard-schema/spec` 1.1.0 (ce que la
 * spécification autorise) plutôt que pris en dépendance : ils entrent dans les
 * `.d.ts` publiés de Nodefony (`RouteInput`, `IRealtimeContract`), et un type
 * importé d'un paquet que l'installeur n'a pas serait introuvable chez lui.
 * L'assignabilité est STRUCTURELLE : un schéma Zod satisfait cette copie sans
 * import.
 *
 * Fichier de TYPES SEULS, séparé de `standardSchema.ts` (qui porte les gardes
 * et l'erreur de validation) : le contrat temps réel partagé par le navigateur
 * et le serveur (`RealtimeEventMap.ts`) le lit sans entraîner une seule
 * valeur dans le graphe du navigateur.
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
