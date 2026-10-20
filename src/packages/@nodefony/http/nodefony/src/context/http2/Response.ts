import http2 from "node:http2";
import { thenMaybe } from "nodefony";
import type { MaybePromise } from "nodefony";
import http from "node:http";
import HttpContext from "../http/HttpContext";
import HttpResponse from "../http/Response";
//import { httpResponse } from "../../../service/http-kernel";

//const HTTP2_HEADER_PATH = http2.constants.HTTP2_HEADER_PATH;
//const HTTP2_HEADER_LINK = http2.constants.HTTP2_HEADER_LINK;
const HTTP2_HEADER_STATUS = http2.constants.HTTP2_HEADER_STATUS;
//const HTTP2_HEADER_CONTENT_TYPE = http2.constants.HTTP2_HEADER_CONTENT_TYPE;

/** Ce que la fusion lit d'une réponse Node : ses en-têtes posés, nom par nom. */
interface IHeaderSource {
  getHeaderNames(): string[];
  getHeader(name: string): http.OutgoingHttpHeader | undefined;
}

/** Réponse Node déjà libérée : aucun en-tête posé à reprendre. */
const emptyHeaders: IHeaderSource = {
  getHeaderNames: () => [],
  getHeader: () => undefined,
};

/**
 * Compose les en-têtes d'une réponse HTTP/2 : ceux posés sur la réponse, puis
 * ceux passés à `writeHead`, qui gagnent.
 *
 * Les clés sont ramenées en MINUSCULES : `getHeaders()` rend `content-type`,
 * un contrôleur passe `Content-Type` — fusionnées telles quelles, les deux
 * clés partaient ensemble et `stream.respond()` refusait la réponse
 * (`ERR_HTTP2_HEADER_SINGLE_VALUE`), soit une 500 sur tout média servi en
 * HTTP/2. HTTP/2 n'a de toute façon que des noms en minuscules (RFC 9113 §8.2.1).
 *
 * Les en-têtes posés se lisent nom par nom (`getHeaderNames`, déjà en
 * minuscules) : `getHeaders()` les recopiait d'abord dans un objet sans
 * prototype, avant cette fusion — 3,8 µs par réponse pour 12 en-têtes,
 * contre 1,1 µs en une passe.
 *
 * @param statusMessage - message de statut, recopié en `x-status-message`
 * @param current - la réponse Node qui porte les en-têtes déjà posés
 * @param extra - en-têtes passés à `writeHead` (objet, ou liste plate clé/valeur)
 * @returns les en-têtes à transmettre à `respond()`
 */
export function mergeResponseHeaders(
  statusMessage: string,
  current: IHeaderSource,
  extra?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
): http.OutgoingHttpHeaders {
  const merged: http.OutgoingHttpHeaders = {
    "x-status-message": statusMessage,
  };
  for (const name of current.getHeaderNames()) {
    merged[name] = current.getHeader(name);
  }
  if (Array.isArray(extra)) {
    // Forme plate de Node : [clé, valeur, clé, valeur…].
    for (let i = 0; i + 1 < extra.length; i += 2) {
      merged[String(extra[i]).toLowerCase()] = extra[i + 1];
    }
  } else if (extra) {
    for (const key in extra) {
      const value = extra[key];
      if (value !== undefined) merged[key.toLowerCase()] = value;
    }
  }
  return merged;
}

class Http2Response extends HttpResponse {
  override statusCode: number = 200;
  stream: http2.ServerHttp2Stream | null = null;
  streamId?: number | undefined;
  constructor(response: http2.Http2ServerResponse, context: HttpContext) {
    super(response, context);
    this.stream = response.stream;
    this.streamId = this.stream.id;
    if (this.stream.pushAllowed) {
      this.context.pushAllowed = true;
    }
  }

  override isHeaderSent(): boolean {
    if (this.stream) {
      return this.stream.headersSent;
    }
    return super.isHeaderSent();
  }

