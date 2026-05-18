import { ApiClient } from "../services/ApiClient";
import { AuthService } from "../services/AuthService";
import { RealtimeClient } from "../services/RealtimeClient";
import { AuthStore } from "./AuthStore";
import { ConnectionStore } from "./ConnectionStore";
import { UiStore } from "./UiStore";
import { ChatStore } from "./ChatStore";

/**
 * Composition root — injection manuelle des services + stores.
 *
 * Pas de DI lib côté front : MobX + un objet "RootStore" suffit, durable,
 * facile à mocker en test.
 */
export class RootStore {
  readonly ui: UiStore;
  readonly auth: AuthStore;
  readonly connection: ConnectionStore;
  readonly chat: ChatStore;

  readonly api: ApiClient;
  readonly realtime: RealtimeClient;

  constructor() {
    this.ui = new UiStore();

    this.realtime = new RealtimeClient({ autoReconnect: true });

    this.api = new ApiClient({
      getToken: () => this.auth?.getToken() ?? null,
      onUnauthorized: () => {
        // 401 → on force logout pour relancer le flow.
        void this.auth?.logout();
      },
    });

    const authService = new AuthService(this.api);
    this.auth = new AuthStore(authService);
    this.connection = new ConnectionStore(this.realtime);
    this.chat = new ChatStore(this.realtime);
  }
}
