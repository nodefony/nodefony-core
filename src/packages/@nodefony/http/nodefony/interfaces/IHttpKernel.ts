import type { IServerKernel, MaybePromise } from "nodefony";
import type { ServerType } from "./IContext";

export interface IHttpKernel extends IServerKernel {
  domain: string;
  httpPort?: number | undefined;
  httpsPort?: number | undefined;

  /**
   * Pipeline public d'une requête (appelé par les serveurs HTTP/HTTPS).
   *
   * @returns le contexte servi, ou sa promesse dès qu'une étape attend.
   */
  handle(
    request: unknown,
    response: unknown,
    type: ServerType,
  ): MaybePromise<unknown>;

  // context typed as object: implementation uses ContextType (WebsocketContext | HttpContext | Context)
  handleFrontController(
    context: object,
    checkFirewall?: boolean,
  ): Promise<unknown>;

  // error: unknown covers Error | HttpError | nodefonyError
  // extraHeaders: object covers Record<string,any> | Record<string,unknown>
  // return typed as object to avoid requiring IHttpContext | IWebsocketContext assignability
  onError(
    error: unknown,
    context?: object,
    extraHeaders?: object,
  ): Promise<object>;

  // context typed as object (same reason as handleFrontController)
  isValidDomain(context: object): boolean;
}
