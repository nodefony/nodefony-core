import { ApiClient } from "../services/ApiClient";
import { AuthService } from "../services/AuthService";
import { RealtimeClient } from "nodefony";
import { AuthStore } from "./AuthStore";
import { ConnectionStore } from "./ConnectionStore";
import { UiStore } from "./UiStore";
import { ChatStore } from "./ChatStore";
import { AdminStore } from "./AdminStore";
import { ProfilerStore } from "./ProfilerStore";

/**
 * URL de l'endpoint WS realtime de Studio (`StudioRealtimeController`, JSON-RPC 2.0).
 * Dérivée de l'origine courante → même host/port que la page (wss en https).
 * En P13.4 cette URL pointera vers le RealtimeService partagé — le client ne change pas.
 */
function realtimeUrl(): string {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1/nodefony/studio/api/realtime";
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/nodefony/studio/api/realtime`;
}

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
  readonly admin: AdminStore;
  readonly profiler: ProfilerStore;

  readonly api: ApiClient;
  readonly realtime: RealtimeClient;

  constructor() {
    this.ui = new UiStore();

    // Connexion realtime PARTAGÉE par URL : la même socket sert Studio ET la
    // barre de debug (qui appelle aussi RealtimeClient.shared sur la même URL)
    // → une seule connexion WebSocket, pas deux.
    this.realtime = RealtimeClient.shared({
      url: realtimeUrl(),
      autoReconnect: true,
      // Backoff court : dès que le serveur revient, on se reconnecte en ≤4s
      // (sinon l'overlay « reste » pendant le long backoff par défaut de 30s).
      reconnectDelay: 800,
      reconnectDelayMax: 4000,
    });

    this.api = new ApiClient({
      getToken: () => this.auth?.getToken() ?? null,
      onUnauthorized: () => {
        // 401 → on force logout pour relancer le flow.
        void this.auth?.logout();
      },
    });

    const authService = new AuthService(this.api);
    this.auth = new AuthStore(authService);
    this.connection = new ConnectionStore(this.realtime, realtimeUrl());
    this.chat = new ChatStore(this.realtime);
    this.admin = new AdminStore(this.api);
    this.profiler = new ProfilerStore(this.api);
  }
}
