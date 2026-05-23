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
import { closeCodeToNotice, type NodefonyNotice } from "./notice";
export { closeCodeToNotice } from "./notice";
export type { NodefonyNotice, NoticeLevel } from "./notice";

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

/** Une frame du protocole temps réel (JSON-RPC 2.0) — pour le log/inspecteur. */
export interface RealtimeFrame {
  /** Timestamp (ms epoch). */
  ts: number;
  /** Sens : `out` = client→serveur, `in` = serveur→client. */
  dir: "in" | "out";
  /** Méthode (notification/requête) ou `response`/`error`/`stream`. */
  kind: string;
  /** id JSON-RPC (requêtes/réponses), si présent. */
  id?: number;
  /** Canal pub/sub (`params.channel`), si présent. */
  channel?: string;
  /** Payload affichable — champs sensibles **redactés** (token/secret…). */
  payload: unknown;
}

/** Taille max du ring du log protocole (inspecteur realtime). */
const FRAME_LOG_MAX = 300;

/** Clés sensibles masquées dans le log protocole (sécurité — jamais de secret en clair). */
const FRAME_REDACT_RE =
  /(token|password|secret|api[_-]?key|apikey|authorization|bearer)/i;

/** Copie d'un payload JSON-RPC avec masquage des champs sensibles (bornée en profondeur). */
function redactFrame(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactFrame(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = FRAME_REDACT_RE.test(k) ? "[redacted]" : redactFrame(v, depth + 1);
  }
  return out;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** Si défini, on est en mode streaming. */
  onChunk?: (chunk: unknown) => void;
  chunks?: unknown[];
}

/**
 * Réponse de la méthode RPC standard `kernel:ping` — CONVENTION Nodefony : tout
 * endpoint realtime (Studio aujourd'hui, `RealtimeService` en P13.4) y répond.
 * Sert de liveness + base de mesure du round-trip (cf {@link RealtimeClient.ping}).
 */
export interface KernelPingResult {
  pong: true;
  ts: number;
  /** uptime process serveur (s). */
  uptime: number;
  pid: number;
  version?: string;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private _state: RealtimeState = "disconnected";
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, Set<EventHandler>>();
  // Abonnements pub/sub ref-comptés (canal → nb de consommateurs). Le subscribe/
  // unsubscribe RÉSEAU n'est émis qu'aux transitions 0↔1 → N consommateurs (hooks
  // React `nodefony/react` + store MobX Studio) partagent UN seul abonnement
  // serveur, sans se couper l'un l'autre. Ré-abonné automatiquement au reconnect.
  private readonly _subscriptions = new Map<string, number>();
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
  // Log protocole (inspecteur realtime) — ring ALWAYS-ON mais bon marché : on ne
  // pousse qu'une RÉF brute (`{ts,dir,msg}`) ; la construction + la redaction
  // sont DIFFÉRÉES à la lecture (`frameLog`) ou au live (`__frame__`). Toujours
  // alimenté → la console « retrace l'instant » dès l'ouverture (pas de vide).
  private _rawFrames: { ts: number; dir: "in" | "out"; msg: unknown }[] | null =
    null;

  constructor(private readonly opts: RealtimeOptions = {}) {
    this.startStatsSampler();
  }

  /**
   * Instance de connexion **partagée par URL** (résolue en absolu) sur
   * `globalThis`. Plusieurs consommateurs d'une même page (ex. Studio + barre de
   * debug) obtiennent la MÊME instance → **une seule socket** WebSocket. Les
   * options ne s'appliquent qu'à la 1ʳᵉ création (les suivantes réutilisent).
   *
   * @param opts - options (au moins `url`), appliquées seulement à la création.
   * @returns l'instance partagée pour cette URL.
   */
  static shared(opts: RealtimeOptions = {}): RealtimeClient {
    const key = RealtimeClient.resolveUrl(opts.url);
    const g = globalThis as { __nfRealtime__?: Map<string, RealtimeClient> };
    const map = (g.__nfRealtime__ ??= new Map<string, RealtimeClient>());
    let client = map.get(key);
    if (!client) {
      client = new RealtimeClient({ ...opts, url: key });
      map.set(key, client);
    }
    return client;
  }

