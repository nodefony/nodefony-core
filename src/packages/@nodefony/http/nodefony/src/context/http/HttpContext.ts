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
  Container,
  typeOf,
  Scope,
  thenMaybe,
  finallyMaybe,
  isPromise,
  //Service,
  //Severity,
  //Msgid,
  //Message,
  //Pdu,
  //KernelEventsType,
} from "nodefony";
import type { MaybePromise } from "nodefony";
import HttpRequest from "./Request";
import HttpResponse from "./Response";
import Http2Request from "../http2/Request";
import Http2Response from "../http2/Response";
import http2 from "node:http2";
import http from "node:http";
import type { Socket } from "node:net";
import url, { URL } from "node:url";
import Session from "../../../src/session/session";
import Cookie from "../../cookies/cookie";

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
  proxyServer?: string | undefined;
  proxyProto?: string | undefined;
  proxyScheme?: SchemeType | undefined;
  proxyPort?: string | undefined;
  proxyFor?: string | undefined;
  proxyHost?: string | undefined;
  proxyUri?: string | undefined;
  proxyRealIp?: string | undefined;
  proxyVia?: string | undefined;
}

/**
 * Même URL (chemin, requête, hôte) sous un autre schéma et un autre port.
 * `port` absent → port par défaut du schéma (omis de l'URL).
 *
 * @param from - URL de la requête.
 * @param scheme - schéma cible.
 * @param port - port du serveur cible, s'il est connu.
 * @returns l'URL absolue de redirection.
 */
export function switchUrlScheme(
  from: URL,
  scheme: "http" | "https",
  port?: number,
): string {
  const target = new URL(from.href);
  target.protocol = `${scheme}:`;
  target.port = port === undefined ? "" : String(port);
  return target.href;
}

export type HttpRequestType = Http2Request | HttpRequest;
export type HttpRsponseType = Http2Response | HttpResponse;

// T3 (profil delta vs Express) — timeout d'inactivité armé UNE fois PAR SOCKET
// (h1 keep-alive), plus par requête : `response.setTimeout` re-payait à CHAQUE
// requête un re-arm de timer + une closure `once` pour une valeur CONSTANTE
// par serveur (`httpKernel.responseTimeout[type]`) — ~2,6 % du profil CPU
// (`setStreamTimeout`). Le handler permanent (1/socket) route vers le context
// ACTIF via WeakMap → la sémantique 408/504 + abort PAR REQUÊTE est intacte.
// L'entrée est RETIRÉE au nettoyage du contexte (`clean`) : sans cela, une
// connexion persistante INACTIVE gardait le contexte entier de sa dernière
// requête jusqu'à sa fermeture — un contexte par connexion du pool d'un
// répartiteur de charge, en permanence (#561). HTTP/2 : hors de ce chemin
// (per-stream).
const socketActiveContext = new WeakMap<object, HttpContext>();
const socketTimeoutArmed = new WeakSet<object>();

/**
 * Gestionnaire `timeout` PERMANENT d'une socket h1, fabriqué hors de toute
 * méthode : une fermeture créée dans `HttpContext.setTimeout()` partageait
 * l'environnement d'une autre qui lit `this`, et retenait ainsi le contexte de
 * la PREMIÈRE requête de la connexion tant que celle-ci vivait (#561).
 *
 * @param socket - la socket h1 dont on route le délai d'inactivité
 * @returns l'écouteur à attacher une fois par socket
 */
function idleSocketTimeoutHandler(socket: Socket): () => void {
  return () => {
    const ctx = socketActiveContext.get(socket);
    // `cleaned` d'abord : après `clean()`, `response.response` vaut null
    // et le test d'envoi seul prendrait un contexte MORT pour actif.
    if (
      ctx !== undefined &&
      !ctx.cleaned &&
      !ctx.response.response?.writableEnded
    ) {
      ctx._onTimeout();
      return;
    }
    // Socket INACTIF (keep-alive entre deux requêtes) : le fermer ici.
    // Node ne le fait plus lui-même — le serveur passe un callback à
    // `server.setTimeout` (`server-http.ts`, `server-https.ts`), et un
    // écouteur `timeout` côté serveur suspend la destruction automatique.
    // Sans cette fermeture, `keepAliveTimeout` restait lettre morte : la
    // connexion vivait jusqu'à ce que le CLIENT la ferme, en retenant son
    // dernier contexte.
    socket.destroy();
  };
}

