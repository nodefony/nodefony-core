/// <reference types="node" />
import type {
  IErrorRenderer,
  IErrorHttpResult,
  IErrorWebsocketResult,
} from "../interfaces/IErrorRenderer";
import type { IHttpContext, IWebsocketContext } from "../interfaces/IContext";
import HttpError from "../src/errors/httpError";
import { nodefonyError } from "nodefony";

/**
 * Default Nodefony error renderer — preserves the legacy JSON error shape.
 *
 * HTTP body (unchanged across the migration):
 *   {
 *     code:    <http status>,
 *     message: <error message>,
 *     error:   <HttpError.toJSON() — stack, controller, action, jsonResponse...>,
 *     nodefony: { requestId, scheme, name, version, environment, debug, ... },
 *     result:  null,
 *   }
 *
 * WS close frame:
 *   code:   clamped to WS range (1000-4999), 1011 if HTTP-style code, 500→1011
 *   reason: error.message
 *
 * Stateless singleton — zero per-request allocation. Override via
 * `httpKernel.setErrorRenderer(custom)` for prod hardening or RFC 7807.
 */
class DefaultErrorRenderer implements IErrorRenderer {
  renderHttp(error: Error, context: IHttpContext): IErrorHttpResult {
    const httpError = this.toHttpError(error, context);
    const status = this.normalizeHttpStatus(httpError.code as number | undefined);
    httpError.code = status;

    // Mutate context.metaData like the legacy onError did — the test contract
    // expects nodefony.* fields to be present alongside error/code/message.
    const obj = (context as unknown as { metaData: Record<string, unknown> }).metaData;
    obj.error = (httpError as nodefonyError).toJSON() as Error;
    obj.code = status;
    obj.message = httpError.message;

    return {
      status,
      message: httpError.message,
      body: obj,
    };
  }

  renderWebsocket(error: Error, context: IWebsocketContext): IErrorWebsocketResult {
    const httpError = this.toHttpError(error, context);
    // Reject phase (no WS connection yet): caller uses HTTP-style status.
    // Connected phase: caller uses WS close code. Both clamped here.
    let code = (httpError.code as number) ?? 500;
    if (context && (context as unknown as { rejected?: boolean }).rejected === false) {
      // Already connected — must be a WS code (1000-4999).
      if (code < 1000) code = 1011; // Internal Server Error
      if (code > 4999) code = 1011;
    } else {
      // Reject phase still uses HTTP-style; clamp to 4xx/5xx.
      if (code > 599) code = 500;
    }
    return { code, reason: httpError.message };
  }

  private toHttpError(error: Error, context: IHttpContext | IWebsocketContext): HttpError {
    if (error instanceof HttpError) return error;
    const code = (error as { code?: number }).code;
    return new HttpError(error, code as number, context as unknown as undefined);
  }

  private normalizeHttpStatus(code: number | undefined): number {
    if (code === 200) return 500; // legacy quirk preserved
    if (!code) return 500;
    return code;
  }
}

export default DefaultErrorRenderer;
