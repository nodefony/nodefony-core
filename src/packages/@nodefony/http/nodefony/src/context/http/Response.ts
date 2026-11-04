import http, {
  OutgoingHttpHeaders,
  OutgoingHttpHeader,
  validateHeaderName,
  validateHeaderValue,
} from "node:http";
import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import {
  typeOf,
  thenMaybe,
  Pci,
  Pdu,
  Message,
  Severity,
  Msgid,
} from "nodefony";
import type { MaybePromise } from "nodefony";
import mime from "mime-types";
import Cookie from "../../cookies/cookie";
import type { IFirewallGate } from "../../../interfaces/ISecurity";

// P8 — RegExp ANSI compilée UNE fois (avant : factory recompilant à chaque
// setStatusCode). Le flag `g` partagé est sûr : `String.replace` réinitialise
// `lastIndex` (contrairement à `exec`/`test`).
const ANSI_REGEX = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join("|"),
  "g",
);

const stripAnsi = function (val: string): string {
  return typeof val === "string" ? val.replace(ANSI_REGEX, "") : val;
};

// Codes de redirection RFC 9110 §15.4 qui posent un `Location` pour rediriger
// l'agent utilisateur. 301 (Moved Permanently) / 302 (Found) PEUVENT muter
// POST→GET (raisons historiques) ; 303 (See Other) force un GET ; 307 (Temporary
// Redirect) / 308 (Permanent Redirect) PRÉSERVENT méthode + corps. Tout autre
// code passé à `redirect()` retombe sur 302 (cf `redirect()`). Set module-level
// (0 alloc par appel).
const REDIRECT_STATUS_CODES = new Set<number>([301, 302, 303, 307, 308]);

// Set module-level pour `setLength()` (0 alloc par requête) : statuts qui ne
// portent JAMAIS de Content-Length (RFC 9110 §8.6).
const NO_CONTENT_LENGTH_STATUS = new Set([204, 304]);

/** Résolution MIME d'un type demandé à `setContentType`, mémorisée par {@link resolveContentType}. */
interface IResolvedContentType {
  /** Valeur de `mime.contentType(type)` (charset par défaut compris). */
  readonly full: string;
  /** `full` sans paramètre (tout ce qui précède le premier `;`). */
  readonly bare: string;
  /** Valeur de `mime.charset(full)`. */
  readonly charset: string | false;
}

// `mime.contentType` + `split(";")` coûtaient ~0,5 µs par réponse (#508)
// pour une poignée de types toujours les mêmes. Les deux fonctions de
// `mime-types` sont pures de leur entrée : une résolution POSITIVE ne change
// jamais (`mime-db` n'est pas réécrit). Un refus n'est PAS mémorisé — une
// application peut enrichir `mime.types` à chaud, et un type inconnu ne doit
// pas le rester. Borné : au-delà, on résout sans mémoriser (un nom de fichier
// venu du client ne fait pas grossir la table).
const CONTENT_TYPE_CACHE_MAX = 64;
const contentTypeCache = new Map<string, IResolvedContentType>();

/**
 * Résout `type` (extension ou type MIME) comme `mime.contentType`, avec
 * mémorisation bornée des résolutions positives.
 *
 * @param type - extension (`json`) ou type MIME (`text/html`).
 * @returns la résolution, ou `null` si `mime-types` ne connaît pas le type.
 */
function resolveContentType(type: string): IResolvedContentType | null {
  const hit = contentTypeCache.get(type);
  if (hit !== undefined) {
    return hit;
  }
  const full = mime.contentType(type);
  if (!full) {
    return null;
  }
  const semi = full.indexOf(";");
  const resolved: IResolvedContentType = {
    full,
    bare: semi === -1 ? full : full.slice(0, semi),
    charset: mime.charset(full),
  };
  if (contentTypeCache.size < CONTENT_TYPE_CACHE_MAX) {
    contentTypeCache.set(type, resolved);
  }
  return resolved;
}

/**
 * En-têtes d'une réponse en tableau plat `[nom, valeur, nom, valeur…]`, noms
 * en minuscules : la forme que `ServerResponse.writeHead` compose le plus vite.
 */
type HeaderList = OutgoingHttpHeader[];

/** Valeur d'en-tête sous la forme que Node accepte (une liste figée est copiée). */
function toHeaderValue(
  value: number | string | readonly string[],
): OutgoingHttpHeader {
  return typeof value === "string" || typeof value === "number"
    ? value
    : [...value];
}

/**
 * Contrôle d'un en-tête comme le fait `setHeader` natif — nom, puis chaque
 * valeur (un nombre est toujours valide).
 *
 * @throws TypeError `ERR_INVALID_HTTP_TOKEN` / `ERR_INVALID_CHAR`.
 */
function assertHeader(
  name: string,
  value: number | string | readonly string[],
): void {
  validateHeaderName(name);
  if (typeof value === "string") {
    validateHeaderValue(name, value);
  } else if (typeof value !== "number") {
    for (const item of value) validateHeaderValue(name, item);
  }
}

