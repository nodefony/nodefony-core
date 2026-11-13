/**
 * La NATURE de chaque bloc d'un message — code, JSON, tableau, diff, formule
 * ou texte Markdown — reconnue par une règle PURE, la même dans la page et
 * dans les tests.
 *
 * Guide pour un agent : brique du KIT, partagée par les démos. Le texte
 * voyage BRUT : ni le serveur ni la base ne connaissent la nature, donc une
 * règle améliorée s'applique aussi aux anciens messages. Ordre de
 * reconnaissance : bloc ```langue explicite → JSON valide → CSV (`,` `;` ou
 * tabulation, au moins deux lignes de même largeur) → diff (`@@`, `+`, `-`)
 * → texte Markdown (`markdown.ts`). Tout est BORNÉ et linéaire : l'appelant
 * borne le texte (le salon : 64 Kio, `MESSAGE_MAX_BYTES`), et chaque nature
 * a sa borne ci-dessous. Aucun caractère du message n'est perdu : chaque bloc
 * garde sa `source`, tranche du texte, dans l'ordre.
 */

/** Un objet JSON s'affiche déplié jusqu'à ce niveau, replié au-delà. */
export const JSON_OPEN_DEPTH = 2;

/** Au-delà de ce niveau, un JSON s'affiche « … » (il reste copiable entier). */
export const JSON_MAX_DEPTH = 8;

/** Un tableau montre au plus deux cents lignes ; le reste est annoncé. */
export const CSV_MAX_ROWS = 200;

/**
 * La langue d'un bloc de code sans étiquette se devine sur ses 4 premiers
 * Kio (4 × 1024 octets) : deviner sur 64 Kio coûterait des dizaines de
 * millisecondes, pour la même réponse.
 */
export const GUESS_LANGUAGE_BYTES = 4096;

/** Un bloc d'un message, selon sa nature. */
export type NatureBlock =
  | { nature: "text"; source: string }
  | { nature: "code"; source: string; language: string | null }
  | { nature: "json"; source: string; value: unknown }
  | {
      nature: "csv";
      source: string;
      separator: "," | ";" | "\t";
      header: string[];
      /** Au plus `CSV_MAX_ROWS` lignes… */
      rows: string[][];
      /** …sur ce nombre total. */
      total: number;
    }
  | { nature: "diff"; source: string }
  | { nature: "math"; source: string; tex: string };

/**
 * Les blocs d'un message, chacun avec sa nature.
 *
 * @param text - le texte brut, déjà borné par l'appelant
 * @returns les blocs, dans l'ordre du texte ; aucun pour un texte vide
 */
export function detectBlocks(text: string): NatureBlock[] {
  return text.trim() === "" ? [] : [{ nature: "text", source: text }];
}
