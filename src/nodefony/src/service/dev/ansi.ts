/**
 * Palette SGR des sorties terminal des outils de développement (superviseur,
 * `status`, `stop`, rapport de boot) — une seule définition.
 *
 * Elle vivait en cinq copies : quatre identiques, une qui avait perdu `bold`,
 * et deux fichiers où « atténué » voulait dire `\x1b[2m` quand les trois autres
 * écrivaient `\x1b[90m`. Les deux rendus existent bien, et ne se valent pas :
 * `dim` est un GRIS (lisible sur tout fond), `faint` une ATTÉNUATION de la
 * couleur courante, que certains terminaux ignorent.
 */
export const ANSI = Object.freeze({
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  /** Atténuation de la couleur courante (SGR 2) — ignorée par certains terminaux. */
  faint: "\x1b[2m",
  /** Gris (SGR 90) — le « discret » lisible partout. */
  dim: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
});
