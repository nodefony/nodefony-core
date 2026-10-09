import http, { OutgoingHttpHeaders, OutgoingHttpHeader } from "node:http";
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
import { responseTimeoutType } from "../../../service/http-kernel";
import Cookie from "../../cookies/cookie";

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
  constructor(
    response: http.ServerResponse | http2.Http2ServerResponse,
    context: HttpContext,
  ) {
    this.context = context;
    this.response = response;
    this.timeout =
      this.context.httpKernel?.responseTimeout[
        this.context.type as responseTimeoutType
      ];
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
      !this.response.hasHeader("content-type") &&
      !this.#isBodyless()
    ) {
      this.response.setHeader("content-type", this.contentType);
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
      return this.setCookie(first);
    }
    // ≥2 cookies (ex. session BFF + `csrf-token`) → UN SEUL setHeader avec un
    // TABLEAU : Node émet N lignes `Set-Cookie`. Une boucle de `setHeader` les
    // écraserait (`setHeader('Set-Cookie', str)` REMPLACE → seul le dernier survit).
    const serialized: string[] = [];
    for (const cookie of cookies) {
      const s = cookie.serialize();
      this.log(`ADD COOKIE ==> ${s}`, "DEBUG");
      serialized.push(s);
    }
    return this.setHeader("Set-Cookie", serialized);
  }

  setCookie(cookie: Cookie) {
    const serialize = cookie.serialize();
    this.log(`ADD COOKIE ==> ${serialize}`, "DEBUG");
    return this.setHeader("Set-Cookie", serialize);
  }

  // ADD INPLICIT HEADER
  setHeader(name: string, value: number | string | readonly string[]) {
    if (this.response) {
      if (this.flushing) {
        const obj: OutgoingHttpHeaders = {};
        obj[name] = value as OutgoingHttpHeader;
        this.addTrailers(obj);
        return;
      }
      if (!this.response.headersSent) {
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
        if (lower === "vary") {
          return this.response.setHeader(lower, this.#mergeVary(value));
        }
        return this.response.setHeader(lower, value);
      }
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
    const current = this.response?.getHeader("vary");
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
      return (this.headers =
        this.response?.getHeaders() as OutgoingHttpHeaders);
    }
    this.log("headers already sended ", "WARNING");
    return (this.headers = this.response.getHeaders());
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
          return this.setHeader("Content-Type", mytype);
        }
        return this.setHeader("Content-Type", `${mytype}; charset=${encoding}`);
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
        return this.setHeader("Content-Type", mytype);
      }
    }
    return this.setHeader(
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
    return this.setContentType(myType, encoding || this.encoding);
  }

  setContentTypeByExtension(extention: string) {
    const ismime = mime.contentType(extention);
    if (ismime) {
      this.contentType = ismime;
      let charset = mime.charset(this.contentType);
      if (charset) {
        this.encoding = charset as BufferEncoding;
      }
      return this.setHeader("Content-Type", ismime);
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
      this.response?.removeHeader("Content-Length");
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
      this.setHeader("Content-Length", String(length));
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
      if (this.context.requestId) {
        this.response.setHeader("x-request-id", this.context.requestId);
      }
      // P2.7 — echo W3C traceparent so downstream services and clients can
      // continue the trace. Header name is lower-case per the spec.
      if (this.context.traceparent) {
        this.response.setHeader("traceparent", this.context.traceparent);
      }
      this.setLength();
      this.ensureContentTypeHeader();
      const std = http.STATUS_CODES[this.statusCode];
      if (this.statusMessage === std) {
        // Message standard (cas nominal) : ne PAS le passer à node — un
        // statusMessage custom force le slow path de composition de la ligne
        // de statut, et le message standard n'a rien à assainir.
        (this.response as http.ServerResponse).writeHead(
          this.statusCode,
          headers as http.OutgoingHttpHeaders,
        );
      } else {
        // RFC 9112 §4 — status-message must be printable US-ASCII
        const safeMsg =
          this.statusMessage.replace(/[^\x20-\x7E]/g, "").trim() ||
          (std ?? "Unknown Error");
        (this.response as http.ServerResponse).writeHead(
          this.statusCode,
          safeMsg,
          headers as http.OutgoingHttpHeaders,
        );
      }
    } else {
      this.log("Headers already sent !!", "WARNING");
      throw new Error(`Headers already sent !!`);
    }
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

  getHeader(name: string): string | number | string[] | undefined {
    return this.response?.getHeader(name);
  }

  hasHeader(name: string): boolean {
    if (this.response) {
      // `hasHeader` natif : lookup O(1), sans la copie complète que
      // `getHeaders()` matérialise à chaque appel.
      return this.response.hasHeader(name);
    }
    throw new Error(`Respose not foud`);
  }

  getHeaders(): http.OutgoingHttpHeaders {
    return this.response?.getHeaders() as http.OutgoingHttpHeaders;
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
      msgid = `${this.context.type} RESPONSE `;
    }
    return this.context.log(pci, severity, msgid, msg);
  }
}

export default HttpResponse;
