import {
  ServerType,
  //httpRequest,
  //httpResponse,
  SchemeType,
} from "../../../service/http-kernel";
import HttpError from "../../errors/httpError";
import { sanitizeRequestId } from "../requestId";
import Context, {
  //contextRequest,
  //contextResponse,
  HTTPMethod,
} from "../Context";
import {
  extend,
  Container,
  typeOf,
  Scope,
  //Service,
  //Severity,
  //Msgid,
  //Message,
  //Pdu,
  //KernelEventsType,
} from "nodefony";
import { Csrf } from "@nodefony/security";
import HttpRequest from "./Request";
import HttpResponse from "./Response";
import Http2Request from "../http2/Request";
import Http2Response from "../http2/Response";
import http2 from "node:http2";
import http from "node:http";
import url, { URL } from "node:url";
import Session from "../../../src/session/session";
import Cookie from "../../cookies/cookie";

//import { Resolver } from "@nodefony/framework";
import uploadService from "../../../service/upload/upload-service";

/**
 * Métadonnées de topologie de proxy (en-têtes `X-Forwarded-*`), renseignées
 * seulement derrière un proxy de confiance.
 *
 * ⚠️ RFC 7239 §8.2 (Information Leak) — DONNÉES INTERNES : ne JAMAIS recopier
 * dans une réponse HTTP ni sérialiser en metaData exposée au client (révélerait
 * la chaîne de proxy et les hôtes/IP internes). Lecture interne uniquement
 * (logs, prédicat « derrière un proxy »).
 */
export interface ProxyType {
  proxyServer?: string;
  proxyProto?: string;
  proxyScheme?: SchemeType;
  proxyPort?: string;
  proxyFor?: string;
  proxyHost?: string;
  proxyUri?: string;
  proxyRealIp?: string;
  proxyVia?: string;
}

export type HttpRequestType = Http2Request | HttpRequest;
export type HttpRsponseType = Http2Response | HttpResponse;

// T3 (profil delta vs Express) — timeout d'inactivité armé UNE fois PAR SOCKET
// (h1 keep-alive), plus par requête : `response.setTimeout` re-payait à CHAQUE
// requête un re-arm de timer + une closure `once` pour une valeur CONSTANTE
// par serveur (`httpKernel.responseTimeout[type]`) — ~2,6 % du profil CPU
// (`setStreamTimeout`). Le handler permanent (1/socket) route vers le context
// ACTIF via WeakMap → la sémantique 408/504 + abort PAR REQUÊTE est intacte.
// Mémoire bornée : ≤ 1 entrée par socket VIVANT (écrasée à chaque requête,
// collectée avec le socket — WeakMap). HTTP/2 : hors de ce chemin (per-stream).
const socketActiveContext = new WeakMap<object, HttpContext>();
const socketTimeoutArmed = new WeakSet<object>();

import type { IHttpContext as IHttpContextInterface } from "../../../interfaces/IContext";

