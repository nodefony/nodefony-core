/**
 * Standard Schema (https://standardschema.dev) — gardes et erreur de
 * validation autour de l'interface commune que Zod, Valibot, ArkType…
 * implémentent sous la clé `~standard`.
 *
 * Les TYPES de la spécification vivent dans `standardSchemaTypes.ts` (types
 * seuls, lus par le contrat temps réel du navigateur) et sont réexportés ici.
 * Aucune valeur n'est sérialisée ni copiée : un schéma valide la valeur
 * DÉCODÉE par le transport, qu'elle vienne d'un corps JSON, d'un formulaire
 * ou d'une trame binaire (`Uint8Array`).
 */
import type {
  IStandardJsonSchemaConverter,
  IStandardSchemaIssue,
  IStandardSchemaV1,
} from "./standardSchemaTypes";

export type {
  IStandardSchemaPathSegment,
  IStandardSchemaIssue,
  IStandardSchemaSuccess,
  IStandardSchemaFailure,
  StandardSchemaResult,
  IStandardSchemaTypes,
  IStandardSchemaProps,
  IStandardSchemaV1,
  InferSchemaOutput,
  InferSchemaInput,
  IStandardJsonSchemaConverter,
} from "./standardSchemaTypes";

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
