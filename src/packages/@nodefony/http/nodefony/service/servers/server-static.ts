import serveStatic from "serve-static";
import mime from "mime-types";
import { URL } from "node:url";
import {
  //ProtocolType,
  //ServerType,
  SchemeType,
} from "../http-kernel";
import http from "node:http";
import http2 from "node:http2";
import tls from "tls";
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

/** Un dossier monté sous un préfixe public (`/_assets/x/` → dir). */
type StaticMount = { prefix: string; server: serveStaticType; dir: string };

class Statics extends Service {
  module: Module;
  servers: ServersStatic;
  /** Montages préfixés (prod frontend). Lazy : `[]` rempli à `addMount`. */
  mounts: StaticMount[] = [];
  defaultOptions: serveStatic.ServeStaticOptions = defaultOptions;
  constructor(
    module: Module,
    //@inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    const container = module.container || undefined;
    const options: serveStatic.ServeStaticOptions =
      module.options.statics || {};
    let event: Event | null | false | undefined;
    if (container) {
      event = container.get<Event>("notificationsCenter");
    }
    super("server-static", container, event, options);
    this.module = module;
    this.servers = {};
    this.defaultOptions = extend(
      defaultOptions,
      this.options.defaultOptions || {},
    );
    if (this.options.defaultOptions) delete this.options.defaultOptions;
    this.initStaticFiles();
    this.kernel?.on("onPostReady", () => {
      for (const ele in this.servers) {
        this.log(`Server Listen on ${ele}`, "INFO");
      }
    });
  }

  initStaticFiles() {
    for (const staticRoot in this.options) {
      let Path = this.options[staticRoot].path;
      Path = this.kernel?.checkPath(Path);
      let setHeaders = null;
      const opt: serveStatic.ServeStaticOptions =
        this.options[staticRoot].options || {};
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
      this.addDirectory(Path, opt);
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
    let p = prefix.trim();
    if (!p.startsWith("/")) p = `/${p}`;
    if (!p.endsWith("/")) p = `${p}/`;
    p = p.replace(/\/{2,}/g, "/");
    const server = serveStatic(dir, extend({}, this.defaultOptions));
    const entry: StaticMount = { prefix: p, server, dir };
    const i = this.mounts.findIndex((m) => m.prefix === p);
    if (i >= 0) this.mounts[i] = entry;
    else this.mounts.push(entry);
    this.log(`mount ${p} → ${dir}`, "INFO");
  }

  /** `true` si au moins un montage préfixé est actif (gate du pipeline). */
  hasMounts(): boolean {
    return this.mounts.length > 0;
  }

  addDirectory(Path: string, options: any) {
    if (!Path) {
      throw new Error("Static file path not Defined ");
    }
    const opt = extend({}, this.defaultOptions, options);
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
      scheme =
        request.connection instanceof tls.TLSSocket &&
        request.connection.encrypted
          ? "https"
          : "http";
      host = request.headers.host;
      return scheme + "://" + host;
    } else if (request instanceof http2.Http2ServerRequest) {
      // Pour http2.Http2ServerRequest
      scheme =
        request.socket instanceof tls.TLSSocket && request.socket.encrypted
          ? "https"
          : "http";
      host = request.headers[":authority"];
      return scheme + "://" + host;
    }
    throw new Error(`Bad request type`);
  }

  async handle(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
  ): Promise<http.ServerResponse | http2.Http2ServerResponse> {
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
          return Promise.reject(e);
        }
        break;
      }
    }
    for (const server in this.servers) {
      try {
        let ele = this.servers[server];
        await this.getStatic(ele, request, response);
        const type = mime.lookup(pathname);
        response.setHeader("Content-Type", type as string);
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.resolve(response);
  }
}

export default Statics;