  override writeHead(
    statusCode?: number,
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
  ): void {
    if (this.stream) {
      if (statusCode) {
        this.setStatusCode(statusCode);
      }
      // Stream HTTP/2 fermé/détruit (client abandonné, réponse lente, timeout) :
      // ne pas appeler respond() → évite ERR_HTTP2_INVALID_STREAM.
      if (this.stream.destroyed || this.stream.closed) {
        this.log("HTTP/2 stream destroyed before writeHead — skip", "DEBUG");
        return;
      }
      if (!this.stream.headersSent) {
        if (this.statusCode) {
          if (typeof this.statusCode === "string") {
            this.statusCode = parseInt(this.statusCode, 10);
          }
          if (this.statusCode > 599) {
            this.statusCode = 500;
          }
        }
        this.statusMessage = this.getStatusMessage();
        this.setLength();
        this.ensureContentTypeHeader();
        this.headers = mergeResponseHeaders(
          this.statusMessage,
          this.response ?? emptyHeaders,
          headers,
        );
        this.headers[HTTP2_HEADER_STATUS] = this.statusCode;
        // Request tracing — le chemin stream HTTP/2 bypasse super.writeHead
        // (http/Response.ts), donc on pose ICI les headers de corrélation,
        // sinon les réponses HTTP/2 (port 5152) n'ont NI x-request-id NI
        // traceparent → la debug bar / profiler ne peut pas corréler.
        const requestId = (this.context as { requestId?: string }).requestId;
        if (requestId) this.headers["x-request-id"] = requestId;
        const traceparent = (this.context as { traceparent?: string | null })
          .traceparent;
        if (traceparent) this.headers["traceparent"] = traceparent;
        this.stream.respond(this.headers, {
          endStream: false,
        });
      } else {
        // throw new Error("Headers already sent !!");
        this.log("Headers already sent !!", "WARNING");
      }
    } else {
      return super.writeHead(statusCode, headers);
    }
  }

  /**
   * Écrit le corps sur le flux HTTP/2 et, pour une réponse unique, le termine
   * d'un seul `end(corps)`. Synchrone, sauf en streaming (`flush()`) : une
   * promesse réglée par le rappel d'écriture, la contre-pression (#505).
   *
   * @returns la réponse, ou sa promesse.
   */
  override send(
    chunk?: unknown,
    encoding?: BufferEncoding,
    _flush: boolean = false,
  ): MaybePromise<Http2Response> {
    if (this.context.isRedirect) {
      if (this.stream && !this.stream.headersSent) {
        this.writeHead();
      }
      return thenMaybe(this.end(), () => this);
    }
    const stream = this.stream;
    if (!stream) {
      return super.send(chunk, encoding) as MaybePromise<Http2Response>;
    }
    // Stream fermé/non-writable (client abandonné, write-after-end) :
    // résoudre sans écrire → évite ERR_STREAM_WRITE_AFTER_END (CRITIC).
    if (stream.destroyed || !stream.writable) {
      this.log("HTTP/2 stream not writable before send — skip", "DEBUG");
      return this;
    }
    if (chunk) {
      this.setBody(chunk);
    }
    // Corps VIDE légal (cf chemin HTTP/1) : `payload` rend un vide plutôt que
    // `null` — `stream.write(null)` jetterait ERR_STREAM_NULL_VALUES.
    // Réponse UNIQUE : `end(corps)` d'un seul appel, comme le chemin HTTP/1.
    // `write` puis `end()` à vide coûtait l'attente du rappel d'écriture (un
    // tour de boucle) et une trame DATA vide de plus pour porter END_STREAM.
    // Le streaming (`flush()`) garde `write` et son rappel : la contre-pression.
    if (!_flush && !this.flushing) {
      stream.end(this.payload, this.payloadEncoding);
      return this;
    }
    return new Promise((resolve, reject) => {
      stream.write(this.payload, this.payloadEncoding, (error) => {
        if (error) {
          return reject(error);
        }
        return resolve(this);
      });
    });
  }

