import { JsonRpcPeer, type RpcActionHandler } from "nodefony";
import type { WebsocketContext } from "@nodefony/http";
import { Controller } from "@nodefony/framework";
import {
  WsConnectionTransport,
  type RawWsConnection,
} from "../transport/WsConnectionTransport";
import { getRealtimeHub, type ChannelSink } from "./RealtimeHub";
import type {
  IRealtimeController,
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController";
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
   */
  protected handleRealtime(message: string | Buffer | null): void {
    const ctx = this.context as WebsocketContext | undefined;
    if (!ctx) return;
    if (message == null) {
      this.onHandshake(ctx);
      return;
    }
    (ctx as unknown as RealtimeHolder).__nfRealtime?.transport.feed(
      message.toString(),
    );
  }

  /** Handshake : crée peer+transport, enregistre les actions, welcome + cleanup. */
  private onHandshake(ctx: WebsocketContext): void {
    const holder = ctx as unknown as RealtimeHolder;
    if (holder.__nfRealtime?.welcomed) return;
    const conn = ctx.connection as RawWsConnection | null;
    if (!conn) return;

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
    // l'expose. Retiré au close (onFinish, plus bas).
    const hub = getRealtimeHub();
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

export default RealtimeController;
