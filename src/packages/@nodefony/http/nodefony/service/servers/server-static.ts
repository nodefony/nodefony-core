import serveStatic from "serve-static";
import mime from "mime-types";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import {
  //ProtocolType,
  //ServerType,
  SchemeType,
} from "../http-kernel";
import http from "node:http";
import http2 from "node:http2";
import tls from "node:tls";
import {
  Service,
  //Kernel,
  //Container,
  Event,
  extend,
  Module,
  //FamilyType,
  //DefaultOptionsService,
  //inject,
} from "nodefony";

type serveStaticType = serveStatic.RequestHandler<http.ServerResponse>;

type ServersStatic = Record<string, serveStaticType>;

const defaultOptions: serveStatic.ServeStaticOptions = {
  cacheControl: true,
  maxAge: 96 * 60 * 60,
};

/**
 * Origine vers laquelle relayer une requête, calculée à partir du nom d'hôte
 * par lequel le client est arrivé (`Context.domain`, sans port).
 *
 * @returns l'origine cible (`scheme://hôte:port`, sans `/` final), ou
 *   `undefined` quand rien ne peut être relayé — la requête suit alors son
 *   chemin normal.
 */
export type RelayOriginResolver = (domain: string) => string | undefined;

/** Un préfixe d'URL relayé vers une autre origine (`/_vite/default/` → Vite). */
type StaticRelay = { prefix: string; resolveOrigin: RelayOriginResolver };

/**
 * Normalise un préfixe d'URL : `/` en tête et en fin, sans `/` doublé. Règle
 * UNIQUE des montages et des relais — deux écritures du même préfixe doivent
 * désigner la même entrée.
 */
function normalizePrefix(prefix: string): string {
  let p = prefix.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (!p.endsWith("/")) p = `${p}/`;
  return p.replace(/\/{2,}/g, "/");
}

/** Un dossier monté sous un préfixe public (`/_assets/x/` → dir). */
type StaticMount = { prefix: string; server: serveStaticType; dir: string };

/**
 * Config par module du montage statique natif (`module.options.publicMount`).
 * - `false` → opt-out (le module ne sert pas de `public/`).
 * - `{ publicPath?, dir? }` → override (l'override explicite prime sur le skip
 *   automatique des modules frontend-managed).
 * - `undefined` → auto : `publicPath = /<basename(nom)>/`, `dir = "public"`.
 *
 * `publicPath` partage la sémantique de `@nodefony/frontend.publicPath` ; `dir`
 * est le dossier SOURCE servi (l'analogue en entrée du `outDir` frontend).
 */
type PublicMountOption = false | { publicPath?: string; dir?: string };

/** Racine statique déclarée en configuration (`statics.<nom>`). */
interface IStaticRootConfig {
  path: string;
  options?: serveStatic.ServeStaticOptions;
}

