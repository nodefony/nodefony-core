/**
 * JsonRpcPeer — moteur protocole **JSON-RPC 2.0 ISOMORPHE** (client ET serveur).
 *
 * Client et serveur sont des **pairs** : le protocole (classer une frame, router,
 * corréler les réponses) est identique des deux côtés. Cette classe l'implémente
 * **une seule fois** ; chaque côté l'enrobe de son transport (`send`) et de ses
 * handlers. → fin de la duplication client/serveur (la discrimination request /
 * notification / response vivait à 2 endroits qui divergeaient).
 *
 * Transport-agnostique : on injecte `send(frame)` ; le peer ignore WebSocket/TCP/…
 * Aucune dépendance Node (browser-safe) : seulement `setTimeout`/`clearTimeout`.
 *
 * ── La RÈGLE de discrimination (le cœur) ──
 *  Le RÔLE d'une frame se lit sur `method`, PAS sur `id` :
 *   - `method` + `id`        → **requête** entrante  → handler enregistré → réponse `result`/`error`
 *   - `method` seul          → **notification**      → `onNotification` (pas de réponse)
 *   - `id` sans `method`     → **réponse**           → résout/rejette un `pending` sortant
 *  `id` autorisé string OU number (JSON-RPC 2.0 §id). Méthode inconnue → `-32601` ;
 *  handler qui throw → `-32603` (message GÉNÉRIQUE au pair, détail via `onError` = Zero Trust).
 */

/** Erreur JSON-RPC 2.0 (objet `error` d'une réponse). */
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** Handler d'une action (requête→réponse). Sync ou async ; throw → `-32603`. */
export type RpcActionHandler = (params: unknown) => unknown | Promise<unknown>;

/** Handler des notifications entrantes (pas de réponse). */
export type RpcNotificationHandler = (method: string, params: unknown) => void;

/** Nature d'une frame entrante (renvoyée par {@link JsonRpcPeer.handleFrame}). */
export type JsonRpcFrameKind =
  | "request"
  | "notification"
  | "response"
  | "invalid";

export interface JsonRpcPeerOptions {
  /** Envoie une frame sérialisable sur le transport (le peer ignore le transport). */
  send: (frame: unknown) => void;
  /** Notifications entrantes (`method` sans `id`) : pub/sub côté client, subscribe/unsubscribe côté serveur. */
  onNotification?: RpcNotificationHandler;
  /** Erreur interne d'un handler — détail JAMAIS renvoyé au pair (loggé ici). */
  onError?: (context: string, err: unknown) => void;
}

/**
 * Surface BIDIRECTIONNELLE d'un endpoint temps réel — **contrat ISOMORPHE**,
 * identique back et front. `RealtimeClient` (navigateur) ET la connexion serveur
 * l'exposent, en composant le même {@link JsonRpcPeer}. Du code métier écrit
 * contre cette interface tourne des deux côtés (le pari isomorphe de Nodefony).
 *
 * Sortant : `request` (attend une réponse), `notify` (fire-and-forget).
 * Entrant : `receive` (le transport y pousse chaque frame). Callee : `register`.
 */
export interface IRealtimePeer {
  /** Requête sortante → `Promise` du `result` (rejette sur `error`/timeout). */
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T>;
  /** Requête sortante en streaming (chunks → `onChunk`, `Promise` au `done`). */
  requestStream<T = unknown>(
    method: string,
    params: unknown,
    onChunk: (chunk: unknown) => void,
    timeoutMs?: number,
  ): Promise<T[]>;
  /** Notification sortante (pas de réponse). */
  notify(method: string, params?: unknown): void;
  /** Expose une action appelable par le pair (requête entrante → `result`). */
  register(method: string, handler: RpcActionHandler): void;
  /** Retire une action. */
  unregister(method: string): void;
  /** Ingestion d'une frame ENTRANTE (déjà parsée) → classe + route. */
  receive(frame: unknown): JsonRpcFrameKind;
  /** Actions exposées (découverte). */
  readonly methods: string[];
  /** Annule les requêtes en attente (fermeture transport). */
  dispose(reason?: string): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Mode streaming : chunks accumulés jusqu'au `done`. */
  onChunk?: (chunk: unknown) => void;
  chunks?: unknown[];
}

/** Une réponse JSON-RPC entrante (succès, erreur, ou chunk de stream). */
interface JsonRpcInboundResponse {
  id: number;
  result?: unknown;
  error?: JsonRpcErrorObject;
  stream?: { chunk: unknown; done: boolean };
}

export class JsonRpcPeer implements IRealtimePeer {
  private nextId = 1;
  // `pending` = NOS requêtes sortantes en attente de réponse (lazy : alloué au 1ᵉʳ
  // `request`). Les actions entrantes ne touchent pas cette map.
  private pending: Map<number, PendingCall> | null = null;
  // Registre des actions exposées (requêtes entrantes). Lazy : la plupart des pairs
  // (ex. client) n'exposent aucune action → pas d'alloc « au cas où ».
  private actions: Map<string, RpcActionHandler> | null = null;