class HttpContext extends Context implements IHttpContextInterface {
  //url: string;
  proxy: ProxyType | null = null;
  isRedirect: boolean = false;
  sended: boolean = false;
  //isHtml: boolean = false;
  override request: HttpRequestType;
  override response: HttpRsponseType;
  uploadService: uploadService | null;
  //resolver: Resolver | null = null;
  csrf?: Csrf;
  constructor(
    container: Container | Scope,
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
    type: ServerType,
  ) {
    super(container, type);
    this.uploadService = this.get<uploadService>("upload");
    if (this.type === "http2") {
      this.request = new Http2Request(
        request as http2.Http2ServerRequest,
        this,
      );
      this.response = new Http2Response(
        response as http2.Http2ServerResponse,
        this,
      );
    } else {
      this.request = new HttpRequest(request as http.IncomingMessage, this);
      this.response = new HttpResponse(response as http.ServerResponse, this);
    }
    //this.router = this.get("router");
    this.url = url.format(this.request.url);
    this.scheme = this.setScheme();
    this.method = this.request.getMethod();
    this.remoteAddress = this.request.remoteAddress;
    this.originUrl = new URL(this.request.origin || this.url);
    // Détection proxy — uniquement derrière un proxy de CONFIANCE (sinon les
    // X-Forwarded-* sont forgeables → IP/scheme spoofing ; cf trustProxy).
    // `this.proxy` = métadonnées de topologie INTERNE (noms/IP de serveurs
    // internes, port, chaîne `via`…).
    //
    // ⚠️ RFC 7239 §8.2 (Information Leak) : ces données ne doivent JAMAIS être
    // recopiées dans une réponse (révéleraient toute la chaîne de proxy au
    // client) ni exposées en metaData. Usage INTERNE seul : log DEBUG + prédicat
    // « derrière un proxy ? » (redirectHttp/redirectHttps).
    //
    // On ne détourne PAS `this.type` (le TRANSPORT réel) avec X-Forwarded-Proto :
    // le scheme client effectif est déjà porté par `this.scheme` (setScheme ←
    // request.url.protocol ← getFullUrl, qui honore X-Forwarded-Proto si trusted).
    // L'écraser corrompait l'identité du transport (this.type ≠ this.server) et
    // pouvait casser les `switch (context.type)` (cookie/Resolver) sur une valeur
    // client arbitraire.
    this.proxy = null;
    // Résolution forwarded canonique calculée par Request (RFC 7239 `Forwarded`
    // prioritaire, repli `X-Forwarded-*`) — déjà gated proxy de confiance.
    // proto/for/host viennent de la résolution unifiée ; les champs de-facto
    // (server/port/via/realIp/uri/scheme) restent lus bruts.
    const fwd = this.request.forwarded;
    if (fwd) {
      this.proxy = {
        proxyServer: <string>request.headers["x-forwarded-server"] || "unknown",
        proxyProto: fwd.proto ?? <string>request.headers["x-forwarded-proto"],
        proxyScheme: <SchemeType>request.headers["x-forwarded-scheme"],
        proxyPort: <string>request.headers["x-forwarded-port"],
        proxyFor:
          fwd.forwardedFor ?? <string>request.headers["x-forwarded-for"],
        proxyHost: fwd.host ?? <string>request.headers["x-forwarded-host"],
        proxyUri: <string>request.headers["x-original-uri"],
        proxyRealIp: <string>request.headers["x-real-ip"],
        proxyVia: <string>request.headers.via || "unknown",
      };
      this.log(
        `PROXY REQUEST ${fwd.fromStandard ? "Forwarded (RFC 7239)" : "x-forwarded"} VIA : ${this.proxy.proxyVia}`,
        "DEBUG",
      );
    }
    this.isHtml = this.request.acceptHtml;
    // Zero Trust : le X-Request-Id client est réfléchi en réponse + logué + en
    // ALS → on n'adopte que s'il est sûr, sinon on garde l'UUID serveur.
    const incomingId = sanitizeRequestId(
      request.headers["x-request-id"] as string | undefined,
    );
    if (incomingId) {
      this.requestId = incomingId;
    }
    //this.setDefaultContentType();
    this.domain = this.getHostName();
    this.validDomain = this.isValidDomain();
    this.parseCookies();
    // Nom effectif selon le transport (`__Host-` sur TLS) — même calcul à
    // l'écriture (session.setCookieSession) → reprise L1 cohérente.
    this.cookieSession = this.getCookieSession(this.getSessionCookieName());
  }

  /**
   * Chemin timeout direct — appelé par les handlers socket/stream de
   * `setTimeout()`. T4 : remplace l'ancien `once("onTimeout")` posé au ctor
   * (1 onceWrapper node + 1 closure alloués à CHAQUE requête pour un event
   * qui ne fire presque jamais). L'event `onTimeout` reste émis pour
   * d'éventuels listeners externes — guard 0-listener : 0 alloc sinon.
   */
  _onTimeout(): void {
    if (this.listenerCount("onTimeout")) {
      this.fire("onTimeout", this);
    }
    // P2.5 — abort in-flight async work (DB queries, fetches honoring
    // `ctx.signal`) BEFORE rendering the timeout error, so a slow/hung
    // controller stops producing a response the client will never receive.
    // No-op if nobody read `signal` (cold path, zero overhead otherwise).
    this._abortIfPending("Request timeout");
    let error = null;
    if ((this.response as Http2Response).stream) {
      // traff 408 reload page htpp2 loop
      error = new HttpError("Gateway Timeout", 504, this);
    } else {
      error = new HttpError("Request Timeout", 408, this);
    }
    void this.httpKernel?.onError(error, this);
  }

