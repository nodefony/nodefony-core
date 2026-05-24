import type { RealtimePublish } from "../interfaces/IRealtimeController";
import type {
  IRealtimeConnProbe,
  IRealtimeProbe,
} from "../interfaces/IRealtimeProbe";

/**
 * Seuil d'alerte slow-consumer (octets de `bufferedAmount`). Au-delà, la connexion
 * est comptée comme « lente » par la sonde (PAS encore de drop/close — la sonde MESURE
 * avant qu'on optimise : stringify unique → seuil de drop → coalescing). 1 MiB =
 * `websocket.maxPayload` par défaut : une file qui dépasse une frame max pleine est
 * déjà anormale pour des canaux d'ÉTAT (latest-wins).
 */
export const SLOW_CONSUMER_BYTES = 1 << 20; // 1 MiB

/**
 * Sink d'un canal : pousse une charge vers UNE connexion abonnée (son `peer.notify`).
 * 1 sink = 1 connexion. Le hub fan-out la charge à tous les sinks d'un canal.
 */
export type ChannelSink = (payload: unknown) => void;

/**
 * Fabrique le provider PARTAGÉ d'un canal (listener/ticker qui pousse via `publish`).
 * Appelée UNE fois, au 1ᵉʳ abonné. Renvoie son `dispose` (appelé au dernier
 * désabonné) ou `null` si le canal est inconnu. Le provider doit capturer des deps
 * **long-lived** (kernel/syslog/broker, valeurs simples) — JAMAIS la connexion qui
 * a déclenché la création (elle peut fermer alors que le provider partagé survit).
 */
export type ChannelFactory = (
  channel: string,
  publish: RealtimePublish,
) => (() => void) | null;

interface ChannelState {
  /** dispose du provider partagé (`null` brièvement pendant la création). */
  dispose: (() => void) | null;
  /** abonnés locaux (1 sink = 1 connexion). */
  sinks: Set<ChannelSink>;
  /** publications cumulées sur ce canal (monotone) — sonde fan-out. */
  messages: number;
}

/**
 * RealtimeHub — broker temps réel **PAR INSTANCE** (1 pod = 1 process = 1 hub local).
 *
 * Élève le realtime serveur du modèle **per-connexion** (chaque connexion son propre
 * ticker/listener = N fois le même travail) au modèle **canaux PARTAGÉS** : un canal a
 * **UN provider** créé au 1ᵉʳ abonné et un **fan-out** vers tous les abonnés. C'est le
 * gain cloud-native (1 ticker/canal/pod) ET le **seam du backplane Redis** (le cross-pod
 * se branchera dans {@link publish} : fan-out local + forward Redis, l'ingress backplane
 * ne refaisant QUE du fan-out local — règle anti-boucle). Cf vision « la socket Nodefony ».
 *
 * Périmètre actuel : canaux **broadcast** (même flux pour tous les abonnés — stats,
 * syslog, orm…). Les canaux **privés/par-connexion** (ex. une ligne SIP par user) =
 * seam futur (le provider serait per-connexion, pas partagé).
 *
 * Perf (règle ABSOLUE) : map des canaux **lazy** (rien alloué tant qu'aucun abonné) ;
 * provider créé au 1ᵉʳ abonné, **disposé au dernier** (aucun timer/listener orphelin) ;
 * fan-out isolé (une connexion fautive ne casse pas la diffusion). Le hub lui-même est
 * **sans dépendance** : ce sont les *factories* (fournies par les contrôleurs) qui
 * portent les deps.
 *
 * Vocabulaire : la **socket** ({@link IRealtimeSocket}) est la prise que tient le métier ;
 * ce **hub** est le broker serveur caché derrière (registre + fan-out local). La socket
 * multiplexe des canaux ; le hub aiguille entre les sockets. Une façade *consommateur*
 * `IRealtimeSocket` côté serveur (qu'un service back tiendrait : `subscribe/on/publish`)
 * enrobera ce broker plus tard — même rôle que `RealtimeClient` côté navigateur.
 */
export class RealtimeHub {
  // Lazy : alloué au 1ᵉʳ subscribe (un process sans abonné n'alloue rien).
  #channels: Map<string, ChannelState> | null = null;

  // Compteurs d'auto-observabilité (sonde socket). Primitives → 0 alloc, incrément
  // O(1) sur le chemin `publish` (pas de syscall/stringify). Cumuls MONOTONES → le
  // débit/s se dérive côté lecteur. Cf {@link probe}.
  #publishTotal = 0;
  #fanoutTotal = 0;
  #inboundTotal = 0;

  // Registre des connexions vivantes — lazy (0 alloc tant qu'aucune connexion). Sert
  // UNIQUEMENT la sonde (backpressure : `bufferedAmount` vit sur la connexion brute,
  // pas sur le sink opaque). Inscrit au handshake, retiré au close (symétrique).
  #connections: Set<IRealtimeConnProbe> | null = null;

