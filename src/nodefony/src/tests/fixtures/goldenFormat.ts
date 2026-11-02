/**
 * Format UNIQUE des fichiers d'octets de référence (« dorés ») de la socket et
 * du bus (#629, ADR-0022 §10, contrôle 4) — lu par `frameGolden.test.ts` (cœur)
 * et `backplaneEnvelopeGolden.test.ts` (realtime). Deux formats divergeraient
 * en silence.
 *
 * Une ligne par trame : `<forme>\t<t|b>\t<trame>` — `t` = trame texte telle
 * quelle, `b` = trame binaire en hexadécimal. Les lignes `#` sont l'en-tête.
 * Fins de ligne LF garanties par `.gitattributes` (`eol=lf`).
 */

/** Hexadécimal sans `Buffer` : le même test doit pouvoir tourner en navigateur. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Relit un hexadécimal produit par {@link toHex} ; lève sur toute autre forme. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex))
    throw new Error(`hexadécimal invalide : ${hex.slice(0, 32)}…`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Rend le contenu d'un fichier de référence.
 *
 * @param regenerate - la commande qui le régénère, écrite dans l'en-tête
 * @param frames - forme → trame telle qu'émise (texte ou octets)
 * @returns le contenu, à comparer au fichier commité
 */
export function renderGolden(
  regenerate: string,
  frames: Iterable<readonly [string, string | Uint8Array]>,
): string {
  let out =
    "# Octets de référence (#629). Ne pas éditer à la main :\n" +
    `# ${regenerate} — dans le commit qui porte l'entrée de rupture.\n`;
  for (const [kind, wire] of frames)
    out +=
      typeof wire === "string"
        ? `${kind}\tt\t${wire}\n`
        : `${kind}\tb\t${toHex(wire)}\n`;
  return out;
}

/**
 * Relit un fichier de référence commité.
 *
 * @param content - le contenu du fichier
 * @returns forme → trame (texte ou octets), dans l'ordre du fichier
 * @throws Sur une ligne illisible — un fichier abîmé n'est jamais lu à moitié
 */
export function parseGolden(content: string): Map<string, string | Uint8Array> {
  const frames = new Map<string, string | Uint8Array>();
  for (const line of content.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const [kind, type, ...rest] = line.split("\t");
    const wire = rest.join("\t");
    if (kind === undefined || (type !== "t" && type !== "b"))
      throw new Error(`ligne de référence illisible : ${line.slice(0, 60)}`);
    frames.set(kind, type === "t" ? wire : fromHex(wire));
  }
  return frames;
}