class HttpResponse {
  context: HttpContext;
  response: http.ServerResponse | http2.Http2ServerResponse | null;
  statusCode: number = 200;
  statusMessage: string = "";
  flushing: boolean = false;
  encoding: BufferEncoding = "utf-8";
  // Corps en DEUX formes exclusives : une chaîne reste une chaîne jusqu'à
  // `res.end`. Node colle alors en-têtes et corps en UNE écriture ; un Buffer
  // l'oblige à un `writev` en deux morceaux, après une copie d'encodage —
  // ~5 µs par réponse JSON mesurés au profil, pour un octet identique sur le fil.
  #text: string | null = null;
  #textEncoding: BufferEncoding = "utf-8";
  #buffer: Buffer | null = null;
  contentType: string = "application/octet-stream";
  headers: http.OutgoingHttpHeaders = {};
  timeout?: number | undefined; // miiliseconde
  cookies: Record<string, Cookie> = {};
  /**
   * En-têtes posés, remis TELS QUELS en un seul `writeHead(statut, liste)` :
   * un `setHeader` natif par en-tête coûtait validation, rangement dans la
   * table de Node puis relecture au `writeHead` — 41 % de plus pour le même
   * bloc (`micro-write-head.mjs`). Et un seul `setHeader` natif avant le
   * `writeHead` suffit à faire retomber Node sur son chemin lent.
   * `null` tant que rien n'est posé ; amorcée avec les en-têtes du transport.
   */
  #headers: HeaderList | null = null;
  /**
   * Pare-feu qui posera les en-têtes de sécurité applicatifs juste avant
   * l'émission des en-têtes, une fois le type de la réponse fixé : la politique
   * suit ce type (ADR-0024 §C11). Armé par le noyau HTTP au routage, consommé
   * une fois ; `null` sans module de sécurité.
   */
  headerPolicy: IFirewallGate | null = null;
  /**
   * Vrai une fois la réserve recopiée sur la réponse Node ({@link commitHeaders}) :
   * le transport y est déjà, il ne s'amorce plus.
   */
  #committed = false;
  constructor(
    response: http.ServerResponse | http2.Http2ServerResponse,
    context: HttpContext,
  ) {
    this.context = context;
    this.response = response;
    // Délai du SERVEUR qui a reçu la requête (section de config `http` / `https`).
    const responseTimeout = this.context.httpKernel?.responseTimeout;
    this.timeout =
      this.context.serverType === "https"
        ? responseTimeout?.https
        : responseTimeout?.http;
    // Pas de `setHeader("Content-Type", "application/octet-stream")` ici : le
    // chemin nominal (JSON/HTML) le remplacerait aussitôt (1 set + 2 remove
    // gaspillés par requête). Le défaut vit dans `this.contentType` et n'est
    // émis QUE si personne n'a rien posé au moment du writeHead
    // (cf `ensureContentTypeHeader()`), même résultat sur le fil.
  }

  /**
   * Filet posé juste avant l'émission des en-têtes : si aucun `Content-Type`
   * n'a été choisi (ni négociation, ni `render`, ni controller), émet le défaut
   * `this.contentType` (application/octet-stream) — comportement identique à
   * l'ancienne pose au constructeur, sans le ping-pong set/remove/re-set.
   *
   * Une réponse SANS corps n'annonce aucun type : `Content-Type` décrit le
   * contenu (RFC 9110 §8.3), et il n'y en a pas.
   */
  protected ensureContentTypeHeader(): void {
    if (
      this.response &&
      !this.hasHeader("content-type") &&
      !this.#isBodyless()
    ) {
      this.setHeader("content-type", this.contentType);
    }
  }

  /**
   * Vrai quand la réponse n'a pas de corps : 204 et 304 n'en ont jamais
   * (RFC 9110 §15.3.5, §15.4.5) ; ailleurs, un corps posé et VIDE. Un corps
   * jamais posé ne dit rien — un flux peut suivre l'en-tête — et `HEAD` rend
   * les en-têtes du `GET` (§9.3.2) : tous deux gardent le défaut.
   */
  #isBodyless(): boolean {
    if (NO_CONTENT_LENGTH_STATUS.has(this.statusCode)) return true;
    if (this.context.method === "HEAD") return false;
    if (this.#text !== null) return this.#text === "" && !this.flushing;
    return this.#buffer?.length === 0 && !this.flushing;
  }

  /**
   * Corps de la réponse en octets. Un corps posé en texte n'est encodé qu'à la
   * première lecture de cette propriété — l'envoi, lui, écrit le texte tel quel.
   */
  get body(): Buffer | null {
    if (this.#text !== null) {
      this.#buffer = Buffer.from(this.#text, this.#textEncoding);
      this.#text = null;
    }
    return this.#buffer;
  }

  set body(value: Buffer | null) {
    this.#text = null;
    this.#buffer = value;
  }

  /**
   * Corps tel qu'il part sur le fil : le texte s'il n'a jamais été encodé, sinon
   * les octets — vide légal si rien n'a été posé (`write(null)` jetterait
   * ERR_STREAM_NULL_VALUES).
   */
  protected get payload(): string | Buffer {
    return this.#text ?? this.#buffer ?? "";
  }

  /** Encodage à passer avec {@link payload} (ignoré par Node pour des octets). */
  protected get payloadEncoding(): BufferEncoding {
    return this.#text !== null ? this.#textEncoding : this.encoding;
  }

