/**
 * RealtimeClient — Core isomorphe Nodefony côté navigateur (P14.11).
 *
 * Protocole : JSON-RPC 2.0 maison sur WebSocket (+ HTTP long-polling fallback TODO P13).
 * State machine : disconnected → connecting → connected → reconnecting → error.
 *
 * Features :
 *  - reconnect exponentiel avec back-off
 *  - pub/sub (on/off/emit) — notifications JSON-RPC sans id
 *  - request/response — RPC bidirectionnel typé
 *  - streaming — chunks `{ id, stream: { chunk, done } }` pour LLM token-by-token
 *
 * Le backend WS de référence (RealtimeService) sera implémenté en P13.4.
 * En attendant, ce client peut parler à n'importe quel serveur JSON-RPC 2.0.
 */
export type RealtimeState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface RealtimeOptions {
  url?: string;
  token?: string | null;
  /** Reconnexion auto. Défaut: true. */
  autoReconnect?: boolean;
  /** Délai initial entre tentatives (ms). Défaut: 1000. */
  reconnectDelay?: number;
  /** Délai max entre tentatives (ms). Défaut: 30000. */
  reconnectDelayMax?: number;
  /** Heartbeat ping interval (ms). Défaut: 30000. */
  heartbeatInterval?: number;
}

