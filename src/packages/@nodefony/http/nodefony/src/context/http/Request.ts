import http from "node:http";
import http2 from "node:http2";
import fsp from "node:fs/promises";
import HttpContext from "../http/HttpContext";
import { URL } from "node:url";
import { HTTPMethod, Cookies } from "../Context";
import QS from "qs";
//import Http2Request from "../http2/Request";
import formidable, { IncomingForm } from "formidable";
//import { Container } from "nodefony";
import { ParserXml, ParserQs, Parser, acceptParser } from "./parser";
import { UploadedFile } from "../../../service/upload/upload-service";
import { extend, Pci, Pdu, Message, Severity, Msgid } from "nodefony";
import Session from "../../session/session";
import { HttpError } from "@nodefony/http";

const reg = /(.*)[\[][\]]$/u;

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

type ParserType =
  | ParserXml
  | ParserQs
  | Parser
  | InstanceType<typeof IncomingForm>;

class HttpRequest {
  context: HttpContext;
  request: http.IncomingMessage | http2.Http2ServerRequest;
  url: URL;
  headers: http.IncomingHttpHeaders = {};
  host: string | undefined = "";
  method: HTTPMethod;
  contentType: string | null;
  rawContentType: Record<string, string> = {};
  extentionContentType: string = "";
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
  formidableOption: formidable.Options = {};
  data: Buffer = Buffer.alloc(0);
  dataSize: number = 0;
  accept: ReturnType<typeof acceptParser> = [];
  acceptHtml: boolean = false;
  origin: string | undefined;
  constructor(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    context: HttpContext,
  ) {
    this.request = request;
    this.request.on("data", (data) => {
      this.dataSize += data.length;
    });
    this.context = context;
    this.origin = this.headers.origin;
    this.request.body = null;
    this.headers = request.headers;
    this.method = this.getMethod();
    this.host = this.getHost();
    this.hostname = this.getHostName(this.host);
    this.sUrl = this.getFullUrl(request);
    this.url = this.getUrl(this.sUrl);
    this.queryStringOptions =
      this.context?.httpKernel?.module.options.queryString || {};
    this.formidableOption =
      this.context?.httpKernel?.module.options.formidable || {};
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
      .then((parser) => {
        switch (true) {
          case parser instanceof ParserXml:
          case parser instanceof ParserQs:
          case parser instanceof Parser: {
            //this.request.once("end", () => {
            try {
              if (this.context.finished) {
                return;
              }
              parser.parse();
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
      default:
        return this.parseMultipart();
    }
  }

  /**
   * Parse un corps `multipart/form-data` via formidable, hydrate
   * `queryPost`/`query`/`queryFile`, puis fire `onRequestEnd`.
   *
   * Robustesse :
   * - SEUL un échec de `formidable.parse()` (corps malformé, code 1003/1011)
   *   bascule sur le `Parser` de secours ; une erreur survenant APRÈS (limite
   *   `maxFileSize`, hook `onRequestEnd`) est propagée telle quelle.
   * - En cas d'erreur après écriture, les fichiers temporaires déjà posés sur
   *   disque par formidable sont supprimés (best-effort) → pas d'orphelins
   *   (vecteur de saturation disque sur endpoint d'upload public).
   *
   * @returns le parser formidable, ou le `Parser` de secours.
   * @throws {HttpError} 413 si un fichier dépasse `maxFileSize`.
   */
  async parseMultipart(): Promise<ParserType> {
    const parserInst = new Parser(this);
    const opt: formidable.Options = extend(this.formidableOption, {
      encoding: this.charset === "utf8" ? "utf-8" : this.charset,
    });
    const form = formidable(opt);
    this.parser = form;

    let fields: formidable.Fields;
    let files: formidable.Files;
    try {
      [fields, files] = await form.parse(this.request as http.IncomingMessage);
    } catch (err) {
      // Échec du parsing multipart lui-même → fallback simple parser.
      const error = err as HttpError;
      this.log(`${error.message} use Simple parser`, "WARNING");
      switch (error.code) {
        case 1003:
        case 1011:
          this.parser = parserInst;
          return (await parserInst.parse()) as Parser;
        default:
          this.log(error, "ERROR");
          error.code = error.httpCode;
          throw err;
      }
    }

    // Parsing OK : les fichiers sont écrits sur disque. Toute erreur à partir
    // d'ici doit nettoyer les temporaires avant de remonter.
    try {
      await parserInst.parse();
      this.queryPost = fields;
      this.query = extend({}, this.query, this.queryPost);
      await this.processUploadedFiles(files, opt.maxFileSize);
      this.context.requestEnded = true;
      await this.context.fireAsync("onRequestEnd", this);
      return form;
    } catch (err) {
      await this.cleanupTempFiles(files);
      throw err;
    }
  }

  /**
   * Hydrate `queryFile` depuis la map formidable. Le nom de champ `foo[]` est
   * normalisé en `foo` (correctif : on passait l'index numérique `"0"/"1"`).
   */
  private async processUploadedFiles(
    files: formidable.Files | undefined,
    maxSize?: number,
  ): Promise<void> {
    if (!files || !Object.keys(files).length) {
      return;
    }
    for (const field in files) {
      const ele = files[field];
      if (!ele) {
        continue;
      }
      const match = reg.exec(field);
      const name = match ? match[1] : field;
      const list = Array.isArray(ele) ? ele : [ele as formidable.File];
      for (const file of list) {
        await this.createFileUpload(name, file, maxSize);
      }
    }
  }

  /** Supprime (best-effort) les fichiers temporaires posés par formidable. */
  private async cleanupTempFiles(
    files: formidable.Files | undefined,
  ): Promise<void> {
    if (!files) {
      return;
    }
    for (const field in files) {
      const ele = files[field];
      if (!ele) {
        continue;
      }
      const list = Array.isArray(ele) ? ele : [ele as formidable.File];
      for (const file of list) {
        const fp = file?.filepath;
        if (!fp) {
          continue;
        }
        try {
          await fsp.unlink(fp);
        } catch {
          /* déjà supprimé / inaccessible — best-effort */
        }
      }
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

  async createFileUpload(
    name: string,
    file?: formidable.File,
    maxSize?: number,
  ): Promise<UploadedFile | undefined> {
    if (file && maxSize && file.size > maxSize) {
      throw new HttpError(
        `maxFileSize exceeded, received ${file.size} bytes of file data for : ${
          file.originalFilename || name || file.newFilename
        }`,
        413,
        this.context,
      );
    }
    const fileUpload = await this.context.uploadService?.createUploadFile(
      file as formidable.File,
      name,
    );
    /*const index =*/
    if (fileUpload) {
      this.queryFile.push(fileUpload);
    }

    //this.queryFile[fileUpload.filename] = this.queryFile[index - 1];
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
      this.extentionContentType = request.headers["content-type"];
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
    const normalized = raw
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/gu, "");
    const alias: Record<string, BufferEncoding> = {
      "utf-8": "utf8",
      utf8: "utf8",
      "iso-8859-1": "latin1",
      latin1: "latin1",
      "us-ascii": "ascii",
      ascii: "ascii",
      "ucs-2": "ucs2",
      "utf-16le": "utf16le",
    };
    const enc = alias[normalized] ?? (normalized as BufferEncoding);
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
    // proxy mode
    if (this.headers && this.headers["x-forwarded-for"]) {
      return this.headers["x-forwarded-for"] as string;
    }
    if (this.request.socket && this.request.socket.remoteAddress) {
      return this.request.socket.remoteAddress;
    }
    return null;
  }

  getFullUrl(request: http.IncomingMessage | http2.Http2ServerRequest) {
    const myurl = `://${this.host}${request.url}`;
    // proxy mode
    if (this.headers && this.headers["x-forwarded-for"]) {
      return `${this.headers["x-forwarded-proto"]}${myurl}`;
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
