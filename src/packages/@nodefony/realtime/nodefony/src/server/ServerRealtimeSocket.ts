import {
  type IRealtimeSocket,
  type IRealtimeChannel,
  type IChannelStats,
  type RealtimeHandler,
  type EventsMap,
  type ActionsMap,
  type DefaultEventsMap,
  type DefaultActionsMap,
  type EventNames,
  type EventPayload,
  type ContractParams,
  type ContractResult,
} from "nodefony";
import { getRealtimeHub, type ChannelSink } from "./RealtimeHub";

/**
 * **L4 — façade serveur « la socket Nodefony ».** Un handle SERVEUR qui implémente
 * le contrat ISOMORPHE {@link IRealtimeSocket} au-dessus du {@link RealtimeHub} : un
 * service back code **comme une page front** (`publish` / `subscribe` / `on` /
 * `channel`) — il tient UN handle, ignore le fan-out et le backplane.
 *
 * Tient la promesse North Star « un consommateur — front OU back — tient UN handle ».
 *
 * ── Sémantique côté serveur ──
 *  - `publish(channel, payload)` : **fan-out** aux abonnés via le hub (+ backplane si
 *    le canal est broadcast). C'est le cas d'usage principal (un service pousse des
 *    events que les clients reçoivent).
 *  - `subscribe`/`on` : le service ÉCOUTE un canal (sink interne) — **écoute passive**
 *    (`RealtimeHub.listen`). Écouter n'ouvre PAS le canal : s'il n'a pas de provider,
 *    l'état créé est passif, et c'est la fabrique du controller qui tranchera quand
 *    une connexion cliente le demandera. Un service n'invente donc jamais un canal
 *    pour les autres.
 *  - `request` : **non supporté** — un handle au-dessus du hub n'a PAS de pair unique
 *    (le hub est multi-clients). Pour un RPC serveur→client 1-1, utiliser
 *    `RealtimeController.requestClient` (par connexion, L1).
 *
 * Lazy : aucune structure allouée tant que le service n'`on`/`subscribe`/`publish` pas.
 *
 * @typeParam Emit   — canaux pub/sub SORTANTS (`publish`) = ServerToClient.
 * @typeParam Listen — canaux pub/sub RÉCEPTIONNÉS (`subscribe`/`on`) = ClientToServer.
 */
export class ServerRealtimeSocket<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> implements IRealtimeSocket<Emit, Listen, Actions> {
  #handlers: Map<string, Set<RealtimeHandler>> | null = null;
  #sinks: Map<string, ChannelSink> | null = null;
  #subs: Map<string, number> | null = null;
  #stats: Map<string, IChannelStats> | null = null;

  constructor(private readonly hub = getRealtimeHub()) {}

  /** Émet sur un canal — fan-out aux abonnés via le hub (+ backplane si broadcast). */
  publish<K extends string>(
    channel: K,
    payload?: K extends EventNames<Emit> ? EventPayload<Emit, K> : unknown,
  ): void {
    this.hub.publish(channel, payload);
  }

