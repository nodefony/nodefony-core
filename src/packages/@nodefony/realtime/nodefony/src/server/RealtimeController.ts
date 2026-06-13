import {
  JsonRpcPeer,
  RpcError,
  type RpcActionHandler,
  type JsonRpcPeerOptions,
  type IRealtimeWelcome,
} from "nodefony";
import type { WebsocketContext } from "@nodefony/http";
import { Controller } from "@nodefony/framework";
import {
  WsConnectionTransport,
  type RawWsConnection,
} from "../transport/WsConnectionTransport";
import { getRealtimeHub, type ChannelSink } from "./RealtimeHub";
import { ANONYMOUS_REALTIME_TOKEN } from "./AnonymousRealtimeToken";
import type {
  IRealtimeController,
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController";
import type { IRealtimeHandshake } from "../../interfaces/IRealtimeHandshake";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";
import {
  getRealtimeActions,
  getRealtimeChannels,
  getRealtimeInbound,
  type RealtimeChannelFactory,
} from "../../decorators/realtimeDecorators";

/** État realtime PAR connexion ws, stocké sur le contexte (persiste entre messages). */
interface RealtimeConnState {
  welcomed: boolean;
  peer: JsonRpcPeer;
  transport: WsConnectionTransport;
  /** canal → sink de CETTE connexion auprès du hub partagé (pour se désabonner). */
  channels: Map<string, ChannelSink>;
  /** canaux full-duplex acceptant une entrée client (null si aucun — cas par défaut). */
  inbound: Record<string, RealtimeInboundHandler> | null;
}

interface RealtimeHolder {
  __nfRealtime?: RealtimeConnState;
}

/**
 * RealtimeController — base d'un endpoint WebSocket temps réel SERVEUR (JSON-RPC 2.0).
 *
 * Factorise TOUT le protocole (handshake/welcome, discrimination request/notification/
 * response via {@link JsonRpcPeer}, actions `result`/`error`, pub/sub par canal, cleanup)
 * — écrit UNE fois, partagé par tous les modules. Un contrôleur concret ne déclare que
 * son métier : {@link createRealtimeChannel} (providers de canaux) + {@link realtimeActions}.
 *
 * Chaque connexion compose un `JsonRpcPeer` (le MÊME que `RealtimeClient` côté navigateur
 * — symétrie isomorphe) branché sur un {@link WsConnectionTransport}.
 *
 * Usage : le sous-classe garde sa route WS et délègue —
 * ```ts
 * @route("ws", { path: "/realtime", requirements: { methods: ["WEBSOCKET"] } })
 * async realtime(message: string | Buffer | null) { this.handleRealtime(message); }
 * ```
 *
 * Perf : les canaux sont **partagés** via {@link RealtimeHub} (1 provider/canal/pod, pas
 * 1 par connexion) ; chaque connexion n'ajoute/retire qu'un *sink* (fan-out). Provider
 * créé au 1ᵉʳ abonné, `dispose()` au dernier (`unsubscribe` ou `onFinish`). Le dispatch
 * d'action n'est payé que sur une requête `id`. C'est aussi le seam du backplane Redis.
 */
export abstract class RealtimeController
  extends Controller
  implements IRealtimeController
{
  /**
   * Map des factories de canaux EXACT, lue depuis les décorateurs `@RealtimeChannel`
   * au handshake (cold-path) et mémoïsée par instance. `null` = pas de décorateur
   * sur cette classe → la base court-circuite la lecture metadata par frame.
   */
  private _decoratedChannels: Record<string, RealtimeChannelFactory> | null =
    null;

  /**
   * Crée le provider d'un canal (listener/ticker → `publish`) et renvoie son `dispose`.
   * `null` si le canal est inconnu — la base ne souscrit pas.
   *
   * **Deux façons de déclarer un canal** (coexistent sans casse) :
   *  1. **Décorateur `@RealtimeChannel(name)`** sur une méthode (match EXACT, déclaratif).
   *  2. **Override de cette méthode** (pattern/regex, suffixe `:<ms>`, drill `@<pid>`).
   *
   * La base CONSULTE D'ABORD les décorateurs ; si aucun match, elle appelle
   * cette méthode (fallback). Défaut : `null`. Un controller qui n'utilise QUE
   * des décorateurs peut donc se passer d'override.
   */
  createRealtimeChannel(
    _channel: string,
    _publish: RealtimePublish,
  ): (() => void) | null {
    return null;
  }

  /** Actions RPC exposées (requête→réponse). À surcharger ; défaut : aucune. */
  protected realtimeActions(): Record<string, RpcActionHandler> {
    return {};
  }

  /** Canaux annoncés au handshake. À surcharger ; défaut : aucun. */
  protected realtimeChannels(): string[] {
    return [];
  }

  /**
   * Préfixes de canaux **broadcast** (cross-process) de cet endpoint. À surcharger ;
   * défaut : **aucun** → tous les canaux restent **instance-local** (observabilité,
   * état du pod). Un canal listé ici traverse le {@link IBackplane} (cluster IPC /
   * Redis) : chat, présence, notifications… Cf {@link RealtimeHub.markBroadcastChannel}
   * (défaut sûr : pas de fuite cross-pod de données per-instance sans intention explicite).
   */
  protected realtimeBroadcastChannels(): string[] {
    return [];
  }

  /**
   * Canaux FULL-DUPLEX acceptant une entrée client (`method` = nom du canal). À
   * surcharger ; défaut : **aucun** (sûr — un client ne peut rien pousser au serveur
   * tant qu'un canal n'est pas explicitement déclaré ici). Seam des backings entrants
   * (SIP, bridge). Cf {@link RealtimeInboundHandler} (params NON FIABLES).
   */
  protected realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {};
  }

  /**
   * Opt-in du **pont API** (« API souveraine », POC Ph.3) : `true` → la
   * connexion expose la méthode RPC `api.request {path}` qui re-route le path
   * porté par le message vers l'action controller correspondante — la MÊME
   * action que le GET REST (`socket.request("/nodefony/kernel/api/modules")`
   * côté client). Le pont n'atteint QUE les routes déclarant le transport
   * `WEBSOCKET` dans leurs `methods` (zéro bypass : une action dit à quels
   * transports elle répond). À surcharger ; défaut : `false` — aucune surface
   * d'invocation ajoutée à un hub sans intention explicite.
   */
  protected realtimeApiRequest(): boolean {
    return false;
  }

  /**
   * Point d'entrée à appeler depuis la route WS du contrôleur. `message === null`
   * = handshake (1ʳᵉ invocation) ; sinon = frame entrante.
   *
   * Le handshake est désormais ASYNC (seams sécu #2/#4 : origin check + run
   * d'authenticator au handshake). Les frames texte entrantes pendant
   * l'authentification sont DROP silencieusement (transport pas encore branché —
   * c'est le client qui doit attendre `realtime:welcome` avant de pousser, ce
   * que `RealtimeClient` fait nativement).
   */
  protected handleRealtime(message: string | Buffer | null): void {
    const ctx = this.context as WebsocketContext | undefined;
    if (!ctx) return;
    if (message == null) {
      // Fire-and-forget — l'auth WS peut être async (cookie JWT → vérif sig…).
      // Erreurs déjà gérées dans `onHandshake` (close socket + log). Ce `void`
      // évite un unhandled rejection si quelque chose throw au-delà du catch.
      void this.onHandshake(ctx);
      return;
    }
    (ctx as unknown as RealtimeHolder).__nfRealtime?.transport.feed(
      message.toString(),
    );
  }

  /**
   * **L1 — duplex serveur→client.** Émet une REQUÊTE vers le client de CETTE
   * connexion (sur une action qu'il a exposée via `client.register(...)`) et attend
   * sa réponse. Possible depuis L0 : le client compose le même `JsonRpcPeer`, il
   * est donc un *callee* (avant L0 : `-32601` systématique).
   *
   * Usages : confirmation d'action (le serveur demande au client de valider),
   * invalidation de cache poussée AVEC accusé, health applicatif serveur→client.
   * Pour une notification sans réponse → {@link notifyClient} (ou un canal pub/sub).
   *
   * @returns le `result` du handler client ; rejette sur erreur applicative
   *   ({@link RpcError} `code`/`data` préservés), méthode inconnue (`-32601`),
   *   timeout, ou connexion fermée (`dispose`).
   * @throws (rejet) si le handshake n'est pas terminé (aucun peer encore).
   */
  protected requestClient<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const state = (this.context as unknown as RealtimeHolder).__nfRealtime;
    if (!state) {
      return Promise.reject(
        new Error(
          "requestClient: connexion realtime non établie (welcome non émis)",
        ),
      );
    }
    return state.peer.request(
      method as never,
      params as never,
      timeoutMs,
    ) as Promise<T>;
  }

  /**
   * Notification CIBLÉE serveur→client (sans réponse) vers CETTE connexion, hors
   * canal pub/sub — pendant *fire-and-forget* de {@link requestClient}. Pour un
   * fan-out à N abonnés, préférer un canal (`publish` via le hub). No-op si le
   * handshake n'est pas terminé.
   */
  protected notifyClient(method: string, params?: unknown): void {
    const state = (this.context as unknown as RealtimeHolder).__nfRealtime;
    state?.peer.notify(method as never, params as never);
  }

  /**
   * Handshake : seams sécurité #4 (Origin RFC 6455 §10.2) + #2 (authenticator
   * réseau) PUIS crée peer+transport, enregistre les actions, welcome + cleanup.
   *
   * Pipeline (cold path, 1× par connexion) :
   *  1. Origin check via `hub.checkOrigin()` (bypass si `csrf.checkOrigin.enabled=false`).
   *  2. Resolve authenticator via `hub.resolveAuthenticator(handshake)` (matchers
   *     ordonnés, 1ʳᵉ qui matche capture) → `authenticate()` async.
   *  3. Aucun match OU `enabled=false` → `ANONYMOUS_REALTIME_TOKEN`.
   *  4. Pose le token sur `hub.peer → token` (lookup voters P6 hot-path).
   *
   * Échecs (close WebSocket, codes plage applicative RFC 6455 §7.4.2) :
   *  - Origin refusée    → code 4003 (`forbidden`).
   *  - `authenticate` throw → code 4001 (`unauthorized`).
   */
  private async onHandshake(ctx: WebsocketContext): Promise<void> {
    const holder = ctx as unknown as RealtimeHolder;
    if (holder.__nfRealtime?.welcomed) return;
    const conn = ctx.connection as RawWsConnection | null;
    if (!conn) return;

    const hub = getRealtimeHub();
    const handshake = buildHandshakeFromContext(ctx);

    // Seam #4 — Origin check natif (CSRF defense). Bypass O(1) si pas de guard.
    if (!hub.checkOrigin(handshake.origin)) {
      this.log(
        `WS realtime upgrade refused: Origin "${handshake.origin ?? "(missing)"}" not allowed`,
        "WARNING",
      );
      conn.close(4003, "origin not allowed");
      return;
    }

    // Seam #2 — Authenticator réseau. Fallback ANONYMOUS si aucun matcher.
    const authenticator = hub.resolveAuthenticator(handshake);
    let token: IRealtimeToken;
    if (authenticator !== null && authenticator.supports(handshake)) {
      try {
        token = await authenticator.authenticate(handshake);
        authenticator.onSuccess?.(handshake, token);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        try {
          authenticator.onFailure?.(handshake, err);
        } catch {
          /* hooks d'audit fautifs ne bloquent pas la fermeture */
        }
        this.log(
          `WS realtime auth failed (${authenticator.name}): ${err.message}`,
          "WARNING",
        );
        conn.close(4001, "unauthorized");
        return;
      }
    } else {
      token = ANONYMOUS_REALTIME_TOKEN;
    }

    const transport = new WsConnectionTransport(conn);
    const peerOptions: JsonRpcPeerOptions = {
      send: (frame) => transport.send(JSON.stringify(frame)),
      onNotification: (method, params) =>
        this.onRealtimeNotification(ctx, method, params),
      onError: (context, err) =>
        this.log(
          `${context}: ${err instanceof Error ? err.message : String(err)}`,
          "ERROR",
        ),
    };
    // Seam #1 — VERROU DE FRAME (P6). Branché SEULEMENT si une politique est
    // posée sur le hub (`hasFrameAuthorizer`, cold-path check 1× au handshake) :
    // un hub non sécurisé garde `beforeDispatch === undefined` → bypass 0-coût
    // du peer sur CHAQUE frame (cf doctrine perf). `peer` est capturé par closure
    // (clé du mapping `peer → token`) — référence DIFFÉRÉE, jamais évaluée
    // pendant la construction, donc pas de TDZ à l'exécution.
    if (hub.hasFrameAuthorizer()) {
      peerOptions.beforeDispatch = (frame) => hub.runAuthorizer(frame, peer);
      peerOptions.onFrameAudit = (reason) => {
        // Zero Trust : une frame REFUSÉE est tracée (audit P6.14, cold path). Les
        // autres motifs (invalid/method_not_found/internal_error) sont déjà gérés
        // par le peer (réponse d'erreur normalisée) → pas de double log.
        if (reason === "denied") {
          this.log("WS realtime frame refused by authorizer", "WARNING");
        }
      };
    }
    const peer = new JsonRpcPeer(peerOptions);
    // Pose `peer → token` AVANT le welcome → voters/audit lookup garanti dès
    // la 1ʳᵉ frame entrante (hot-path O(1) via WeakMap).
    hub.setTokenForPeer(peer, token);
    transport.onMessage((raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return; // frame illisible → ignorée
      }
      peer.receive(parsed);
    });
    // Actions = décorateurs `@RealtimeAction` + override `realtimeActions()`. L'override
    // gagne en cas de conflit (un user peut volontairement écraser un décorateur hérité).
    const decoratedActions = getRealtimeActions(this);
    const allActions: Record<string, RpcActionHandler> = {
      ...(decoratedActions ?? {}),
      ...this.realtimeActions(),
    };
    for (const [name, handler] of Object.entries(allActions)) {
      peer.register(name, handler);
    }
    // Pont API souverain (opt-in) — enregistré APRÈS les actions custom : la
    // plateforme garde la main sur `api.request` quand le pont est activé.
    if (this.realtimeApiRequest()) {
      peer.register("api.request", (params) =>
        this.invokeApiRequest(ctx, params),
      );
    }

    // Map des canaux décorés (cold-path) — mémoïsé sur l'instance pour que les
    // `subscribe` ultérieurs (chaque frame entrante) lookup en O(1) sans toucher
    // au reflect-metadata.
    this._decoratedChannels = getRealtimeChannels(this);

    // Sonde socket : la connexion (= ce transport) entre au registre du hub. La
    // backpressure (`bufferedAmount`) vit sur la connexion brute → seul le transport
    // l'expose. Retiré au close (onFinish, plus bas). `hub` réutilisé depuis le
    // seam #2 plus haut (même scope) — pas de relookup.
    hub.registerConnection(transport);

    // Politique de forward : déclare les canaux broadcast (cross-process) de cet
    // endpoint au hub (idempotent, cold-path). Défaut = aucun → tout instance-local.
    const broadcast = this.realtimeBroadcastChannels();
    for (let i = 0; i < broadcast.length; i++) {
      hub.markBroadcastChannel(broadcast[i]!);
    }

    // Canaux full-duplex = décorateurs `@RealtimeInbound` + override `realtimeInbound()`.
    // `null` si AUCUN des deux n'en déclare → 0 lookup sur le chemin notification.
    const decoratedInbound = getRealtimeInbound(this);
    const overrideInbound = this.realtimeInbound();
    const inboundMap: Record<string, RealtimeInboundHandler> = {
      ...(decoratedInbound ?? {}),
      ...overrideInbound,
    };
    const inbound = Object.keys(inboundMap).length > 0 ? inboundMap : null;

    const state: RealtimeConnState = {
      welcomed: true,
      peer,
      transport,
      channels: new Map(),
      inbound,
    };
    holder.__nfRealtime = state;

    ctx.once?.("onFinish", () => {
      // Désabonne CETTE connexion de tous ses canaux : le hub dispose le provider
      // partagé au dernier abonné (aucun timer/listener orphelin).
      const hub = getRealtimeHub();
      for (const [channel, sink] of state.channels) {
        hub.unsubscribe(channel, sink);
      }
      state.channels.clear();
      hub.unregisterConnection(transport); // sonde : sortie symétrique du registre
      transport.fireClose();
      peer.dispose("ws closed");
      this.log("WS realtime client disconnected — cleanup done", "INFO");
    });

    // `realtime:welcome` annonce canaux + actions découvrables (décorateurs + override).
    const announcedChannels = [
      ...(this._decoratedChannels ? Object.keys(this._decoratedChannels) : []),
      ...this.realtimeChannels(),
    ];
    // L'identité est lue sur le `token` NEUTRE (`IRealtimeToken`) déjà résolu au
    // handshake (authenticator P6 ou `ANONYMOUS_REALTIME_TOKEN`) — 0 dépendance
    // security, 0 re-lecture base. Le client la consomme pour savoir QUI il est
    // sans taper de route (anonyme → login). Vue « sur soi » : aucun secret.
    const welcome: IRealtimeWelcome = {
      ts: Date.now(),
      protocol: "jsonrpc-2.0",
      channels: announcedChannels,
      methods: peer.methods,
      identity: {
        type: token.type,
        authenticated: token.isAuthenticated(),
        userIdentifier: token.getUserIdentifier(),
        roles: token.getRoles(),
        scopes: token.getScopes(),
      },
    };
    peer.notify("realtime:welcome", welcome);
    this.log("WS realtime client connected", "INFO");
  }

  /**
   * Notifications entrantes : pub/sub (subscribe/unsubscribe), heartbeat (ping), puis
   * canaux FULL-DUPLEX déclarés (entrée client → handler `realtimeInbound`).
   */
  private onRealtimeNotification(
    ctx: WebsocketContext,
    method: string,
    params: unknown,
  ): void {
    if (method === "subscribe") {
      this.startChannel(
        ctx,
        (params as { channel?: string } | undefined)?.channel,
      );
      return;
    }
    if (method === "unsubscribe") {
      this.stopChannel(
        ctx,
        (params as { channel?: string } | undefined)?.channel,
      );
      return;
    }
    // Full-duplex : `method` == nom du canal entrant déclaré → handler (per-connexion).
    const state = (ctx as unknown as RealtimeHolder).__nfRealtime;
    const handler = state?.inbound?.[method];
    if (handler) {
      getRealtimeHub().recordInbound(); // sonde : frame full-duplex entrante
      // reply = push serveur→client sur le MÊME canal, vers CETTE connexion.
      handler(params, (payload) => state!.peer.notify(method, payload));
    }
    // `ping` = heartbeat no-op ; notification inconnue = ignorée.
  }

  /** Abonne la connexion à un canal via le hub partagé (idempotent par connexion). */
  private startChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = (ctx as unknown as RealtimeHolder).__nfRealtime;
    if (!state || state.channels.has(channel)) return;
    // Sink de CETTE connexion : pousse la charge fan-outée par le hub sur son peer.
    const sink: ChannelSink = (payload) => state.peer.notify(channel, payload);
    // Le hub PARTAGE le provider entre connexions (1 ticker/canal/pod) ; la factory
    // (appelée au 1ᵉʳ abonné) doit capturer des deps long-lived — cf createRealtimeChannel.
    //
    // Ordre de résolution : décorateur `@RealtimeChannel` (match EXACT, O(1)) d'abord,
    // sinon fallback sur l'override classique `createRealtimeChannel` (regex, suffixes,
    // drill cluster). Coexistence sans casse pour les controllers historiques.
    const ok = getRealtimeHub().subscribe(channel, sink, (ch, publish) => {
      const decFactory = this._decoratedChannels?.[ch];
      if (decFactory) return decFactory(ch, publish);
      return this.createRealtimeChannel(ch, publish);
    });
    if (ok) {
      state.channels.set(channel, sink);
      this.log(`WS subscribe → ${channel}`, "DEBUG");
    }
  }

  /**
   * Handler de la méthode RPC `api.request {path}` — le **pont API souverain**
   * (POC Ph.3) : résout le path porté par le message via le Router
   * (`cleanPathOverride` — l'URL de la connexion n'est jamais mutée) puis
   * exécute l'action SANS la rendre (`executeAction`) : la valeur nue est
   * enveloppée `{id, result}` par le peer — snapshot ≡ GET REST par
   * construction.
   *
   * Query : le `?…` du path invoqué est parsé ici (paires plates, clés répétées
   * → array — sémantique `qs` plate) et porté par `resolver.queryOverride`
   * (per-invocation : zéro bleed entre requêtes concurrentes de la même
   * socket). Limitation POC assumée : syntaxe nested `a[b]=c` non supportée
   * par le pont (doc §11 — le parse complet du transport HTTP n'est pas
   * mutualisé tant que Ph.6 n'a pas tranché).
   *
   * Erreurs → {@link RpcError} (`data.status` = statut HTTP équivalent) :
   * `-32602` params invalides, 404 path inconnu, 408 timeout d'action…
   * Tout autre throw de l'action reste opaque (`-32603`, Zero Trust).
   */
  private async invokeApiRequest(
    ctx: WebsocketContext,
    params: unknown,
  ): Promise<unknown> {
    const path = (params as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string" || path.charCodeAt(0) !== 47 /* "/" */) {
      throw new RpcError("api.request: params.path invalide", -32602);
    }
    const router = ctx.router;
    if (!router) {
      throw new RpcError("api.request: router indisponible", -32000, {
        status: 500,
      });
    }
    // Query du path INVOQUÉ séparée avant le match (le Router matche un pathname).
    const qIdx = path.indexOf("?");
    const pathname = qIdx === -1 ? path : path.slice(0, qIdx);
    let resolver: ReturnType<typeof router.resolve>;
    try {
      resolver = router.resolve(ctx, pathname);
    } catch (e) {
      // Le Router THROW un HttpError 405 agrégé (RFC 9110 §15.5.6) quand le
      // path existe mais sans le transport WEBSOCKET — même sémantique que le
      // REST, exposée fetch-like. Duck-typing (pas d'import runtime http ici) ;
      // tout code non-HTTP reste opaque (re-throw → `-32603`, Zero Trust).
      const code = (e as { code?: unknown }).code;
      if (typeof code === "number" && code >= 400 && code <= 599) {
        throw new RpcError(e instanceof Error ? e.message : String(e), -32000, {
          status: code,
        });
      }
      throw e;
    }
    if (!resolver.resolve) {
      throw new RpcError(`api.request: not found ${pathname}`, -32000, {
        status: 404,
      });
    }
    if (qIdx !== -1 && qIdx < path.length - 1) {
      const sp = new URLSearchParams(path.slice(qIdx + 1));
      const query: Record<string, unknown> = {};
      for (const [k, v] of sp) {
        const prev = query[k];
        if (prev === undefined) query[k] = v;
        else if (Array.isArray(prev)) (prev as string[]).push(v);
        else query[k] = [prev as string, v];
      }
      resolver.queryOverride = query;
    }
    // `reload = true` : le container de la connexion porte CE hub sous
    // "controller" — sans reload, l'action serait cherchée sur la mauvaise
    // instance (seam découvert au POC Ph.1). Singleton-safe (cache Router).
    const { result } = await resolver.executeAction(undefined, true);
    // L'action peut retourner un thenable — déballé avant l'enveloppe peer.
    return await Promise.resolve(result);
  }

  /** Désabonne la connexion d'un canal (le hub dispose le provider au dernier abonné). */
  private stopChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = (ctx as unknown as RealtimeHolder).__nfRealtime;
    const sink = state?.channels.get(channel);
    if (sink) {
      getRealtimeHub().unsubscribe(channel, sink);
      state!.channels.delete(channel);
      this.log(`WS unsubscribe → ${channel}`, "DEBUG");
    }
  }
}

