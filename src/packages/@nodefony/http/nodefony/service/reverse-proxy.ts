import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import { Service, Event, Module } from "nodefony";
import type {
  IProxyMount,
  IProxyMountOptions,
} from "../interfaces/IReverseProxy";
import {
  forwardRequest,
  forwardUpgrade,
  refuseUpgrade,
  type IForwardedFrom,
  type IRelaySettings,
  type ProxiedRequest,
  type ProxiedResponse,
} from "../src/proxy/forward";
import {
  isAmbiguousPath,
  normalizePrefix,
  parseProxyOrigin,
  proxyMountProblems,
  websocketHandshakeProblem,
} from "../src/proxy/rules";
import type { IHttpConfig } from "../config/config";

/** Replis si la section `proxy` manque (module construit hors configuration). */
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_SOCKETS = 256;

/** Un montage tel que le service le garde : la dernière cible analysée y est mise en cache. */
interface IMountRecord extends IProxyMount {
  /** D'où vient le montage : la configuration de l'application, ou un module. */
  readonly source: "config" | "module";
  /** Dernière origine rendue par `target`, et son analyse. */
  lastOrigin: string | undefined;
  lastUrl: URL | undefined;
  /** Pool de connexions vers l'amont, créé au premier relais (scheme de la cible). */
  agent: http.Agent | null;
  /** Tunnels WebSocket ouverts vers l'amont — bornés par `maxSockets`, hors pool. */
  tunnels: number;
}

/**
 * Ce que le proxy lit du noyau HTTP (résolu par nom) : les MÊMES règles que le
 * pipeline — barrière d'hôte, confiance des relais, `Origin` WebSocket.
 */
interface IHttpKernelRules {
  isTrustedHostname(hostname: string): boolean;
  getTrustProxyChecker(): { isTrusted(address: string | undefined): boolean };
  isWebsocketOriginAllowed(
    origin: string | undefined,
    hostname: string,
    secure: boolean,
  ): boolean;
  websocketQuotaRefusal(
    req: http.IncomingMessage,
    connection: { once(event: "close", listener: () => void): unknown },
  ): string | null;
}

/**
 * Proxy inverse de Nodefony : relaie un préfixe d'URL vers un autre serveur
 * HTTP — requêtes ET, sur demande, upgrades WebSocket — sur la MÊME origine
 * que la page. Le client ne voit qu'un serveur, un certificat ; l'amont peut
 * rester sur la boucle locale.
 *
 * Deux sources de montages, mêmes règles (`src/proxy/rules.ts`) : la section
 * `proxy.mounts` de la configuration, lue à la construction, et
 * {@link ReverseProxy.mount}, appelé par un module (`@nodefony/frontend` y
 * relaie `/_vite/<famille>/` vers ses serveurs Vite de développement). Un
 * module se résout ce service par NOM (`container.get("reverse-proxy")`) :
 * il n'a pas à importer `@nodefony/http`.
 *
 * Consulté AVANT le routage : une route attrape-tout de l'application ne peut
 * pas avaler un préfixe relayé. Sans montage, le pipeline ne paie qu'une
 * lecture de champ (`mounts === null`) — c'est le cas de toute application
 * qui ne s'en sert pas.
 *
 * Règles communes à tout montage : en-têtes de connexion jamais transmis
 * (RFC 9110 §7.6.1), `X-Forwarded-For/-Proto/-Host` et `Via` posés par le
 * proxy, Host hors `trustedHosts` jamais relayé (même barrière, même 421 que
 * toute requête), amont injoignable → 502, amont muet → 504, boucle → 508.
 */
class ReverseProxy extends Service {
  module: Module;
  /**
   * Montages actifs, du préfixe le PLUS LONG au plus court : le premier qui
   * couvre une URL est le plus spécifique. `null` tant qu'il n'y en a aucun.
   */
  mounts: IMountRecord[] | null = null;
  /** Délai d'inactivité appliqué aux montages qui n'en fixent pas (`proxy.timeoutMs`). */
  readonly defaultTimeoutMs: number;
  /** Délai d'établissement de la connexion amont (`proxy.connectTimeoutMs`). */
  readonly connectTimeoutMs: number;
  /** Connexions simultanées par amont (`proxy.maxSockets`) : pool ET tunnels WebSocket. */
  readonly maxSockets: number;
  /**
   * Arrêt engagé ({@link closeAll}) : un relais encore en vol ne recrée plus
   * de pool — il passerait après la fermeture et garderait ses sockets.
   */
  #closing = false;
  /**
   * Nom de CE processus dans `Via` (RFC 9110 §7.6.3) : tiré au hasard au
   * démarrage, il ne dit rien de la machine et distingue deux instances —
   * un message qui le porte déjà est une boucle (508).
   */
  readonly pseudonym = `nodefony-${randomBytes(4).toString("hex")}`;