  /**
   * S'abonne (ref-compté) à un canal pour le RECEVOIR. Au 1ᵉʳ consommateur, pose un
   * sink d'**écoute passive** auprès du hub : le service reçoit ce qui passe, sans
   * ouvrir le canal à qui que ce soit d'autre.
   */
  subscribe(channel: EventNames<Listen> | (string & {})): void {
    const c = channel as string;
    const subs = (this.#subs ??= new Map<string, number>());
    const n = (subs.get(c) ?? 0) + 1;
    subs.set(c, n);
    if (n !== 1) return;
    const sink: ChannelSink = (payload) => this.#receive(c, payload);
    (this.#sinks ??= new Map<string, ChannelSink>()).set(c, sink);
    // Écoute, pas propriété : le canal reste à qui fournit son provider.
    this.hub.listen(c, sink);
  }

  /** Désabonne (ref-compté) : coupe le sink du hub au DERNIER consommateur. */
  unsubscribe(channel: EventNames<Listen> | (string & {})): void {
    const c = channel as string;
    const cur = this.#subs?.get(c);
    if (!cur) return;
    if (cur > 1) {
      this.#subs!.set(c, cur - 1);
      return;
    }
    this.#subs!.delete(c);
    const sink = this.#sinks?.get(c);
    if (sink) {
      this.hub.unsubscribe(c, sink);
      this.#sinks!.delete(c);
    }
  }

  /** Branche un handler de réception sur un canal. Renvoie un `dispose`. */
  on<K extends string>(
    channel: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): () => void {
    const handlers = (this.#handlers ??= new Map<
      string,
      Set<RealtimeHandler>
    >());
    let set = handlers.get(channel);
    if (!set) {
      set = new Set<RealtimeHandler>();
      handlers.set(channel, set);
    }
    set.add(handler as RealtimeHandler);
    return () => this.off(channel, handler);
  }

  /** Retire un handler d'un canal. */
  off<K extends string>(
    channel: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): void {
    this.#handlers?.get(channel)?.delete(handler as RealtimeHandler);
  }

  /**
   * **Non supporté.** Un handle au-dessus du hub n'a pas de pair unique
   * (multi-clients). Pour un RPC serveur→client 1-1, utiliser
   * `RealtimeController.requestClient` (par connexion, L1).
   */
  request<K extends string, T = unknown>(
    _method: K,
    _params?: ContractParams<Actions, K>,
    _timeoutMs?: number,
  ): Promise<ContractResult<Actions, K, T>> {
    return Promise.reject(
      new Error(
        "ServerRealtimeSocket.request: pas de pair unique côté hub (multi-clients). " +
          "Pour un RPC serveur→client 1-1, utiliser RealtimeController.requestClient.",
      ),
    ) as Promise<ContractResult<Actions, K, T>>;
  }

  /** Vue par-canal ({@link IRealtimeChannel}) — fine liaison sur les primitives. */
  channel(name: string): IRealtimeChannel {
    const hub = this;
    const disposers = new Set<() => void>();
    return {
      name,
      on(handler: RealtimeHandler): () => void {
        const dispose = hub.on(name, handler as never);
        disposers.add(dispose);
        return () => {
          dispose();
          disposers.delete(dispose);
        };
      },
      send(payload?: unknown): void {
        hub.publish(name, payload as never);
      },
      open(): void {
        hub.subscribe(name);
      },
      close(): void {
        for (const d of disposers) d();
        disposers.clear();
        hub.unsubscribe(name);
      },
    };
  }

  /** Snapshot des compteurs par canal (refs internes — à LIRE). */
  getStats(): IChannelStats[] {
    return this.#stats ? Array.from(this.#stats.values()) : [];
  }

  /** Compteurs d'un canal précis ou `undefined`. */
  getChannelStats(channel: string): IChannelStats | undefined {
    return this.#stats?.get(channel);
  }

  /** Canaux actuellement abonnés (≥ 1 consommateur). */
  get subscribedChannels(): string[] {
    return this.#subs ? Array.from(this.#subs.keys()) : [];
  }

  /** Dispatch d'une charge fan-outée par le hub : stats + handlers locaux + wildcard. */
  #receive(channel: string, payload: unknown): void {
    const stats = (this.#stats ??= new Map<string, IChannelStats>());
    let st = stats.get(channel);
    if (!st) {
      st = {
        method: channel,
        msgCount: 0,
        lastMessage: null,
        rate: 0,
        series: [],
      };
      stats.set(channel, st);
    }
    st.msgCount++;
    st.lastMessage = Date.now();
    this.#handlers?.get(channel)?.forEach((h) => {
      try {
        h(payload);
      } catch {
        /* un handler fautif n'interrompt pas le fan-out */
      }
    });
    this.#handlers?.get("*")?.forEach((h) => {
      try {
        h(channel, payload);
      } catch {
        /* ignore */
      }
    });
  }
}

/** Crée un handle serveur ({@link ServerRealtimeSocket}) sur le hub courant. */
export function serverSocket<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
>(): ServerRealtimeSocket<Emit, Listen, Actions> {
  return new ServerRealtimeSocket<Emit, Listen, Actions>(getRealtimeHub());
}

export default ServerRealtimeSocket;