  override setScheme(): SchemeType {
    return this.request.url.protocol.replace(":", "") as SchemeType;
  }

  // P7 — fonction async directe (plus de `new Promise(async executor)` : un
  // throw de l'executor y était avalé par le constructeur Promise → rejet
  // silencieux/pendu selon le timing).
  async handle(/*data*/): Promise<this> {
    this.setTimeout();
    if (this.isRedirect) {
      await this.send();
      return this;
    }
    // NB perf : pas de `setParameters("query.*")` ici. Les décorateurs
    // @Query/@Param/@Body lisent `ctx.request.queryGet/queryPost/queryFile`
    // DIRECTEMENT (cf framework routerDecorators) ; peupler le scope DI avec
    // ces clés (4 parses + insertions/req) n'était lu par PERSONNE — héritage
    // JS mort, retiré (~+3 % RPS sur route sans query). Cf metaData per-requête.
    //this.locale = this.translation.handle();
    // WARNING EVENT KERNEL
    this.fire("onRequest", this);
    this.kernel?.fire("onRequest", this);
    if (!this.resolver && this.router) {
      this.resolver = this.router.resolve(this);
    }
    if (this.resolver && this.resolver.resolve) {
      this.setMetaData();
      const ret = await this.resolver.callController();
      return ret as this;
    }
    throw new HttpError("", 404, this);
  }

  setTimeout(): void {
    const res = this.response.response;
    if (!res) {
      return;
    }
    if ((this.response as Http2Response).stream) {
      // HTTP/2 : 1 stream = 1 requête (multiplexé) → le timeout PER-STREAM est
      // la bonne granularité (un timeout socket couvrirait N requêtes
      // concurrentes). Comportement historique conservé.
      res.setTimeout(this.response.timeout as number, () => {
        if (!this.response?.response?.writableEnded) {
          this._onTimeout();
        }
      });
      return;
    }
    // h1 (+ h1 sur TLS) — T3 : router le context actif, handler armé 1 fois.
    const socket = (res as http.ServerResponse).socket;
    if (!socket) {
      return;
    }
    socketActiveContext.set(socket, this);
    // ⚠️ Re-arm CONDITIONNEL par requête (pas « 1× par socket ») : node
    // lui-même ré-arme le socket aux transitions keep-alive (`server.timeout`
    // 120 s à la requête, `keepAliveTimeout` 5 s à l'idle) → un arm unique
    // serait ÉCRASÉ dès la requête 2 (timeout effectif 120 s au lieu de 30 s).
    // Le check `socket.timeout !== ms` ne ré-arme que si node a écrasé — et
    // devient 0 arm/req si `server.timeout` est aligné sur `responseTimeout`.
    const ms = this.response.timeout as number;
    if (socket.timeout !== ms) {
      socket.setTimeout(ms);
    }
    if (!socketTimeoutArmed.has(socket)) {
      socketTimeoutArmed.add(socket);
      // `on` (PAS `once`, et UNE closure par socket — plus une par requête) :
      // le handler survit aux fires no-op (idle keep-alive) et route toujours
      // vers le context ACTIF du socket.
      socket.on("timeout", () => {
        const ctx = socketActiveContext.get(socket);
        if (ctx && !ctx.response?.response?.writableEnded) {
          ctx._onTimeout();
        }
        // Socket idle SANS requête active : no-op (comportement historique du
        // 1er fire) — `keepAliveTimeout` du serveur ferme l'idle par ailleurs.
      });
    }
  }

