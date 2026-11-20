/**
 * Caractères qui ne se VOIENT pas dans un terminal, nommés pour un humain.
 *
 * Un copier-coller depuis une messagerie, une page web ou un traitement de
 * texte glisse souvent un espace insécable (macOS : Alt + Espace) là où l'on
 * croit avoir tapé un espace. Le refus est juste — `brice-app` suivi de U+00A0
 * n'est pas un nom kebab-case —, mais un message qui affiche `« brice-app »`
 * comme invalide envoie chercher au mauvais endroit : la faute est à l'écran,
 * et l'on ne la voit pas.
 *
 * `Map` : table fixe, lue caractère par caractère sur une valeur courte, et
 * seulement quand une validation a DÉJÀ échoué — rien sur le chemin nominal.
 */
const INVISIBLE_CHARS: ReadonlyMap<string, string> = new Map([
  ["\u00a0", "espace insécable"],
  ["\u202f", "espace fine insécable"],
  ["\u2007", "espace tabulaire"],
  ["\u2009", "espace fine"],
  ["\u200a", "espace ultrafine"],
  ["\u200b", "espace sans chasse"],
  ["\u200c", "antiliant sans chasse"],
  ["\u200d", "liant sans chasse"],
  ["\u2060", "gluon de mots"],
  ["\u00ad", "trait d'union conditionnel"],
  ["\u3000", "espace idéographique"],
  ["\ufeff", "indicateur d'ordre des octets"],
]);

/**
 * Décrit les caractères invisibles d'une valeur saisie, ou `null` s'il n'y en a pas.
 *
 * Rend une phrase à ajouter à un message de refus : le code Unicode, le nom du
 * caractère et sa position (1 = premier caractère), puis le geste — retaper.
 *
 * @param value - la valeur refusée, telle que reçue
 * @returns la phrase, ou `null` si la valeur ne contient aucun caractère invisible
 */
export function describeInvisibleChars(value: string): string | null {
  const found: string[] = [];
  let position = 0;
  for (const char of value) {
    position++;
    const name = INVISIBLE_CHARS.get(char);
    if (name !== undefined) {
      const code = char
        .codePointAt(0)
        ?.toString(16)
        .toUpperCase()
        .padStart(4, "0");
      found.push(`U+${code} (${name}) en position ${position}`);
    }
  }
  if (found.length === 0) return null;
  return (
    `La valeur contient ${found.length > 1 ? "des caractères INVISIBLES" : "un caractère INVISIBLE"} : ` +
    `${found.join(", ")} — souvent laissé par un copier-coller ; retape-la au clavier`
  );
}
