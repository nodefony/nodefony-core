import { makeAutoObservable, runInAction } from "mobx";
import type { RealtimeClient, RealtimeState } from "../services/RealtimeClient";

/**
 * ConnectionStore — état réactif du `RealtimeClient`.
 *
 * Surfacé dans l'UI (badge dans le header) + bloque le login stepper
 * tant que `connected` n'est pas atteint (étape 4).
 */
export class ConnectionStore {
  state: RealtimeState = "disconnected";
  lastError: string | null = null;
  latencyMs: number | null = null;

  constructor(private readonly client: RealtimeClient) {
    makeAutoObservable(this, { /* methods inferred */ }, { autoBind: true });
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

  async connect(token?: string | null): Promise<void> {
    try {
      // POC : on n'a pas encore de WS backend (P13.4). On simule "connected" en 250ms.
      // Quand P13 sera là, remplacer par : await this.client.connect(undefined, { token });
      void token;
      runInAction(() => (this.state = "connecting"));
      await new Promise((r) => setTimeout(r, 250));
      runInAction(() => {
        this.state = "connected";
        this.latencyMs = 12;
      });
    } catch (e) {
      runInAction(() => {
        this.state = "error";
        this.lastError = e instanceof Error ? e.message : String(e);
      });
      throw e;
    }
  }

  disconnect(): void {
    this.client.disconnect();
    runInAction(() => {
      this.state = "disconnected";
    });
  }
}
