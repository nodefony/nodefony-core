import http from "node:http";
import http2 from "node:http2";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import HttpContext from "../http/HttpContext";
import { URL } from "node:url";
import { HTTPMethod, Cookies } from "../Context";
import QS from "qs";
import { Busboy } from "@fastify/busboy";
import type { BusboyFileStream, BusboyHeaders } from "@fastify/busboy";
import {
  ParserXml,
  ParserQs,
  ParserJson,
  Parser,
  acceptParser,
} from "./parser";
import { UploadedFile } from "../../../service/upload/upload-service";
import type {
  IParsedUploadFile,
  IUploadOptions,
} from "../../../interfaces/IUpload";
import { extend, Pci, Pdu, Message, Severity, Msgid } from "nodefony";
import Session from "../../session/session";
import { HttpError } from "@nodefony/http";
import {
  resolveForwarded,
  hasForwardingHeaders,
  type ResolvedProxy,
} from "../forwarded";

const reg = /(.*)[\[][\]]$/u;

// Sentinelle (singleton, 0 alloc/req) renvoyée quand le corps a été ENTIÈREMENT
// consommé + onRequestEnd émis DANS parseRequest (multipart busboy en streaming,
// ou JSON drainé+parsé). `initialize()` la voit comme « déjà traité » (n'est ni
// ParserXml/Qs/Parser → branche default noop) → ne refait RIEN (pas de double
// parse ni de double onRequestEnd).
class BodyHandled {}
const BODY_DONE = new BodyHandled();

