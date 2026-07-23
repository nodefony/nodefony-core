import http, { OutgoingHttpHeaders, OutgoingHttpHeader } from "node:http";
import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import { typeOf, Pci, Pdu, Message, Severity, Msgid } from "nodefony";
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

const stripAinsi = function (val: string): string {
  return typeof val === "string" ? val.replace(ANSI_REGEX, "") : val;
};

// Codes de redirection RFC 9110 §15.4 qui posent un `Location` pour rediriger
// l'agent utilisateur. 301 (Moved Permanently) / 302 (Found) PEUVENT muter
// POST→GET (raisons historiques) ; 303 (See Other) force un GET ; 307 (Temporary
// Redirect) / 308 (Permanent Redirect) PRÉSERVENT méthode + corps. Tout autre
// code passé à `redirect()` retombe sur 302 (cf `redirect()`). Set module-level
// (0 alloc par appel).
const REDIRECT_STATUS_CODES = new Set<number>([301, 302, 303, 307, 308]);

class HttpResponse {
  context: HttpContext;
  response: http.ServerResponse | http2.Http2ServerResponse | null;
  statusCode: number = 200;
  statusMessage: string = "";
  flushing: boolean = false;
  encoding: BufferEncoding = "utf-8";
  body: Buffer | null = null;
  contentType: string = "application/octet-stream";
  headers: http.OutgoingHttpHeaders = {};
  timeout?: number; // miiliseconde
  cookies: Record<string, Cookie> = {};
  constructor(
    response: http.ServerResponse | http2.Http2ServerResponse,
    context: HttpContext,
  ) {
    this.context = context;
    this.response = response;
    this.timeout =
      this.context?.httpKernel?.responseTimeout[
        this.context.type as responseTimeoutType
      ];
    this.setContentTypeByExtension("bin");
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
      if (this.cookies[cookie.name]) {
        delete this.cookies[cookie.name];
        return true;
      }
      return false;
    }
    throw new Error("Response delCookie not valid cookies");
  }

  deleteCookieByName(name: string) {
    if (this.cookies[name]) {
      delete this.cookies[name];
      return true;
    }
    return false;
  }

  setCookies() {
    const names = Object.keys(this.cookies);
    if (names.length === 0) return;
    // 1 cookie (cas dominant) → chemin direct, comportement inchangé.
    if (names.length === 1) {
      return this.setCookie(this.cookies[names[0]]);
    }
    // ≥2 cookies (ex. session BFF + `csrf-token`) → UN SEUL setHeader avec un
    // TABLEAU : Node émet N lignes `Set-Cookie`. Une boucle de `setHeader` les
    // écraserait (`setHeader('Set-Cookie', str)` REMPLACE → seul le dernier survit).
    const serialized: string[] = [];
    for (const name of names) {
      const s = this.cookies[name].serialize();
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
        return this.addTrailers(obj);
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
    const current = this.response?.getHeader?.("vary");
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
    this.response?.removeHeader("content-type");
    this.response?.removeHeader("Content-Type");
    if (type && encoding) {
      let mytype = mime.contentType(type);
      // Get the MIME type without charset
      if (mytype) {
        mytype = mytype.split(";")[0];
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
      const mytype = mime.contentType(type);
      if (mytype) {
        this.contentType = mytype;
        let charset = mime.charset(this.contentType);
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
      // HTTP status messages must be printable US-ASCII only (RFC 7230 §3.1.2)
      const ascii = stripAinsi(message)
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

  setBody(ele: unknown, encoding?: BufferEncoding | undefined): Buffer {
    if (typeof ele === "string") {
      this.body = Buffer.from(ele, encoding || this.encoding);
    } else if (ele instanceof ArrayBuffer || ele instanceof SharedArrayBuffer) {
      this.body = Buffer.from(ele);
    } else if (ArrayBuffer.isView(ele) && ele.buffer instanceof ArrayBuffer) {
      // Respecter byteOffset/byteLength : un Buffer issu du pool Node partage un
      // ArrayBuffer bien plus grand → Buffer.from(ele.buffer) copierait TOUT le
      // pool (octets adjacents d'autres buffers = fuite mémoire dans la réponse).
      // On ne prend que la fenêtre de la vue.
      this.body = Buffer.from(ele.buffer, ele.byteOffset, ele.byteLength);
    } else {
      try {
        this.body = Buffer.from(JSON.stringify(ele));
      } catch (e) {
        this.body = Buffer.from(String(ele));
      }
    }
    return this.body;
  }

  setLength(
    body?: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
  ): number {
    if (this.response?.headersSent) {
      throw new Error("Headers already sended");
    }
    const actualBody = body || this.body;
    const noContentLengthMethods = ["HEAD", "OPTIONS", "TRACE"];
    const noContentLengthStatusCodes = [204, 304];
    // Ne pas définir Content-Length si Transfer-Encoding est chunked
    const isChunked = this.getHeader("Transfer-Encoding") === "chunked";
    // Vérifier si Content-Length doit être défini
    let actualContentLength = null;
    if (this.hasHeader("Content-Length")) {
      actualContentLength = this.getHeader("Content-Length");
    }
    if (
      //actualBody &&
      !noContentLengthMethods.includes(this.context?.method as string) &&
      !noContentLengthStatusCodes.includes(this.statusCode) &&
      !isChunked
    ) {
      // Calculer la longueur du corps

      // Vérifier si Content-Length est déjà défini
      if (!actualContentLength) {
        this.response?.removeHeader("Content-Length");
      }
      let length = 0;
      if (actualBody) {
        length = Buffer.byteLength(actualBody);
        this.setHeader("Content-Length", length.toString());
      }
      return length;
    } else {
      // Ne pas définir Content-Length pour les réponses sans corps
      if (!noContentLengthStatusCodes.includes(this.statusCode)) {
        if (actualContentLength) {
          this.response?.removeHeader("Content-Length");
        }
        this.setHeader("Content-Length", "0");
        return 0;
      }
    }
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
          this.statusCode = parseInt(this.statusCode as string, 10);
        }
        if (this.statusCode > 599) {
          this.statusCode = 500;
        }
      }
      this.statusMessage = this.getStatusMessage();
      if (this.context.requestId && !this.response.headersSent) {
        this.response.setHeader("x-request-id", this.context.requestId);
      }
      // P2.7 — echo W3C traceparent so downstream services and clients can
      // continue the trace. Header name is lower-case per the spec.
      if (this.context.traceparent && !this.response.headersSent) {
        this.response.setHeader("traceparent", this.context.traceparent);
      }
      this.setLength();
      // RFC 7230 §3.1.2 — status-message must be printable US-ASCII
      const safeMsg =
        this.statusMessage.replace(/[^\x20-\x7E]/g, "").trim() ||
        (http.STATUS_CODES[this.statusCode] ?? "Unknown Error");
      (this.response as http.ServerResponse).writeHead(
        this.statusCode,
        safeMsg,
        headers as http.OutgoingHttpHeaders,
      );
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

  // P7 — la partie async (redirect/end) vit AVANT le `new Promise` ; l'executor
  // redevient synchrone (plus de `new Promise(async …)` dont les throws étaient
  // avalés par le constructeur Promise).
  async send(
    chunk?: unknown,
    encoding?: BufferEncoding,
    _flush: boolean = false,
  ): Promise<HttpResponse> {
    if (this.context.isRedirect) {
      if (!this.response?.headersSent) {
        this.writeHead();
      }
      await this.end();
      return this;
    }
    if (chunk) {
      this.setBody(chunk);
    }
    if (!this.response) {
      throw new Error(`Http Response not found`);
    }
    // Corps VIDE légal (action qui `return ""`, 416/204…) : `res.write(null)`
    // jetterait ERR_STREAM_NULL_VALUES → 500 pour un cas parfaitement valide.
    if (this.body === null) {
      this.body = Buffer.alloc(0);
    }
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
        this.body,
        encoding || this.encoding,
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

  async write(
    chunk?: unknown,
    encoding?: BufferEncoding,
  ): Promise<HttpResponse> {
    return await this.send(chunk, encoding || this.encoding);
  }

  writeContinue() {
    return this.response?.writeContinue();
  }

  async end(
    chunk?: string | Buffer,
    encoding?: BufferEncoding,
  ): Promise<http.ServerResponse | http2.ServerHttp2Stream> {
    return new Promise((resolve, reject) => {
      if (this.response) {
        return resolve(
          (this.response as http.ServerResponse).end(
            chunk,
            encoding || this.encoding,
          ),
        );
      }
      return reject(new Error(`response not found`));
    });
  }

  getHeader(name: string): string | number | string[] | undefined {
    return this.response?.getHeader(name);
  }

  hasHeader(name: string): boolean {
    if (this.response) {
      const headers = this.response.getHeaders();
      if (name.toLocaleLowerCase() in headers) {
        return true;
      }
      return false;
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
