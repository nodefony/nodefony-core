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
 * Sévérité RFC 5424 de WARNING : au-dessus (NOTICE, INFO, DEBUG), ce que Vite
 * écrit est du bavardage d'outillage (démarrage, rechargement à chaud) ; ses
 * avertissements et les erreurs qu'il relaie du navigateur restent visibles.
 */
const WARNING = 4;

/** Séquences de couleur ANSI (une ligne d'accès peut être colorée). */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Dit si un Pdu est du trafic de la console d'administration — ce que
 * l'exploitant ne cherche pas en lisant les journaux de son application : une
 * ligne qui porte l'URL de la requête (ligne d'accès `msgid "req"`, ou ligne
 * `URL : …` du journal de requête, ouverture et fermeture WebSocket comprises)
 * vers un chemin de la console, ou ce que le serveur Vite écrit sous le niveau
 * WARNING (`msgid "frontend"` : démarrage, rechargement à chaud).
 *
 * Pure et isomorphe. Seules les lignes qui portent l'URL sont classées par
 * chemin : les autres lignes d'une même requête se rattachent par leur
 * `requestId` (`filterPdus` écarte alors la requête entière).
 *
 * @param pdu - tout objet portant `msgid` et `payload`.
 * @returns `true` pour une ligne de la console ou du bavardage de Vite.
 */
export function pduIsConsoleTraffic(
  pdu: Pick<IPduLike, "msgid" | "payload" | "severity">,
): boolean {
  // Vite (msgid `frontend`) : tout son bavardage, quel que soit le texte.
  if (pdu.msgid === "frontend") return pdu.severity > WARNING;
  if (typeof pdu.payload !== "string") return false;
  // Ligne d'accès `METHODE STATUT schéma://hôte/chemin …`, ou journal de
  // requête `URL : schéma://hôte/chemin FROM : …`.
  if (pdu.msgid !== "req" && !pdu.payload.startsWith("URL : ")) return false;
  const text = pdu.payload.replace(ANSI, "");
  const scheme = text.indexOf("://");
  if (scheme === -1) return false;
  const path = text.indexOf("/", scheme + 3);
  return path !== -1 && CONSOLE_PATH.test(text.slice(path));
}

/** Ce qu'il faut d'une ligne pour la rattacher à une requête de la console. */
type IConsoleLine = Pick<
  IPduLike,
  "msgid" | "payload" | "severity" | "requestId"
>;

/**
 * Les requêtes de la console présentes dans un lot de lignes : celles dont UNE
 * ligne vise la console. Les autres lignes d'une requête ne portent que son
 * `requestId` — c'est par lui qu'on les écarte avec elle.
 *
 * @param lines - le lot à examiner (ring, page relue, flux du Direct)
 * @returns les requestId de la console, ou `null` s'il n'y en a aucun (rien d'alloué)
 */
export function consoleRequestIds(
  lines: Iterable<IConsoleLine>,
): Set<string> | null {
  let ids: Set<string> | null = null;
  for (const line of lines) {
    if (line.requestId !== undefined && pduIsConsoleTraffic(line)) {
      (ids ??= new Set()).add(line.requestId);
    }
  }
  return ids;
}

/**
 * Dit si une ligne appartient au trafic de la console : elle-même (cf
 * {@link pduIsConsoleTraffic}), ou une ligne d'une requête de la console.
 *
 * @param line - la ligne
 * @param ids - le résultat de {@link consoleRequestIds} sur le même lot
 */
export function pduIsConsoleRequest(
  line: IConsoleLine,
  ids: ReadonlySet<string> | null,
): boolean {
  return (
    pduIsConsoleTraffic(line) ||
    (line.requestId !== undefined && ids?.has(line.requestId) === true)
  );
}