  /** Résout une URL (relative ou absolue) en chaîne absolue stable = clé du singleton. */
  private static resolveUrl(url?: string): string {
    if (typeof window === "undefined")
      return url ?? "ws://localhost/nodefony/api/realtime";
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const fallback = `${wsProto}//${window.location.host}/nodefony/api/realtime`;
    try {
      const u = new URL(url ?? fallback, window.location.href);
      // Normaliser http(s)→ws(s) : une URL RELATIVE résout vers le scheme de la
      // page (https) → sinon la clé `https://…` ≠ `wss://…` → 2 instances/2 sockets.
      if (u.protocol === "http:") u.protocol = "ws:";
      else if (u.protocol === "https:") u.protocol = "wss:";
      return u.toString();
    } catch {
      return fallback;
    }
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

  /**
   * S'abonne aux **notices normalisées** émises par le client : criticités qui
   * cassent le temps réel (close codes RFC 6455 interprétés via
   * {@link closeCodeToNotice}), erreurs serveur poussées, rétablissement de
   * connexion. Réutilisable par toute app — le centre de notifications (snackbar
   * Studio) s'y branche directement.
   *
   * @param handler - reçoit chaque {@link NodefonyNotice}.
   * @returns dispose (désabonnement).
   */
  onNotice(handler: (notice: NodefonyNotice) => void): () => void {
    return this.on("__notice__", handler as EventHandler);
  }

  /** Notification one-way client → server (pas de réponse attendue). */
  emit(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.send(msg);
  }

  /**
   * S'abonne à un canal pub/sub serveur (**ref-compté**). Émet la notification
   * `subscribe` au serveur UNIQUEMENT au 1er consommateur du canal ; les suivants
   * ne font qu'incrémenter le compteur. Ré-émis automatiquement à chaque
   * (re)connexion. NE remplace PAS {@link on} : `on(channel, h)` REÇOIT les
   * messages, `subscribe(channel)` DEMANDE au serveur de les pousser.
   *
   * Autorité unique partagée par le binding `nodefony/react` ET le store Studio →
   * deux consommateurs du même canal ne se coupent plus l'un l'autre.
   */
  subscribe(channel: string): void {
    const n = (this._subscriptions.get(channel) ?? 0) + 1;
    this._subscriptions.set(channel, n);
    if (n === 1) this.emit("subscribe", { channel });
  }

  /**
   * Désabonne un consommateur d'un canal (ref-compté) : émet `unsubscribe` au
   * serveur seulement au **dernier** consommateur. No-op si le canal n'est pas suivi.
   */
  unsubscribe(channel: string): void {
    const cur = this._subscriptions.get(channel);
    if (!cur) return;
    if (cur <= 1) {
      this._subscriptions.delete(channel);
      this.emit("unsubscribe", { channel });
    } else {
      this._subscriptions.set(channel, cur - 1);
    }
  }

  /** Canaux actuellement abonnés (≥ 1 consommateur). Lecture seule. */
  get subscribedChannels(): string[] {
    return Array.from(this._subscriptions.keys());
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
   * Mesure le round-trip WS via la méthode RPC standard `kernel:ping` — helper
   * RÉUTILISABLE par tout consommateur (topbar Studio, debug bar, app user) :
   * la mesure du RTT et la convention `kernel:ping` vivent dans la lib cliente,
   * pas dupliquées dans chaque front. Renvoie le payload serveur enrichi de `rtt`
   * (ms, aller-retour mesuré côté client). Lève si le serveur ne répond pas
   * (`request` timeout) ou ne connaît pas la méthode (`-32601`).
   */
  async ping(timeoutMs = 5000): Promise<KernelPingResult & { rtt: number }> {
    const now = (): number =>
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const t0 = now();
    const res = await this.request<KernelPingResult>(
      "kernel:ping",
      undefined,
      timeoutMs,
    );
    return { ...res, rtt: Math.round(now() - t0) };
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

  /** Émet une notice normalisée aux abonnés `onNotice` (event local, pas réseau). */
  private fireNotice(notice: NodefonyNotice): void {
    this.fireLocal("__notice__", notice);
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
        // Une URL relative hérite du scheme de la page (http/https) → WebSocket
        // exige ws/wss. Normaliser systématiquement (sinon throw "scheme must be…").
        if (url.protocol === "http:") url.protocol = "ws:";
        else if (url.protocol === "https:") url.protocol = "wss:";
        if (this.opts.token) url.searchParams.set("token", this.opts.token);
        this.ws = new WebSocket(url.toString());
      } catch (e) {
        this.setState("error");
        reject(e);
        return;
      }
      this.ws.onopen = () => {
        const wasReconnecting = this.reconnectAttempt > 0;
        this.reconnectAttempt = 0;
        this._nextRetryAt = null;
        this.setState("connected");
        this.startHeartbeat();
        // Ré-abonne tous les canaux ref-comptés : le serveur repart d'un état
        // vide après une (re)connexion ; couvre aussi un `subscribe` appelé avant
        // l'ouverture du socket (l'`emit` avait alors été droppé par `send`).
        for (const channel of this._subscriptions.keys()) {
          this.emit("subscribe", { channel });
        }
        // Notice de rétablissement : seulement après une vraie perte (pas au 1er
        // connect) → l'UI confirme le retour du temps réel.
        if (wasReconnecting) {
          this.fireNotice({
            level: "success",
            title: "Temps réel",
            message: "Connexion temps réel rétablie",
            source: "realtime",
            ts: Date.now(),
          });
        }
        resolve();
      };
      this.ws.onmessage = (ev) => this.handleMessage(ev.data);
      this.ws.onerror = () => {
        // L'event `close` qui suit gère le reconnect.
      };
      this.ws.onclose = (ev) => {
        this.clearTimers();
        this.ws = null;
        if (this.intentionalClose) {
          this.setState("disconnected");
          return;
        }
        // Criticité qui casse le temps réel (RFC 6455 §7.4) → notice normalisée,
        // pendant client du `toWsCloseCode` serveur (@nodefony/http).
        const notice = closeCodeToNotice(ev?.code, ev?.reason);
        if (notice) this.fireNotice(notice);
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

  /**
   * Log protocole : les `FRAME_LOG_MAX` dernières frames JSON-RPC (redactées),
   * enregistrées EN CONTINU → la console « retrace l'instant » dès l'ouverture
   * (jamais de démarrage à vide). Construction + redaction faites ici, à la lecture.
   */
  get frameLog(): readonly RealtimeFrame[] {
    return (this._rawFrames ?? []).map((f) =>
      RealtimeClient.buildFrame(f.dir, f.msg, f.ts),
    );
  }

  /** Purge le log protocole. */
  clearFrameLog(): void {
    if (this._rawFrames) this._rawFrames.length = 0;
  }

  /**
   * Enregistre une frame dans le ring — coût = 1 push de réf (construction +
   * redaction DIFFÉRÉES). Émet `__frame__` (frame construite) seulement si la
   * console écoute.
   */
  private recordFrame(dir: "in" | "out", msg: unknown): void {
    const ts = Date.now();
    (this._rawFrames ??= []).push({ ts, dir, msg });
    if (this._rawFrames.length > FRAME_LOG_MAX) this._rawFrames.shift();
    const listeners = this.handlers.get("__frame__");
    if (listeners && listeners.size > 0)
      this.fireLocal("__frame__", RealtimeClient.buildFrame(dir, msg, ts));
  }

  /** Construit une frame affichable (kind/canal/id + payload redacté). */
  private static buildFrame(
    dir: "in" | "out",
    msg: unknown,
    ts: number,
  ): RealtimeFrame {
    const m = (msg ?? {}) as Record<string, unknown>;
    let kind = "?";
    let channel: string | undefined;
    if (typeof m.method === "string") {
      kind = m.method;
      const p = m.params as { channel?: unknown } | undefined;
      if (p && typeof p.channel === "string") channel = p.channel;
    } else if ("error" in m) kind = "error";
    else if ("stream" in m) kind = "stream";
    else if ("result" in m) kind = "response";
    return {
      ts,
      dir,
      kind,
      id: typeof m.id === "number" ? m.id : undefined,
      channel,
      payload: redactFrame(msg),
    };
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // TODO P13.7 : buffering offline ? Pour l'instant on drop.
      return;
    }
    this.ws.send(JSON.stringify(msg));
    this.recordFrame("out", msg);
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

    this.recordFrame("in", msg); // log protocole (lazy)

    // Le RÔLE d'une frame se lit sur `method`, PAS sur `id` (sinon une réponse
    // serait prise pour une requête, et une requête serveur→client pour une
    // réponse). `id` autorisé string OU number (JSON-RPC 2.0 §id).
    const id = (msg as { id?: unknown }).id;
    const hasId = typeof id === "number" || typeof id === "string";
    const method =
      typeof (msg as { method?: unknown }).method === "string"
        ? (msg as { method: string }).method
        : undefined;

    // Frame AVEC `method` = appel ENTRANT (le serveur nous appelle).
    if (method !== undefined) {
      if (hasId) {
        // Requête serveur→client : pas (encore) de registre d'actions exposées
        // côté client → réponse standard « méthode inconnue » (le serveur voit son
        // `request()` rejeter au lieu d'attendre le timeout). Brancher ici un
        // registre le jour du bidirectionnel complet (client = callee).
        this.send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${method}` },
        });
        return;
      }
      // Notification (pas d'`id`) — événement pub/sub.
      const params = (msg as JsonRpcNotification).params;
      this.trackFrame(method); // stats génériques avant dispatch
      this.handlers.get(method)?.forEach((h) => {
        try {
          h(params);
        } catch {
          /* ignore handler errors */
        }
      });
      // wildcard
      this.handlers.get("*")?.forEach((h) => {
        try {
          h(method, params);
        } catch {
          /* ignore */
        }
      });
      return;
    }

    // Frame SANS `method` mais AVEC `id` = RÉPONSE à une de NOS requêtes (flux
    // sortant). Nos `id` sont numériques (cf `nextId`) → on ne matche que ceux-là.
    if (typeof id === "number") {
      const m = msg as JsonRpcResponse | JsonRpcStreamChunk;
      const pending = this.pending.get(id);
      if (!pending) return;
      if ("stream" in m) {
        pending.onChunk?.(m.stream.chunk);
        if (m.stream.done) {
          this.pending.delete(id);
          pending.resolve(pending.chunks);
        }
      } else if ("error" in m && m.error) {
        this.pending.delete(id);
        pending.reject(new Error(m.error.message));
      } else if ("result" in m) {
        this.pending.delete(id);
        pending.resolve(m.result);
      }
      return;
    }

    // Frame SANS `method` ni `id` mais AVEC `error` = erreur globale serveur (pas
    // une réponse à une requête) → notice normalisée pour le centre de notifications.
    if ((msg as JsonRpcResponse).error) {
      const err = (msg as JsonRpcResponse).error!;
      this.fireNotice({
        level: "error",
        title: "Temps réel",
        message: err.message || "Erreur serveur temps réel",
        source: "server",
        code: err.code,
        ts: Date.now(),
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
