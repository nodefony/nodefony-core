import { makeAutoObservable, runInAction } from "mobx";
import type { RealtimeClient, RealtimeState } from "nodefony";

/** Nb de points conservés dans la série de débit (VU-mètre) — ~32 s. */
const SAMPLE_POINTS = 32;

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
  /** URL de l'endpoint WS (affichée dans le hub). */
  endpointUrl = "";
  /** Total des frames JSON-RPC reçues, TOUS canaux + welcome confondus (capté
   *  par un handler wildcard `*` indépendant des abonnements). Diagnostic brut :
   *  si ça monte, le transport reçoit bien ; sinon le serveur ne pousse pas. */
  framesReceived = 0;
  lastFrameAt: number | null = null;
  /** `method` de la dernière frame reçue (diagnostic du routing par canal). */
  lastFrameMethod: string | null = null;

  /** Disposers + wrapped handlers pour détacher + simuler des messages. */
  private readonly clientHandlers = new Map<
    string,
    { dispose: () => void; wrapped: (...args: unknown[]) => void }
  >();

  /** Sampler de débit (1×/s) — calcule rate + série par abonnement dans le store
   *  (source unique, pilotée par msgCount qui marche). Le drawer ne fait que lire. */
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  /** Dernier msgCount échantillonné par canal (pour le delta du débit). */
  private prevSampled: Record<string, number> = {};

  constructor(
    private readonly client: RealtimeClient,
    endpointUrl = "",
  ) {
    this.endpointUrl = endpointUrl;
    makeAutoObservable(
      this,
      { sampleTimer: false, prevSampled: false },
      { autoBind: true },
    );
    this.client.on("__state__", (s) => {
      runInAction(() => {
        this.state = s as RealtimeState;
        if (s === "connected") {
          this.lastError = null;
          this.connectedAt = Date.now();
        } else if (s === "disconnected" || s === "error") {
          this.connectedAt = null;
        }
      });
      // (Re)connexion : ré-émettre les `subscribe` de tous les canaux actifs.
      // Couvre le reconnect (le serveur repart d'un état vide) ET la course au
      // 1er connect (subscribe appelé avant l'ouverture du socket → emit droppé).
      if (s === "connected") {
        for (const channel of this.activeSubscriptions.keys()) {
          this.client.emit("subscribe", { channel });
        }
      }
    });
    // Compteur de frames + STATS PAR ABONNEMENT pilotés par le wildcard `*`.
    // C'est la SOURCE UNIQUE de comptage : le wildcard fire de façon fiable pour
    // toute notification (le handler par canal, lui, ne se déclenchait pas selon
    // le cas — instance/timing). Le `method` reçu == le nom du canal abonné, donc
    // on retrouve l'abonnement et on met à jour ses stats (msgCount + débit).
    this.client.on("*", (method) => {
      runInAction(() => {
        this.framesReceived++;
        this.lastFrameAt = Date.now();
        if (typeof method === "string") {
          this.lastFrameMethod = method;
          const sub = this.activeSubscriptions.get(method);
          if (sub) {
            sub.msgCount++;
            sub.lastMessage = Date.now();
          }
        }
      });
    });
    this.startSampler();
  }

  /** Échantillonne le débit (msg/s) de chaque abonnement 1×/s dans le store —
   *  source unique du VU-mètre. Timer toujours actif (UI admin, coût négligeable). */
  private startSampler(): void {
    if (this.sampleTimer) return;
    this.sampleTimer = setInterval(() => {
      runInAction(() => {
        for (const sub of this.activeSubscriptions.values()) {
          const cur = sub.msgCount;
          const prev = this.prevSampled[sub.channel] ?? cur;
          sub.rate = Math.max(0, cur - prev);
          this.prevSampled[sub.channel] = cur;
          sub.series = [...sub.series, sub.rate].slice(-SAMPLE_POINTS);
        }
      });
    }, 1000);
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
    if (this.activeSubscriptions.has(channel)) {
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
    // Demande au serveur de POUSSER ce canal (no-op si pas connecté → ré-émis
    // au prochain "connected" via le listener __state__).
    this.client.emit("subscribe", { channel });
    return () => this.unsubscribe(channel);
  }

  unsubscribe(channel: string): void {
    this.clientHandlers.get(channel)?.dispose();
    this.clientHandlers.delete(channel);
    runInAction(() => {
      this.activeSubscriptions.delete(channel);
    });
    // Dit au serveur d'ARRÊTER de pousser ce canal — le WS reste ouvert (ex:
    // on quitte le Dashboard mais on garde la connexion pour les autres pages).
    this.client.emit("unsubscribe", { channel });
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
    if (this.activeSubscriptions.has(channel)) {
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
