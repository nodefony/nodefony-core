/**
 * Fusion de directives Content-Security-Policy — logique PURE (aucune dépendance
 * à Vite, au frontend ni au transport). Permet à un module de DÉCLARER ses besoins
 * CSP (ex. `@nodefony/frontend` en dev : origines Vite + `'unsafe-eval'` pour le
 * Fast Refresh) sans que `@nodefony/security` connaisse leur sémantique : security
 * se contente de MERGER des fragments génériques `directive → sources`.
 *
 * Pourquoi un merge structuré (et pas une simple concaténation) : en CSP une
 * directive RÉPÉTÉE est ignorée après sa 1ʳᵉ occurrence (W3C CSP3 §3) → concaténer
 * deux `script-src` perdrait le second. Il faut fusionner les sources dans UNE
 * directive. Le token `'nonce-{{nonce}}'` est opaque (ni `;` ni espace) → préservé
 * tel quel par parse/serialize.
 */

/** Fragment additif d'un module : directive CSP → sources à ajouter. */
export type CspFragment = Record<string, readonly string[]>;

/**
 * Parse une chaîne CSP en directives ordonnées `[nom, sources[]]`. L'ordre des
 * directives et des sources est préservé (déterminisme : header stable, tests
 * fiables). Les séparateurs multiples / espaces superflus sont normalisés.
 */
export function parseCsp(csp: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0];
    out.push([name, tokens.slice(1)]);
  }
  return out;
}

/** Sérialise des directives ordonnées en chaîne CSP (`a b; c d`). */
export function serializeCsp(directives: Array<[string, string[]]>): string {
  return directives
    .map(([name, src]) => (src.length ? `${name} ${src.join(" ")}` : name))
    .join("; ");
}

/**
 * Fusionne un CSP de base avec des fragments additifs par module.
 *
 * - directive déjà dans la base → ses sources sont COMPLÉTÉES (dédupliquées,
 *   ordre base d'abord puis ajouts) ;
 * - directive absente → AJOUTÉE en fin (ordre d'apparition des fragments).
 *
 * Pur + déterministe : recalculé uniquement quand un module (dé)enregistre ses
 * origines (jamais par requête). Le résultat repart dans `SecurityHeaders`, qui
 * re-split autour de `{{nonce}}` au boot → 1 `join` par requête (hot-path inchangé).
 *
 * @param base - CSP de configuration (peut contenir `'nonce-{{nonce}}'`).
 * @param fragments - fragments additifs (un par module enregistré).
 * @returns la chaîne CSP fusionnée.
 */
export function mergeCspFragments(
  base: string,
  fragments: Iterable<CspFragment>,
): string {
  const directives = parseCsp(base);
  // Index nom → sources (référence partagée avec `directives` pour l'append).
  const index = new Map<string, string[]>();
  for (const [name, src] of directives) index.set(name, src);

  for (const fragment of fragments) {
    for (const name in fragment) {
      const additions = fragment[name];
      if (additions.length === 0) continue;
      let sources = index.get(name);
      if (!sources) {
        sources = [];
        index.set(name, sources);
        directives.push([name, sources]);
      }
      for (const src of additions) {
        if (!sources.includes(src)) sources.push(src);
      }
    }
  }
  return serializeCsp(directives);
}
