import { makeAutoObservable, runInAction } from "mobx";
import type { RealtimeClient, RealtimeState } from "nodefony";

/** Transport sous-jacent d'un flux temps réel. */
export type RealtimeTransport = "ws" | "sse" | "webrtc" | "tcp";
/** Nature du flux temps réel. */
export type RealtimeKind = "channel" | "stream" | "rpc" | "binary";

/**
 * Métadonnées d'un abonnement — décrivent le PROTOCOLE transporté, pas seulement
 * le canal pub/sub. Permet au hub d'afficher demain des WS à protocole encapsulé
 * (SIP/WS, MQTT/WS, flux binaire, WebRTC signaling…) sans changer le modèle :
 * un consommateur passe `{ protocol: "sip", kind: "stream", transport: "ws" }`.
 */
export interface SubscriptionMeta {
  /** Protocole applicatif encapsulé/négocié (ex "json-rpc-2.0", "sip", "mqtt", "binary"). */
  protocol?: string;
  /** Transport sous-jacent. Défaut "ws" (subscribe) / "sse" (subscribeSSE). */
  transport?: RealtimeTransport;
  /** Nature du flux. Défaut "channel" (subscribe) / "stream" (subscribeSSE). */
  kind?: RealtimeKind;
  /**
   * Destination/pair distant du flux supervisé (ex "asterisk@pbx:5060",
   * "broker.local:1883"). Décrit la PILE complète avec `protocol`+`transport` :
   * ex SIP sur TCP vers Asterisk → `{ protocol:"sip", transport:"tcp", peer:"asterisk@pbx:5060" }`.
   * Ces flux sont ouverts côté serveur (@nodefony/realtime, P13.1) et leur état
   * est poussé au hub via un canal de supervision — le navigateur ne fait pas le TCP.
   */
  peer?: string;
}

/**
 * Stats observées par souscription — affichées dans le Drawer du chip topbar.
 * Étend `SubscriptionMeta` : chaque entrée porte son protocole/transport.
 */
export interface SubscriptionStats extends SubscriptionMeta {
  channel: string;
  msgCount: number;
  lastMessage: number | null;
  subscribedAt: number;
  /** Débit instantané (msg/s), échantillonné 1×/s par le store. */
  rate: number;
  /** Historique du débit (msg/s) pour le VU-mètre — fenêtre glissante. */
  series: number[];
}

/**
 * ConnectionStore — état réactif du `RealtimeClient` + hub d'abonnements
 * temps réel cross-pages.
 *
 * Pattern : chaque page subscribe au mount via `conn.subscribe(channel, handler)`,
 * récupère un `dispose()` à appeler dans le useEffect cleanup. Le store track
 * les stats (msgCount, latence) pour le Drawer dans le topbar.
 *
 * Le badge topbar reflète `state` en live via le listener `__state__` du client.
 */
export class ConnectionStore {
  state: RealtimeState = "disconnected";
  lastError: string | null = null;
  latencyMs: number | null = null;
  activeSubscriptions: Map<string, SubscriptionStats> = new Map();
  /** Timestamp du dernier passage à "connected" (uptime de la session WS). */
  connectedAt: number | null = null;
  /** `true` dès la 1ʳᵉ connexion réussie — distingue un VRAI drop du boot initial. */
  everConnected = false;
  /** Tentative de reconnexion courante (backoff client), 0 hors reconnexion. */
  reconnectAttempt = 0;
  /** Timestamp (ms) de la prochaine tentative planifiée (compte à rebours UI). */
  nextRetryAt: number | null = null;
  /** URL de l'endpoint WS (affichée dans le hub). */
  endpointUrl = "";
  /** Miroirs des stats du `RealtimeClient` (source de vérité, Core isomorphe) —
   *  rafraîchis sur l'event `__stats__` (1×/s). framesReceived = total frames. */
  framesReceived = 0;
  lastFrameAt: number | null = null;
  lastFrameMethod: string | null = null;

  /** Disposers + wrapped handlers pour détacher + simuler des messages. */
  private readonly clientHandlers = new Map<
    string,
    { dispose: () => void; wrapped: (...args: unknown[]) => void }
  >();

  constructor(
    private readonly client: RealtimeClient,
    endpointUrl = "",
  ) {
    this.endpointUrl = endpointUrl;
    makeAutoObservable(this, {}, { autoBind: true });
    this.client.on("__state__", (s) => {
      runInAction(() => {
        this.state = s as RealtimeState;
        if (s === "connected") {
          this.lastError = null;
          this.connectedAt = Date.now();
          this.everConnected = true;
          this.reconnectAttempt = 0;
          this.nextRetryAt = null;
        } else if (s === "disconnected" || s === "error") {
          this.connectedAt = null;
        }
      });
      // Le ré-abonnement au (re)connect est désormais porté par le CLIENT
      // (`RealtimeClient.subscribe` ref-compté + re-subscribe à l'ouverture du
      // socket) — autorité unique partagée avec le binding `nodefony/react`.
    });
    // Les stats (framesReceived + msgCount/rate/série par canal) sont calculées
    // par le RealtimeClient (Core) — source unique réutilisable. Le store n'en est
    // qu'un MIROIR réactif (MobX), rafraîchi sur `__stats__` (émis 1×/s par le
    // client). cf RealtimeClient.startStatsSampler / getChannelStats.
    this.client.on("__stats__", () => this.syncStats());
    // Backoff de reconnexion (Core) → compte à rebours live dans l'overlay.
    this.client.on("__reconnect__", (info) => {
      const i = info as { attempt: number; nextRetryAt: number };
      runInAction(() => {
        this.reconnectAttempt = i.attempt;
        this.nextRetryAt = i.nextRetryAt;
      });
    });
  }

