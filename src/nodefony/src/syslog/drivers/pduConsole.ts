import type { IPduLike } from "./ILogDriver";

/**
 * Chemins servis à la console d'administration elle-même : relais Vite
 * (`/_vite/`), interface pré-bâtie (`/_assets/studio/`), pages de la console
 * (`/nodefony`, `/nodefony/<page>`, `/nodefony/modules/<nom>`) et data plane
 * (`/nodefony/<module>/api/…`). Une route d'application à deux segments sous
 * `/nodefony` (`/nodefony/test/index`) n'en fait pas partie.
 */
const CONSOLE_PATH =
  /^\/(?:_vite\/|_assets\/studio\/|nodefony(?:\/(?:modules\/)?[^/\s?]*)?(?:[?\s]|$)|nodefony\/[^/\s?]+\/api(?:[/?\s]|$))/;

/** Séquences de couleur ANSI (une ligne d'accès peut être colorée). */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Dit si un Pdu est une ligne d'accès (`msgid "req"`) d'une requête servie à la
 * console d'administration — ce que l'exploitant ne cherche pas en lisant les
 * journaux de son application.
 *
 * Pure et isomorphe. Seules les lignes d'accès sont classées : les autres
 * lignes d'une même requête ne portent pas son URL.
 *
 * @param pdu - tout objet portant `msgid` et `payload`.
 * @returns `true` pour une ligne d'accès vers un chemin de la console.
 */
export function pduIsConsoleTraffic(
  pdu: Pick<IPduLike, "msgid" | "payload">,
): boolean {
  if (pdu.msgid !== "req" || typeof pdu.payload !== "string") return false;
  // Ligne d'accès : `METHODE STATUT schéma://hôte/chemin …`.
  const text = pdu.payload.replace(ANSI, "");
  const scheme = text.indexOf("://");
  if (scheme === -1) return false;
  const path = text.indexOf("/", scheme + 3);
  return path !== -1 && CONSOLE_PATH.test(text.slice(path));
}
