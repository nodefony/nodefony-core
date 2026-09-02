import {
  Service,
  Module,
  Container,
  Event,
  RequestContext,
  //typeOf,
  //EnvironmentType,
  //DebugType,
  //inject,
  FileClass,
} from "nodefony";
import type { IController } from "../interfaces/index.js";
import Route from "./Route";
import Router from "../service/router";
import {
  contextRequest,
  //contextResponse,
  //Context,
  HTTPMethod,
  HttpRequest,
  Http2Request,
  HttpResponse,
  Session,
  ContextType,
  WebsocketContext,
  Http2Response,
  WebsocketResponse,
  //HttpKernel,
  HttpContext,
  HttpError,
} from "@nodefony/http";

//import { runInThisContext } from "node:vm";
import {
  //IncomingMessage,
  //ServerResponse,
  OutgoingHttpHeaders,
} from "node:http";
//import { ServerHttp2Stream } from "node:http2";
import fs, { createReadStream, ReadStream } from "node:fs";
import { promisify } from "node:util";
import Eta from "../service/Eta";
const fsClose = promisify(fs.close);

interface ReadStreamWithFD extends ReadStream {
  fd: number;
}
// Définir les options pour le flux de lecture

type ReadStreamOptions = {
  flags?: string;
  encoding?: BufferEncoding;
  fd?: number;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  end?: number;
  highWaterMark?: number;
};

/**
 * Un `<script>` EN LIGNE qui ne porte pas d'attribut `nonce`.
 *
 * `(?![^>]*\bnonce=)` refuse la balise déjà signée ; `(?![^>]*\bsrc=)` refuse
 * le script SERVI depuis un fichier, qui n'a pas besoin de nonce et satisfait
 * `script-src 'self'`. Reste exactement le cas que le navigateur bloquera.
 */
const INLINE_SCRIPT_SANS_NONCE =
  /<script(?![^>]*\bnonce=)(?![^>]*\bsrc=)[^>]*>\s*\S/iu;

/**
 * Le CSP posé sur cette réponse exige-t-il un nonce sur les scripts ?
 *
 * Lu sur l'en-tête RÉELLEMENT posé, jamais recopié d'une configuration : le
 * firewall a pu le composer (directives `@Csp` d'une route, fragments de
 * modules), et une seconde idée de « la politique en vigueur » divergerait au
 * premier de ces cas.
 *
 * @param csp - valeur de l'en-tête `Content-Security-Policy`, si posée.
 * @returns `true` quand un script en ligne devra porter un nonce.
 */
function cspExigeUnNonce(csp: string | number | string[] | undefined): boolean {
  return typeof csp === "string" && csp.includes("'nonce-");
}

/**
 * Parse un header `Range` mono-plage en octets (RFC 9110 §14.1.2).
 *
 * @param range - valeur brute du header `Range` (ex. `bytes=0-499`, `bytes=-500`).
 * @param length - taille de la représentation sélectionnée (octets).
 * @returns bornes `{ start, end }` clampées à la représentation,
 *   `"unsatisfiable"` si la plage est valide mais hors représentation (→ 416,
 *   RFC 9110 §15.5.17), ou `null` si le header doit être ignoré — unité ≠
 *   `bytes`, multi-range non supporté ou syntaxe invalide (RFC 9110 §14.2 :
 *   un serveur PEUT ignorer un Range ; on répond alors 200 complet, jamais 500).
 */
