import http2 from "node:http2";
import http from "node:http";
import HttpContext from "../http/HttpContext";
import HttpResponse from "../http/Response";
import { extend } from "nodefony";
//import { httpResponse } from "../../../service/http-kernel";

//const HTTP2_HEADER_PATH = http2.constants.HTTP2_HEADER_PATH;
//const HTTP2_HEADER_LINK = http2.constants.HTTP2_HEADER_LINK;
const HTTP2_HEADER_STATUS = http2.constants.HTTP2_HEADER_STATUS;
//const HTTP2_HEADER_CONTENT_TYPE = http2.constants.HTTP2_HEADER_CONTENT_TYPE;

class Http2Response extends HttpResponse {
  override statusCode: number = 200;
  stream: http2.ServerHttp2Stream | null = null;
  streamId?: number | undefined;
  constructor(response: http2.Http2ServerResponse, context: HttpContext) {
    super(response, context);
    if (response) {
      this.stream = response.stream;
      this.streamId = this.stream.id;
    }
    if (this.stream && this.stream.pushAllowed) {
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
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[]
  ): void {
    if (this.stream) {
      if (statusCode) {
        this.setStatusCode(statusCode);
      }
      if (!this.stream.headersSent) {
        try {
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
          this.headers = extend(
            true,
            { "X-Status-Message": this.statusMessage },
            this.getHeaders(),
            headers
          );
          this.headers[HTTP2_HEADER_STATUS] = this.statusCode;
          //console.log("HTTH2 respond", this.headers);
          this.stream.respond(this.headers, {
            endStream: false,
          });
        } catch (e) {
          throw e;
        }
      } else {
        // throw new Error("Headers already sent !!");
        this.log("Headers already sent !!", "WARNING");
      }
    } else {
      return super.writeHead(statusCode, headers);
    }
  }

  override async send(
    chunk: any,
    encoding?: BufferEncoding,
    flush: boolean = false
  ): Promise<Http2Response> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.context.isRedirect) {
          if (this.stream && !this.stream.headersSent) {
            this.writeHead();
            await this.end();
            return resolve(this);
          }
          await this.end();
          return resolve(this);
        }
        if (this.stream) {
          if (chunk) {
            this.setBody(chunk);
          }
          if (!flush) {
            //this.context.displayDebugBar();
          }
          return this.stream.write(
            this.body,
            encoding || this.encoding,
            (error) => {
              if (error) {
                return reject(error);
              }
              return resolve(this);
            }
          );
        }
        return super.send(chunk, encoding);
      } catch (e) {
        return reject(e);
      }
    });
  }

  override end(
    chunk?: any,
    encoding?: BufferEncoding
  ): Promise<http.ServerResponse | http2.ServerHttp2Stream> {
    return new Promise((resolve, reject) => {
      try {
        if (this.stream) {
          this.ended = true;
          return resolve(
            this.stream.end(
              chunk,
              encoding || this.encoding
            ) as http2.ServerHttp2Stream
          );
        }
        return resolve(super.end(chunk, encoding));
      } catch (e) {
        return reject(e);
      }
    });
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
