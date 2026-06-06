import type { ServerType } from "./IContext";

export interface IHttpKernel {
  domain: string;
  httpPort?: number;
  httpsPort?: number;

  // Public request pipeline (called by server-http / server-https)
  handle(
    request: unknown,
    response: unknown,
    type: ServerType,
  ): Promise<unknown>;

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