/**
 * Construit un {@link IRealtimeHandshake} immuable depuis le `WebsocketContext`
 * de @nodefony/http — DTO neutre passé aux authenticators réseau (zéro
 * dépendance security/http côté contrat). Cold path (1× par upgrade).
 *
 * - `cookies` est aplati en `Map<string, string>` (Context expose
 *   `Record<string, Cookie>` — on ne garde que `name → value`, les options
 *   path/domain/expires ne sont pas utiles à l'authenticator).
 * - `protocols` : la liste des sous-protocoles annoncés (`Sec-WebSocket-Protocol`,
 *   csv séparé virgule selon RFC 6455 §4.1).
 */
function buildHandshakeFromContext(ctx: WebsocketContext): IRealtimeHandshake {
  const req = ctx.request;
  const headers = (req?.headers ?? {}) as Record<
    string,
    string | string[] | undefined
  >;

  // Cookies → Map<string, string> (le Context expose un Record<name, Cookie>).
  const cookies = new Map<string, string>();
  const rawCookies = (ctx.cookies ?? {}) as Record<
    string,
    { value?: unknown } | undefined
  >;
  for (const name in rawCookies) {
    const c = rawCookies[name];
    if (c && typeof c.value === "string") cookies.set(name, c.value);
  }

  // Sec-WebSocket-Protocol : peut être string CSV ou string[] ; on normalise.
  const rawProto = headers["sec-websocket-protocol"];
  let protocols: string[];
  if (Array.isArray(rawProto)) {
    protocols = rawProto.flatMap((p) => p.split(",").map((x) => x.trim()));
  } else if (typeof rawProto === "string") {
    protocols = rawProto
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  } else {
    protocols = [];
  }

  return {
    headers,
    cookies,
    // CONTRAT IRealtimeHandshake.url = **pathname + query** (ce que matchent les
    // matchers d'authenticator, comme `firewall.matchPath` côté HTTP). Or
    // `WebsocketContext.url` est l'URL ABSOLUE (`wss://host:port/path?q`) → on
    // extrait le path, sinon un matcher `^/nodefony/…` ne matcherait jamais une
    // URL préfixée du scheme (bug J3b : authenticator de zone jamais résolu).
    url: handshakePath(ctx),
    remoteAddress: ctx.remoteAddress ?? "",
    origin: ctx.origin && ctx.origin.length > 0 ? ctx.origin : undefined,
    protocols,
  };
}

/**
 * Extrait le **path** (pathname + query) de l'URL du handshake. `WebsocketContext.url`
 * est absolue (`url.format(wsUrl)`) ; un path relatif (tests/clients legacy) est
 * conservé tel quel. Jamais throw (cold path, 1× par upgrade).
 */
function handshakePath(ctx: WebsocketContext): string {
  const raw = (ctx as { url?: unknown }).url;
  if (typeof raw !== "string" || raw.length === 0) return "/";
  try {
    const u = new URL(raw); // URL absolue → pathname + search
    return u.pathname + u.search;
  } catch {
    return raw.charCodeAt(0) === 47 /* "/" */ ? raw : "/";
  }
}

export default RealtimeController;