  clean() {
    this.response = null;
    this.body = null;
    this.cookies = {};
    this.#headers = null;
    // this.streamFile = null;
    // delete this.streamFile;
  }

  isHeaderSent(): boolean {
    if (this.response) {
      return this.response.headersSent;
    }
    return false;
  }

  isHtml(): boolean {
    let ct = this.getHeader("Content-Type") as string;
    return mime.extension(ct) === "html";
  }

  setTimeout(ms: number) {
    this.timeout = ms;
  }

  addCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      return (this.cookies[cookie.name] = cookie);
    }
    throw new Error("Response addCookies not valid cookies");
  }

  deleteCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      if (Object.hasOwn(this.cookies, cookie.name)) {
        delete this.cookies[cookie.name];
        return true;
      }
      return false;
    }
    throw new Error("Response delCookie not valid cookies");
  }

  deleteCookieByName(name: string) {
    if (Object.hasOwn(this.cookies, name)) {
      delete this.cookies[name];
      return true;
    }
    return false;
  }

  setCookies() {
    const cookies = Object.values(this.cookies);
    const first = cookies.at(0);
    if (first === undefined) return;
    // 1 cookie (cas dominant) → chemin direct, comportement inchangé.
    if (cookies.length === 1) {
      this.setCookie(first);
      return;
    }
    // ≥2 cookies (ex. session BFF + `csrf-token`) → UN SEUL setHeader avec un
    // TABLEAU : Node émet N lignes `Set-Cookie`. Une boucle de `setHeader` les
    // écraserait (`setHeader('Set-Cookie', str)` REMPLACE → seul le dernier survit).
    const serialized: string[] = [];
    for (const cookie of cookies) {
      const s = cookie.serialize();
      this.logCookie(cookie, s);
      serialized.push(s);
    }
    this.setHeader("Set-Cookie", serialized);
  }

  setCookie(cookie: Cookie) {
    const serialize = cookie.serialize();
    this.logCookie(cookie, serialize);
    this.setHeader("Set-Cookie", serialize);
  }

  /**
   * Journalise en DEBUG un cookie posé, sa VALEUR MASQUÉE : nom et attributs
   * seulement. Le journal de développement se lit par le plan d'administration
   * — un identifiant de session y entrerait chez quiconque le consulte.
   * La ligne n'est construite que si DEBUG passe le gate du syslog pour ce
   * `msgid` (debug ciblé compris) : rien n'est alloué en production.
   *
   * @param cookie - le cookie posé.
   * @param serialized - sa forme `Set-Cookie`, déjà calculée pour l'en-tête.
   */
  private logCookie(cookie: Cookie, serialized: string): void {
    const msgid = `${this.context.serverType} RESPONSE `;
    const syslog = this.context.syslog;
    if (syslog && !syslog.severityEnabled("DEBUG", msgid)) {
      return;
    }
    // La valeur est encodée (`encodeURIComponent`) : aucun `;` ne peut y
    // figurer, le premier `; ` après `nom=` ouvre donc les attributs.
    const attrs = serialized.indexOf("; ", cookie.name.length + 1);
    this.log(
      `ADD COOKIE ==> ${cookie.name}=<masqué>${attrs === -1 ? "" : serialized.slice(attrs)}`,
      "DEBUG",
      msgid,
    );
  }

  /**
   * Pose un en-tête de la réponse ; en flux chunké déjà ouvert, le range en
   * trailer. Le nom et la valeur sont VALIDÉS ici, comme le ferait Node : une
   * valeur invalide (saut de ligne…) lève tout de suite et n'entre jamais dans
   * la réserve — sinon elle lèverait au `writeHead`, et la page d'erreur
   * rejouerait le même en-tête.
   *
   * @param name - nom de l'en-tête (casse indifférente).
   * @param value - valeur ; une liste émet une ligne par élément (`Set-Cookie`).
   * @throws TypeError `ERR_INVALID_HTTP_TOKEN` / `ERR_INVALID_CHAR` sur un nom
   *   ou une valeur qu'un en-tête HTTP ne peut pas porter.
   */
  setHeader(name: string, value: number | string | readonly string[]) {
    if (this.response) {
      if (this.flushing) {
        const obj: OutgoingHttpHeaders = {};
        obj[name] = toHeaderValue(value);
        this.addTrailers(obj);
        return;
      }
      if (!this.response.headersSent) {
        assertHeader(name, value);
        // P8 : toLowerCase (header ASCII) — pas de détour locale ICU.
        const lower = name.toLowerCase();
        // `Vary` est une LISTE de noms d'en-têtes (RFC 9110 §12.5.5), pas une
        // valeur unique : l'écraser est presque toujours un bug. Le firewall pose
        // `Vary: Origin` quand la réponse reflète l'origine ; un controller qui
        // écrivait ensuite `Vary: Accept-Encoding` l'effaçait — un cache partagé
        // cessait alors de varier sur l'origine et pouvait servir à B une réponse
        // portant `Access-Control-Allow-Origin: A`. On FUSIONNE donc, quel que
        // soit l'ordre d'écriture : le trou se ferme par construction, pas par
        // discipline d'appel.
        this.#put(
          lower,
          lower === "vary" ? this.#mergeVary(value) : toHeaderValue(value),
        );
      }
    }
  }

  /**
   * Pose un en-tête dont la valeur a DÉJÀ été validée par l'appelant — une
   * table figée et contrôlée au démarrage (en-têtes de sécurité). Node la
   * validera une fois, au `writeHead` ; la revalider ici effaçait le gain de
   * l'écriture groupée (`micro-write-head.mjs`, ligne « plat validé »).
   *
   * ⚠️ Jamais pour une valeur venue d'une requête : elle passe par {@link setHeader}.
   *
   * @param name - nom de l'en-tête (casse indifférente).
   * @param value - valeur contrôlée au démarrage.
   */
  setValidatedHeader(name: string, value: string): void {
    if (this.response === null || this.response.headersSent) return;
    if (this.flushing) {
      this.setHeader(name, value);
      return;
    }
    this.#put(name.toLowerCase(), value);
  }

  /**
   * Pose un en-tête validé au démarrage SAUF si la réponse en porte déjà un :
   * la valeur du framework est un défaut, celle que l'application a écrite
   * gagne. Même coût que {@link setValidatedHeader} — le rangement cherche
   * l'en-tête de toute façon.
   *
   * @param name - nom de l'en-tête (casse indifférente).
   * @param value - valeur contrôlée au démarrage.
   */
  setDefaultHeader(name: string, value: string): void {
    if (this.response === null || this.response.headersSent) return;
    const lower = name.toLowerCase();
    if (this.flushing) {
      if (!this.hasHeader(lower)) this.setHeader(name, value);
      return;
    }
    if (this.#indexOf(lower) === -1) this.#store().push(lower, value);
  }

  /**
   * Pose les en-têtes de la politique armée ({@link headerPolicy}) pour une
   * réponse de type `contentType` — une fois, juste avant l'émission.
   *
   * Un `304` n'en reçoit aucun : ses en-têtes REMPLACENT ceux de la
   * représentation en cache (RFC 9111 §4.3.4). Une politique courte y
   * réduirait la page gardée, un nonce neuf la désaccorderait de ses balises.
   *
   * @param contentType - type de la réponse ; `null` = sans contenu ; `undefined`
   *   = inconnu (politique complète).
   */
  protected applyHeaderPolicy(contentType: string | null | undefined): void {
    const policy = this.headerPolicy;
    if (policy === null) return;
    this.headerPolicy = null;
    if (this.statusCode === 304) return;
    policy.applySecurityHeaders(this.context, contentType);
  }

  /**
   * Type qui choisit la politique : `null` pour une réponse sans contenu (204,
   * corps vide) — même si un `Content-Type` y a été posé, rien n'y sera rendu ;
   * sinon le `Content-Type` posé.
   */
  protected contentTypeForPolicy(): string | null {
    if (this.#isBodyless()) return null;
    const value = this.getHeader("content-type");
    return typeof value === "string" ? value : null;
  }

  /**
   * La réserve, amorcée au premier usage avec les en-têtes du transport
   * (`Server`, `X-Content-Type-Options`, `X-Frame-Options`, HSTS) que le
   * noyau a figés au démarrage — posés EN TÊTE, comme à l'entrée de la requête.
   */
  #store(): HeaderList {
    if (this.#headers === null) {
      const transport = this.#committed
        ? null
        : this.context.httpKernel?.transportHeaders(this.context.serverType);
      this.#headers = transport ? [...transport] : [];
    }
    return this.#headers;
  }

  /** Position du nom (minuscules) dans la réserve, ou -1. */
  #indexOf(lower: string): number {
    const list = this.#headers;
    if (list === null) return -1;
    for (let i = 0; i < list.length; i += 2) {
      if (list[i] === lower) return i;
    }
    return -1;
  }

  /** Range un en-tête, en remplaçant sa valeur s'il est déjà posé. */
  #put(lower: string, value: OutgoingHttpHeader): void {
    const list = this.#store();
    const at = this.#indexOf(lower);
    if (at === -1) {
      list.push(lower, value);
    } else {
      list[at + 1] = value;
    }
  }

  /**
   * Recopie la réserve sur la réponse Node, pour un émetteur qui écrit sans
   * passer par {@link writeHead} — fichier statique, relais vers un amont. La
   * réserve se vide ; ce qui se pose ensuite y retourne, et Node fusionne les
   * deux au `writeHead`.
   */
  commitHeaders(): void {
    const res = this.response;
    if (res === null || res.headersSent) return;
    if (this.headerPolicy !== null) {
      // Le tiers posera le type APRÈS cette recopie : celui d'un fichier se lit
      // à son extension, comme le serveur statique le fera. Sans extension
      // connue (index d'un dossier), type inconnu → politique complète.
      const type = mime.lookup(this.context.request.pathname);
      this.applyHeaderPolicy(type === false ? undefined : type);
    }
    const list = this.#store();
    for (let i = 0; i + 1 < list.length; i += 2) {
      const name = list[i];
      const value = list[i + 1];
      if (typeof name === "string" && value !== undefined) {
        res.setHeader(name, value);
      }
    }
    this.#headers = null;
    this.#committed = true;
  }

  /**
   * Recopie la réserve sur la réponse Node au PREMIER `setHeader` qu'un tiers
   * y fera — fichier statique servi, redirection de dossier — et seulement
   * alors : un raté du repli statique (la 404 d'une route inconnue) ne recopie
   * rien, sa réponse part ensuite en un seul `writeHead`. À désarmer par
   * {@link disarmNativeWrite} quand le tiers rend la main sans avoir écrit.
   *
   * L'interception est une propriété PROPRE de la réponse, ajoutée puis
   * retirée : V8 annule alors la dernière transition de forme de l'objet.
   */
  commitBeforeNativeWrite(): void {
    const res = this.response;
    if (res === null || res.headersSent || Object.hasOwn(res, "setHeader")) {
      return;
    }
    const native = res.setHeader;
    Object.defineProperty(res, "setHeader", {
      configurable: true,
      writable: true,
      value: (
        name: string,
        value: number | string | readonly string[],
      ): unknown => {
        this.disarmNativeWrite();
        this.commitHeaders();
        return Reflect.apply(native, res, [name, value]);
      },
    });
  }

  /** Retire l'interception posée par {@link commitBeforeNativeWrite}. */
  disarmNativeWrite(): void {
    const res = this.response;
    if (res !== null && Object.hasOwn(res, "setHeader")) {
      Reflect.deleteProperty(res, "setHeader");
    }
  }

  /**
   * Retire un en-tête, de la réserve comme de la réponse Node.
   *
   * @param name - nom de l'en-tête (casse indifférente).
   */
  removeHeader(name: string): void {
    const at = this.#indexOf(name.toLowerCase());
    if (at !== -1) this.#headers?.splice(at, 2);
    if (this.response && !this.response.headersSent) {
      this.response.removeHeader(name);
    }
  }

  /**
   * Union des tokens `Vary` déjà posés et de ceux qu'on ajoute, sans doublon.
   *
   * `*` absorbe tout (RFC 9110 : « la réponse varie sur des paramètres non
   * exprimables ») — le conserver seul évite une liste qui contredirait ce total.
   * Comparaison insensible à la casse : les noms d'en-têtes le sont.
   *
   * Coût : ne s'exécute QUE sur `Vary`, jamais sur les autres en-têtes.
   */
  #mergeVary(value: number | string | readonly string[]): string {
    const incoming = (Array.isArray(value) ? value.join(",") : String(value))
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const current = this.getHeader("vary");
    const existing = (
      Array.isArray(current) ? current.join(",") : String(current ?? "")
    )
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const all = [...existing, ...incoming];
    if (all.some((t) => t === "*")) return "*";
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const token of all) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(token);
    }
    return merged.join(", ");
  }

  setHeaders(obj: OutgoingHttpHeaders) {
    if (!this.response?.headersSent) {
      if (obj instanceof Object) {
        for (const head in obj) {
          const value = obj[head];
          // OutgoingHttpHeaders peut contenir des valeurs `undefined` (type Node) :
          // ne pas écrire de header undefined (setHeader natif throw / pollue).
          if (value !== undefined) {
            this.setHeader(head, value);
          }
        }
      }
      return (this.headers = this.getHeaders());
    }
    this.log("headers already sended ", "WARNING");
    return (this.headers = this.getHeaders());
  }

  setContentType(type?: string, encoding?: BufferEncoding) {
    // Pas de `removeHeader` préalable : `setHeader` natif écrase (node indexe
    // les en-têtes sortants en minuscules, la casse ne crée pas de doublon).
    if (type && encoding) {
      const resolved = resolveContentType(type);
      // Get the MIME type without charset
      if (resolved) {
        const mytype = resolved.bare;
        this.contentType = mytype;
        this.encoding = encoding;
        // RFC 8259 §11 : `application/json` (et tout type structuré `+json`) ne
        // définit AUCUN paramètre `charset` (le JSON est UTF-8 par spec). Émettre
        // `; charset=` serait un paramètre non conforme (ignoré). → type nu.
        if (mytype === "application/json" || mytype.endsWith("+json")) {
          this.setHeader("Content-Type", mytype);
          return;
        }
        this.setHeader("Content-Type", `${mytype}; charset=${encoding}`);
        return;
      }
    }
    if (type && !encoding) {
      const resolved = resolveContentType(type);
      if (resolved) {
        const mytype = resolved.full;
        this.contentType = mytype;
        const charset = resolved.charset;
        if (charset) {
          this.encoding = charset as BufferEncoding;
        }
        this.setHeader("Content-Type", mytype);
        return;
      }
    }
    this.setHeader(
      "Content-Type",
      `${this.contentType}; charset=${this.encoding}`,
    );
  }

  setFileMimeType(type: string, encoding?: BufferEncoding) {
    let myType = this.getMimeType(type);
    if (!myType) {
      this.log(`Content-Type not valid !!! : ${type}`, "WARNING");
      myType = "application/octet-stream";
    }
    this.contentType = myType;
    this.setContentType(myType, encoding || this.encoding);
  }

  setContentTypeByExtension(extention: string) {
    const ismime = mime.contentType(extention);
    if (ismime) {
      this.contentType = ismime;
      let charset = mime.charset(this.contentType);
      if (charset) {
        this.encoding = charset as BufferEncoding;
      }
      this.setHeader("Content-Type", ismime);
      return;
    }
    this.log(`setContentTypeByExtension: ${extention}  not found`, "WARNING");
  }

  getMimeType(filenameOrExt: string): string | false {
    return mime.lookup(filenameOrExt);
  }

  setEncoding(encoding: BufferEncoding) {
    return (this.encoding = encoding);
  }

  setStatusCode(
    status: number | string,
    message?: string,
  ): { code: number; message: string } {
    if (status && typeof status !== "number") {
      status = parseInt(status, 10);
      if (isNaN(status)) {
        status = 500;
      }
    }

    this.statusCode = (status as number) || this.statusCode;
    if (message) {
      // HTTP status messages must be printable US-ASCII only (RFC 9112 §4)
      const ascii = stripAnsi(message)
        .replace(/[^\x20-\x7E]/g, "")
        .trim();
      this.statusMessage =
        ascii || (http.STATUS_CODES[this.statusCode] ?? "Unknown Error");
    } else if (!this.statusMessage) {
      if (http.STATUS_CODES[this.statusCode]) {
        this.statusMessage = http.STATUS_CODES[this.statusCode] as string;
      } else {
        this.statusMessage = http.STATUS_CODES[500] as string;
      }
    }
    return {
      code: this.statusCode,
      message: this.statusMessage,
    };
  }

  getStatus(): { code: number; message: string } {
    return {
      code: this.getStatusCode(),
      message: this.getStatusMessage(),
    };
  }

  getStatusCode(): number {
    return this.statusCode;
  }

  getStatusMessage(code?: number | string): string {
    if (code) {
      if (this.response) {
        return (
          (http.STATUS_CODES[code] as string) ||
          this.statusMessage ||
          this.response.statusMessage
        );
      }
    }
    if (this.response) {
      return (
        this.statusMessage ||
        this.response.statusMessage ||
        (http.STATUS_CODES[this.statusCode] as string)
      );
    }
    return this.statusMessage || (http.STATUS_CODES[this.statusCode] as string);
  }

  /**
   * Pose le corps de la réponse : texte gardé tel quel, octets copiés sur leur
   * seule fenêtre, tout autre valeur sérialisée en JSON.
   *
   * @param ele - corps à envoyer.
   * @param encoding - encodage d'un corps texte (défaut : `this.encoding`).
   */
  setBody(ele: unknown, encoding?: BufferEncoding): void {
    if (typeof ele === "string") {
      this.#setText(ele, encoding || this.encoding);
    } else if (ele instanceof ArrayBuffer || ele instanceof SharedArrayBuffer) {
      this.body = Buffer.from(ele);
    } else if (ArrayBuffer.isView(ele) && ele.buffer instanceof ArrayBuffer) {
      // Respecter byteOffset/byteLength : un Buffer issu du pool Node partage un
      // ArrayBuffer bien plus grand → Buffer.from(ele.buffer) copierait TOUT le
      // pool (octets adjacents d'autres buffers = fuite mémoire dans la réponse).
      // On ne prend que la fenêtre de la vue.
      this.body = Buffer.from(ele.buffer, ele.byteOffset, ele.byteLength);
    } else {
      let text: string;
      try {
        text = JSON.stringify(ele);
      } catch {
        text = String(ele);
      }
      this.#setText(text, "utf-8");
    }
  }

  #setText(text: string, encoding: BufferEncoding): void {
    this.#buffer = null;
    this.#text = text;
    this.#textEncoding = encoding;
  }

  setLength(
    body?: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
  ): number {
    if (this.response?.headersSent) {
      throw new Error("Headers already sended");
    }
    // Le Content-Length DÉLIMITE le message (RFC 9112 §6.3) : faux, il
    // désynchronise la connexion. Trois règles, sans exception de méthode :
    // - chunked : AUCUN Content-Length (RFC 9112 §6.2), même posé avant ;
    // - 204/304 : aucun en-tête touché (RFC 9110 §8.6) ;
    // - sinon la longueur RÉELLE, HEAD compris : le corps y est rendu comme pour
    //   GET et Node l'écarte, et §8.6 interdit tout autre nombre que celui du
    //   GET. OPTIONS et TRACE portent un corps (§9.3.7, §9.3.8) : leur annoncer
    //   0 laissait le corps écrit déborder sur la réponse suivante.
    if (this.getHeader("Transfer-Encoding") === "chunked") {
      this.removeHeader("Content-Length");
      return 0;
    }
    if (NO_CONTENT_LENGTH_STATUS.has(this.statusCode)) {
      return 0;
    }
    const actualBody = body || this.#text || this.#buffer;
    if (actualBody) {
      const length =
        typeof actualBody === "string" && actualBody === this.#text
          ? Buffer.byteLength(actualBody, this.#textEncoding)
          : Buffer.byteLength(actualBody);
      // Nombre calculé ici : rien à valider.
      this.#put("content-length", String(length));
      return length;
    }
    // Corps absent (streaming différé) : un Content-Length posé par le
    // producteur du stream est conservé tel quel.
    return 0;
  }

  writeHead(
    statusCode?: number,
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
  ): void {
    if (statusCode) {
      this.setStatusCode(statusCode);
    }
    if (this.response && !this.response.headersSent) {
      if (this.statusCode) {
        if (typeof this.statusCode === "string") {
          this.statusCode = parseInt(this.statusCode, 10);
        }
        if (this.statusCode > 599) {
          this.statusCode = 500;
        }
      }
      this.statusMessage = this.getStatusMessage();
      if (headers) {
        this.#apply(headers);
      }
      // Validés par Node au `writeHead`, comme lorsqu'ils étaient posés ici
      // par `setHeader` natif.
      if (this.context.requestId) {
        this.#put("x-request-id", this.context.requestId);
      }
      // P2.7 — echo W3C traceparent so downstream services and clients can
      // continue the trace. Header name is lower-case per the spec.
      if (this.context.traceparent) {
        this.#put("traceparent", this.context.traceparent);
      }
      this.setLength();
      this.ensureContentTypeHeader();
      this.applyHeaderPolicy(this.contentTypeForPolicy());
      // UNE remise : la réserve entière, en tableau plat.
      const list = this.#store();
      const std = http.STATUS_CODES[this.statusCode];
      if (this.statusMessage === std) {
        // Message standard (cas nominal) : ne PAS le passer à node — un
        // statusMessage custom force le slow path de composition de la ligne
        // de statut, et le message standard n'a rien à assainir.
        (this.response as http.ServerResponse).writeHead(this.statusCode, list);
      } else {
        // RFC 9112 §4 — status-message must be printable US-ASCII
        const safeMsg =
          this.statusMessage.replace(/[^\x20-\x7E]/g, "").trim() ||
          (std ?? "Unknown Error");
        (this.response as http.ServerResponse).writeHead(
          this.statusCode,
          safeMsg,
          list,
        );
      }
    } else {
      this.log("Headers already sent !!", "WARNING");
      throw new Error(`Headers already sent !!`);
    }
  }

  /**
   * Range dans la réserve les en-têtes passés à `writeHead` — ils l'emportent
   * sur ceux déjà posés, comme chez Node.
   */
  #apply(headers: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[]): void {
    if (Array.isArray(headers)) {
      for (let i = 0; i + 1 < headers.length; i += 2) {
        const value = headers[i + 1];
        if (value !== undefined) this.setHeader(String(headers[i]), value);
      }
      return;
    }
    for (const name in headers) {
      const value = headers[name];
      if (value !== undefined) this.setHeader(name, value);
    }
  }

  /** La réserve amorcée — pour une remise sous une autre forme (HTTP/2). */
  protected headerList(): readonly OutgoingHttpHeader[] {
    return this.#store();
  }

  // flushHeaders(): void {
  //   try {
  //     return this.response?.flushHeaders();
  //   } catch (e) {
  //     throw e;
  //   }
  // }

  addTrailers(headers: http.OutgoingHttpHeaders): void {
    return this.response?.addTrailers(headers);
  }

  flush(chunk: unknown, encoding: BufferEncoding) {
    this.flushing = true;
    this.setHeader("Transfer-Encoding", "chunked");
    return this.send(chunk, encoding, true);
  }

  /**
   * Écrit le corps sur le flux et, pour une réponse unique, la termine.
   *
   * Synchrone pour une réponse unique ou une redirection : `end(corps)` est un
   * appel synchrone de Node, rien n'y est à attendre (#505). Une promesse
   * seulement en streaming chunké (`flush()`), réglée quand le flux accepte
   * l'écriture suivante (`drain`) — c'est la contre-pression.
   *
   * @param chunk - le corps (posé par `setBody`) ; absent, le corps déjà posé.
   * @param encoding - l'encodage d'un corps texte.
   * @returns la réponse, ou sa promesse en streaming chunké.
   * @throws de façon SYNCHRONE quand la réponse Node n'existe plus.
   */
  send(
    chunk?: unknown,
    encoding?: BufferEncoding,
    _flush: boolean = false,
  ): MaybePromise<HttpResponse> {
    if (this.context.isRedirect) {
      if (!this.response?.headersSent) {
        this.writeHead();
      }
      return thenMaybe(this.end(), () => this);
    }
    if (chunk) {
      // L'encodage demandé s'applique au texte qu'on pose — il était ignoré
      // tant que le corps était converti en octets avant l'écriture.
      this.setBody(chunk, encoding);
    }
    if (!this.response) {
      throw new Error(`Http Response not found`);
    }
    // Corps VIDE légal (action qui `return ""`, 416/204…) : `payload` rend un
    // vide plutôt que `null` — `res.write(null)` jetterait ERR_STREAM_NULL_VALUES.
    // P2.8 — Backpressure (Node `stream.Writable.write()` : retourne `false`
    // quand le buffer interne dépasse `highWaterMark` → le producteur DOIT
    // attendre l'event `'drain'` avant de réécrire). En streaming chunké
    // (flush, RFC 9112 §7.1 — 1 écriture = 1 chunk), résoudre sur `'drain'`
    // borne la RAM serveur si le client est lent : un controller qui `flush()`
    // en boucle est naturellement freiné par cet `await`. Cas réponse unique
    // (non-flush) : `ok===true` quasi toujours → resolve immédiat (0 attente).
    // Le listener `'drain'` n'est attaché QUE sous pression (rare) et est
    // `once` (auto-détaché au fire) + retiré explicitement en cas d'erreur.
    const res = this.response as http.ServerResponse;
    // ── Réponse UNIQUE : terminer d'un SEUL appel `end(corps)` ───────────────
    // Node 26.8 (nodejs/node#65466) attache la finalisation à cette écriture
    // quand le corps lui est donné AU `end()` : `maybePrepareFinalChunk` accepte
    // une chaîne OU un Uint8Array (donc un Buffer), et évite alors « a separate
    // send() & tick step ». En écrivant par `write(corps)` puis `end()` VIDE, on
    // sortait de ce chemin et l'on payait un tick de boucle d'événements par
    // réponse — mesuré de l'extérieur : Express encaissait 40,9 µs du passage à
    // 26.8 quand nous n'en encaissions que 32,9.
    //
    // La contre-pression n'est pas perdue : elle n'a de sens que pour le
    // streaming chunké (`flush()`, 1 écriture = 1 chunk), qui garde `write` +
    // `drain` ci-dessous. Une réponse unique n'a rien à écrire ensuite.
    if (!_flush && !this.flushing && !res.writableEnded) {
      res.end(this.payload, this.payloadEncoding);
      return this;
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve(this);
        }
      };
      const onDrain = () => done();
      const ok = res.write(
        this.payload,
        this.payloadEncoding,
        (error: Error | null | undefined) => {
          if (error) {
            this.log(error, "ERROR");
            res.removeListener("drain", onDrain);
            done();
          }
        },
      );
      if (ok) {
        done();
      } else {
        res.once("drain", onDrain);
      }
    });
  }

  write(
    chunk?: unknown,
    encoding?: BufferEncoding,
  ): MaybePromise<HttpResponse> {
    return this.send(chunk, encoding || this.encoding);
  }

  writeContinue() {
    return this.response?.writeContinue();
  }

  /**
   * Termine la réponse Node — un appel synchrone, rien n'y est à attendre (#505).
   *
   * @returns le flux terminé (valeur de `ServerResponse.end`).
   * @throws de façon SYNCHRONE quand la réponse Node n'existe plus.
   */
  end(
    chunk?: string | Buffer,
    encoding?: BufferEncoding,
  ): MaybePromise<http.ServerResponse | http2.ServerHttp2Stream> {
    if (!this.response) {
      throw new Error(`response not found`);
    }
    return (this.response as http.ServerResponse).end(
      chunk,
      encoding || this.encoding,
    );
  }

  /**
   * Valeur d'un en-tête posé — dans la réserve, sinon sur la réponse Node (ce
   * qu'un tiers y a écrit directement : `send`, quota).
   *
   * @param name - nom de l'en-tête (casse indifférente).
   */
  getHeader(name: string): string | number | string[] | undefined {
    const at = this.#indexOf(name.toLowerCase());
    if (at !== -1) return this.#headers?.[at + 1];
    return this.response?.getHeader(name);
  }

  hasHeader(name: string): boolean {
    if (this.response) {
      return (
        this.#indexOf(name.toLowerCase()) !== -1 ||
        this.response.hasHeader(name)
      );
    }
    throw new Error(`Respose not foud`);
  }

  /** Tous les en-têtes posés, noms en minuscules — une copie, à chaque appel. */
  getHeaders(): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = { ...this.response?.getHeaders() };
    const list = this.#headers;
    if (list !== null) {
      for (let i = 0; i + 1 < list.length; i += 2) {
        const name = list[i];
        if (typeof name === "string") out[name] = list[i + 1];
      }
    }
    return out;
  }

  redirect(
    url: string,
    status?: number | string,
    headers?: Record<string, string | number>,
  ) {
    this.context.isRedirect = true;
    if (typeof status === "string") status = parseInt(status, 10);
    // Whitelist RFC 9110 §15.4 — un code de redirection non valide (ou absent)
    // retombe sur 302 (Found), le défaut sûr universel (Express/Symfony). On ne
    // force PLUS 301 : 301 par défaut piégeait (cache permanent navigateur quasi
    // irréversible) et un 307/308 explicite était silencieusement réécrit en 301
    // (perte de la préservation de méthode → faille fonctionnelle).
    if (typeof status !== "number" || !REDIRECT_STATUS_CODES.has(status)) {
      if (status !== undefined && !Number.isNaN(status)) {
        this.log(
          `Invalid redirect status ${status} → fallback 302 (RFC 9110 §15.4)`,
          "WARNING",
        );
      }
      status = 302;
    }
    this.setStatusCode(status);
    if (headers) {
      switch (typeOf(headers)) {
        case "object":
          this.setHeaders(headers);
          break;
        case "boolean":
          this.setHeaders({
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Expires: "Thu, 01 Jan 1970 00:00:00 GMT",
          });
          break;
        case null:
        default:
          break;
      }
    }
    this.setHeader("Location", url);
    this.log(`REDIRECT ${status} : ${url} `, "DEBUG");
    return this;
  }

  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    if (!msgid) {
      msgid = `${this.context.serverType} RESPONSE `;
    }
    return this.context.log(pci, severity, msgid, msg);
  }
}

export default HttpResponse;