class Statics extends Service {
  module: Module;
  servers: ServersStatic;
  /** Montages préfixés (prod frontend). Lazy : `[]` rempli à `addMount`. */
  mounts: StaticMount[] = [];
  /**
   * Préfixes relayés vers une autre origine (dev frontend : `/_vite/<famille>/`
   * → serveur Vite). `null` tant qu'aucun relais n'est déclaré : c'est le cas
   * de toute production, où le pipeline ne paie qu'une lecture de champ.
   */
  relays: StaticRelay[] | null = null;
  /**
   * Serveur statique config-driven actif. `false` (config `statics.enabled`) =
   * aucun montage `web`/`assets`, 0 listener — quand un reverse-proxy/CDN sert
   * les statiques. Ne gate PAS les `addMount()` programmatiques (frontend prod).
   */
  enabled: boolean = true;
  defaultOptions: serveStatic.ServeStaticOptions = defaultOptions;
  constructor(
    module: Module,
    //@inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    const container = module.container ?? undefined;
    const options = (module.options.statics ||
      {}) as serveStatic.ServeStaticOptions;
    let event: Event | null | false | undefined;
    if (container) {
      event = container.get<Event>("notificationsCenter");
    }
    super("server-static", container, event, options);
    this.module = module;
    this.servers = {};
    // `enabled` lu PUIS supprimé des options AVANT le `for...in` de
    // initStaticFiles (sinon traité comme une racine statique → `.path` sur un
    // booléen). Même contrat que `defaultOptions` : ce n'est pas une entrée
    // servable. Le `delete` exige une config NON gelée (cf defineHttpConfig).
    this.enabled = this.options.enabled !== false;
    if (typeof this.options.enabled !== "undefined")
      delete this.options.enabled;
    this.defaultOptions = extend(
      defaultOptions,
      this.options.defaultOptions || {},
    ) as serveStatic.ServeStaticOptions;
    if (this.options.defaultOptions) delete this.options.defaultOptions;
    if (this.enabled) {
      this.initStaticFiles();
    } else {
      this.log(
        "Static file server DISABLED (statics.enabled=false) — reverse-proxy/CDN attendu",
        "INFO",
      );
    }
    // Préfixe natif `/<module>/` : à `onReady` (tous les modules enregistrés),
    // auto-monte le `public/` de chaque module applicatif. Indépendant de
    // `enabled` (la carte préfixe→dossier doit rester introspectable par
    // `proxy:generate` même quand les statiques sont servis par un proxy/CDN).
    this.kernel?.once("onReady", () => {
      this.mountModulePublics();
    });
    this.kernel?.on("onPostReady", () => {
      // Bannière sautée sous l'écran de boot animé (dev TTY) — cohérent avec les
      // serveurs réseau (`Kernel.suppressBootBanners`). Affichée sinon (prod/CI/--debug).
      if (this.kernel?.suppressBootBanners) return;
      for (const ele in this.servers) {
        this.log(`Server Listen on ${ele}`, "INFO");
      }
    });
  }

  /**
   * Auto-monte le `public/` de chaque module applicatif sous le préfixe natif
   * `/<module>/` (basename du nom — `@nodefony/test` → `/test/`). Appelé une fois
   * à `onReady`. Idempotent via {@link addMount} (un même préfixe est remplacé).
   *
   * Exclusions :
   * - **app root** (`isApp`) — son `public/` est servi à la racine `/` par la
   *   racine statique `web` (favicon…), sans préfixe.
   * - **modules frontend-managed** (présents dans `frontend.listEntries()`) —
   *   leurs assets buildés sont servis sous `/_assets/<name>/` par
   *   `@nodefony/frontend` ; on ne double-sert pas leur `public/dist`.
   * - **modules sans `public/`** — rien à monter (http, framework, security…).
   *
   * Enregistré dans {@link mounts} quel que soit `enabled` → la carte
   * préfixe→dossier reste lisible par `proxy:generate` même statiques désactivés
   * (reverse-proxy/CDN en prod).
   */
  mountModulePublics(): void {
    const modules = this.kernel?.modules;
    if (!modules) return;
    // Modules dont les assets sont déjà servis par @nodefony/frontend.
    const frontend = this.container?.get<{
      listEntries?: () => ReadonlyArray<{ moduleName: string }>;
    }>("frontend");
    const frontManaged = frontend?.listEntries
      ? new Set(frontend.listEntries().map((e) => e.moduleName))
      : null;
    for (const mod of Object.values(modules)) {
      if (mod.isApp) continue;
      // Config par module (cf {@link PublicMountOption}) : option top-level
      // du module, lue dans `mod.options`.
      const cfg = (mod.options as { publicMount?: PublicMountOption })
        .publicMount;
      if (cfg === false) continue; // opt-out explicite
      // Auto (cfg absent) → skip les modules frontend-managed (servis sous
      // /_assets/<name>/). Un override explicite `{…}` prime sur ce skip.
      if (cfg == null && frontManaged?.has(mod.name)) continue;
      const dir = join(mod.path, cfg?.dir || "public");
      if (!existsSync(dir)) continue;
      // Défaut = basename du nom (`@nodefony/test` → `/test/`), surchargeable
      // par `publicMount.publicPath` (addMount normalise les `/`).
      const prefix = cfg?.publicPath || `/${mod.name.split("/").pop()}/`;
      this.addMount(prefix, dir);
    }
  }

