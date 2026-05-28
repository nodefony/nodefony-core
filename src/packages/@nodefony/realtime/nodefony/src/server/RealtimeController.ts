import { JsonRpcPeer, type RpcActionHandler } from "nodefony";
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
    const peer = new JsonRpcPeer({
      send: (frame) => transport.send(JSON.stringify(frame)),
      onNotification: (method, params) =>
        this.onRealtimeNotification(ctx, method, params),
      onError: (context, err) =>
        this.log(
          `${context}: ${err instanceof Error ? err.message : String(err)}`,
          "ERROR",
        ),
    });
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
    peer.notify("realtime:welcome", {
      ts: Date.now(),
      protocol: "jsonrpc-2.0",
      channels: announcedChannels,
      methods: peer.methods,
    });
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
    url: ctx.url ?? req?.url ?? "/",
    remoteAddress: ctx.remoteAddress ?? "",
    origin: ctx.origin && ctx.origin.length > 0 ? ctx.origin : undefined,
    protocols,
  };
}

export default RealtimeController;
