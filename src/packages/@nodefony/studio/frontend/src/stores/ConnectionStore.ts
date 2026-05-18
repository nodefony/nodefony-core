import { makeAutoObservable, runInAction } from "mobx";
import type { RealtimeClient, RealtimeState } from "nodefony";

/**
 * Stats observées par souscription — affichées dans le Drawer du chip topbar.
 */
export interface SubscriptionStats {
  channel: string;
  msgCount: number;
  lastMessage: number | null;
  subscribedAt: number;
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

  /** Disposers + wrapped handlers pour détacher + simuler des messages. */
  private readonly clientHandlers = new Map<
    string,
    { dispose: () => void; wrapped: (...args: unknown[]) => void }
  >();

  constructor(private readonly client: RealtimeClient) {
    makeAutoObservable(this, {}, { autoBind: true });
    this.client.on("__state__", (s) => {
      runInAction(() => {
        this.state = s as RealtimeState;
        if (s === "connected") this.lastError = null;
      });
    });
  }

  get isConnected(): boolean {
    return this.state === "connected";
  }

  get subscriptionCount(): number {
    return this.activeSubscriptions.size;
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
      // Tolérance dev : le backend WS n'existe pas encore → on n'empêche pas
      // le login. La chip topbar reflètera "disconnected".
      this.client.disconnect();
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
    };
    const wrapped = (...args: unknown[]) => {
      runInAction(() => {
        stats.msgCount++;
        stats.lastMessage = Date.now();
      });
      handler(...args);
    };
    const dispose = this.client.on(channel, wrapped);
    runInAction(() => {
      this.activeSubscriptions.set(channel, stats);
    });
    this.clientHandlers.set(channel, { dispose, wrapped });
    return () => this.unsubscribe(channel);
  }

  unsubscribe(channel: string): void {
    this.clientHandlers.get(channel)?.dispose();
    this.clientHandlers.delete(channel);
    runInAction(() => {
      this.activeSubscriptions.delete(channel);
    });
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
    };
    const wrapped = (...args: unknown[]) => {
      runInAction(() => {
        stats.msgCount++;
        stats.lastMessage = Date.now();
      });
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