// Sonde perf in-situ (cf http-kernel.ts) — flag lu 1× ; éteinte, les
// sous-marques de ce fichier ne coûtent rien (branche morte).
const PERF_PROBE_SUB = process.env.NF_PERF_PROBE === "1";
type PerfSubMarks = { t0: bigint; uploadNs: number; reqResNs: number };

import type { IHttpContext as IHttpContextInterface } from "../../../interfaces/IContext";
import { describeSessionStoreFailure } from "../../session/sessionStoreFailure";
import { responseEnded } from "../responseEnded";
import {
  openSseStream,
  type ISseStreamOptions,
  type SseStream,
} from "./SseStream";

class HttpContext extends Context implements IHttpContextInterface {
  //url: string;
  proxy: ProxyType | null = null;
  // Champs privés TypeScript, pas `#` : des tests fabriquent un contexte sans
  // passer par le constructeur, et un champ `#` y refuse toute écriture.
  /** Socket h1 inscrite dans `socketActiveContext` — retirée par `clean()`. */
  private activeSocket: object | null = null;
  isRedirect: boolean = false;
  sended: boolean = false;
  //isHtml: boolean = false;
  override request: HttpRequestType;
  override response: HttpRsponseType;
  uploadService: uploadService | null;
  //resolver: Resolver | null = null;
  constructor(
    container: Container | Scope,
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
    type: ServerType,
  ) {
    super(container, type);
    this.uploadService = this.get<uploadService>("upload");
    // Sous-marque sonde perf : t0 → après le lookup DI "upload".
    const perfSub = PERF_PROBE_SUB
      ? ((globalThis as unknown as Record<string, unknown>).__nfPerfProbe as
          PerfSubMarks | undefined)
      : undefined;
    if (perfSub && perfSub.t0 !== 0n) {
      perfSub.uploadNs += Number(process.hrtime.bigint() - perfSub.t0);
    }
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
      this.request = new HttpRequest(request, this);
      this.response = new HttpResponse(response, this);
    }
    // Sous-marque sonde perf : t0 → après new Request + new Response.
    if (perfSub && perfSub.t0 !== 0n) {
      perfSub.reqResNs += Number(process.hrtime.bigint() - perfSub.t0);
    }
    //this.router = this.get("router");
    // F-B : `request.href` — la sérialisation SANS construire l'URL (fast-path
    // : sUrl, identique au href par contrat canonique ; bail-out : le vrai
    // href de l'URL déjà parsée).
    this.url = this.request.href;
    this.scheme = this.setScheme();
    this.method = this.request.getMethod();
    this.remoteAddress = this.request.remoteAddress;
    // `originUrl` n'est PLUS construit ici : getter paresseux (plus bas) — ses
    // seuls lecteurs sont les loggers, et `new URL` par requête se payait même
    // logger éteint. Corrige AU PASSAGE un vrai bug : `Origin: null` (RFC 6454,
    // iframe sandboxée/redirect cross-origin) faisait THROW ce constructeur →
    // requête SANS réponse (socket pendu). Le repli = même pattern que le WS.
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
        proxyVia: request.headers.via || "unknown",
      };
      this.log(
        `PROXY REQUEST ${fwd.fromStandard ? "Forwarded (RFC 7239)" : "x-forwarded"} VIA : ${this.proxy.proxyVia}`,
        "DEBUG",
      );
    }
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
   * URL d'origine effective, construite À LA DEMANDE (1ʳᵉ lecture, puis
   * mémoïsée). `Origin` invalide ou `null` (RFC 6454) → repli sur l'URL de la
   * requête, comme le WS — jamais de throw.
   */
  override get originUrl(): URL | undefined | null {
    if (this._originUrl === null) {
      try {
        this._originUrl = new URL(this.request.origin || this.url);
      } catch {
        this._originUrl = new URL(this.url);
      }
    }
    return this._originUrl;
  }
  override set originUrl(value: URL | undefined | null) {
    this._originUrl = value;
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
    // F-B : le scheme effectif est posé par `Request.getFullUrl` (résolution
    // Forwarded/transport) — le lire n'exige plus l'URL. Si l'URL a été
    // construite (bail-out, ex. proto `Forwarded` exotique), sa forme
    // normalisée (lowercase WHATWG) reste la référence, comme avant.
    const req = this.request;
    if (req.hasParsedUrl) {
      return req.url.protocol.replace(":", "") as SchemeType;
    }
    return req.scheme as SchemeType;
  }

  /**
   * Sert la requête : délai de réponse, hooks `onRequest`, puis l'action
   * résolue et son rendu (`resolver.callController()`).
   *
   * Pas `async` : synchrone quand l'action et son rendu le sont, rien n'y est
   * alors attendu (#505).
   *
   * @returns ce que rend `callController()` — le résultat du rendu, pas le
   *   contexte (comportement historique, conservé) —, ou sa promesse. Sur une
   *   redirection déjà posée : le contexte, une fois l'envoi fait.
   * @throws HttpError 404, de façon SYNCHRONE, quand aucune route ne résout.
   */
  handle(/*data*/): MaybePromise<this> {
    this.setTimeout();
    if (this.isRedirect) {
      return thenMaybe(this.send(), () => this);
    }
    // NB perf : pas de copie des paramètres de requête dans le scope DI. Les décorateurs
    // @Query/@Param/@Body lisent `ctx.request.queryGet/queryPost/queryFile`
    // DIRECTEMENT (cf framework routerDecorators) ; peupler le scope DI avec
    // ces clés (4 parses + insertions/req) n'était lu par PERSONNE — héritage
    // JS mort, retiré (~+3 % RPS sur route sans query). Cf metaData per-requête.
    //this.locale = this.translation.handle();
    // WARNING EVENT KERNEL
    this.fire("onRequest", this);
    // `Kernel.fire` journalise en DEBUG avant d'émettre : sans écouteur ni
    // debug, c'est une chaîne formatée et un appel au journal pour rien.
    const kernel = this.kernel;
    if (kernel && (kernel.debug || kernel.listenerCount("onRequest") > 0)) {
      kernel.fire("onRequest", this);
    }
    if (!this.resolver && this.router) {
      this.resolver = this.router.resolve(this);
    }
    if (this.resolver?.resolve) {
      this.setMetaData();
      return this.resolver.callController() as MaybePromise<this>;
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
        // `responseEnded` : sous HTTP/2 la fin se lit sur le FLUX — la réponse
        // de compatibilité reste `writableEnded === false` même terminée.
        if (!responseEnded(res)) {
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
    this.activeSocket = socket;
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
      socket.on("timeout", idleSocketTimeoutHandler(socket));
    }
  }

  /**
   * Nettoie le contexte, et le DÉTACHE de sa socket h1 : la connexion
   * persistante survit à la requête, et l'entrée de `socketActiveContext`
   * retiendrait sinon tout le contexte jusqu'à sa fermeture. Seule l'entrée qui
   * pointe encore sur CE contexte est retirée — une requête suivante sur la
   * même socket a pu la réécrire. Le gestionnaire `timeout` de la socket ne
   * trouve alors rien et prend le chemin « socket inactive → `destroy()` »,
   * celui qu'il prenait déjà pour un contexte nettoyé.
   */
  override clean(): void {
    // Lu sans présumer de l'initialisation (contexte fabriqué hors
    // constructeur dans les tests) : absent ou `null`, rien à détacher.
    const socket = this.activeSocket;
    if (socket) {
      if (socketActiveContext.get(socket) === this) {
        socketActiveContext.delete(socket);
      }
      this.activeSocket = null;
    }
    // Le magasin de la requête est vidé par `Context.clean()`.
    super.clean();
  }

  /**
   * Sérialise la donnée selon son type (JSON, HTML, texte), pose statut et
   * en-têtes, puis l'envoie ({@link send}). Synchrone quand l'envoi l'est (#505).
   *
   * @returns la réponse, ou sa promesse.
   * @throws de façon SYNCHRONE ce que lèvent la sérialisation ou l'envoi.
   */
  render(
    chunk: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>,
  ): MaybePromise<Http2Response | HttpResponse> {
    let data = chunk;
    // JSON déclaré → sérialisé tel quel ; sinon (HTML ou indéterminé) le type
    // de la donnée décide. `if` plutôt qu'un `switch (true)` : même aiguillage.
    if (this.isJson) {
      data = JSON.stringify(chunk);
    } else {
      const type = typeOf(chunk);
      if (type === "object") {
        this.setContextJson();
        data = JSON.stringify(chunk);
      } else if (type === "string") {
        if (this.response.contentType === "application/octet-stream") {
          this.setContextHtml();
        }
      } else if (this.response.contentType === "application/octet-stream") {
        this.response.setContentType("text");
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
    // Même invariant que `send()` : une session qu'on ne sait pas persister ne
    // doit pas empêcher la réponse de partir. Ici les en-têtes sont déjà
    // décidés — on ne peut plus basculer en 500 —, donc on JOURNALISE et on
    // ferme : une réponse servie vaut mieux qu'une socket abandonnée.
    return this.saveSession()
      .catch((e: unknown) => {
        this.log(
          describeSessionStoreFailure(e).message,
          "CRITIC",
          "SESSION-STORE",
        );
        return null;
      })
      .then(async (_session: Session | null) => {
        return this.close();
      });
  }

  /**
   * Envoie la réponse : session sauvée, hook `onSend`, en-têtes, corps, puis
   * fin de la réponse.
   *
   * Synchrone dans le cas nominal — aucune session ouverte, aucun écouteur
   * `onSend`, réponse unique : rien n'y est à attendre (#505). Une promesse
   * seulement quand une étape attend réellement (écriture du store de session,
   * hook asynchrone, streaming chunké, flux HTTP/2).
   *
   * @param chunk - le corps ; absent, le corps déjà posé sur la réponse.
   * @param encoding - l'encodage d'un corps texte.
   * @returns la réponse, ou sa promesse.
   * @throws de façon SYNCHRONE `Response Already sended` quand la réponse est
   *   déjà partie, et ce que lève une étape synchrone de l'envoi.
   */
  send(
    chunk?: unknown,
    encoding?: BufferEncoding,
  ): MaybePromise<Http2Response | HttpResponse> {
    // Client closed the socket while the controller was still running.
    // `teardown()` (http-kernel.createHttpContext) flipped `finished` before
    // the controller's catch block could call `renderJson(...)`. Nothing can
    // be written anymore — silent DEBUG no-op instead of CRITIC noise.
    if (this.finished && !this.sended) {
      this.log("send() on finished context — client disconnected", "DEBUG");
      return this.response;
    }
    if (this.sended || this.finished || this.response.isHeaderSent()) {
      throw new Error("Response Already sended");
    }
    // Phase `send` — l'envoi n'est PAS gratuit : il porte `saveSession()` (écriture
    // du store : SQLite/Redis — de loin le premier poste d'une requête authentifiée),
    // le hook `onSend`, le `writeHead` et le `write`. Sans elle, le waterfall
    // s'arrêtait à la fin de l'action et ce temps-là n'était imputé à personne.
    // Timing éteint (production) → chemin nominal STRICTEMENT inchangé.
    if (!this.timingEnabled) return this.doSend(chunk, encoding);
    this.phaseStart("send");
    return finallyMaybe(
      () => this.doSend(chunk, encoding),
      () => this.phaseEnd("send"),
    );
  }

  /**
   * Le travail de {@link send}, journalisé en ERROR quand il échoue — de façon
   * synchrone ou par rejet, selon l'étape qui échoue.
   */
  private doSend(
    chunk?: unknown,
    encoding?: BufferEncoding,
  ): MaybePromise<Http2Response | HttpResponse> {
    let sent: MaybePromise<Http2Response | HttpResponse>;
    try {
      sent = this.sendSteps(chunk, encoding);
    } catch (error) {
      this.log(error, "ERROR");
      throw error;
    }
    if (!isPromise(sent)) return sent;
    return sent.catch((error: unknown) => {
      this.log(error, "ERROR");
      throw error;
    });
  }

  /** Session, puis hook `onSend`, puis en-têtes et corps — chacun attendu seulement s'il attend. */
  private sendSteps(
    chunk?: unknown,
    encoding?: BufferEncoding,
  ): MaybePromise<Http2Response | HttpResponse> {
    // Sans session démarrée, il n'y a rien à sauver : sauter l'aller-retour
    // service (2 Promises/req sur le chemin anonyme). Le service refait le
    // même check (`sessions-service.ts` saveSession) — lui reste la source
    // de la logique dirty/touch, ici on évite seulement l'appel à vide.
    if (this.session != null) {
      return this.saveSession().then(
        () => this.emitAndWrite(chunk, encoding),
        (e: unknown) => {
          // 🔴 Une requête reçoit TOUJOURS une réponse. La sauvegarde a lieu
          // juste avant `writeHead()` : relancer ici laissait la socket
          // ouverte, et le client attendait son propre délai sans qu'aucun
          // journal ne nomme la cause. C'est le pire mode de défaillance
          // possible pour une application déployée : l'exploitant cherche du
          // côté du réseau.
          const failure = describeSessionStoreFailure(e);
          this.log(failure.message, "CRITIC", "SESSION-STORE");
          this.response.statusCode = failure.statusCode;
          return this.emitAndWrite(failure.body, encoding);
        },
      );
    }
    return this.emitAndWrite(chunk, encoding);
  }

  /** Hook `onSend` (attendu seulement s'il a un écouteur), puis en-têtes et corps. */
  private emitAndWrite(
    body: unknown,
    encoding?: BufferEncoding,
  ): MaybePromise<Http2Response | HttpResponse> {
    // La chaîne vide se pose aussi : un corps VIDE n'est pas un corps absent
    // (flux à venir), et le filet `Content-Type` les distingue (#562).
    if (body || body === "") {
      this.response.setBody(body);
    }
    // Hook utilisateur — aucun listener dans le cas nominal : le check évite
    // l'appel async lui-même (fireAsync + emitAsync = 2 Promises), pas
    // seulement la boucle (déjà court-circuitée dans Event.emitAsync).
    if (this.listenerCount("onSend") > 0) {
      return this.fireAsync("onSend", this.response, this).then(() =>
        this.writeHeadAndBody(body, encoding),
      );
    }
    return this.writeHeadAndBody(body, encoding);
  }

  /** En-têtes, puis corps — ou la seule fin de réponse pour une redirection. */
  private writeHeadAndBody(
    body: unknown,
    encoding?: BufferEncoding,
  ): MaybePromise<Http2Response | HttpResponse> {
    try {
      this.writeHead();
    } catch (e) {
      this.log(e, "WARNING");
    }
    if (this.isRedirect) {
      return this.close();
    }
    return this.write(body, encoding);
  }

  writeHead(
    statusCode?: number,
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
  ) {
    // cookies
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

  /**
   * Écrit le corps, puis termine la requête ({@link close}). Synchrone pour une
   * réponse unique (#505).
   *
   * @returns la réponse, ou sa promesse quand l'écriture attend.
   */
  write(
    chunk: unknown,
    encoding?: BufferEncoding,
    _flush: boolean = false,
  ): MaybePromise<Http2Response | HttpResponse> {
    return thenMaybe(
      this.response.send(chunk, encoding || this.response.encoding),
      () => {
        this.sended = true;
        // END REQUEST
        return this.close();
      },
    );
  }

  /**
   * Répond par un flux d'événements serveur (`text/event-stream`).
   *
   * La requête ne se termine qu'à `close()` du flux, ou au départ du client.
   *
   * @param options - battement de cœur, délai `retry:` initial.
   * @returns le flux, ou sa promesse quand une session est à sauver d'abord.
   * @throws HttpError 500 quand la réponse est déjà partie.
   */
  openSse(options?: ISseStreamOptions): SseStream | Promise<SseStream> {
    return openSseStream(this, options);
  }

  flush(chunk: unknown, encoding: BufferEncoding) {
    return this.response.flush(chunk, encoding);
  }

  /**
   * Termine la requête : hook `onClose`, puis fin de la réponse si l'envoi ne
   * l'a pas déjà faite. Synchrone sans écouteur `onClose` (#505).
   *
   * @returns la réponse, ou sa promesse quand le hook attend.
   */
  close(): MaybePromise<Http2Response | HttpResponse> {
    // Le démontage (écouteur `close` de la réponse Node) a déjà libéré le
    // contexte : sur un chemin qui a attendu (flux chunké, HTTP/2), la réponse
    // a pu se fermer entre l'écriture et ici. Plus rien à terminer — et le
    // centre de notifications, libéré avec le contexte, n'est plus lisible.
    if (this.finished) return this.response;
    // Même garde que `onSend` : hook utilisateur, 0 listener nominal.
    if (this.listenerCount("onClose") > 0) {
      return this.fireAsync("onClose", this).then(() => this.endResponse());
    }
    return this.endResponse();
  }

  /** Fin de la réponse, sauf si l'envoi l'a déjà terminée. */
  private endResponse(): MaybePromise<Http2Response | HttpResponse> {
    // END REQUEST
    // `send()` termine désormais la réponse UNIQUE d'un seul `end(body)` (cf
    // Response.send) : rappeler `end()` ici poserait un second appel sur un flux
    // déjà terminé. Node l'ignore, mais il coûte le tick que le correctif vient
    // d'économiser. Le chemin chunké (`flush()`), lui, n'a pas terminé : il
    // passe toujours par ici.
    if (this.response.response?.writableEnded) return this.response;
    return thenMaybe(this.response.end(), () => this.response);
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

  /**
   * Redirige vers la même URL en HTTPS, sur le port du serveur HTTPS lié —
   * ou le port par défaut derrière un proxy, dont le port public est inconnu.
   *
   * @param status - code de redirection (défaut de `redirect`).
   * @param headers - en-têtes ajoutés à la réponse.
   */
  redirectHttps(
    status?: number | string,
    headers?: Record<string, string | number>,
  ) {
    const port = this.proxy ? undefined : this.httpKernel?.httpsPort;
    return this.redirect(
      switchUrlScheme(this.request.url, "https", port),
      status,
      headers,
    );
  }

  /**
   * Redirige vers la même URL en HTTP, sur le port du serveur HTTP lié — ou
   * le port par défaut derrière un proxy.
   *
   * @param status - code de redirection (défaut de `redirect`).
   * @param headers - en-têtes ajoutés à la réponse.
   */
  redirectHttp(
    status?: number | string,
    headers?: Record<string, string | number>,
  ) {
    const port = this.proxy ? undefined : this.httpKernel?.httpPort;
    return this.redirect(
      switchUrlScheme(this.request.url, "http", port),
      status,
      headers,
    );
  }

  getHostName(): string {
    return this.request.getHostName();
  }

  getRemoteAddress(): string | null {
    return this.request.getRemoteAddress();
  }

  getHost(): string | undefined {
    return this.request.getHost();
  }

  getUserAgent(): string | undefined {
    return this.request.getUserAgent();
  }

  getMethod(): HTTPMethod {
    return this.request.getMethod();
  }

  setContentType(type?: string, encoding?: BufferEncoding) {
    return this.response.setContentType(type, encoding);
  }

  // F-C : `isHtml` se résout contre l'en-tête Accept au PREMIER accès (getter
  // lazy de Context) — le chemin JSON nominal ne parse jamais Accept.
  protected override resolveIsHtml(): boolean {
    return this.request.acceptHtml;
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