  /** `true` quand la connexion temps réel est rompue APRÈS avoir été établie. */
  get isDown(): boolean {
    return (
      this.state === "reconnecting" ||
      this.state === "error" ||
      (this.state === "disconnected" && this.everConnected)
    );
  }

  /** Force une reconnexion immédiate (annule le backoff). */
  retryNow(): void {
    this.client.retryNow();
  }

  /** Copie les stats du client dans les structures observables (MobX) → le drawer
   *  (observer) réaffiche. SSE (transport propre, hors client) garde son comptage. */
  private syncStats(): void {
    runInAction(() => {
      this.framesReceived = this.client.framesReceived;
      this.lastFrameAt = this.client.lastFrameAt;
      this.lastFrameMethod = this.client.lastFrameMethod;

      // Réconcilie l'affichage du hub avec l'AUTORITÉ du client : les canaux WS
      // abonnés via les hooks `nodefony/react` (pas seulement via le store)
      // apparaissent ainsi dans le Drawer avec leurs graphes. Les flux SSE
      // (transport "sse", hors `client.subscribedChannels`) sont préservés.
      const liveWs = new Set(this.client.subscribedChannels);
      for (const channel of liveWs) {
        if (!this.activeSubscriptions.has(channel)) {
          this.activeSubscriptions.set(channel, {
            channel,
            msgCount: 0,
            lastMessage: null,
            subscribedAt: Date.now(),
            rate: 0,
            series: [],
            protocol: "json-rpc-2.0",
            transport: "ws",
            kind: "channel",
          });
        }
      }
      for (const [channel, sub] of this.activeSubscriptions) {
        if (sub.transport !== "sse" && !liveWs.has(channel)) {
          this.activeSubscriptions.delete(channel);
        }
      }

      for (const sub of this.activeSubscriptions.values()) {
        const cs = this.client.getChannelStats(sub.channel);
        if (cs) {
          sub.msgCount = cs.msgCount;
          sub.lastMessage = cs.lastMessage;
          sub.rate = cs.rate;
          sub.series = cs.series;
        }
      }
    });
  }

  get isConnected(): boolean {
    return this.state === "connected";
  }

  get subscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  /** Total des messages reçus, tous canaux confondus. */
  get totalMessages(): number {
    let n = 0;
    for (const s of this.activeSubscriptions.values()) n += s.msgCount;
    return n;
  }

  /** Reconnexion manuelle (no-op si déjà connecté). Préserve les abonnements
   *  (le listener __state__ les ré-émet au "connected"). */
  reconnect(): void {
    void this.client.connect();
  }