type EventHandler = (...args: unknown[]) => void;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcStreamChunk {
  jsonrpc: "2.0";
  id: number;
  stream: { chunk: unknown; done: boolean };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/**
 * Stats d'un canal/méthode reçus — GÉNÉRIQUES, calculées dans le client donc
 * réutilisables par toute app (`import { RealtimeClient } from "nodefony"`).
 */
export interface MessageStats {
  /** Méthode JSON-RPC == nom du canal pub/sub. */
  method: string;
  /** Total de notifications reçues sur ce canal. */
  msgCount: number;
  /** Timestamp (ms) de la dernière notification. */
  lastMessage: number | null;
  /** Débit instantané (msg/s), échantillonné 1×/s. */
  rate: number;
  /** Historique du débit (VU-mètre) — fenêtre glissante. */
  series: number[];
}

/** Points conservés dans la série de débit (~32 s à 1 échantillon/s). */
const STATS_SERIES_POINTS = 32;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** Si défini, on est en mode streaming. */
  onChunk?: (chunk: unknown) => void;
  chunks?: unknown[];
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private _state: RealtimeState = "disconnected";
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private reconnectAttempt = 0;
  private _nextRetryAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  // Stats génériques par méthode/canal — calculées ici (au point d'arrivée des
  // frames), donc fiables et réutilisables par toute app.
  private readonly _stats = new Map<string, MessageStats>();
  private _framesReceived = 0;
  private _lastFrameAt: number | null = null;
  private _lastFrameMethod: string | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _prevSampled = new Map<string, number>();

  constructor(private readonly opts: RealtimeOptions = {}) {
    this.startStatsSampler();
  }

  get state(): RealtimeState {
    return this._state;
  }

  /** Nombre de tentatives de reconnexion depuis la dernière connexion réussie. */
  get reconnectAttempts(): number {
    return this.reconnectAttempt;
  }

  /**
   * Timestamp (ms epoch) de la prochaine tentative de reconnexion planifiée,
   * `null` hors backoff. Permet un compte à rebours UI synchronisé au vrai délai.
   */
  get nextRetryAt(): number | null {
    return this._nextRetryAt;
  }

  /**
   * Force une reconnexion **immédiate** (annule le backoff en cours). No-op si
   * déjà connecté/connexion en cours.
   */
  retryNow(): void {
    if (this._state === "connected" || this._state === "connecting") return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._nextRetryAt = null;
    this.intentionalClose = false;
    this.openSocket().catch(() => {
      /* onclose relancera le backoff */
    });
  }

  /**
   * Ouvre la connexion WS. Idempotent — si déjà ouverte, no-op.
   * Resolve une fois `connected` ou reject sur erreur fatale.
   */
  async connect(url?: string): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return;
    this.intentionalClose = false;
    this.opts.url = url ?? this.opts.url ?? this.defaultUrl();
    return this.openSocket();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    this.ws?.close(1000, "client disconnect");
    this.setState("disconnected");
  }

  /** Pub/sub local — handler sur un event server-pushed (notification JSON-RPC). */
  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** Notification one-way client → server (pas de réponse attendue). */
  emit(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.send(msg);
  }

  /** Request/response JSON-RPC 2.0 — Promise resolved with `result`. */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30000,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.send(msg);
    });
  }

  /**
   * Streaming response — chunks émis avec le même `id`, terminés par
   * `{ done: true }`. Resolve avec la liste de chunks (et appelle
   * `onChunk` en live).
   */
  async stream<TChunk = unknown>(
    method: string,
    params: unknown,
    onChunk: (chunk: TChunk) => void,
    timeoutMs = 120000,
  ): Promise<TChunk[]> {
    const id = this.nextId++;
    return new Promise<TChunk[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Stream timeout: ${method}`));
      }, timeoutMs);
      const chunks: TChunk[] = [];
      this.pending.set(id, {
        resolve: (_v) => {
          clearTimeout(timer);
          resolve(chunks);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        onChunk: (c) => {
          chunks.push(c as TChunk);
          onChunk(c as TChunk);
        },
        chunks,
      });
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.send(msg);
    });
  }

  // ── Stats (génériques, réutilisables) ──────────────────────────────────

  /** Total de notifications reçues, tous canaux confondus (welcome inclus). */
  get framesReceived(): number {
    return this._framesReceived;
  }

  /** Timestamp (ms) de la dernière notification reçue. */
  get lastFrameAt(): number | null {
    return this._lastFrameAt;
  }

  /** `method`/canal de la dernière notification reçue. */
  get lastFrameMethod(): string | null {
    return this._lastFrameMethod;
  }

  /** Snapshot des stats par canal (msgCount/rate/series). Les objets sont les
   *  refs internes — à LIRE, pas à muter (copier les valeurs si besoin). */
  getStats(): MessageStats[] {
    return Array.from(this._stats.values());
  }

  /** Stats d'un canal précis (== method JSON-RPC) ou `undefined`. */
  getChannelStats(method: string): MessageStats | undefined {
    return this._stats.get(method);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Comptabilise une notification entrante (avant dispatch aux handlers). */
  private trackFrame(method: string): void {
    const now = Date.now();
    this._framesReceived++;
    this._lastFrameAt = now;
    this._lastFrameMethod = method;
    let st = this._stats.get(method);
    if (!st) {
      st = { method, msgCount: 0, lastMessage: null, rate: 0, series: [] };
      this._stats.set(method, st);
    }
    st.msgCount++;
    st.lastMessage = now;
  }

  /** Échantillonne le débit (msg/s) + série par canal, 1×/s, puis émet
   *  `__stats__` (event local) pour notifier les consommateurs réactifs. */
  private startStatsSampler(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      for (const st of this._stats.values()) {
        const prev = this._prevSampled.get(st.method) ?? st.msgCount;
        st.rate = Math.max(0, st.msgCount - prev);
        this._prevSampled.set(st.method, st.msgCount);
        st.series = [...st.series, st.rate].slice(-STATS_SERIES_POINTS);
      }
      this.fireLocal("__stats__");
    }, 1000);
    (this.statsTimer as { unref?: () => void }).unref?.();
  }

  /** Déclenche les handlers locaux d'un event interne (pas d'envoi réseau). */
  private fireLocal(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(...args);
      } catch {
        /* ignore handler errors */
      }
    });
  }

  private defaultUrl(): string {
    if (typeof window === "undefined") return "ws://localhost/realtime";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/nodefony/api/realtime`;
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
      try {
        const base =
          typeof window !== "undefined"
            ? window.location.href
            : "http://localhost";
        const url = new URL(this.opts.url ?? this.defaultUrl(), base);
        if (this.opts.token) url.searchParams.set("token", this.opts.token);
        this.ws = new WebSocket(url.toString());
      } catch (e) {
        this.setState("error");
        reject(e);
        return;
      }
      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this._nextRetryAt = null;
        this.setState("connected");
        this.startHeartbeat();
        resolve();
      };
      this.ws.onmessage = (ev) => this.handleMessage(ev.data);
      this.ws.onerror = () => {
        // L'event `close` qui suit gère le reconnect.
      };
      this.ws.onclose = () => {
        this.clearTimers();
        this.ws = null;
        if (this.intentionalClose) {
          this.setState("disconnected");
          return;
        }
        if (this.opts.autoReconnect !== false) {
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      };
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const base = this.opts.reconnectDelay ?? 1000;
    const max = this.opts.reconnectDelayMax ?? 30000;
    const delay = Math.min(base * 2 ** (this.reconnectAttempt - 1), max);
    this._nextRetryAt = Date.now() + delay;
    this.setState("reconnecting");
    // Event dédié → l'UI peut afficher tentative + compte à rebours live.
    this.fireLocal("__reconnect__", {
      attempt: this.reconnectAttempt,
      delay,
      nextRetryAt: this._nextRetryAt,
    });
    this.reconnectTimer = setTimeout(() => {
      this.openSocket().catch(() => {
        /* swallow — onclose re-déclenchera */
      });
    }, delay);
  }

  private startHeartbeat(): void {
    const interval = this.opts.heartbeatInterval ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.emit("ping", { ts: Date.now() });
      }
    }, interval);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // TODO P13.7 : buffering offline ? Pour l'instant on drop.
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== "string") return; // ignore binary for now
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      !msg ||
      typeof msg !== "object" ||
      (msg as { jsonrpc?: string }).jsonrpc !== "2.0"
    )
      return;

    // Response (with id)
    if ("id" in msg && typeof (msg as { id: unknown }).id === "number") {
      const m = msg as JsonRpcResponse | JsonRpcStreamChunk;
      const pending = this.pending.get(m.id as number);
      if (!pending) return;
      if ("stream" in m) {
        pending.onChunk?.(m.stream.chunk);
        if (m.stream.done) {
          this.pending.delete(m.id as number);
          pending.resolve(pending.chunks);
        }
      } else if ("error" in m && m.error) {
        this.pending.delete(m.id as number);
        pending.reject(new Error(m.error.message));
      } else if ("result" in m) {
        this.pending.delete(m.id as number);
        pending.resolve(m.result);
      }
      return;
    }

    // Notification (no id) — pub/sub event
    const n = msg as JsonRpcNotification;
    if (n.method) {
      this.trackFrame(n.method); // stats génériques avant dispatch
      this.handlers.get(n.method)?.forEach((h) => {
        try {
          h(n.params);
        } catch {
          /* ignore handler errors */
        }
      });
      // wildcard
      this.handlers.get("*")?.forEach((h) => {
        try {
          h(n.method, n.params);
        } catch {
          /* ignore */
        }
      });
    }
  }

  private setState(s: RealtimeState): void {
    if (this._state === s) return;
    this._state = s;
    this.fireLocal("__state__", s);
  }
}

export default RealtimeClient;
