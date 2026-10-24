import type { IPduLike } from "./ILogDriver";
import {
  AUTH_API_BASE,
  OAUTH2_API_BASE,
  WEBAUTHN_API_BASE,
} from "../../runtime/authRoutes";

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
 * Connexions des utilisateurs (mot de passe, passkeys, fournisseurs OAuth) :
 * elles passent par l'API de sécurité, sous `/nodefony/`, mais ce sont les
 * connexions à l'APPLICATION — l'exploitant les cherche, elles ne sont jamais
 * rangées dans le trafic de la console.
 */
const AUTH_PREFIXES: readonly string[] = [
  AUTH_API_BASE,
  WEBAUTHN_API_BASE,
  OAUTH2_API_BASE,
];

/** Le chemin vise-t-il une route de connexion (préfixe suivi d'une frontière) ? */
function isAuthPath(path: string): boolean {
  for (const prefix of AUTH_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const next = path.charAt(prefix.length);
    if (next === "" || next === "/" || next === "?" || next === " ")
      return true;
  }
  return false;
}

/**
 * Dit si un chemin est servi à la console d'administration elle-même — la
 * seule règle de chemin du trafic de la console, que la ligne d'accès
 * ({@link pduIsConsoleTraffic}) et la barre de débogage (qui voit le chemin
 * des requêtes du navigateur) appliquent toutes deux. Une connexion à
 * l'application n'en fait jamais partie.
 *
 * Pure et isomorphe.
 *
 * @param path - chemin de la requête, requête (`?…`) comprise ou non
 * @returns `true` pour un chemin de la console
 */
export function isConsolePath(path: string): boolean {
  return CONSOLE_PATH.test(path) && !isAuthPath(path);
}

/**
 * Sévérité RFC 5424 de WARNING : au-dessus (NOTICE, INFO, DEBUG), ce que Vite
 * écrit est du bavardage d'outillage (démarrage, rechargement à chaud) ; ses
 * avertissements et les erreurs qu'il relaie du navigateur restent visibles.
 */
const WARNING = 4;

/** Séquences de couleur ANSI (une ligne d'accès peut être colorée). */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Ligne qui porte l'URL de la requête : ligne d'accès `msgid "req"`
 * (`METHODE STATUT schéma://hôte/chemin …`) ou journal de requête
 * `URL : schéma://hôte/chemin FROM : …` (ouverture et fermeture WebSocket).
 */
function carriesRequestUrl(pdu: Pick<IPduLike, "msgid" | "payload">): boolean {
  return (
    pdu.msgid === "req" ||
    (typeof pdu.payload === "string" && pdu.payload.startsWith("URL : "))
  );
}

/**
 * Dit si une ligne tombe sous l'exclusion d'un module (`excludeModule`) :
 * même nom, sans tenir compte de la casse — sauf la ligne qui porte l'URL de la
 * requête. Celle-ci appartient à l'application même quand le framework l'écrit
 * (le journal d'accès est signé `NODEFONY`) : masquer le framework ne doit
 * jamais masquer les requêtes, sans quoi la vue se vide entièrement.
 *
 * Pure et isomorphe : `filterPdus` (Journaux) et le Direct l'appellent tous les deux.
 *
 * @param pdu - la ligne
 * @param excludedLc - le module exclu, en minuscules ; `null` = aucune exclusion
 * @returns `true` si la ligne doit être écartée
 */
export function pduIsModuleExcluded(
  pdu: Pick<IPduLike, "moduleName" | "msgid" | "payload">,
  excludedLc: string | null,
): boolean {
  return (
    excludedLc !== null &&
    pdu.moduleName.toLowerCase() === excludedLc &&
    !carriesRequestUrl(pdu)
  );
}

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
  if (typeof pdu.payload !== "string" || !carriesRequestUrl(pdu)) return false;
  const text = pdu.payload.replace(ANSI, "");
  const scheme = text.indexOf("://");
  if (scheme === -1) return false;
  const at = text.indexOf("/", scheme + 3);
  if (at === -1) return false;
  return isConsolePath(text.slice(at));
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

/** Une ligne d'accès lue : ce qu'il faut voir d'une requête d'un coup d'œil. */
export interface IAccessLine {
  /** `GET`, `POST`… ou `WS` pour une connexion WebSocket. */
  method: string;
  /** Statut HTTP ; `null` quand la ligne n'en porte pas (`---`). */
  status: number | null;
  /** Chemin et requête (`/api/users?page=2`), sans schéma ni hôte. */
  path: string;
  /** Durée telle qu'écrite (`3.21ms`), `null` si absente. */
  duration: string | null;
}

/** Ligne d'accès : `MÉTHODE STATUT URL DURÉE …`. */
const ACCESS_LINE = /^([A-Z]+)\s+(\d{3}|---)\s+(\S+)(?:\s+(\S+))?/;

/**
 * Lit une ligne d'accès (`msgid "req"`) : verbe, statut, chemin, durée — la
 * seule lecture de ce format, que les Journaux de la console et la barre de
 * débogage partagent.
 *
 * Pure et isomorphe.
 *
 * @param pdu - une ligne du journal (`payload` : le texte de la ligne)
 * @returns la requête lue, ou `null` si ce n'est pas une ligne d'accès lisible
 */
export function parseAccessLine(
  pdu: Pick<IPduLike, "msgid" | "payload">,
): IAccessLine | null {
  if (pdu.msgid !== "req" || typeof pdu.payload !== "string") return null;
  const m = ACCESS_LINE.exec(pdu.payload.replace(ANSI, ""));
  if (m === null) return null;
  const [, method = "", rawStatus = "", url = "", duration] = m;
  let path = url;
  const scheme = url.indexOf("://");
  if (scheme !== -1) {
    const slash = url.indexOf("/", scheme + 3);
    path = slash === -1 ? "/" : url.slice(slash);
  }
  return {
    method,
    status: rawStatus === "---" ? null : Number(rawStatus),
    path,
    duration: duration !== undefined && /\d/.test(duration) ? duration : null,
  };
}