  async render(
    chunk: any,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>,
  ): Promise<
    //http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
    Http2Response | HttpResponse
  > {
    let data = chunk;
    switch (true) {
      case this.isJson:
        data = JSON.stringify(chunk);
        break;
      case this.isHtml:
      default:
        const type = typeOf(chunk);
        switch (type) {
          case "object":
            this.setContextJson();
            data = JSON.stringify(chunk);
            break;
          case "string":
            if (this.response.contentType === "application/octet-stream") {
              this.setContextHtml();
            }
            break;
          default:
            if (this.response.contentType === "application/octet-stream") {
              this.response.setContentType("text");
            }
        }
    }
    if (headers) {
      this.response.setHeaders(headers);
    }
    if (status) {
      this.response.setStatusCode(status);
    }
    return this.send(data, encoding);
  }

  async end(): Promise<
    //http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
    Http2Response | HttpResponse
  > {
    return this.saveSession().then(async (_session: Session | null) => {
      return this.close().catch((e) => {
        throw e;
      });
    });
  }

  async send(
    chunk?: any,
    encoding?: BufferEncoding,
  ): Promise<
    //http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
    Http2Response | HttpResponse
  > {
    // Client closed the socket while the controller was still running.
    // `teardown()` (http-kernel.createHttpContext) flipped `finished` before
    // the controller's catch block could call `renderJson(...)`. Nothing can
    // be written anymore — silent DEBUG no-op instead of CRITIC noise.
    if (this.finished && !this.sended) {
      this.log("send() on finished context — client disconnected", "DEBUG");
      return this.response;
    }
    if (this.sended || this.finished || this.response.isHeaderSent()) {
      return new Promise((_resolve, reject) => {
        return reject(new Error("Response Already sended"));
      });
    }
    // Phase `send` — l'envoi n'est PAS gratuit : il porte `saveSession()` (écriture
    // du store : SQLite/Redis — de loin le premier poste d'une requête authentifiée),
    // le hook `onSend`, le `writeHead` et le `write`. Sans elle, le waterfall
    // s'arrêtait à la fin de l'action et ce temps-là n'était imputé à personne.
    // Timing éteint (production) → chemin nominal STRICTEMENT inchangé : pas de
    // `try/finally` autour de la chaîne (une microtask de plus par requête).
    if (!this.timingEnabled) return this.#doSend(chunk, encoding);
    this.phaseStart("send");
    try {
      return await this.#doSend(chunk, encoding);
    } finally {
      this.phaseEnd("send");
    }
  }