// Hoisted hors de getCharset() — évite de réallouer l'objet d'alias + la regex
// à CHAQUE requête (getCharset tourne dans le ctor de Request, hot path).
const CHARSET_ALIASES: Record<string, BufferEncoding> = {
  "utf-8": "utf8",
  utf8: "utf8",
  "iso-8859-1": "latin1",
  latin1: "latin1",
  "us-ascii": "ascii",
  ascii: "ascii",
  "ucs-2": "ucs2",
  "utf-16le": "utf16le",
};
// `replace()` ignore/réinitialise lastIndex → partage sûr d'une regex /g.
const QUOTE_TRIM = /^["']|["']$/gu;

const parse = {
  POST: true,
  PUT: true,
  DELETE: true,
};

declare module "url" {
  interface URL {
    query: QS.ParsedQs;
  }
}

declare module "http" {
  interface IncomingMessage {
    body: unknown;
    session: Session;
    cookie: Cookies;
  }
}

declare module "http2" {
  interface Http2ServerRequest {
    body: unknown;
    session: Session;
  }
}

type ParserType = ParserXml | ParserQs | Parser | BodyHandled;

class HttpRequest {
  context: HttpContext;
  request: http.IncomingMessage | http2.Http2ServerRequest;
  url: URL;
  headers: http.IncomingHttpHeaders = {};
  host: string | undefined = "";
  method: HTTPMethod;
  contentType: string | null;
  rawContentType: Record<string, string> = {};
  domain: string;
  remoteAddress: string | null | undefined = "";
  hostname: string;
  sUrl: string;
  parser: ParserType | null = null;
  queryPost: Record<string, unknown> = {};
  queryGet: Record<string, unknown> = {};
  queryFile: UploadedFile[] = [];
  query: Record<string, unknown> = {};
  queryStringOptions:
    | (QS.IParseOptions & {
        decoder?: undefined;
      })
    | undefined;
  charset: BufferEncoding = "utf8";
  uploadOption: IUploadOptions = {};
  data: Buffer = Buffer.alloc(0);
  accept: ReturnType<typeof acceptParser> = [];
  acceptHtml: boolean = false;
  origin: string | undefined;
  // La connexion (socket) provient-elle d'un reverse-proxy de confiance ?
  // Décide si les en-têtes X-Forwarded-* sont honorés (cf config trustProxy).
  trustedProxy: boolean = false;
  // Résolution canonique des en-têtes forwarded (RFC 7239 `Forwarded` prioritaire,
  // repli `X-Forwarded-*`). `null` = requête directe / proxy non fiable (hot path,
  // 0 allocation) ; sinon scheme/host/IP cliente effectifs résolus une seule fois.
  forwarded: ResolvedProxy | null = null;
  constructor(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    context: HttpContext,
  ) {
    this.request = request;
    this.context = context;
    this.origin = this.headers.origin;
    this.request.body = null;
    this.headers = request.headers;
    // Calculé AVANT getFullUrl/getRemoteAddress (qui lisent le forwarded) :
    // n'honorer ces en-têtes que si le socket vient d'un proxy de confiance.
    const checker = this.context?.httpKernel?.getTrustProxyChecker();
    const socketAddress = this.request.socket?.remoteAddress;
    this.trustedProxy = !!checker?.isTrusted(socketAddress);
    // Résolution forwarded UNIFIÉE (RFC 7239 `Forwarded` prioritaire, repli
    // `X-Forwarded-*`), une seule passe. Seulement derrière un proxy de confiance
    // ET si un en-tête forwarded existe → requête directe = hot path, 0 allocation.
    if (this.trustedProxy && checker && hasForwardingHeaders(this.headers)) {
      this.forwarded = resolveForwarded(this.headers, socketAddress, checker);
    }
    this.method = this.getMethod();
    this.host = this.getHost();
    this.hostname = this.getHostName(this.host);
    this.sUrl = this.getFullUrl(request);
    this.url = this.getUrl(this.sUrl);
    this.queryStringOptions =
      this.context?.httpKernel?.module.options.queryString || {};
    this.uploadOption = this.context?.httpKernel?.module.options.upload || {};
    if (this.url.search) {
      this.url.query = QS.parse(
        this.url.search.slice(1),
        this.queryStringOptions || {},
      );
    } else {
      this.url.query = {};
    }
    // ALIASING : `queryGet` et `query` pointent d'abord le MÊME objet
    // (`url.query` = GET). Sur POST/PUT/DELETE, `query` est RÉASSIGNÉ par
    // `extend({}, query, queryPost)` (nouvel objet) — `queryGet` reste le GET
    // seul. `request.body` est ensuite aliasé sur `query` final (onRequestEnd).
    this.queryGet = this.url.query;
    this.query = this.url.query;
    // ORDRE CRITIQUE : getContentType() remplit this.rawContentType (dont
    // charset=…) ; getCharset() le lit. L'inverse laissait charset toujours
    // "utf8" → le `charset=` du Content-Type n'était jamais honoré.
    this.contentType = this.getContentType(this.request);
    this.charset = this.getCharset();
    this.domain = this.getDomain();
    this.remoteAddress = this.getRemoteAddress();
    try {
      this.accept = acceptParser(this.headers?.accept);
      this.acceptHtml = this.accepts("html");
    } catch (e) {
      this.log(e, "WARNING");
    }
    this.context.once("onRequestEnd", () => {
      this.request.body = this.query;
    });
  }

  // Valeur de résolution non consommée (awaited pour le séquençage dans
  // http-kernel) : les branches renvoient soit le parser, soit le résultat de
  // `fireAsync("onRequestEnd")` (unknown) → type honnête = Promise<unknown>.
  async initialize(): Promise<unknown> {
    return this.parseRequest()
      .then(async (parser) => {
        switch (true) {
          case parser instanceof ParserXml:
          case parser instanceof ParserQs:
          case parser instanceof Parser: {
            //this.request.once("end", () => {
            try {
              if (this.context.finished) {
                return;
              }
              // AWAIT : le corps doit être ENTIÈREMENT parsé (queryPost rempli)
              // AVANT onRequestEnd → avant que le controller ne lise @Body. Sans
              // await, onRequestEnd partait sur un parse encore en cours → body vide.
              await parser.parse();
              return this.context.fireAsync("onRequestEnd", this);
            } catch (error) {
              return this.context?.httpKernel?.onError(
                error as Error,
                this.context,
              );
            }
            //});
            break;
          }
          default: {
            if (!parser) {
              //this.request.once("end", () => {
              try {
                if (this.context.finished) {
                  return;
                }
                this.context.requestEnded = true;
                return this.context.fireAsync("onRequestEnd", this);
              } catch (error) {
                return this.context.httpKernel?.onError(
                  error as Error,
                  this.context,
                );
              }
              // });
            }
          }
        }
        return parser;
      })
      .catch((e) => {
        throw e;
      });
  }

  // Pipeline d'entrée du corps de requête. Async PUR (plus de
  // `new Promise(async …)`) : un throw du constructeur de parser remonte
  // proprement au lieu de laisser la promesse pendante.
  async parseRequest(): Promise<ParserType | null> {
    if (!(this.method in parse)) {
      return this.parser;
    }
    switch (this.contentType) {
      case "application/xml":
      case "text/xml":
        this.parser = new ParserXml(this);
        return this.parser;
      case "application/x-www-form-urlencoded":
        this.parser = new ParserQs(this);
        return this.parser;
      case "multipart/form-data":
        // SEUL le multipart passe par busboy (streaming → disque).
        return this.parseMultipart();
      default:
        // formidable parsait le JSON via son plugin `json` interne ; busboy ne
        // gère QUE le multipart → on parse le JSON nous-mêmes (→ queryPost, lu
        // par @Body). `*+json` (ex: application/vnd.api+json) inclus.
        // AWAIT ici (comme l'ancien `await form.parse()`) : ParserJson draine le
        // corps puis remplit queryPost AVANT que initialize ne résolve, donc
        // avant que le controller ne lise @Body. On fire onRequestEnd ici et on
        // renvoie la sentinelle → initialize ne re-parse pas.
        if (
          this.contentType === "application/json" ||
          this.contentType?.endsWith("+json")
        ) {
          const jsonParser = new ParserJson(this);
          this.parser = jsonParser;
          await jsonParser.parse();
          await this.context.fireAsync("onRequestEnd", this);
          return BODY_DONE;
        }
        // text/plain, octet-stream, inconnu, ou sans corps : bufferise le brut
        // dans request.data (le framework décidera) ; pas de queryPost.
        this.parser = new Parser(this);
        return this.parser;
    }
  }

  /**
   * Parse un corps `multipart/form-data` via **busboy** (streaming pur).
   *
   * Contrairement à l'ancien chemin formidable, le corps brut n'est **jamais**
   * bufferisé en RAM : busboy lit le flux, les fichiers sont écrits au fil de
   * l'eau dans le répertoire temp (`UploadService.path`), seuls les champs
   * texte (petits) restent en mémoire → fin de la double-bufferisation
   * (`Parser.chunks` + parser de fichiers) qui doublait la RAM par upload.
   *
   * Robustesse / sécurité :
   * - `new Busboy()` lève **synchroniquement** si le Content-Type n'est pas un
   *   multipart exploitable (boundary manquant, en-tête absent) → le flux n'a
   *   pas encore été consommé → bascule sur le `Parser` de secours.
   * - `limits.fileSize` borne CHAQUE fichier ; `maxTotalFileSize` borne le
   *   CUMUL par requête (compteur Nodefony) ; `files`/`fields`/`parts` bornent
   *   la quantité → 413. Toute erreur nettoie les temporaires déjà posés
   *   (anti-orphelins / saturation disque sur endpoint d'upload public).
   * - nom temp = `randomUUID()` + extension d'origine → jamais le nom client
   *   dans le chemin (anti path-traversal).
   *
   * @returns la sentinelle `BODY_DONE` (corps déjà traité), ou le `Parser`
   *   de secours quand le corps n'est pas un multipart.
   * @throws {HttpError} 413 si une limite de taille/quantité est dépassée.
   */
  async parseMultipart(): Promise<ParserType> {
    let bb: Busboy;
    try {
      bb = new Busboy({
        headers: this.request.headers as BusboyHeaders,
        defCharset: this.uploadOption.encoding || "utf8",
        limits: {
          fileSize: this.uploadOption.maxFileSize,
          files: this.uploadOption.maxFiles,
          fields: this.uploadOption.maxFields,
          fieldSize: this.uploadOption.maxFieldsSize,
        },
      });
    } catch (e) {
      // multipart sans boundary exploitable → parser de secours (flux non
      // consommé par busboy). initialize() fera parse() + onRequestEnd.
      this.log(`${(e as Error).message} : fallback simple parser`, "WARNING");
      this.parser = new Parser(this);
      return this.parser;
    }

    const { fields, files } = await this.streamMultipart(bb);
    this.queryPost = fields;
    this.query = extend({}, this.query, this.queryPost);
    for (const pf of files) {
      await this.createFileUpload(pf.field, pf.file);
    }
    this.context.requestEnded = true;
    await this.context.fireAsync("onRequestEnd", this);
    return BODY_DONE;
  }

  /**
   * Pilote busboy : pipe le flux requête, écrit chaque fichier dans un temp au
   * fil de l'eau, accumule les champs texte. Résout `{ fields, files }` à
   * `finish` (après flush de tous les writes), rejette — avec cleanup des temp
   * déjà posés — à la moindre erreur ou dépassement de limite.
   */
  private streamMultipart(bb: Busboy): Promise<{
    fields: Record<string, unknown>;
    files: { field: string; file: IParsedUploadFile }[];
  }> {
    const dir =
      (this.context.uploadService?.path as string) ||
      this.uploadOption.uploadDir ||
      os.tmpdir();
    const maxTotal = this.uploadOption.maxTotalFileSize;
    const algo = this.uploadOption.hashAlgorithm || false;

    return new Promise((resolve, reject) => {
      const fields: Record<string, unknown> = {};
      const files: { field: string; file: IParsedUploadFile }[] = [];
      const pending: Promise<void>[] = [];
      const tempPaths: string[] = [];
      const openStreams = new Set<fs.WriteStream>();
      let totalBytes = 0;
      let aborted = false;

      const abort = (err: Error): void => {
        if (aborted) {
          return;
        }
        aborted = true;
        this.request.unpipe(bb);
        this.request.resume(); // draine la source → libère le socket
        for (const ws of openStreams) {
          ws.destroy();
        }
        Promise.all(
          tempPaths.map((p) => fsp.unlink(p).catch(() => undefined)),
        ).finally(() => reject(err));
      };

      bb.on("field", (name: string, value: string) => {
        if (aborted) {
          return;
        }
        this.assignField(fields, name, value);
      });

      bb.on(
        "file",
        (
          fieldname: string,
          stream: BusboyFileStream,
          filename: string,
          _enc: string,
          mimeType: string,
        ) => {
          if (aborted) {
            stream.resume(); // discard obligatoire sinon 'finish' ne fire jamais
            return;
          }
          const match = reg.exec(fieldname);
          const field = match ? match[1] : fieldname;
          const ext = filename ? path.extname(filename) : "";
          const newFilename = `${randomUUID()}${ext}`;
          const filepath = path.join(dir, newFilename);
          tempPaths.push(filepath);
          const hasher = algo ? createHash(algo) : null;
          const ws = fs.createWriteStream(filepath);
          openStreams.add(ws);
          let size = 0;

          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            totalBytes += chunk.length;
            hasher?.update(chunk);
            if (maxTotal && totalBytes > maxTotal) {
              abort(
                new HttpError(
                  `maxTotalFileSize exceeded (${maxTotal} bytes)`,
                  413,
                  this.context,
                ),
              );
            }
          });
          // busboy a atteint limits.fileSize sur CE fichier.
          stream.on("limit", () => {
            abort(
              new HttpError(
                `maxFileSize exceeded for ${filename || field}`,
                413,
                this.context,
              ),
            );
          });

          const done = new Promise<void>((res, rej) => {
            stream.on("error", rej);
            ws.on("error", rej);
            ws.on("close", () => {
              openStreams.delete(ws);
              if (aborted) {
                return res();
              }
              files.push({
                field,
                file: {
                  filepath,
                  newFilename,
                  originalFilename: filename || null,
                  mimetype: mimeType || null,
                  size,
                  mtime: new Date(),
                  hashAlgorithm: algo,
                  hash: hasher ? hasher.digest("hex") : null,
                },
              });
              res();
            });
          });
          // .catch → abort (jamais de rejet pendant non-géré).
          pending.push(
            done.catch((e) =>
              abort(e instanceof Error ? e : new Error(String(e))),
            ),
          );
          stream.pipe(ws);
        },
      );

      // Limites de QUANTITÉ (anti-DoS) → 413 plutôt qu'ignorer silencieusement.
      bb.on("filesLimit", () =>
        abort(new HttpError("too many files", 413, this.context)),
      );
      bb.on("fieldsLimit", () =>
        abort(new HttpError("too many fields", 413, this.context)),
      );
      bb.on("partsLimit", () =>
        abort(new HttpError("too many parts", 413, this.context)),
      );
      bb.on("error", (e: unknown) =>
        abort(e instanceof Error ? e : new Error(String(e))),
      );
      bb.on("finish", () => {
        if (aborted) {
          return;
        }
        Promise.all(pending)
          .then(() => {
            if (!aborted) {
              resolve({ fields, files });
            }
          })
          .catch(abort);
      });

      this.request.pipe(bb);
    });
  }

  /**
   * Accumule un champ texte multipart. `foo[]` (ou répétition de `foo`) →
   * tableau ; sinon valeur scalaire. (Anciennement délégué à formidable.)
   */
  private assignField(
    fields: Record<string, unknown>,
    name: string,
    value: string,
  ): void {
    const match = reg.exec(name);
    const key = match ? match[1] : name;
    if (key in fields) {
      const cur = fields[key];
      if (Array.isArray(cur)) {
        cur.push(value);
      } else {
        fields[key] = [cur, value];
      }
    } else {
      fields[key] = match ? [value] : value;
    }
  }

  accepts(Type: string) {
    let parse: string[] = [];
    let subtype = "*";
    let type = "*";
    try {
      if (Type) {
        parse = Type.split("/");
      }
      if (parse) {
        switch (parse.length) {
          case 1:
            subtype = parse.shift() as string;
            break;
          case 2:
            type = parse.shift() as string;
            subtype = parse.shift() as string;
            break;
          default:
            throw new Error("request accepts method bad type format");
        }
      }
      for (let i = 0; i < this.accept.length; i++) {
        const line = this.accept[i];
        if (
          (type === "*" || line.type.test(type)) &&
          (subtype === "*" || line.subtype.test(subtype))
        ) {
          return true;
        }
        continue;
      }
      return false;
    } catch (e) {
      throw e;
    }
  }

  // La limite de taille par fichier (`maxFileSize`) et le cumul
  // (`maxTotalFileSize`) sont désormais appliqués PENDANT le streaming busboy
  // (events 'limit' / compteur cumulé) → plus de check post-hoc ici.
  async createFileUpload(
    name: string,
    file: IParsedUploadFile,
  ): Promise<UploadedFile | undefined> {
    const fileUpload = await this.context.uploadService?.createUploadFile(
      file,
      name,
    );
    if (fileUpload) {
      this.queryFile.push(fileUpload);
    }
    return fileUpload;
  }

  getMethod(): HTTPMethod {
    return this.request.method as HTTPMethod;
  }

  getContentType(
    request: http.IncomingMessage | http2.Http2ServerRequest,
  ): string | null {
    if (request.headers["content-type"]) {
      const tab = request.headers["content-type"].split(";");
      if (tab.length > 1) {
        for (let i = 1; i < tab.length; i++) {
          if (typeof tab[i] === "string") {
            const ele = tab[i].split("=");
            const key = ele[0].replace(" ", "").toLowerCase();
            this.rawContentType[key] = ele[1];
          } else {
            continue;
          }
        }
      }
      return tab[0];
    }
    return null;
  }

  /**
   * Charset du corps déduit du `Content-Type` (`charset=…`), normalisé en un
   * `BufferEncoding` Node valide. Les alias IANA courants sont mappés
   * (`iso-8859-1` → `latin1`, `us-ascii` → `ascii`…) ; tout charset inconnu ou
   * non supporté par Node retombe sur `utf8` — JAMAIS de throw `.toString()`
   * sur un encoding invalide (erreur propre, pas de 500 sur charset exotique).
   */
  getCharset(): BufferEncoding {
    const raw = this.rawContentType.charset;
    if (!raw) {
      return "utf8";
    }
    const normalized = raw.trim().toLowerCase().replace(QUOTE_TRIM, "");
    const enc = CHARSET_ALIASES[normalized] ?? (normalized as BufferEncoding);
    return Buffer.isEncoding(enc) ? enc : "utf8";
  }

  getDomain(): string {
    return this.getHostName();
  }

  getUserAgent(): string | undefined {
    return this.request.headers["user-agent"];
  }

  getHostName(host?: string): string {
    if (this.url && this.url.hostname) {
      return this.url.hostname;
    }
    if (host) {
      return host.split(":")[0];
    }
    if ((host = this.getHost())) {
      return host.split(":")[0];
    }
    return "";
  }

  getHost(): string | undefined {
    return this.request.headers.host;
  }

  getRemoteAddress(): string | null {
    // IP cliente réelle résolue une seule fois au ctor (cf this.forwarded /
    // resolveForwarded) : derrière un proxy de confiance, la chaîne forwarded est
    // dépouillée DE DROITE À GAUCHE. Lire la valeur la plus à gauche serait
    // FORGEABLE — le client l'injecte, le proxy ne fait qu'append l'IP réelle.
    if (this.forwarded) {
      return this.forwarded.clientIp;
    }
    return this.request.socket?.remoteAddress ?? null;
  }

  getFullUrl(request: http.IncomingMessage | http2.Http2ServerRequest) {
    const myurl = `://${this.host}${request.url}`;
    // Scheme effectif côté client : `Forwarded`/`X-Forwarded-*` résolu de façon
    // canonique (this.forwarded, gated proxy de confiance) ; sinon le transport réel.
    if (this.forwarded?.proto) {
      return `${this.forwarded.proto}${myurl}`;
    }
    if ("encrypted" in request.socket && request.socket.encrypted) {
      return `https${myurl}`;
    }
    return `http${myurl}`;
  }

  getHeader(name: string) {
    if (name in this.headers) {
      return this.headers[name];
    }
    return null;
  }

  setUrl(Url: string): URL {
    return (this.url = this.getUrl(Url));
  }

  getUrl(sUrl: string, baseUrl?: string): URL {
    return new URL(sUrl, baseUrl);
  }

  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    if (!msgid) {
      msgid = `${this.context.type} REQUEST `;
    }
    return this.context.log(pci, severity, msgid, msg);
  }
}

export default HttpRequest;
