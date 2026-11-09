/**
 * Les limites de GitHub qu'un corps d'issue ou un commentaire ne doit pas
 * franchir — vérifiées AVANT l'envoi, jamais découvertes au refus.
 *
 * GitHub refuse au-delà de 65 536 caractères le corps d'une issue, d'une
 * demande de fusion ET d'un commentaire (« Body is too long (maximum is 65536
 * characters) ») : le geste échoue après coup, souvent à la fin d'une session,
 * et un `gh issue close --comment` refusé laisse le ticket OUVERT.
 *
 * @module github-limits
 */

/** Taille maximale, en caractères, d'un corps d'issue ou d'un commentaire. */
export const GITHUB_BODY_MAX = 65_536;

/**
 * Vérifie qu'un texte tient dans un corps ou un commentaire GitHub.
 *
 * Compte en unités UTF-16 (`String.length`) : jamais moins que les caractères
 * perçus, donc la garde ne laisse rien passer que GitHub refuserait.
 *
 * @param {string} text - le corps ou le commentaire à envoyer
 * @returns {{ ok: true, length: number } | { ok: false, length: number, reason: string }}
 */
export function checkBodyLength(text) {
  const length = text.length;
  if (length <= GITHUB_BODY_MAX) return { ok: true, length };
  return {
    ok: false,
    length,
    reason:
      `${length} caractères, GitHub en refuse au-delà de ${GITHUB_BODY_MAX} ` +
      `(corps d'issue comme commentaire) — couper : le détail va dans le commit ` +
      `ou un fichier versionné, le ticket le POINTE`,
  };
}
