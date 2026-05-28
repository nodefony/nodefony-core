import { z } from "zod";
import { realtimeConfigSchema, type RealtimeConfig } from "./schema";
import type { IBackplane } from "../interfaces/IBackplane";

/**
 * Builder type-safe de la configuration de `@nodefony/realtime`.
 *
 * Principes (alignés sur `defineSecurityConfig`) :
 * - **Source unique** : `./schema.ts` (Zod). Le builder VALIDE + GÈLE, ne dévie pas.
 * - **Auto-documenté + introspectable** : chaque champ Zod porte `.describe()` →
 *   {@link realtimeConfigJsonSchema} produit un JSON Schema qu'un formulaire
 *   Studio (futur) consommera pour générer son UI d'édition.
 * - **Backplane custom** : instance `IBackplane` userland (NATS, Pulsar…) passée
 *   via le 2ᵉ argument — **hors** schéma sérialisable (les classes n'ont rien à
 *   faire dans un JSON Schema Studio). L'instance, si fournie, prend précédence
 *   sur `driver` côté service ; ce dernier reste source d'introspection/UI.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @param options.backplane - instance `IBackplane` custom (override le driver à
 *   l'init du `RealtimeService`). Non sérialisable → exclue du JSON Schema.
 * @returns config gelée prête pour `RealtimeService`.
 * @throws ZodError si invalide.
 */
export function defineRealtimeConfig(
  config: IRealtimeConfigInput = {},
  options: { backplane?: IBackplane } = {},
): IRealtimeConfig {
  const parsed = realtimeConfigSchema.parse(config);
  const out: IRealtimeConfig = {
    ...parsed,
    backplane: { ...parsed.backplane, instance: options.backplane },
  };
  return Object.freeze(out);
}

/**
 * JSON Schema introspectable de la config realtime — destiné au formulaire
 * d'édition Studio (futur). N'inclut PAS `backplane.instance` (non sérialisable).
 */
export function realtimeConfigJsonSchema(): unknown {
  return z.toJSONSchema(realtimeConfigSchema);
}

/** Entrée du builder (champs avec défaut optionnels). */
export type IRealtimeConfigInput = z.input<typeof realtimeConfigSchema>;

/** Config normalisée et gelée (sortie du builder, lue par `RealtimeService`). */
export type IRealtimeConfig = RealtimeConfig & {
  backplane: RealtimeConfig["backplane"] & { instance?: IBackplane };
};