  /**
   * Abonne une connexion à un canal. Crée le provider partagé au **1ᵉʳ** abonné (via
   * `factory`), puis ajoute le sink. Le sink est inscrit AVANT l'appel à `factory` →
   * le 1ᵉʳ paquet immédiat éventuel du provider (ex. `createBrokerTicker` tick initial)
   * atteint bien ce 1ᵉʳ abonné.
   *
   * @returns `true` si abonné, `false` si canal inconnu (`factory` a renvoyé `null`).
   */
  subscribe(
    channel: string,
    sink: ChannelSink,
    factory: ChannelFactory,
  ): boolean {
    const channels = (this.#channels ??= new Map<string, ChannelState>());
    let st = channels.get(channel);
    if (st) {
      st.sinks.add(sink);
      return true;
    }
    // 1ᵉʳ abonné : on inscrit le sink AVANT de créer le provider (capte son 1ᵉʳ push).
    st = { dispose: null, sinks: new Set([sink]), messages: 0 };
    channels.set(channel, st);
    const dispose = factory(channel, (ch, payload) =>
      this.publish(ch, payload),
    );
    if (dispose === null) {
      channels.delete(channel); // canal inconnu → rien créé, on nettoie
      return false;
    }
    st.dispose = dispose;
    return true;
  }

  /**
   * Désabonne une connexion d'un canal. Au **dernier** abonné, `dispose()` le provider
   * et retire le canal (libère timers/listeners). No-op si non abonné.
   */
  unsubscribe(channel: string, sink: ChannelSink): void {
    const st = this.#channels?.get(channel);
    if (!st) return;
    st.sinks.delete(sink);
    if (st.sinks.size === 0) {
      try {
        st.dispose?.();
      } catch {
        /* noop — un provider fautif ne bloque pas le nettoyage */
      }
      this.#channels!.delete(channel);
    }
  }

  /**
   * Fan-out d'une charge à tous les abonnés locaux d'un canal. Point d'extension du
   * **backplane** (P13) : forward Redis ici ; l'ingress backplane appellera un
   * `publishLocal` (fan-out SEULEMENT) pour ne pas reboucler.
   */
  publish(channel: string, payload: unknown): void {
    const st = this.#channels?.get(channel);
    if (!st) return;
    // Sonde : 1 publish, N livraisons (= fan-out réel). Incréments O(1).
    this.#publishTotal += 1;
    st.messages += 1;
    this.#fanoutTotal += st.sinks.size;
    for (const sink of st.sinks) {
      try {
        sink(payload);
      } catch {
        /* une connexion fautive ne casse pas le fan-out aux autres */
      }
    }
  }

  /** Nombre d'abonnés locaux d'un canal (observabilité / tests). */
  subscriberCount(channel: string): number {
    return this.#channels?.get(channel)?.sinks.size ?? 0;
  }

  /**
   * Inscrit une connexion au registre de la sonde (au handshake). Lazy : alloue le
   * Set au 1ᵉʳ appel. Le hub ne lit ces connexions QUE dans {@link probe} (jamais
   * sur le chemin chaud). À équilibrer par {@link unregisterConnection} au close.
   */
  registerConnection(conn: IRealtimeConnProbe): void {
    (this.#connections ??= new Set<IRealtimeConnProbe>()).add(conn);
  }

  /** Retire une connexion du registre de la sonde (au close). No-op si absente. */
  unregisterConnection(conn: IRealtimeConnProbe): void {
    this.#connections?.delete(conn);
  }

  /**
   * Compte une frame entrante full-duplex (canaux gated SIP/bridge). Appelé par le
   * contrôleur quand un handler `realtimeInbound` traite un message client.
   */
  recordInbound(): void {
    this.#inboundTotal += 1;
  }

  /**
   * Snapshot d'auto-observabilité de la socket (per-instance). Lecture PURE (aucune
   * alloc sur le chemin chaud, jamais throw) : agrège canaux + fan-out + connexions +
   * **backpressure** (`bufferedAmount`, risque #1). Appelé à la demande (endpoint HTTP)
   * ou par le ticker hub `realtime:health`. Les cumuls sont monotones → débit dérivé
   * côté lecteur. Cf {@link IRealtimeProbe}.
   */
  probe(): IRealtimeProbe {
    const channels: IRealtimeProbe["channels"] = [];
    if (this.#channels) {
      for (const [channel, st] of this.#channels) {
        channels.push({
          channel,
          subscribers: st.sinks.size,
          messages: st.messages,
        });
      }
    }
    let connectionCount = 0;
    let bytesSentTotal = 0;
    let messagesSentTotal = 0;
    let maxBufferedAmount = 0;
    let totalBufferedAmount = 0;
    let slowConsumers = 0;
    if (this.#connections) {
      for (const c of this.#connections) {
        connectionCount += 1;
        bytesSentTotal += c.bytesSent;
        messagesSentTotal += c.messagesSent;
        const buf = c.bufferedAmount;
        if (buf > maxBufferedAmount) maxBufferedAmount = buf;
        totalBufferedAmount += buf;
        if (buf >= SLOW_CONSUMER_BYTES) slowConsumers += 1;
      }
    }
    return {
      ts: Date.now(),
      channels,
      channelCount: channels.length,
      publishTotal: this.#publishTotal,
      fanoutTotal: this.#fanoutTotal,
      inboundTotal: this.#inboundTotal,
      connectionCount,
      bytesSentTotal,
      messagesSentTotal,
      backpressure: {
        maxBufferedAmount,
        totalBufferedAmount,
        slowConsumers,
      },
    };
  }

  /** Canaux actifs (≥ 1 abonné). Lecture seule. */
  get activeChannels(): string[] {
    return this.#channels ? [...this.#channels.keys()] : [];
  }

  /** Dispose tous les providers et vide le hub (arrêt process / reset de test). */
  clear(): void {
    if (this.#channels) {
      for (const st of this.#channels.values()) {
        try {
          st.dispose?.();
        } catch {
          /* noop */
        }
      }
      this.#channels.clear();
      this.#channels = null;
    }
    this.#connections?.clear();
    this.#connections = null;
    this.#publishTotal = 0;
    this.#fanoutTotal = 0;
    this.#inboundTotal = 0;
  }
}

// Hub partagé du process (1 pod = 1 hub). Lazy : pas d'instance tant qu'inutilisé.
let _hub: RealtimeHub | null = null;

/** Renvoie le hub realtime du process (singleton lazy). */
export function getRealtimeHub(): RealtimeHub {
  return (_hub ??= new RealtimeHub());
}

export default RealtimeHub;
