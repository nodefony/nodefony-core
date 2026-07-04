import type {} from "zod";

/**
 * Métadonnées Nodefony d'un champ de config Zod, au-delà de la `description`.
 *
 * Portées par le `.meta()` NATIF de zod 4 (global registry) — recopiées telles
 * quelles par `z.toJSONSchema()`, donc lisibles par :
 *   - le formulaire d'édition Studio (grise les `reserved`, masque les `secret`,
 *     autorise l'édition à chaud des `runtimeMutable`),
 *   - la documentation générée,
 *   - la provenance de config (défaut / surcharge / env).
 *
 * Sémantique : les flags sont des **marqueurs opt-in**. Leur ABSENCE = défaut
 * naturel (champ NON réservé, NON secret, NON dérivé du kernel, et nécessitant
 * un **restart** pour prendre effet).
 *
 * Usage (aucun helper — le typage vient de l'augmentation de `GlobalMeta`
 * ci-dessous, active dès que le programme importe `nodefony`) :
 *
 * ```typescript
 * password: z.string().optional().meta({
 *   description: "Mot de passe du serveur Redis.",
 *   secret: true,
 * }),
 * ```
 *
 * ⚠️ **`.meta()` TOUJOURS EN DERNIER dans la chaîne** : chaque méthode zod
 * (`.default()`, `.optional()`, `.refine()`…) retourne une NOUVELLE instance et
 * la métadonnée est attachée à l'instance — `.meta({...}).default(x)` la PERD
 * silencieusement (`.meta()` rend `undefined` sur l'instance finale).
 */
export interface IConfigFieldMeta {
  /** Réservé à une feature future, non lu en runtime (Studio grise le champ). */
  reserved?: boolean;
  /**
   * Modifiable à chaud : la valeur est relue à chaque usage, donc muter
   * `module.options` prend effet SANS redémarrage. Absent = restart requis.
   */
  runtimeMutable?: boolean;
  /**
   * Défaut injecté par le builder à partir du kernel (ex. `upload.uploadDir`
   * ← `kernel.tmpDir`). Studio affiche « auto » plutôt qu'une valeur figée.
   */
  kernelDerived?: boolean;
  /** Donnée sensible : à masquer dans Studio et à rédiger dans les logs. */
  secret?: boolean;
}

declare module "zod" {
  /**
   * Les flags Nodefony vivent dans le `GlobalMeta` zod : `.meta()` les propose
   * typés sur tout schéma, dans le core, les modules ET les apps consommatrices.
   */
  interface GlobalMeta extends IConfigFieldMeta {}
}