  constructor(private readonly opts: JsonRpcPeerOptions) {}

  /** Expose une action (requête entrante `method`+`id` → `result`). Idempotent. */
  register(method: string, handler: RpcActionHandler): void {
    (this.actions ??= new Map<string, RpcActionHandler>()).set(method, handler);
  }

  /** Retire une action. */
  unregister(method: string): void {
    this.actions?.delete(method);
  }

  /** Liste des actions exposées (pour annoncer au handshake, découverte côté pair). */
  get methods(): string[] {
    return this.actions ? [...this.actions.keys()] : [];
  }

  /** Requête SORTANTE — `Promise` résolue avec le `result` (rejette sur `error`/timeout). */
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30000,
  ): Promise<T> {
    return this.startCall<T>(method, params, timeoutMs);
  }

  /**
   * Requête SORTANTE en streaming — chunks émis avec le même `id`, `Promise`
   * résolue (avec tous les chunks) au `done`. Pour les réponses token-by-token (LLM).
   */
  requestStream<T = unknown>(
    method: string,
    params: unknown,
    onChunk: (chunk: unknown) => void,
    timeoutMs = 60000,
  ): Promise<T[]> {
    return this.startCall<T[]>(method, params, timeoutMs, onChunk);
  }

  /** Notification SORTANTE (pas de réponse attendue). */
  notify(method: string, params?: unknown): void {
    this.opts.send({ jsonrpc: "2.0", method, params });
  }

  /**
   * Ingestion d'une frame ENTRANTE déjà parsée → classe (request/notification/
   * response) et route. Renvoie la nature (utile log/tests). Ne lève jamais.
   * (Le pendant sortant = `request`/`notify` ; le `send` brut est injecté.)
   */
  receive(msg: unknown): JsonRpcFrameKind {
    if (
      !msg ||
      typeof msg !== "object" ||
      (msg as { jsonrpc?: unknown }).jsonrpc !== "2.0"
    )
      return "invalid";

    const id = (msg as { id?: unknown }).id;
    const hasId = typeof id === "number" || typeof id === "string";
    const rawMethod = (msg as { method?: unknown }).method;
    const method = typeof rawMethod === "string" ? rawMethod : undefined;
    const params = (msg as { params?: unknown }).params;

    // Frame AVEC `method` = appel entrant (le pair nous appelle).
    if (method !== undefined) {
      if (hasId) {
        this.handleRequest(id as number | string, method, params);
        return "request";
      }
      this.opts.onNotification?.(method, params);
      return "notification";
    }

    // Frame SANS `method` mais AVEC `id` = réponse à une de NOS requêtes sortantes.
    if (hasId) {
      this.handleResponse(msg as JsonRpcInboundResponse);
      return "response";
    }

    return "invalid";
  }

  /** Annule tous les pending (fermeture du transport). */
  dispose(reason = "peer disposed"): void {
    if (!this.pending) return;
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // ── interne ───────────────────────────────────────────────────────────────

  private startCall<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
    onChunk?: (chunk: unknown) => void,
  ): Promise<T> {
    const id = this.nextId++;
    const pending = (this.pending ??= new Map<number, PendingCall>());
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
        onChunk,
        chunks: onChunk ? [] : undefined,
      });
      this.opts.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private handleRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): void {
    const handler = this.actions?.get(method);
    if (!handler) {
      this.opts.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${method}` },
      });
      return;
    }
    Promise.resolve()
      .then(() => handler(params))
      .then(
        (result) => this.opts.send({ jsonrpc: "2.0", id, result }),
        (err: unknown) => {
          this.opts.onError?.(`rpc ${method}`, err);
          this.opts.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: "internal error" },
          });
        },
      );
  }

  private handleResponse(msg: JsonRpcInboundResponse): void {
    // Nos requêtes sortantes ont des `id` numériques → on ne matche que ceux-là ;
    // une réponse à `id` string (jamais émise par nous) est ignorée.
    if (typeof msg.id !== "number" || !this.pending) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return; // réponse inattendue (déjà résolue/timeout) → ignore
    if (msg.stream) {
      pending.chunks?.push(msg.stream.chunk); // accumulé → résolu au `done`
      pending.onChunk?.(msg.stream.chunk); // poussé live à l'appelant
      if (msg.stream.done) {
        this.pending.delete(msg.id);
        pending.resolve(pending.chunks);
      }
      return;
    }
    if (msg.error) {
      this.pending.delete(msg.id);
      pending.reject(new Error(msg.error.message));
      return;
    }
    if ("result" in msg) {
      this.pending.delete(msg.id);
      pending.resolve(msg.result);
    }
  }
}

export default JsonRpcPeer;