  initStaticFiles() {
    for (const staticRoot in this.options) {
      // Racine statique déclarée en config (`statics.<nom>`).
      const root = this.options[staticRoot] as IStaticRootConfig;
      const Path = this.kernel?.checkPath(root.path);
      let setHeaders = null;
      const opt: serveStatic.ServeStaticOptions = root.options ?? {};
      if (opt.setHeaders) {
        if (typeof opt.setHeaders === "function") {
          setHeaders = opt.setHeaders;
          delete opt.setHeaders;
        }
      }
      opt.setHeaders = (res: http.ServerResponse, path: string) => {
        this.log(`Render ${path}`, "DEBUG", `SERVE STATIC ${staticRoot}`);
        this.fire("onServeStatic", res, path, staticRoot, this);
      };
      if (setHeaders) {
        this.on("onServeStatic", setHeaders);
      }
      // `""` : chemin non résolu → `addDirectory` lève (comportement inchangé).
      this.addDirectory(Path ?? "", opt);
    }
  }

  /**
   * Monte un dossier sous un préfixe public (ex `/_assets/studio/` → outDir).
   * Le préfixe est normalisé (leading + trailing `/`). Idempotent : un même
   * préfixe est remplacé. Consommé par `@nodefony/frontend` en prod (assets
   * Vite buildés) — résolu par nom via le Container, sans import croisé.
   *
   * @param prefix préfixe d'URL public
   * @param dir dossier absolu à servir
   */
  addMount(prefix: string, dir: string): void {
    const p = normalizePrefix(prefix);
    const server = serveStatic(
      dir,
      extend({}, this.defaultOptions) as serveStatic.ServeStaticOptions,
    );
    const entry: StaticMount = { prefix: p, server, dir };
    const i = this.mounts.findIndex((m) => m.prefix === p);
    if (i >= 0) this.mounts[i] = entry;
    else this.mounts.push(entry);
    this.log(`mount ${p} → ${dir}`, "INFO");
  }

  /**
   * Relaie un préfixe d'URL vers une autre origine, par une redirection 307.
   * Consommé par `@nodefony/frontend` en développement : les URLs d'assets que
   * Vite fabrique sont relatives au DOCUMENT (servi ici), alors que le fichier
   * vit sur le serveur Vite. Le relais est consulté AVANT le routage — une
   * route attrape-tout de l'application ne peut donc pas l'avaler. Idempotent :
   * un même préfixe est remplacé.
   *
   * @param prefix préfixe d'URL relayé (normalisé : `/` en tête et en fin)
   * @param resolveOrigin calcule l'origine cible pour le nom d'hôte du client
   */
  addRelay(prefix: string, resolveOrigin: RelayOriginResolver): void {
    const p = normalizePrefix(prefix);
    const entry: StaticRelay = { prefix: p, resolveOrigin };
    this.relays ??= [];
    const i = this.relays.findIndex((r) => r.prefix === p);
    if (i >= 0) this.relays[i] = entry;
    else this.relays.push(entry);
    this.log(`relay ${p}`, "DEBUG");
  }

  /**
   * Retire un relais déclaré par {@link addRelay}. Le dernier retiré rend
   * `relays` à `null` : le pipeline cesse alors de le consulter.
   *
   * @param prefix préfixe tel que déclaré (normalisé de la même façon)
   */
  removeRelay(prefix: string): void {
    if (this.relays === null) return;
    const p = normalizePrefix(prefix);
    const kept = this.relays.filter((r) => r.prefix !== p);
    this.relays = kept.length > 0 ? kept : null;
  }