  constructor(module: Module) {
    const container = module.container ?? undefined;
    const event = container?.get<Event>("notificationsCenter");
    super("reverse-proxy", container, event, {});
    this.module = module;
    const section = (module.options as Partial<IHttpConfig>).proxy;
    this.defaultTimeoutMs = section?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.connectTimeoutMs =
      section?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.maxSockets = section?.maxSockets ?? DEFAULT_MAX_SOCKETS;
    this.kernel?.prependOnceListener("onTerminate", () => this.closeAll());
    for (const [prefix, mount] of Object.entries(section?.mounts ?? {})) {
      this.#add(prefix, mount, "config");
    }
  }

  /**
   * Relaie un préfixe d'URL vers un amont. Idempotent pour un même module :
   * un même préfixe est remplacé. Un module qui recouvre un préfixe de la
   * CONFIGURATION le remplace aussi, mais le dit — l'auteur de l'application
   * doit pouvoir lire pourquoi son montage ne sert plus.
   *
   * @param prefix - préfixe d'URL (normalisé : `/` en tête et en fin)
   * @param options - cible et réglages du montage
   * @throws Error qui nomme chaque refus (préfixe `/` ou réservé, cible qui
   *   n'est pas une origine http(s) nue, `secure: false` hors boucle locale…)
   */
  mount(prefix: string, options: IProxyMountOptions): void {
    this.#add(prefix, options, "module");
  }

