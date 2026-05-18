/**
 * RealtimeClient — préfigure l'API du futur `@nodefony/client` (P13.7).
 *
 * Pattern : Symbiose Socket.IO-like SANS Socket.IO.
 * Protocole : JSON-RPC 2.0 maison sur WebSocket + HTTP long-polling fallback (TODO).
 * State machine : disconnected → connecting → connected → reconnecting → error.
 *
 * Pour le POC Studio, ce client est un stub fonctionnel :
 *  - state machine OK
 *  - reconnect exponentiel OK
 *  - pub/sub (on/off/emit) OK
 *  - request/response JSON-RPC 2.0 OK
 *  - streaming (chat IA tokens) OK
 *  - le backend WS n'existera vraiment qu'en P13.4 RealtimeService
 *
 * Sera remplacé en P14.11 par l'import direct depuis `@nodefony/client`
 * (Core isomorphe Nodefony côté navigateur).
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;

  constructor(private readonly opts: RealtimeOptions = {}) {}

  get state(): RealtimeState {
    return this._state;
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
   * Streaming response — pour chat IA token-by-token.
   * Le serveur émet plusieurs `JsonRpcStreamChunk` avec le même `id`,
   * puis un dernier `{ done: true }` qui resolve la Promise avec
   * la liste de chunks (et appelle `onChunk` en live).
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

  // ── Internals ─────────────────────────────────────────────────────────

  private defaultUrl(): string {
    if (typeof window === "undefined") return "ws://localhost/realtime";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/nodefony/api/realtime`;
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
      try {
        const url = new URL(this.opts.url ?? this.defaultUrl(), window.location.href);
        if (this.opts.token) url.searchParams.set("token", this.opts.token);
        this.ws = new WebSocket(url.toString());
      } catch (e) {
        this.setState("error");
        reject(e);
        return;
      }
      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
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
    this.setState("reconnecting");
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
    if (!msg || typeof msg !== "object" || (msg as { jsonrpc?: string }).jsonrpc !== "2.0") return;

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
    this.handlers.get("__state__")?.forEach((h) => h(s));
  }
}