  /**
   * Cible de la redirection pour une URL de requête, si un relais la couvre.
   *
   * @param url URL brute de la requête (chemin + requête)
   * @param domain nom d'hôte du client (`Context.domain`)
   * @returns l'URL absolue vers laquelle rediriger, ou `undefined`
   */
  relayTarget(url: string | undefined, domain: string): string | undefined {
    const relays = this.relays;
    if (relays === null || url === undefined) return undefined;
    for (const r of relays) {
      if (!url.startsWith(r.prefix)) continue;
      const origin = r.resolveOrigin(domain);
      // L'URL commence par le préfixe (donc par `/`) : la cible reste sur
      // l'origine résolue, jamais sur un hôte que le client aurait glissé.
      return origin === undefined ? undefined : origin + url;
    }
    return undefined;
  }

  /** `true` si au moins un montage préfixé est actif (gate du pipeline). */
  hasMounts(): boolean {
    return this.mounts.length > 0;
  }

  addDirectory(Path: string, options: serveStatic.ServeStaticOptions) {
    if (!Path) {
      throw new Error("Static file path not Defined ");
    }
    const opt = extend(
      {},
      this.defaultOptions,
      options,
    ) as serveStatic.ServeStaticOptions;
    /* if (typeof opt.maxAge === "string") {
      //opt.maxAge = parseInt(eval(opt.maxAge), 10);
    }*/
    const server = serveStatic(Path, opt);
    this.servers[Path] = server;
    return server;
  }

  getStatic(
    server: serveStaticType,
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
  ): Promise<http.ServerResponse | http2.Http2ServerResponse> {
    return new Promise((resolve, reject) => {
      server(
        request as http.IncomingMessage,
        response as http.ServerResponse,
        (err) => {
          // static not found 404
          if (err) {
            return reject(err);
          }
          return resolve(response);
        },
      );
    });
  }

  getUrl(request: http.IncomingMessage | http2.Http2ServerRequest): string {
    let scheme: SchemeType, host;
    if (request instanceof http.IncomingMessage) {
      // Pour http.IncomingMessage
      scheme = request.socket instanceof tls.TLSSocket ? "https" : "http";
      host = request.headers.host;
      return scheme + "://" + host;
    } else if (request instanceof http2.Http2ServerRequest) {
      // Pour http2.Http2ServerRequest
      scheme = request.socket instanceof tls.TLSSocket ? "https" : "http";
      host = request.headers[":authority"];
      return scheme + "://" + host;
    }
    throw new Error(`Bad request type`);
  }

  async handle(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
  ): Promise<http.ServerResponse | http2.Http2ServerResponse> {
    // Rien à servir (statics désactivé + aucun mount programmatique) → no-op
    // immédiat, sans parser l'URL. Le routing prend le relais.
    if (!this.enabled && this.mounts.length === 0) {
      return Promise.resolve(response);
    }
    const baseURL = this.getUrl(request);
    const { pathname } = new URL(request.url as string, baseURL);
    if (!pathname) {
      throw new Error(`Bad url ${request.url}`);
    }
    // Montages préfixés (prod frontend). Guard `startsWith` = O(1), aucun stat
    // disque si l'URL ne vise pas un mount → les routes dynamiques ne paient rien.
    // `serve-static` pose lui-même le Content-Type. Si le fichier est servi, la
    // Promise reste pending (pas de `next()`) → le routing n'est jamais atteint.
    if (this.mounts.length > 0) {
      const raw = request.url as string;
      for (const m of this.mounts) {
        if (!raw.startsWith(m.prefix)) continue;
        request.url = `/${raw.slice(m.prefix.length)}`;
        try {
          await this.getStatic(m.server, request, response);
          // Fichier absent (next appelé) → restaure l'URL, laisse le routing gérer.
          request.url = raw;
        } catch (e) {
          request.url = raw;
          throw e;
        }
        break;
      }
    }
    for (const ele of Object.values(this.servers)) {
      await this.getStatic(ele, request, response);
      const type = mime.lookup(pathname);
      response.setHeader("Content-Type", type as string);
    }
    return Promise.resolve(response);
  }
}

export default Statics;
