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

/**
 * Messages du rechargement à chaud que le serveur Vite écrit au journal
 * (msgid `frontend`). Les erreurs qu'il relaie depuis le navigateur n'en font
 * pas partie : ce sont de vraies erreurs.
 */
const HMR_MESSAGE =
  /\[vite\] (?:\(client\) )?(?:hmr update|hmr invalidate|page reload)\b/;

/** Séquences de couleur ANSI (une ligne d'accès peut être colorée). */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Dit si un Pdu est du trafic de la console d'administration — ce que
 * l'exploitant ne cherche pas en lisant les journaux de son application : une
 * ligne d'accès (`msgid "req"`) vers un chemin de la console, ou un message de
 * rechargement à chaud de Vite (`msgid "frontend"`).
 *
 * Pure et isomorphe. Seules les lignes d'accès sont classées par chemin : les
 * autres lignes d'une même requête ne portent pas son URL.
 *
 * @param pdu - tout objet portant `msgid` et `payload`.
 * @returns `true` pour une ligne de la console ou du rechargement à chaud.
 */
export function pduIsConsoleTraffic(
  pdu: Pick<IPduLike, "msgid" | "payload">,
): boolean {
  if (typeof pdu.payload !== "string") return false;
  if (pdu.msgid === "frontend") return HMR_MESSAGE.test(pdu.payload);
  if (pdu.msgid !== "req") return false;
  // Ligne d'accès : `METHODE STATUT schéma://hôte/chemin …`.
  const text = pdu.payload.replace(ANSI, "");
  const scheme = text.indexOf("://");
  if (scheme === -1) return false;
  const path = text.indexOf("/", scheme + 3);
  return path !== -1 && CONSOLE_PATH.test(text.slice(path));
}