  /**
   * Termine le flux HTTP/2 (ou la réponse de repli) — synchrone (#505).
   *
   * @returns le flux terminé.
   * @throws de façon SYNCHRONE ce que lève la fin du flux.
   */
  override end(
    chunk?: string | Buffer,
    encoding?: BufferEncoding,
  ): MaybePromise<http.ServerResponse | http2.ServerHttp2Stream> {
    if (this.stream) {
      // Flux déjà terminé par `send()`, fermé ou détruit : ne pas re-appeler end().
      if (
        this.stream.writableEnded ||
        this.stream.destroyed ||
        this.stream.closed
      ) {
        return this.stream;
      }
      return this.stream.end(chunk, encoding || this.encoding);
    }
    return super.end(chunk, encoding);
  }

  override getStatusMessage(code?: number | string): string {
    if (code) {
      if (this.response) {
        return (http.STATUS_CODES[code] as string) || this.statusMessage;
      }
    }
    if (this.response) {
      return (
        this.statusMessage || (http.STATUS_CODES[this.statusCode] as string)
      );
    }
    return this.statusMessage || (http.STATUS_CODES[this.statusCode] as string);
  }

  override getStatus(): { code: number; message: string } {
    return {
      code: this.getStatusCode(),
      message: "",
    };
  }

  // push(ele, headers, options) {
  //   return new Promise((resolve, reject) => {
  //     try {
  //       if (this.stream && this.stream.pushAllowed) {
  //         const file = new nodefony.fileClass(ele);
  //         const myheaders = nodefony.extend(
  //           {
  //             "content-length": file.stats.size,
  //             "last-modified": file.stats.mtime.toUTCString(),
  //             "Content-Type": file.mimeType || "application/octet-stream",
  //           },
  //           headers
  //         );
  //         return this.stream.pushStream(
  //           {
  //             [HTTP2_HEADER_PATH]: myheaders.path,
  //           },
  //           {
  //             exclusive: true,
  //             parent: this.streamId,
  //           },
  //           (err, pushStream /* , headers*/) => {
  //             if (err) {
  //               return reject(err);
  //             }
  //             pushStream.on("error", (err) => {
  //               this.log(err, "ERROR", "HTTP2 push stream");
  //               switch (err.code) {
  //                 case "ENOENT":
  //                   pushStream.respond({
  //                     ":status": 404,
  //                   });
  //                   break;
  //                 case "ERR_HTTP2_STREAM_ERROR":
  //                   return;
  //                 default:
  //                   pushStream.respond({
  //                     ":status": 500,
  //                   });
  //               }
  //               return reject(err);
  //             });
  //             pushStream.on("close", () => {
  //               this.log("Push Stream Closed", "DEBUG", "HTTP2 push stream");
  //             });
  //             const myOptions = nodefony.extend(
  //               {
  //                 onError: (err) => {
  //                   this.log(err, "ERROR", "HTTP2 push stream");
  //                   if (err.code === "ENOENT") {
  //                     pushStream.respond({
  //                       ":status": 404,
  //                     });
  //                   } else {
  //                     pushStream.respond({
  //                       ":status": 500,
  //                     });
  //                   }
  //                   // pushStream.end();
  //                   return reject(err);
  //                 },
  //               },
  //               options
  //             );
  //             try {
  //               this.log(`>> Pushing : ${file.path}`, "DEBUG", "HTTP2 Pushing");
  //               pushStream.respondWithFile(file.path, myheaders, myOptions);
  //               return resolve(pushStream);
  //             } catch (e) {
  //               return reject(e);
  //             }
  //           }
  //         );
  //       }
  //       const warn = new Error("HTTP/2 client has disabled push streams !! ");
  //       this.log(warn.message, "DEBUG");
  //       return reject(warn);
  //     } catch (e) {
  //       return reject(e);
  //     }
  //   });
  // }
}

export default Http2Response;