export function parseByteRange(
  range: string,
  length: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const unit = /^\s*bytes\s*=\s*(.+)$/i.exec(range);
  if (!unit) return null;
  const spec = (unit[1] ?? "").trim();
  if (spec.includes(",")) return null;
  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return null;
  const first = parts[1] ?? "";
  const last = parts[2] ?? "";
  if (first === "" && last === "") return null;
  if (first === "") {
    // Suffixe `bytes=-N` : les N derniers octets (§14.1.2 suffix-range).
    const suffix = parseInt(last, 10);
    if (suffix === 0 || length === 0) return "unsatisfiable";
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = parseInt(first, 10);
  if (last !== "" && start > parseInt(last, 10)) return null;
  if (start >= length) return "unsatisfiable";
  const end =
    last === "" ? length - 1 : Math.min(parseInt(last, 10), length - 1);
  return { start, end };
}

/**
 * Scope d'instanciation d'un controller (V4.3).
 *
 * - `"request"` (défaut) : une instance par requête — l'état per-request peut
 *   vivre sur `this` (legacy sûr, zéro breaking).
 * - `"singleton"` (opt-in via `@Scope`) : UNE instance partagée par toutes les
 *   requêtes — réservé aux controllers **stateless** (état uniquement via
 *   arguments décorés + ALS). Un champ mutable par requête sur `this` y serait
 *   une data race silencieuse entre requêtes concurrentes.
 */
export type ControllerScope = "request" | "singleton";

class Controller extends Service implements IController {
  static prefix: string = "/";
  /**
   * Scope d'instanciation de la classe — `"request"` par défaut, `"singleton"`
   * posé par le décorateur `@Scope` (statique hérité, lu via `new.target` au
   * constructor et par le Resolver : 0 Reflect). Cf {@link ControllerScope}.
   */
  static scope: ControllerScope = "request";
  // V4.1 — état per-request en champs SHADOW privés (null par défaut, 0 alloc :
  // remplace 4 snapshots `{}`/`[]` alloués par construction). Les accessors
  // publics dérivent du `context` LIVE (`shadow ?? dérivation`) : plus de
  // re-snapshot `once("onRequestEnd")` — la valeur est toujours fraîche, et un
  // listener par requête disparaît. Les setters absorbent les écritures
  // userland/tests (champ shadow prioritaire, comportement legacy intact).
  #context: ContextType | null = null;
  #route: Route | null = null;
  #request: contextRequest = null;
  #response: HttpResponse | Http2Response | WebsocketResponse | null = null;
  #method: HTTPMethod | null = null;
  #queryGet: Record<string, unknown> | null = null;
  #query: Record<string, unknown> | null = null;
  #queryFile: unknown[] | null = null;
  #queryPost: Record<string, unknown> | null = null;
  //metaData: Data;
  module?: Module;
  template?: Eta | null;

  /**
   * Contexte transport courant. Per-request : champ posé par `setContext`
   * (constructor) — coût d'accès inchangé. Singleton stateless (V4.3) : champ
   * jamais posé → lecture de l'ALS `RequestContext` (le `HttpKernel` y place
   * le contexte à l'entrée du scope, V4.1) — chaque appel de helper retrouve
   * LA requête en cours, jamais celle d'une requête concurrente.
   */
  get context(): ContextType | undefined {
    return this.#context ?? RequestContext.getContext<ContextType>();
  }
  set context(context: ContextType | undefined) {
    this.#context = context ?? null;
  }

  /**
   * Route matchée. Per-request : posée par le Resolver via `setRoute`.
   * Sans champ (singleton) : dérive du Resolver de la requête courante
   * (`context.resolver`), donc toujours la route de CETTE requête.
   */
  get route(): Route | null {
    return this.#route ?? this.context?.resolver?.route ?? null;
  }

  get request(): contextRequest {
    return this.#request ?? this.context?.request ?? null;
  }
  set request(request: contextRequest) {
    this.#request = request;
  }

  get response(): HttpResponse | Http2Response | WebsocketResponse | null {
    return this.#response ?? this.context?.response ?? null;
  }
  set response(
    response: HttpResponse | Http2Response | WebsocketResponse | null,
  ) {
    this.#response = response;
  }

  get method(): HTTPMethod | undefined {
    return (
      this.#method ?? (this.context?.method as HTTPMethod | null) ?? undefined
    );
  }
  set method(method: HTTPMethod | undefined) {
    this.#method = method ?? null;
  }

  get queryGet(): Record<string, unknown> {
    return (this.#queryGet ??
      (this.context?.request as HttpRequest | Http2Request | null)
        ?.queryGet) as Record<string, unknown>;
  }
  set queryGet(value: Record<string, unknown>) {
    this.#queryGet = value;
  }

  get query(): Record<string, unknown> {
    return (this.#query ??
      (this.context?.request as HttpRequest | Http2Request | null)
        ?.query) as Record<string, unknown>;
  }
  set query(value: Record<string, unknown>) {
    this.#query = value;
  }

  get queryFile(): unknown[] {
    return (this.#queryFile ??
      (this.context?.request as HttpRequest | Http2Request | null)
        ?.queryFile) as unknown[];
  }
  set queryFile(value: unknown[]) {
    this.#queryFile = value;
  }

  get queryPost(): Record<string, unknown> {
    return (this.#queryPost ??
      (this.context?.request as HttpRequest | Http2Request | null)
        ?.queryPost) as Record<string, unknown>;
  }
  set queryPost(value: Record<string, unknown>) {
    this.#queryPost = value;
  }

  /**
   * Le CORPS de la requête, parsé — nom universel de l'écosystème (Express,
   * Fastify, NestJS), alias de {@link queryPost}.
   *
   * Ne pas confondre avec {@link query}, qui FUSIONNE la query string et le
   * corps. Pour une action typée, préférer le décorateur `@Body()`.
   *
   * Getter (aucune allocation) : `queryPost` reste la source unique.
   */
  get body(): Record<string, unknown> {
    return this.queryPost;
  }
  set body(value: Record<string, unknown>) {
    this.queryPost = value;
  }

  /**
   * Session courante, ou `null`. Getter direct sur `context.session` (peuplé au
   * point d'activation unique du pipeline si la route déclare `@UseSession` /
   * `@Session`, ou si un cookie de session est repris — L1). Remplace l'ancien
   * pont via l'event `onSessionStart` : toujours à jour, zéro allocation.
   */
  get session(): Session | null {
    return this.context?.session ?? null;
  }

  constructor(
    name: string,
    context: ContextType,
    //@inject("HttpKernel") private httpKernel?: HttpKernel
  ) {
    // V4.3 — `new.target` lit le statique `scope` de la classe la plus dérivée
    // (posé par `@Scope("singleton")`, hérité sinon). Singleton : bindé au
    // container du KERNEL — celui de la requête est `clean()`é au teardown,
    // le capturer = `this.get()` sur un container mort dès la requête suivante.
    // Et AUCUNE capture per-request (pas de `setContext`) : l'état de la
    // requête arrive par l'ALS (V4.1), jamais par `this`.
    const singleton = (new.target as typeof Controller).scope === "singleton";
    const kernel = singleton ? context.kernel : null;
    super(
      name,
      ((singleton ? kernel?.container : null) ??
        context.container) as Container,
      ((singleton ? kernel?.notificationsCenter : null) ??
        context.notificationsCenter) as Event,
    );
    this.template = this.get<Eta>("template");
    if (!singleton) {
      this.setContext(context);
    }
  }

  setContext(context: ContextType) {
    // V4.1 — un seul write : tout l'état per-request (request/response/method/
    // query*) dérive du context via les accessors, toujours frais (le
    // re-snapshot `once("onRequestEnd")` n'a plus de raison d'être).
    this.#context = context;
  }

  setContextJson(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextJson(encoding);
  }
  setContextHtml(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextHtml(encoding);
  }

  /**
   * Dit, EN DÉVELOPPEMENT SEULEMENT, qu'un script en ligne ne s'exécutera pas.
   *
   * Le navigateur refuse un `<script>` en ligne sous une politique de contenu à
   * nonce, et il le dit dans SA console — que personne ne lit quand la page est
   * produite par un test, un `curl` ou un agent. Le serveur, lui, a les deux
   * moitiés sous la main : l'en-tête qu'il vient de poser et le corps qu'il
   * s'apprête à écrire. Il le dit donc au moment exact où le geste manque, avec
   * le geste — c'est ce qui distingue un refus utilisable d'un refus juste.
   *
   * ⚠️ Coût nul hors développement : la garde d'environnement est le PREMIER
   * test, avant toute lecture d'en-tête et toute expression régulière. Une page
   * de production ne paie donc rien, pas même la lecture du CSP.
   *
   * @param data - le corps HTML sur le point d'être envoyé.
   * @returns rien — cette sonde n'échoue jamais et ne change aucune réponse.
   */
  #avertirScriptSansNonce(data: unknown): void {
    const kernel = this.context?.kernel;
    if (
      kernel?.environment !== "development" &&
      kernel?.environment !== "dev"
    ) {
      return;
    }
    if (typeof data !== "string" || data.length === 0) {
      return;
    }
    const response = this.response as { getHeader?: (n: string) => unknown };
    if (typeof response?.getHeader !== "function") {
      return;
    }
    const csp = response.getHeader("Content-Security-Policy") as
      string | number | string[] | undefined;
    if (!cspExigeUnNonce(csp) || !INLINE_SCRIPT_SANS_NONCE.test(data)) {
      return;
    }
    this.log(
      "Cette réponse porte un <script> EN LIGNE sans attribut `nonce`, et la " +
        "politique de contenu de cette application exige un nonce sur les " +
        "scripts : le navigateur REFUSERA de l'exécuter (« Refused to execute " +
        "inline script »). Deux gestes, au choix :\n" +
        '  • signer le script — `<script nonce="${this.context?.cspNonce}">` ' +
        '(dans une vue Eta : `<script nonce="<%= it.nonce %>">`, le nonce ' +
        "étant passé en donnée depuis `this.context?.cspNonce`) ;\n" +
        "  • sortir le script dans un FICHIER servi par l'application — un " +
        "`<script src=…>` de même origine satisfait `script-src 'self'` sans nonce.\n" +
        "  Ne desserre PAS la politique (`'unsafe-inline'`) : le détail vit dans " +
        "`@nodefony/security/docs/headers.md`.",
      "WARNING",
      "CSP",
    );
  }

  async render(
    data: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>,
  ) {
    this.#avertirScriptSansNonce(data);
    return (this.context as HttpContext)?.render(
      data,
      encoding,
      status,
      headers,
    );
  }

  renderResponse(
    data: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ): Promise<Http2Response | HttpResponse> | Promise<WebsocketResponse> {
    if (headers) {
      this.response?.setHeaders(headers);
    }
    if (status) {
      this.response?.setStatusCode(status);
    }
    return (<HttpContext | WebsocketContext>this.context)?.send(
      data as Buffer | string | null,
      encoding,
    );
  }

  async renderView(
    path: string | FileClass,
    param: Record<string, unknown> = {},
    status?: string | number,
    headers?: Record<string, string | number>,
  ): Promise<Http2Response | HttpResponse | WebsocketResponse> {
    let data: string | undefined;
    try {
      const file = typeof path === "string" ? await FileClass.from(path) : path;
      // Phase `render` — la PRODUCTION du corps par le moteur de vue (lecture du
      // template + Eta). C'est le seul « rendu » qui coûte vraiment ; un
      // `JSON.stringify` de réponse API est du bruit à côté (il reste compté dans
      // `action`). L'ENVOI, lui, a sa propre phase (`send`) : rendre et écrire sur
      // le fil sont deux temps distincts, et les confondre masquerait lequel traîne.
      this.context?.phaseStart("render");
      try {
        data = await this.template?.render(
          (await file.readAsync()).toString(),
          this.withFrontendLocals(param),
        );
      } finally {
        this.context?.phaseEnd("render");
      }
      this.setContextHtml();
      this.#avertirScriptSansNonce(data);
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  /**
   * Injecte les helpers frontend (`frontendTags`/`frontendDocument`) dans les
   * locals du template (passés en data, pas de registre global de fonctions).
   * Service `frontend` résolu par nom (pas d'import `@nodefony/frontend`). Les
   * valeurs fournies par l'action priment (spread `param` en dernier).
   */
  private withFrontendLocals(
    param: Record<string, unknown>,
  ): Record<string, unknown> {
    const fe = this.get<{
      renderTags?: (
        entry: string,
        nonce?: string,
        requestHost?: string,
      ) => string;
      renderDocument?: (
        entry: string,
        nonce?: string,
        requestHost?: string,
      ) => string;
      assetUrl?: (p: string) => string;
    }>("frontend");
    if (!fe?.renderTags) return param;
    // Nonce CSP et hôte de la REQUÊTE : le helper de vue a le contexte sous la
    // main, l'auteur du gabarit n'a donc rien à propager (`<%~ frontendTags("x") %>`).
    // L'hôte fait suivre l'origine des assets Vite à celui par lequel le client
    // est arrivé ; le nonce satisfait `script-src 'nonce-…'`.
    const nonce = this.context?.cspNonce;
    const host = this.context?.domain;
    return {
      frontendTags: (entry: string) => fe.renderTags!(entry, nonce, host),
      frontendDocument: (entry: string) =>
        fe.renderDocument!(entry, nonce, host),
      // `asset('/x')` → URL CDN (assetBaseUrl) en prod, sinon chemin relatif.
      asset: (p: string) => (fe.assetUrl ? fe.assetUrl(p) : p),
      ...param,
    };
  }

  async renderJson(
    obj: unknown,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ) {
    const data = JSON.stringify(obj);
    this.setContextJson();
    return this.renderResponse(data, "utf8", status, headers);
  }

  setRoute(route: Route): Route {
    this.#route = route;
    return route;
  }

  getSession(): Session | undefined | null {
    if (this.context?.session) return this.context?.session;
  }

  redirect(
    url: string,
    status?: string | number,
    headers?: Record<string, string | number>,
  ) {
    // if (!(this.context as HttpContext).redirect) {
    //   throw new Error("subRequest can't redirect request");
    // }
    if (!url) {
      throw new Error("Redirect error no url !!!");
    }
    (this.context as HttpContext).redirect(url, status, headers);
  }

  getFlashBag(key: string) {
    const session = this.getSession();
    if (session) {
      return session.getFlashBag(key);
    }
    this.log("getFlashBag session not started !", "ERROR");
    return null;
  }
  setFlashBag(key: string, value: unknown) {
    const session = this.getSession();
    if (session) {
      return session.setFlashBag(key, value);
    }
    return null;
  }

  addFlash(key: string, value: unknown) {
    return this.setFlashBag(key, value);
  }

  forward(name: string, param?: unknown[]) {
    const resolver = (this.get("router") as Router).resolveController(
      this.context as ContextType,
      name,
    );
    return resolver.callController(param, true);
  }

  /**
   * @deprecated Bloque l'event-loop (`fs.lstatSync` via `new FileClass`).
   *   Utiliser {@link getFileAsync} dans tout pipeline. Conservé pour compat.
   */
  getFile(file: FileClass | string): FileClass {
    let File: FileClass;
    if (file instanceof FileClass) {
      File = file;
    } else if (typeof file === "string") {
      File = new FileClass(file);
    } else {
      throw new Error(`File argument bad type for getFile :${typeof file}`);
    }
    if (File.type !== "File") {
      throw new Error(`getFile bad type for  :${file}`);
    }
    return File;
  }

  /**
   * Variante **async** de `getFile()` — résout les stats via `FileClass.from`
   * (pas de `lstatSync` bloquant). À préférer dans le pipeline (render/stream).
   *
   * Un chemin qui ne désigne aucun fichier rend **404**, pas 500 : la RFC 9110
   * §15.5.5 définit le 404 comme l'absence de « représentation courante pour la
   * ressource cible », alors que le 500 (§15.6.1) suppose une condition
   * **inattendue**. Or le chemin vient presque toujours d'un paramètre d'URL :
   * un nom qui ne correspond à rien est une entrée client banale, pas une panne.
   * Un dossier reçoit le même traitement — il n'est pas servable comme fichier.
   *
   * Les autres échecs d'accès (permissions, E/S) remontent INCHANGÉS et valent
   * 500 : là, la condition est bien inattendue. Le 403 ne conviendrait pas, la
   * RFC le réservant à un refus « compris et délibéré » (§15.5.4).
   *
   * Le message rendu au client ne cite JAMAIS le chemin — la même section
   * autorise le serveur à ne pas divulguer l'existence d'une ressource, et un
   * chemin serveur dans un corps d'erreur est une fuite d'information. Le chemin
   * va dans le journal, à la disposition de qui exploite l'application.
   *
   * @param file - `FileClass` déjà hydraté OU chemin string.
   * @returns le `FileClass` (type `"File"` validé).
   * @throws {HttpError} 404 si le chemin ne désigne aucun fichier.
   * @throws Si le type de l'argument est invalide (bug d'appel, pas d'entrée client).
   */
  async getFileAsync(file: FileClass | string): Promise<FileClass> {
    let File: FileClass;
    if (file instanceof FileClass) {
      File = file;
    } else if (typeof file === "string") {
      try {
        File = await FileClass.from(file);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") {
          throw e;
        }
        this.log(`fichier introuvable : ${file}`, "DEBUG");
        throw new HttpError("Not Found", 404, this.context);
      }
    } else {
      throw new Error(
        `File argument bad type for getFileAsync :${typeof file}`,
      );
    }
    if (File.type !== "File") {
      this.log(`ce chemin n'est pas un fichier : ${file}`, "DEBUG");
      throw new HttpError("Not Found", 404, this.context);
    }
    return File;
  }

  /**
   * Sert un fichier en TÉLÉCHARGEMENT (`Content-Disposition: attachment`).
   *
   * Comme {@link Controller.streamFile} dont il est l'habillage, il envoie le
   * fichier ENTIER et n'honore pas `Range` — c'est le comportement voulu pour un
   * téléchargement. Pour un média seekable, voir {@link Controller.renderMediaStream}.
   *
   * @param file - chemin ou `FileClass` du fichier à servir.
   * @param options - options de `createReadStream`.
   * @param headers - en-têtes ajoutés (écrasent ceux posés par défaut).
   * @returns le flux de lecture, une fois la réponse écoulée.
   */
  async renderFileDownload(
    file: FileClass | string,
    options?: ReadStreamOptions,
    headers: OutgoingHttpHeaders = {},
  ): Promise<ReadStream> {
    const File = await this.getFileAsync(file);
    const length = File.stats.size;
    const head = {
      "Content-Disposition": `attachment; filename="${File.name}"`,
      "Content-Length": length,
      Expires: "0",
      "Content-Description": "File Transfer",
      "Content-Type": File.mimeType || "application/octet-stream",
      ...headers,
    };
    try {
      return this.streamFile(File, head, options);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  /**
   * Envoie un fichier en FLUX, du disque vers la réponse, sans jamais le charger
   * en mémoire.
   *
   * ⚠️ **N'honore PAS l'en-tête `Range`** : le fichier part toujours en entier,
   * avec un statut 200. Pour un média dans lequel un lecteur doit pouvoir sauter
   * (vidéo, audio, gros PDF), utiliser {@link Controller.renderMediaStream} —
   * seul à implémenter les requêtes par plage (RFC 9110 §14 : 206, 416,
   * `Content-Range`). Annoncer `Accept-Ranges: bytes` depuis ici est un piège :
   * le client croit pouvoir se déplacer et reçoit tout le fichier.
   *
   * Ce que cette méthode garantit et qui justifie son existence : le NETTOYAGE.
   * Le flux est ouvert en `autoClose: false` ; un client qui raccroche en plein
   * téléchargement laisserait sinon un descripteur ouvert et une promesse pendue.
   *
   * @param file - chemin ou `FileClass` du fichier à servir.
   * @param headers - en-têtes ajoutés à la réponse (le type MIME est déduit si absent).
   * @param options - options de `createReadStream` (`start`/`end` pour un extrait).
   * @returns le flux de lecture, une fois la réponse écoulée.
   * @throws Si la réponse n'est pas disponible, ou si le fichier est illisible.
   */
  async streamFile(
    file: FileClass | string,
    headers?: OutgoingHttpHeaders,
    options: ReadStreamOptions | undefined = {},
  ): Promise<ReadStream> {
    if (!this.response) {
      throw new Error(`response not found`);
    }
    const contextResponse = this.response as HttpResponse | Http2Response;
    const response = contextResponse.response;
    if (!response) {
      throw new Error(`response not found`);
    }
    (options as ReadStreamOptions).autoClose = false;
    try {
      const fileDetails = await this.getFileAsync(file);

      (this.response as HttpResponse | Http2Response).response?.removeHeader(
        "Content-Type",
      );
      (this.response as HttpResponse | Http2Response).response?.removeHeader(
        "content-type",
      );
      const contentTypeHeader =
        headers && (headers["Content-Type"] || headers["content-type"]);
      if (!contentTypeHeader) {
        (this.response as HttpResponse | Http2Response).setFileMimeType(
          fileDetails.name,
        );
      }
      const contentLength =
        headers && (headers["Content-Length"] || headers["content-length"]);
      if (!contentLength) {
        if (!headers) {
          headers = {};
        }
        (this.response as HttpResponse | Http2Response).response?.removeHeader(
          "Content-Length",
        );
        (this.response as HttpResponse | Http2Response).response?.removeHeader(
          "content-length",
        );
        headers["Content-Length"] = fileDetails.stats.size;
      }
      const streamFile = createReadStream(
        fileDetails.path as fs.PathLike,
        options,
      ) as ReadStreamWithFD;

      return new Promise((resolve, reject) => {
        let handled = false;
        // R5 — client parti pendant le stream : la destination morte unpipe le
        // ReadStream qui reste alors PAUSÉ, fd ouvert (`autoClose:false`), sans
        // émettre `end`/`close` → fd fuit + promesse pendue. `destroy()` émet
        // `close` → `handleStreamEnd` ferme le fd et résout.
        const onResponseClose = () => {
          if (!handled) {
            streamFile.destroy();
          }
        };
        response.once("close", onResponseClose);
        streamFile.on("open", () => {
          try {
            (this.context as HttpContext)?.writeHead(
              contextResponse?.statusCode as number,
              headers,
            );
            streamFile.pipe(response, { end: false });
          } catch (e) {
            this.log(e, "ERROR");
            return reject(e);
          }
        });
        const handleStreamEnd = async () => {
          try {
            if (handled) return; // Prevent handling multiple times
            handled = true;
            response.removeListener("close", onResponseClose);
            if (streamFile) {
              streamFile.unpipe(response);
              if (streamFile.fd) {
                await fsClose(streamFile.fd).catch((e) => {
                  return reject(e);
                });
              }
              if (!this.context?.finished) {
                (this.context as HttpContext)?.end();
              }
              return resolve(streamFile);
            }
          } catch (e) {
            this.log(e, "ERROR");
            return reject(e);
          }
        };
        streamFile.on("end", handleStreamEnd);
        streamFile.on("close", handleStreamEnd);
        streamFile.on("error", (error) => {
          this.log(error, "ERROR");
          if (!this.context?.finished) {
            (this.context as HttpContext)?.end();
          }
          return reject(error);
        });
      });
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async renderMediaStream(
    file: FileClass | string,
    headers: OutgoingHttpHeaders = {},
    options: ReadStreamOptions | undefined = {},
  ) {
    const File = await this.getFileAsync(file);
    this.response?.setEncoding("binary");
    // Le `?.` doit porter jusqu'au BOUT : `const { range } = X?.headers`
    // déstructure `undefined` dès que `X` l'est — donc lève exactement le
    // TypeError que l'optional chaining prétendait éviter.
    const range = (this.request as HttpRequest | Http2Request | undefined)
      ?.headers?.range;
    const length = File.stats.size;
    let head: OutgoingHttpHeaders;
    let value: ReadStreamOptions;
    const contextResponse = this.response as HttpResponse | Http2Response;
    const response = contextResponse.response;
    // RFC 9110 §14 — un Range client ne crashe JAMAIS le serveur : plage hors
    // représentation → 416 + `Content-Range: bytes */<len>` (§15.5.17) ; syntaxe
    // invalide / unité inconnue / multi-range → header ignoré, 200 complet (§14.2).
    const parsed = range ? parseByteRange(range, length) : null;
    if (parsed === "unsatisfiable") {
      return this.renderResponse("", "utf8", 416, {
        "Content-Range": `bytes */${length}`,
        "Accept-Ranges": "bytes",
      });
    }
    if (parsed) {
      const { start, end } = parsed;
      const chunksize = end - start + 1;
      value = {
        ...options,
        start,
        end,
      };
      head = {
        "Content-Range": `bytes ${start}-${end}/${length}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": File.mimeType || "application/octet-stream",
        ...headers,
      };
      response?.removeHeader("content-type");
      this.response?.setStatusCode(206);
    } else {
      value = {
        ...options,
      };
      head = {
        "Content-Type": File.mimeType || "application/octet-stream",
        "Content-Length": length.toString(),
        "Content-Disposition": ` inline; filename="${File.name}"`,
        "Accept-Ranges": "bytes",
        ...headers,
      };
      response?.removeHeader("content-type");
    }
    return this.streamFile(File, head, value);
  }
}

export default Controller;
