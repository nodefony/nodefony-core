/**
 * Paramètres des actions temps réel de Studio — déclarés par SCHÉMA, jamais lus
 * à la main.
 *
 * Ils arrivent du réseau : le type `in` de `StudioContract` ne décrit qu'un
 * client conforme. Chaque action valide donc sa charge contre son schéma, et
 * c'est la sortie validée qu'elle exploite. Le contrat et les schémas sont
 * confrontés par le compilateur (`studioContract.types.test.ts`) : l'un ne
 * peut pas dériver de l'autre en silence.
 */
import { z } from "zod";
import {
  JsonRpcError,
  RpcError,
  SchemaValidationError,
  toSchemaValidationIssues,
} from "nodefony";
import type { IStandardSchemaV1, InferSchemaOutput } from "nodefony";

/**
 * Réponses d'un formulaire de génération : texte, case ou liste de textes —
 * ce qu'un formulaire produit, et rien d'autre. Le moteur les valide ensuite
 * contre SA spec.
 */
export const scaffoldAnswersSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.array(z.string())]),
);

/** `nodefony:scaffold:preview` — le type à générer et ses réponses. */
export const scaffoldPreviewParamsSchema = z.strictObject({
  type: z.string().min(1),
  answers: scaffoldAnswersSchema.optional(),
});

/**
 * `nodefony:scaffold:run` — comme la préview, plus les étapes post-écriture
 * demandées. Les étapes restent des textes : l'allowlist (`SCAFFOLD_STEPS`) est
 * appliquée par le contrôleur, qui JETTE une étape inconnue au lieu de refuser
 * l'appel.
 */
export const scaffoldRunParamsSchema = z.strictObject({
  type: z.string().min(1),
  answers: scaffoldAnswersSchema.optional(),
  steps: z.array(z.string()).optional(),
});

/** `nodefony:scaffold:cancel` — l'identifiant du job à arrêter. */
export const scaffoldCancelParamsSchema = z.strictObject({
  id: z.string().min(1),
});

/**
 * Valide les paramètres d'une action contre son schéma et rend la sortie
 * validée.
 *
 * @param schema - schéma Standard Schema SYNCHRONE de la charge.
 * @param params - paramètres reçus du réseau.
 * @returns la charge validée.
 * @throws RpcError `-32602` (INVALID_PARAMS) quand la charge est invalide — le
 *   message nomme chaque champ fautif, `data.fields` en porte la liste.
 * @throws Error si le schéma est asynchrone : une action temps réel répond sans
 *   attendre un validateur distant.
 */
export function parseActionParams<S extends IStandardSchemaV1>(
  schema: S,
  params: unknown,
): InferSchemaOutput<S> {
  const result = schema["~standard"].validate(params);
  if (result instanceof Promise) {
    throw new Error("schéma de paramètres asynchrone non pris en charge");
  }
  if (result.issues !== undefined) {
    const error = new SchemaValidationError(
      toSchemaValidationIssues(result.issues, "params"),
    );
    throw new RpcError(error.message, JsonRpcError.INVALID_PARAMS, {
      fields: error.issues,
    });
  }
  return result.value;
}
