import type { PartialInput } from "nodefony";

/**
 * Retire les clés qui valent `undefined` d'une donnée d'écriture partielle.
 *
 * `undefined` et clé absente veulent dire « ne pas toucher » : Drizzle ignore
 * déjà une valeur `undefined`, Mongoose (≥ 6) la retire d'une mise à jour. La
 * règle est posée ICI, une fois, au seuil de la persistance, au lieu d'être
 * un comportement propre à chaque adaptateur.
 *
 * Rend l'objet reçu TEL QUEL quand aucune clé ne vaut `undefined` — le cas
 * courant d'un corps JSON, qui ne peut pas en porter : aucune allocation.
 *
 * @param data - données d'écriture, clés `undefined` admises
 * @returns les mêmes données, sans aucune clé `undefined`
 */
export function omitUndefined<T>(data: PartialInput<T>): Partial<T> {
  const source = data as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) continue;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(source)) {
      const value = source[k];
      if (value !== undefined) out[k] = value;
    }
    return out as Partial<T>;
  }
  return data;
}