  #doSend(
    chunk?: any,
    encoding?: BufferEncoding,
  ): Promise<Http2Response | HttpResponse> {
    return this.saveSession()
      .then(async (_session: Session | null) => {
        // if (session) {
        //   //this.log(`SAVE SESSION ID : ${session.id}`, "DEBUG");
        // }
        if (chunk) {
          this.response?.setBody(chunk);
        }
        await this.fireAsync("onSend", this.response, this);
        try {
          this.writeHead();
        } catch (e) {
          this.log(e, "WARNING");
        }
        if (this.isRedirect) {
          return this.close().catch((e) => {
            throw e;
          });
        }
        return this.write(chunk, encoding).catch((e) => {
          throw e;
        });
      })
      .catch(async (error) => {
        this.log(error, "ERROR");
        // try {
        //   if (!this.response.isHeaderSent()) {
        //     this.writeHead(error.code || 500);
        //     await this.write(error.message, encoding).catch((e) => {
        //       throw e;
        //     });
        //   } else {
        //     return this.close().catch((e) => {
        //       throw e;
        //     });
        //   }
        // } catch {}
        throw error;
      });
  }

  writeHead(
    statusCode?: number,
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
  ) {
    // cookies
    if (this.response) {
      // Synchronizer CSRF (`@CsrfProtect`) : le firewall a posé `csrfToken` sur une
      // requête sûre vers une route protégée → on pose le cookie LISIBLE `csrf-token`
      // (SameSite=Strict, non HttpOnly : le SPA le lit + le rejoue dans `x-csrf-token`).
      // Secure sur HTTPS. La pose vit ici (http possède `Cookie`) ; security ne fait
      // que minter le token. Flush groupé avec le cookie de session (setCookies array).
      if (this.csrfToken) {
        this.setCookie(
          new Cookie("csrf-token", this.csrfToken, {
            httpOnly: false,
            sameSite: "Strict",
            secure: this.scheme === "https",
            path: "/",
          }),
        );
      }
      this.response.setCookies();
      this.response.writeHead(statusCode, headers);
    }
  }

  async write(
    chunk: any,
    encoding?: BufferEncoding,
    _flush: boolean = false,
  ): Promise<
    //http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
    Http2Response | HttpResponse
  > {
    await this.response
      .send(chunk, encoding || this.response.encoding)
      .then(() => {
        this.sended = true;
      })
      .catch((e: Error) => {
        throw e;
      });
    // END REQUEST
    return this.close().catch((e) => {
      throw e;
    });
  }

  flush(chunk: any, encoding: BufferEncoding) {
    return this.response.flush(chunk, encoding);
  }

  async close(): Promise<
    //http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
    Http2Response | HttpResponse
  > {
    await this.fireAsync("onClose", this);
    // END REQUEST
    return this.response
      .end()
      .then(() => this.response)
      .catch((e) => {
        throw e;
      });
  }

  redirect(
    Url: string,
    status?: number | string,
    headers?: Record<string, string | number>,
  ) {
    if (typeof Url === "object") {
      return this.response.redirect(url.format(Url), status, headers);
    }
    return this.response.redirect(Url, status, headers);
  }

  redirectHttps(
    status?: number | string,
    headers?: Record<string, string | number>,
  ) {
    if (this.session) {
      //this.session.setFlashBag("redirect", "HTTPS");
    }
    let urlExtend = null;
    if (this.proxy) {
      urlExtend = {
        protocol: "https",
        href: "",
        host: "",
      };
    } else {
      urlExtend = {
        protocol: "https",
        port: this.httpKernel?.httpsPort || 443,
        href: "",
        host: "",
      };
    }
    const urlChange = extend({}, this.request.url, urlExtend);
    const newUrl = url.format(urlChange);
    return this.redirect(newUrl, status, headers);
  }

  redirectHttp(
    status?: number | string,
    headers?: Record<string, string | number>,
  ) {
    if (this.session) {
      //this.session.setFlashBag("redirect", "HTTP");
    }
    let urlExtend = null;
    if (this.proxy) {
      urlExtend = {
        protocol: "http",
        href: "",
        host: "",
      };
    } else {
      urlExtend = {
        protocol: "http",
        port: this.httpKernel?.httpPort || 80,
        href: "",
        host: "",
      };
    }
    const urlChange = extend({}, this.request.url, urlExtend);
    const newUrl = url.format(urlChange);
    return this.redirect(newUrl, status, headers);
  }

  getHostName(): string {
    return this.request?.getHostName();
  }

  getRemoteAddress(): string | null {
    return this.request?.getRemoteAddress();
  }

  getHost(): string | undefined {
    return this.request?.getHost();
  }

  getUserAgent(): string | undefined {
    return this.request?.getUserAgent();
  }

  getMethod(): HTTPMethod {
    return this.request?.getMethod();
  }

  setContentType(type?: string, encoding?: BufferEncoding) {
    return this.response.setContentType(type, encoding);
  }

  setDefaultContentType() {
    if (this.isHtml) {
      this.response.setContentType("html", "utf-8");
    } else if (this.request.accepts("json")) {
      this.isJson = true;
      this.response.setContentType("json", "utf-8");
    }
  }
  override setContextJson(encoding: BufferEncoding = "utf-8"): void {
    this.isJson = true;
    this.isHtml = false;
    this.response.setContentType("json", encoding);
  }
  override setContextHtml(encoding: BufferEncoding = "utf-8"): void {
    this.isHtml = true;
    this.isJson = false;
    this.response.setContentType("html", encoding);
  }
}

export default HttpContext;
