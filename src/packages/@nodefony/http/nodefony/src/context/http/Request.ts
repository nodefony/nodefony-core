import http from "node:http";
import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import url, { URL } from "node:url";
import { HTTPMethod } from "../Context";
import QS from "qs";
import Http2Resquest from "../http2/Request";
import formidable, { IncomingForm } from "formidable";
import { Container } from "nodefony";
import { ParserXml, ParserQs, Parser, acceptParser } from "./parser";
import nodefony, { extend, Pdu, Message, Severity, Msgid } from "nodefony";
import Session from "../../session/session";

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
    body: any;
    session: Session;
  }
}

declare module "http2" {
  interface Http2ServerRequest {
    body: any;
    session: Session;
  }
}

type ParserType =
  | ParserXml
  | ParserQs
  | Parser
  | InstanceType<typeof IncomingForm>;

class HttpResquest {
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
  queryPost: Record<string, any> = {};
  queryGet: Record<string, any> = {};
  queryFile: any[] = [];
  query: Record<string, any> = {};
  queryStringOptions:
    | (QS.IParseOptions & {
        decoder?: undefined;
      })
    | undefined;
  charset: BufferEncoding = "utf8";
  formidableOption: formidable.Options = {};
  data: Buffer = Buffer.alloc(0);
  dataSize: number = 0;
  accept: any[] = [];
  acceptHtml: boolean = false;
  origin: string | undefined;
  constructor(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    context: HttpContext
  ) {
    this.context = context;
    this.request = request;
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
      this.url.query = QS.parse(this.url.search, this.queryStringOptions || {});
    } else {
      this.url.query = {};
    }
    this.charset = this.getCharset();
    this.contentType = this.getContentType(this.request);
    this.domain = this.getDomain();
    this.remoteAddress = this.getRemoteAddress();
    try {
      this.accept = acceptParser(this.headers?.accept);
      this.acceptHtml = this.accepts("html");
    } catch (e) {
      this.log(e, "WARNING");
    }

    this.request.on("data", (data) => {
      this.dataSize += data.length;
    });
    this.context.once("onRequestEnd", () => {
      this.request.body = this.query;
    });
    this.initialize();
  }

  async initialize(): Promise<ParserType | null> {
    return this.parseRequest()
      .then((parser) => {
        switch (true) {
          case parser instanceof ParserXml:
          case parser instanceof ParserQs:
          case parser instanceof Parser: {
            this.request.once("end", () => {
              try {
                if (this.context.finished) {
                  return;
                }
                parser.parse();
                return this.context.fireAsync("onRequestEnd", this);
              } catch (error) {
                return this.context?.httpKernel?.onError(
                  error as Error,
                  this.context
                );
              }
            });
            break;
          }
          default: {
            if (!parser) {
              this.request.once("end", () => {
                try {
                  if (this.context.finished) {
                    return;
                  }
                  this.context.requestEnded = true;
                  return this.context.fireAsync("onRequestEnd", this);
                } catch (error) {
                  return this.context.httpKernel?.onError(
                    error as Error,
                    this.context
                  );
                }
              });
            }
          }
        }
        return parser;
      })
      .catch((e) => {
        throw e;
      });
  }

  async parseRequest(): Promise<ParserType | null> {
    return new Promise((resolve, reject) => {
      if (this.method in parse) {
        switch (this.contentType) {
          case "application/xml":
          case "text/xml":
            this.parser = new ParserXml(this);
            return resolve(this.parser as ParserXml);
          case "application/x-www-form-urlencoded":
            try {
              this.parser = new ParserQs(this);
            } catch (e) {
              return reject(e);
            }
            return resolve(this.parser as ParserQs);
          default:
            const parserInst = new Parser(this);
            const opt: formidable.Options = extend(this.formidableOption, {
              encoding: this.charset === "utf8" ? "utf-8" : this.charset,
            });
            this.parser = new IncomingForm(opt);
            this.parser?.parse(
              this.request as http.IncomingMessage,
              async (err, fields, files) => {
                if (err) {
                  this.log(
                    `${err.message || err} use Simple parser`,
                    "WARNING"
                  );
                  switch (err.code) {
                    case 1003:
                    case 1011:
                      try {
                        this.parser = parserInst as Parser;
                      } catch (e) {
                        return reject(e);
                      }
                      return resolve((await this.parser.parse()) as Parser);
                      break;
                    default:
                      console.error(err);
                      err.code = err.httpCode;
                      return reject(err);
                  }
                }
                try {
                  await parserInst.parse();
                  this.queryPost = fields;
                  this.query = nodefony.extend({}, this.query, this.queryPost);
                  if (files && Object.keys(files).length) {
                    for (const file in files) {
                      if (!files[file]) {
                        continue;
                      }
                      const ele:
                        | formidable.File[]
                        | undefined
                        | formidable.Files = files[file];
                      try {
                        if (reg.exec(file)) {
                          if (nodefony.isArray(ele)) {
                            let tab: formidable.File[] =
                              ele as formidable.File[];
                            for (const multifiles in tab) {
                              let ele = tab[multifiles];
                              this.createFileUpload(
                                multifiles,
                                ele,
                                opt.maxFileSize
                              );
                            }
                          }
                          //else if (ele && ele.filepath) {
                          //   this.createFileUpload(file, ele, opt.maxFileSize);
                          // }
                        } else if (nodefony.isArray(ele)) {
                          for (const multifiles in ele) {
                            this.createFileUpload(
                              multifiles,
                              ele[multifiles],
                              opt.maxFileSize
                            );
                          }
                        } else {
                          this.createFileUpload(file, ele, opt.maxFileSize);
                        }
                      } catch (err) {
                        return reject(err);
                      }
                    }
                  }
                } catch (err) {
                  return reject(err);
                }
                this.context.requestEnded = true;
                await this.context.fireAsync("onRequestEnd", this);
                return resolve(
                  this.parser as InstanceType<typeof IncomingForm>
                );
              }
            );
        }
      } else {
        return resolve(this.parser);
      }
    });
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

  createFileUpload(
    name: string,
    file?: formidable.File,
    maxSize?: number
  ): any {
    if (file && maxSize && file.size > maxSize) {
      throw new Error(
        `maxFileSize exceeded, received ${file.size} bytes of file data for : ${file.originalFilename}` ||
          name ||
          file.newFilename
      );
    }
    // const fileUpload = this.context.uploadService.createUploadFile(file, name);
    // const index = this.queryFile.push(fileUpload);
    // this.queryFile[fileUpload.filename] = this.queryFile[index - 1];
    // return fileUpload;
  }

  getMethod(): HTTPMethod {
    return this.request.method as HTTPMethod;
  }

  getContentType(
    request: http.IncomingMessage | http2.Http2ServerRequest
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

  getCharset(): BufferEncoding {
    if (this.rawContentType.charset) {
      return this.rawContentType.charset as BufferEncoding;
    }
    return "utf8";
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

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    if (!msgid) {
      msgid = `${this.context.type} REQUEST `;
    }
    return this.context.log(pci, severity, msgid, msg);
  }
}

export default HttpResquest;
