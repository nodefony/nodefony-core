// Règles de CONTEXTE d'une ancre, partagées par anchor-check (qui juge) et
// anchor-fix (qui recale). Écrites deux fois, elles divergeaient : le juge
// découpait une ligne là où le réparateur ne la découpait pas, et recalait une
// ancre juste sur le symbole de sa voisine.

/** Ancre COURTE `` `:N` `` : reprend le fichier de l'ancre qui la précède. */
export const SHORT_ANCHOR_RE = /`:\d+(?:-\d+)?`/g;

/**
 * Le symbole entre parenthèses qui SUIT immédiatement une ancre —
 * `` `f.ts:N` (`Symbole`) ``, la forme des tableaux de référence. Il appartient
 * à cette ancre, jamais à la suivante. Le `` ` `` initial est optionnel : le
 * juge découpe l'ancre avec ses backticks, le réparateur sans.
 */
export const FOLLOWING_SYMBOL_RE = /^`?\s*\(\s*`([^`]+)`\s*\)/;

/** Fin de l'ancre, son symbole `(…)` suiveur compris. */
export function anchorEnd(line, end) {
  const following = FOLLOWING_SYMBOL_RE.exec(line.slice(end));
  return following ? end + following[0].length : end;
}

/** Une rangée de tableau Markdown. */
export const isTableRow = (line) => /^\s*\|/.test(line);

/**
 * La ligne `current` est-elle la SUITE de `previous`, coupée par prettier ?
 *
 * Seul ce cas autorise à chercher le symbole d'une ancre sur la ligne du
 * dessus. Une rangée de tableau, une nouvelle puce, un titre ou une citation
 * ouvrent un énoncé NEUF : leur prêter le symbole d'au-dessus jugeait (puis
 * recalait) une ancre sur ce que citait sa voisine.
 *
 * @param previous - la ligne du dessus
 * @param current - la ligne de l'ancre
 * @returns `true` si les deux forment une seule phrase
 */
export function continuesPreviousLine(previous, current) {
  if (previous === undefined || previous.trim() === "") return false;
  if (isTableRow(current) || isTableRow(previous)) return false;
  // Une citation se coupe comme la prose : `> a` puis `> b` est UNE phrase,
  // sauf si `> b` ouvre lui-même une puce ou un titre.
  const quote = /^\s*>\s?/;
  if (quote.test(current)) {
    const inner = current.replace(quote, "");
    const before = previous.replace(quote, "");
    if (!quote.test(previous) || before.trim() === "") return false;
    return !/^\s*(?:[-*+]\s|\d+[.)]\s|#|```)/.test(inner);
  }
  return !/^\s*(?:[-*+]\s|\d+[.)]\s|#|```)/.test(current);
}
