/**
 * Validation de l'identifiant de corrélation `X-Request-Id` fourni par le
 * client, avant qu'il ne soit adopté comme `Context.requestId`.
 *
 * Le `requestId` finit (1) réfléchi dans la réponse (`X-Request-Id`),
 * (2) écrit dans les logs (`ID : …`), (3) propagé en ALS à tout le pipeline.
 * Une valeur cliente non assainie ouvre donc : log-injection (CR/LF dans les
 * logs), forging de corrélation, et throw `setHeader` natif (→ 500/DoS) sur
 * caractère de contrôle ou non-ASCII. Cf RFC 9110 §5.5 (field values) + Zero
 * Trust (mémoire `feedback_security_rfc_rigor`).
 */

/**
 * Longueur maximale acceptée pour un `X-Request-Id` client. Borne anti-abus
 * (log flooding / header oversize). 128 couvre largement un UUID (36), un
 * nanoid, ou un `traceparent` (55).
 */
export const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Caractères sûrs : ASCII alphanumérique + `.`, `_`, `-`. Exclut tout caractère
 * de contrôle (CR/LF → response splitting / log injection), espace, et
 * non-ASCII (→ throw `setHeader` Node = DoS). Ancré + quantifieur borné : pas
 * de backtracking catastrophique (ReDoS).
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/u;

/**
 * Valide un `X-Request-Id` entrant. Retourne la valeur si elle est sûre, sinon
 * `null` (l'appelant conserve alors l'UUID généré côté serveur).
 *
 * On REJETTE (plutôt que tronquer/nettoyer) une valeur invalide : nettoyer
 * donnerait au client un faux contrôle sur l'identifiant et masquerait l'abus.
 *
 * @param raw - valeur brute du header `x-request-id` (ou `undefined`/`null`).
 * @returns la valeur si sûre, sinon `null`.
 */
export function sanitizeRequestId(
  raw: string | undefined | null,
): string | null {
  if (!raw || raw.length > MAX_REQUEST_ID_LENGTH) {
    return null;
  }
  return SAFE_REQUEST_ID.test(raw) ? raw : null;
}
