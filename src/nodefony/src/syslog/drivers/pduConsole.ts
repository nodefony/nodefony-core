import type { IPduLike } from "./ILogDriver";
import {
  AUTH_API_BASE,
  OAUTH2_API_BASE,
  WEBAUTHN_API_BASE,
} from "../../runtime/authRoutes";

/**
 * Chemins servis à la console d'administration elle-même — l'OUTILLAGE, ce qui
 * sert à observer l'application et qu'on ne montre donc pas comme elle : relais
 * Vite (`/_vite/`), interface pré-bâtie (`/_assets/studio/`), pages de la
 * console (`/nodefony`, `/nodefony/<page>`, et ses pages profondes
 * `/nodefony/{modules,cluster,orm,users,playground,logs/trace}/<id>`) et data
 * plane (`/nodefony/<module>/api/…`, profileur, journaux et socket de la console
 * compris). Les routes de l'application sous `/nodefony` en sont écartées
 * (`APPLICATION_PREFIXES`). Les pages profondes suivent
 * les replis déclarés par `StudioController` — un test du Studio le vérifie.
 */
const CONSOLE_PATH =
  /^\/(?:_vite\/|_assets\/studio\/|nodefony(?:\/(?:(?:modules|cluster|orm|users|playground|logs\/trace)\/)?[^/\s?]*)?(?:[?\s]|$)|nodefony\/[^/\s?]+\/api(?:[/?\s]|$))/;

/**
 * Ce qui passe sous `/nodefony/` mais appartient à l'APPLICATION, jamais à la
 * console :
 * - les connexions des utilisateurs (mot de passe, passkeys, fournisseurs
 *   OAuth) — elles passent par l'API de sécurité, l'exploitant les cherche ;
 * - le module `test`, l'application de développement de CE dépôt (vitrines,
 *   bancs d'intégration), monté sous `/nodefony/test` (#661) — son flux
 *   `/nodefony/test/api/syslog` est celui d'une page, pas les données de la
 *   console. Absent d'une application générée.
 */
const APPLICATION_PREFIXES: readonly string[] = [
  AUTH_API_BASE,
  WEBAUTHN_API_BASE,
  OAUTH2_API_BASE,
  "/nodefony/test",
];

/** Le chemin appartient-il à l'application (préfixe suivi d'une frontière) ? */
function isApplicationPath(path: string): boolean {
  for (const prefix of APPLICATION_PREFIXES) {
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
  return CONSOLE_PATH.test(path) && !isApplicationPath(path);
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
  /**
   * Statut HTTP, ou code de fermeture WebSocket (`1000`…) sur une ligne `WS` ;
   * `null` quand la ligne n'en porte pas (`---`). Se lit par
   * {@link accessStatusFamily}, qui connaît les deux.
   */
  status: number | null;
  /** Chemin et requête (`/api/users?page=2`), sans schéma ni hôte. */
  path: string;
  /** L'URL telle qu'écrite (`wss://h/socket`), schéma et hôte compris. */
  url: string;
  /** Durée telle qu'écrite (`3.21ms`), `null` si absente. */
  duration: string | null;
  /** Adresse du client, `null` si absente. */
  ip: string | null;
}

/**
 * Ligne d'accès : `MÉTHODE STATUT URL [PROTOCOLE] DURÉE IP …` — le statut d'une
 * ligne `WS` a quatre chiffres, et le sous-protocole négocié se glisse entre
 * l'URL et la durée.
 */
const ACCESS_LINE =
  /^([A-Z]+)\s+(\d{3,4}|---)\s+(\S+)(?:\s+\[[^\]\s]*\])?(?:\s+(\S+))?(?:\s+(\S+))?/;
/** Une adresse IPv4 ou IPv6, assez pour ne pas prendre le `[id]` qui suit. */
const IP = /^[\d.:a-f]+$/i;

/**
 * La famille d'un statut d'accès, de 1 à 5 comme un statut HTTP — y compris
 * pour un code de fermeture WebSocket (RFC 6455 §7.4), qui sinon passerait
 * pour une erreur serveur à quatre chiffres.
 *
 * Fermeture normale (`1000`), départ (`1001`) ou sans code (`1005`) → 2 ;
 * coupure anormale (`1006`) et défaillance du serveur (`1011` à `1014`) → 5 ;
 * tout autre code (protocole, politique, taille, codes applicatifs) → 4.
 * Pure et isomorphe : la seule lecture de ce statut, pour les Journaux de la
 * console comme pour la barre de débogage.
 *
 * @param status - statut HTTP ou code de fermeture, `null` si inconnu
 * @returns 1 à 5, ou `null` quand le statut est inconnu
 */
export function accessStatusFamily(status: number | null): number | null {
  if (status === null) return null;
  if (status < 1000) return Math.floor(status / 100);
  if (status === 1000 || status === 1001 || status === 1005) return 2;
  if (status === 1006 || (status >= 1011 && status <= 1014)) return 5;
  return 4;
}

/** Une ligne relue qu'on peut rapprocher : sa ligne d'accès, son heure, sa requête. */
export type AccessCandidate = Pick<
  IPduLike,
  "msgid" | "payload" | "timeStamp" | "requestId"
>;

/**
 * Retrouve la ligne d'accès d'une requête vue d'ailleurs — le navigateur, qui
 * n'a pas toujours lu son `X-Request-Id` (document, WebSocket, `EventSource`) :
 * même verbe, même chemin, et la plus proche de l'instant donné quand
 * plusieurs connexions ont visé le même chemin.
 *
 * Pure et isomorphe : une seule règle de rapprochement, quel que soit le
 * consommateur.
 *
 * @param rows - lignes relues (une recherche groupée par requête rend la ligne d'accès en tête)
 * @param method - `GET`, `WS`… tel que la ligne d'accès l'écrit
 * @param path - chemin et requête (`/api/x?y=1`), comme {@link IAccessLine.path}
 * @param at - instant attendu de la ligne, en ms epoch
 * @returns la ligne retenue (avec un `requestId`), ou `null`
 */
export function findAccessLine<T extends AccessCandidate>(
  rows: readonly T[],
  method: string,
  path: string,
  at: number,
): T | null {
  let best: T | null = null;
  let gap = Infinity;
  for (const rec of rows) {
    if (!rec.requestId) continue;
    const a = parseAccessLine(rec);
    if (a?.method !== method || a.path !== path) continue;
    const d = Math.abs(rec.timeStamp - at);
    if (d < gap) {
      best = rec;
      gap = d;
    }
  }
  return best;
}

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
  const [, method = "", rawStatus = "", url = "", duration, ip] = m;
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
    url,
    duration: duration !== undefined && /\d/.test(duration) ? duration : null,
    ip: ip !== undefined && IP.test(ip) ? ip : null,
  };
}
