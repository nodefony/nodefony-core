/**
 * Taille maximale, en octets UTF-8, de la raison d'une trame Close (RFC 6455
 * §5.5 : charge d'une trame de contrôle ≤ 125 octets, dont 2 pour le code).
 */
export const MAX_WS_CLOSE_REASON_BYTES = 123;

/** Marqueur de troncature : « … » (U+2026) pèse 3 octets en UTF-8. */
const ELLIPSIS = "…";
const ELLIPSIS_BYTES = 3;

/**
 * Borne la raison d'une fermeture WebSocket à 123 octets UTF-8, coupée sur une
 * frontière de caractère.
 *
 * `ws.close(code, reason)` LÈVE une `RangeError` au-delà de 123 octets, et la
 * connexion n'est alors PAS fermée : jusqu'en `ws` 8.21 elle restait en
 * `CLOSING` sans trame Close ni minuterie — hors de portée de toute garde
 * `readyState === OPEN` et du heartbeat, donc ouverte jusqu'à la mort TCP ;
 * depuis 8.22 elle reste `OPEN`. Or la raison porte souvent un message
 * d'erreur, dont rien ne borne la longueur.
 *
 * @param reason - raison candidate (message d'erreur, libellé…)
 * @returns la raison telle quelle si elle tient, sinon tronquée et terminée
 *          par « … » ; chaîne vide si elle n'est pas une chaîne.
 */
export function toWsCloseReason(reason: string | undefined | null): string {
  if (typeof reason !== "string") return "";
  // Une unité UTF-16 pèse au plus 3 octets : ≤ 41 unités tient toujours.
  if (reason.length <= MAX_WS_CLOSE_REASON_BYTES / 3) return reason;
  if (Buffer.byteLength(reason, "utf8") <= MAX_WS_CLOSE_REASON_BYTES) {
    return reason;
  }
  const budget = MAX_WS_CLOSE_REASON_BYTES - ELLIPSIS_BYTES;
  let bytes = 0;
  let end = 0;
  // Itération par point de code : une paire de substitution n'est jamais coupée.
  for (const char of reason) {
    const cp = char.codePointAt(0) as number;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > budget) break;
    bytes += size;
    end += char.length;
  }
  return reason.slice(0, end) + ELLIPSIS;
}