  #add(
    prefix: string,
    options: IProxyMountOptions,
    source: "config" | "module",
  ): void {
    const problems = proxyMountProblems(prefix, options, source);
    if (problems.length > 0) {
      throw new Error(
        `reverse-proxy : montage « ${prefix} » refusé — ` +
          problems.map((p) => `${p.field} : ${p.message}`).join(" ; "),
      );
    }
    const p = normalizePrefix(prefix);
    const record: IMountRecord = {
      ...options,
      prefix: p,
      source,
      lastOrigin: undefined,
      lastUrl: undefined,
      agent: null,
      tunnels: 0,
    };
    // Normalisés UNE fois ici : la comparaison par requête reste un `includes`.
    if (options.methods) {
      record.methods = options.methods.map((m) => m.toUpperCase());
    }
    if (options.stripHeaders) {
      record.stripHeaders = options.stripHeaders.map((h) => h.toLowerCase());
    }
    record.timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const mounts = (this.mounts ??= []);
    const i = mounts.findIndex((m) => m.prefix === p);
    if (i >= 0) {
      const previous = mounts[i];
      if (previous?.source === "config" && source === "module") {
        this.log(
          `le montage « ${p} » de la configuration est remplacé par un module`,
          "WARNING",
        );
      }
      previous?.agent?.destroy();
      mounts[i] = record;
    } else {
      mounts.push(record);
      mounts.sort((a, b) => b.prefix.length - a.prefix.length);
    }
    this.log(`mount ${p} (${source})`, "DEBUG");
  }

  /**
   * Retire un montage. Le dernier retiré rend `mounts` à `null` : le pipeline
   * cesse alors de le consulter.
   *
   * @param prefix - préfixe tel que monté (normalisé de la même façon)
   */
  unmount(prefix: string): void {
    if (this.mounts === null) return;
    const p = normalizePrefix(prefix);
    const kept: IMountRecord[] = [];
    for (const m of this.mounts) {
      // Un pool en keep-alive garde ses sockets ouverts : le fermer AVEC le montage.
      if (m.prefix === p) m.agent?.destroy();
      else kept.push(m);
    }
    this.mounts = kept.length > 0 ? kept : null;
  }

  /**
   * Ferme tous les pools (arrêt du noyau). Les montages restent déclarés ; un
   * relais encore en vol part ensuite sur une connexion à usage unique.
   */
  closeAll(): void {
    this.#closing = true;
    for (const m of this.mounts ?? []) {
      m.agent?.destroy();
      m.agent = null;
    }
  }

  /**
   * Montage le plus spécifique qui couvre une URL, s'il y en a un.
   *
   * @param url - cible brute de la requête (chemin + requête)
   * @returns le montage au préfixe le plus long qui couvre l'URL
   */
  match(url: string | undefined): IProxyMount | undefined {
    const mounts = this.mounts;
    if (mounts === null || url === undefined) return undefined;
    for (const m of mounts) if (url.startsWith(m.prefix)) return m;
    return undefined;
  }

  /**
   * Origine courante d'un montage, analysée — mise en cache tant que la cible
   * rend la même chaîne.
   *
   * @returns l'URL de l'amont, ou `undefined` si rien n'est relayable
   */
  private targetOf(mount: IMountRecord): URL | undefined {
    const origin =
      typeof mount.target === "string" ? mount.target : mount.target();
    if (origin === undefined) return undefined;
    if (origin === mount.lastOrigin) return mount.lastUrl;
    const url = parseProxyOrigin(origin) ?? undefined;
    if (url === undefined) {
      this.log(
        `cible « ${origin} » invalide pour ${mount.prefix} — non relayé`,
        "WARNING",
      );
    }
    mount.lastOrigin = origin;
    mount.lastUrl = url;
    return url;
  }

  /**
   * Pool de connexions d'un montage, créé au premier relais et recréé si la
   * cible change de scheme.
   *
   * Un `Agent` DÉDIÉ, jamais l'agent global : sous `NODE_USE_ENV_PROXY`, cas
   * courant d'un poste d'entreprise, l'agent global envoie tout vers
   * `HTTP_PROXY` — un amont sur la boucle locale serait demandé au proxy de
   * l'entreprise. Un agent construit ici n'a pas de `proxyEnv` : il va droit
   * à la cible. Keep-alive borné (`maxSockets`), `lifo` : le socket le plus
   * récent, le moins susceptible d'avoir été fermé par l'amont.
   */
  private agentFor(mount: IMountRecord, target: URL): http.Agent | false {
    if (this.#closing) return false;
    const wantsTls = target.protocol === "https:";
    const agent = mount.agent;
    if (agent !== null && agent instanceof https.Agent === wantsTls)
      return agent;
    agent?.destroy();
    const options = {
      keepAlive: true,
      maxSockets: this.maxSockets,
      maxFreeSockets: Math.min(32, this.maxSockets),
      scheduling: "lifo" as const,
    };
    mount.agent = wantsTls ? new https.Agent(options) : new http.Agent(options);
    return mount.agent;
  }

  /** Réglages de relais d'un montage. */
  private relayFor(mount: IMountRecord, target: URL): IRelaySettings {
    return {
      pseudonym: this.pseudonym,
      connectTimeoutMs: this.connectTimeoutMs,
      agent: this.agentFor(mount, target),
    };
  }

  /** Règles du noyau HTTP (résolues par nom), `undefined` hors serveur. */
  private rules(): IHttpKernelRules | undefined {
    return this.container?.get<IHttpKernelRules>("HttpKernel") ?? undefined;
  }

  /** Ce que le proxy annonce à l'amont sur le client. */
  private fromOf(
    req: ProxiedRequest,
    scheme: string,
    host: string | undefined,
  ): IForwardedFrom {
    const address = req.socket.remoteAddress;
    return {
      remoteAddress: address,
      scheme,
      host,
      trustedPeer:
        this.rules()?.getTrustProxyChecker().isTrusted(address) === true,
      httpVersion: req.httpVersion,
    };
  }

  /**
   * Relaie une requête HTTP si un montage la couvre — méthode comprise. Cible
   * pas encore connue → `503` + `Retry-After`, sans aller jusqu'au routage.
   *
   * L'appelant a déjà tranché la barrière d'hôte : c'est le pipeline HTTP, qui
   * la calcule pour toute requête (`Context.validDomain`). Un chemin ambigu
   * sous un préfixe monté rend 400, sans contacter l'amont.
   *
   * ⚠️ Un préfixe monté est servi AVANT le pare-feu, la CSRF et les en-têtes
   * de sécurité applicatifs : c'est une surface publique pour qui atteint
   * Nodefony. L'amont porte sa propre politique d'accès.
   *
   * @param req - requête du client
   * @param res - réponse au client
   * @param scheme - scheme par lequel le client est arrivé
   * @returns la promesse de fin d'échange, ou `undefined` si la requête n'est
   *   pas relayée (hors préfixe ou méthode non relayée : elle suit alors son
   *   chemin normal)
   */
  forward(
    req: ProxiedRequest,
    res: ProxiedResponse,
    scheme: string,
  ): Promise<void> | undefined {
    const mount = this.match(req.url) as IMountRecord | undefined;
    if (mount === undefined) return undefined;
    const method = req.method ?? "GET";
    if (mount.methods && !mount.methods.includes(method)) return undefined;
    const target = this.targetOf(mount);
    if (target === undefined) {
      // Le préfixe est À l'amont, même quand il n'écoute pas encore (Vite en
      // démarrage) : laisser filer jusqu'au routage rendrait un 404 qui ment —
      // la ressource existe, son serveur n'est pas prêt (RFC 9110 §15.6.4).
      return answerPlain(res, 503, "Service Unavailable", "1");
    }
    if (isAmbiguousPath(req.url ?? "/")) {
      return answerPlain(res, 400, "Bad Request");
    }
    const host =
      req.headers.host ?? (req.headers[":authority"] as string | undefined);
    return forwardRequest(
      req,
      res,
      mount,
      target,
      this.fromOf(req, scheme, host),
      this.relayFor(mount, target),
    );
  }

  /**
   * Relaie un upgrade WebSocket si un montage `websocket` couvre son URL.
   * Appelé par le répartiteur d'`upgrade` des serveurs WebSocket, AVANT le
   * serveur WebSocket de Nodefony.
   *
   * Contrôles, dans l'ordre, chacun avec la réponse que rendrait le serveur
   * WebSocket de Nodefony : cible pas encore connue → 503 ; `Host` hors `trustedHosts` (si `domainCheck`) →
   * 421 ; chemin ambigu ou handshake non conforme (RFC 6455 §4.2.1 — seul
   * `Upgrade: websocket` est relayé, jamais un tunnel `h2c`) → 400 ;
   * `Origin` refusée par la MÊME règle que le serveur WebSocket (anti-CSWSH,
   * RFC 6455 §10.2) → 403 ; `maxSockets` tunnels déjà ouverts vers l'amont →
   * 503 ; quotas par IP du noyau (débit de handshakes, connexions
   * simultanées) → 429. Le socket est alors consommé.
   *
   * @returns `true` si le proxy a pris le socket en charge
   */
  handleUpgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    const mount = this.match(req.url) as IMountRecord | undefined;
    if (mount?.websocket !== true) return false;
    const target = this.targetOf(mount);
    if (target === undefined) {
      // Amont pas encore prêt : un refus HTTP AVANT le 101 (RFC 6455 §4.2.2).
      // Laisser filer vers le serveur WebSocket de Nodefony accepterait la
      // socket puis la fermerait — et un client qui sonde « le serveur est-il
      // revenu ? » par une ouverture (le client Vite) conclurait oui à tort.
      refuseUpgrade(socket, 503, "Service Unavailable");
      return true;
    }
    const host = req.headers.host;
    const hostname = hostnameOf(host);
    const rules = this.rules();
    if (
      this.kernel?.options.domainCheck &&
      (hostname === null || rules?.isTrustedHostname(hostname) !== true)
    ) {
      refuseUpgrade(socket, 421, "Misdirected Request");
      return true;
    }
    if (
      hostname === null ||
      isAmbiguousPath(req.url ?? "/") ||
      websocketHandshakeProblem(req.method, req.headers) !== null
    ) {
      refuseUpgrade(socket, 400, "Bad Request");
      return true;
    }
    const secure = req.socket instanceof TLSSocket;
    if (
      rules !== undefined &&
      !rules.isWebsocketOriginAllowed(req.headers.origin, hostname, secure)
    ) {
      refuseUpgrade(socket, 403, "Forbidden");
      return true;
    }
    // Un tunnel ne prend pas de socket du pool : sans cette borne, chaque
    // upgrade ouvrirait une connexion amont de plus, sans limite.
    if (mount.tunnels >= this.maxSockets) {
      refuseUpgrade(socket, 503, "Service Unavailable");
      return true;
    }
    // Mêmes quotas par IP qu'un upgrade servi par Nodefony. Avant le 101 :
    // le refus est un statut HTTP (429), là où `ws` ne peut plus que fermer.
    if (rules?.websocketQuotaRefusal(req, socket) != null) {
      refuseUpgrade(socket, 429, "Too Many Requests");
      return true;
    }
    mount.tunnels++;
    socket.once("close", () => {
      mount.tunnels--;
    });
    forwardUpgrade(
      req,
      socket,
      head,
      mount,
      target,
      this.fromOf(req, secure ? "https" : "http", host),
      this.relayFor(mount, target),
    );
    return true;
  }
}

/**
 * Nom d'hôte d'une autorité `Host`, sans port (`[::1]` garde ses crochets,
 * comme `URL.hostname`).
 *
 * @returns le nom, ou `null` si l'autorité est absente ou invalide
 */
/**
 * Répond au client sans contacter l'amont : texte brut, jamais mis en cache.
 *
 * @param res - réponse au client (HTTP/1.1 ou HTTP/2, API de compatibilité)
 * @param status - statut rendu
 * @param body - corps texte
 * @param retryAfter - valeur de `Retry-After` (secondes), si le refus est passager
 * @returns une promesse déjà résolue — l'échange est terminé
 */
function answerPlain(
  res: ProxiedResponse,
  status: number,
  body: string,
  retryAfter?: string,
): Promise<void> {
  // Les deux réponses partagent `writeHead`/`end`, mais leurs surcharges
  // diffèrent : l'union ne se laisse pas appeler telle quelle.
  const out = res as http.ServerResponse;
  out.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  });
  out.end(body);
  return Promise.resolve();
}

function hostnameOf(host: string | undefined): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export default ReverseProxy;
