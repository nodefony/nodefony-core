import { z } from "zod";

/**
 * Métadonnées Nodefony attachées à un champ de config Zod (au-delà de la
 * `description`). Écrites dans le **global registry** de Zod via {@link meta} →
 * recopiées telles quelles par `z.toJSONSchema()`, donc lisibles par :
 *   - le futur formulaire d'édition Studio (grise les `reserved`, masque les
 *     `secret`, autorise l'édition à chaud des `runtimeMutable`),
 *   - la documentation générée,
 *   - un futur reload-à-chaud de la config.
 *
 * Convention transverse : ce helper vit pour l'instant dans `@nodefony/http`
 * (1ʳᵉ adoption) ; à promouvoir dans le core (`nodefony`) lors d'une passe
 * transverse, pour redis (`password` → `secret`), security (`jwt` → `secret`)…
 *
 * Sémantique : les flags sont des **marqueurs opt-in**. Leur ABSENCE = défaut
 * naturel (champ NON réservé, NON secret, NON dérivé du kernel, et nécessitant
 * un **restart** pour prendre effet — cas de la quasi-totalité des options HTTP,
 * dont les serveurs sont créés une seule fois au boot).
 */
export interface INodefonyFieldMeta {
  /** Réservé à une feature future, non lu en runtime (Studio grise le champ). */
  reserved?: boolean;
  /**
   * Modifiable à chaud : la valeur est relue à chaque requête, donc muter
   * `module.options` prend effet SANS redémarrage. Absent = restart requis.
   */
  runtimeMutable?: boolean;
  /**
   * Défaut injecté par le builder à partir du kernel (ex. `upload.uploadDir`
   * ← `kernel.tmpDir`, `certificates.openssl.attrs` ← `kernel.domain`). Studio
   * affiche « auto » plutôt qu'une valeur figée.
   */
  kernelDerived?: boolean;
  /** Donnée sensible : à masquer dans Studio et à rédiger dans les logs. */
  secret?: boolean;
}

/**
 * Attache une `description` + des {@link INodefonyFieldMeta} à un schéma Zod,
 * de façon typée et chaînable. Remplace `.describe(text)` quand un champ porte
 * une sémantique Nodefony (réservé / éditable à chaud / dérivé kernel / secret).
 *
 * @param schema - le schéma Zod (après `.default()`/`.nullable()`…).
 * @param m - description obligatoire + flags optionnels.
 * @returns le même schéma (annoté).
 */
export function meta<T extends z.ZodType>(
  schema: T,
  m: INodefonyFieldMeta & { description: string },
): T {
  // `.meta()` attend le `GlobalMeta` de Zod (index signature `[k]: unknown`) ;
  // notre interface fermée est compatible en valeur → cast vers l'index sig.
  return schema.meta(m as unknown as Record<string, unknown>) as T;
}