  /**
   * Tente une vraie connexion WS au backend Nodefony. Timeout 3s — si le
   * backend (P13.4 RealtimeService) n'est pas prêt, on tolère et on n'empêche
   * pas le login. Le badge topbar montrera `disconnected`.
   */
  async connect(token?: string | null): Promise<void> {
    void token; // TODO P6 — exposer token sur RealtimeClient.opts
    if (this.state === "connected" || this.state === "connecting") return;
    const start = performance.now();
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(new Error("Backend WS pas prêt (P13.4 RealtimeService)")),
            3000,
          ),
        ),
      ]);
      runInAction(() => {
        this.latencyMs = Math.round(performance.now() - start);
      });
    } catch (e) {
      // Le 1er connect a dépassé 3s : on N'APPELLE PAS disconnect() (qui poserait
      // intentionalClose=true et tuerait l'autoReconnect). Le RealtimeClient
      // continue d'essayer en arrière-plan ; le badge passera "connected" via le
      // listener __state__ dès que le WS s'ouvre. On n'empêche pas le login.
      runInAction(() => {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.latencyMs = null;
      });
    }
  }

  disconnect(): void {
    this.client.disconnect();
    runInAction(() => {
      this.activeSubscriptions.clear();
    });
    this.clientHandlers.clear();
  }

  /**
   * Subscribe à un canal pub/sub temps réel. Renvoie un `dispose()` à
   * appeler dans le `useEffect` cleanup quand le composant unmount.
   *
   * Stats live (msgCount, lastMessage) trackées automatiquement.
   */
  subscribe(
    channel: string,
    handler: (...args: unknown[]) => void,
    meta: SubscriptionMeta = {},
  ): () => void {
    // Garde sur les souscriptions PROPRES au store (clientHandlers) — pas
    // activeSubscriptions, qui peut contenir des entrées d'affichage réconciliées
    // depuis l'autorité client (canaux abonnés via les hooks `nodefony/react`).
    if (this.clientHandlers.has(channel)) {
      // eslint-disable-next-line no-console
      console.warn(`[Connection] already subscribed to ${channel}`);
      return () => this.unsubscribe(channel);
    }
    const stats: SubscriptionStats = {
      channel,
      msgCount: 0,
      lastMessage: null,
      subscribedAt: Date.now(),
      rate: 0,
      series: [],
      // Défauts = transport WS / JSON-RPC. Un flux à protocole encapsulé
      // (SIP/TCP vers Asterisk, MQTT, binaire…) override via `meta`.
      protocol: meta.protocol ?? "json-rpc-2.0",
      transport: meta.transport ?? "ws",
      kind: meta.kind ?? "channel",
      peer: meta.peer,
    };
    // Le comptage des stats (msgCount/lastMessage) est fait par le wildcard `*`
    // dans le constructeur (source unique fiable) — ici on ne fait QUE relayer la
    // donnée au handler de la page. Pas de double comptage.
    const wrapped = (...args: unknown[]) => {
      handler(...args);
    };
    const dispose = this.client.on(channel, wrapped);
    runInAction(() => {
      this.activeSubscriptions.set(channel, stats);
    });
    this.clientHandlers.set(channel, { dispose, wrapped });
    // Demande au serveur de POUSSER ce canal — via l'autorité ref-comptée du
    // client (re-subscribe auto au reconnect inclus, partagé avec les hooks).
    this.client.subscribe(channel);
    return () => this.unsubscribe(channel);
  }

  unsubscribe(channel: string): void {
    this.clientHandlers.get(channel)?.dispose();
    this.clientHandlers.delete(channel);
    runInAction(() => {
      this.activeSubscriptions.delete(channel);
    });
    // Dit au serveur d'ARRÊTER de pousser ce canal (ref-compté côté client : émis
    // seulement au dernier consommateur). Le WS reste ouvert.
    this.client.unsubscribe(channel);
  }

  /**
   * Dev-only — simule la réception d'un message server-pushed sur ce canal.
   * À utiliser pour démo/test des pages temps réel AVANT que P13.4
   * RealtimeService soit en place. Met à jour les stats du hub comme
   * un vrai message.
   */
  simulateMessage(channel: string, payload: unknown): void {
    this.clientHandlers.get(channel)?.wrapped(payload);
  }

  /**
   * Subscribe via Server-Sent Events — utilisé en attendant le WS backend
   * (P13.4). Le canal est traité comme une vraie subscription du hub :
   * stats trackées, dispose() ferme l'EventSource.
   *
   * Les events SSE arrivent en `data: <json>` → parsés et passés au handler.
   * Idéal pour streamer les Pdu du syslog kernel côté browser.
   */
  subscribeSSE(
    channel: string,
    url: string,
    handler: (payload: unknown) => void,
    meta: SubscriptionMeta = {},
  ): () => void {
    // Garde sur les souscriptions PROPRES au store (clientHandlers) — pas
    // activeSubscriptions, qui peut contenir des entrées d'affichage réconciliées
    // depuis l'autorité client (canaux abonnés via les hooks `nodefony/react`).
    if (this.clientHandlers.has(channel)) {
      // eslint-disable-next-line no-console
      console.warn(`[Connection] already subscribed to ${channel}`);
      return () => this.unsubscribe(channel);
    }
    const stats: SubscriptionStats = {
      channel,
      msgCount: 0,
      lastMessage: null,
      subscribedAt: Date.now(),
      rate: 0,
      series: [],
      protocol: meta.protocol ?? "text/event-stream",
      transport: meta.transport ?? "sse",
      kind: meta.kind ?? "stream",
      peer: meta.peer,
    };
    const wrapped = (...args: unknown[]) => {
      // SSE ne passe PAS par le wildcard du RealtimeClient → on compte ici, en
      // mutant l'entrée observable de la map (le proxy MobX), pas la ref locale.
      const live = this.activeSubscriptions.get(channel);
      if (live) {
        runInAction(() => {
          live.msgCount++;
          live.lastMessage = Date.now();
        });
      }
      handler(args[0]);
    };

    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        wrapped(data);
      } catch {
        /* malformed event */
      }
    };
    es.onerror = () => {
      // Le browser auto-reconnect par défaut. Log mais ne ferme pas.
      runInAction(() => {
        this.lastError = `SSE error on ${channel}`;
      });
    };

    const dispose = (): void => {
      es.close();
    };
    runInAction(() => {
      this.activeSubscriptions.set(channel, stats);
    });
    this.clientHandlers.set(channel, { dispose, wrapped });
    return () => this.unsubscribe(channel);
  }
}
