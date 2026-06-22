import { reaction } from "mobx";
import { ApiClient } from "../services/ApiClient";
import { AuthService } from "../services/AuthService";
import { RealtimeClient } from "nodefony";
import type { NoticeLevel } from "nodefony";
import { AuthStore } from "./AuthStore";
import { ConnectionStore } from "./ConnectionStore";
import { UiStore } from "./UiStore";
import { ChatStore } from "./ChatStore";
import { AdminStore } from "./AdminStore";
import { ProfilerStore } from "./ProfilerStore";
import { NotificationStore } from "./NotificationStore";
import { WorkspaceStore } from "../workspace/WorkspaceStore";

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
  readonly notifications: NotificationStore;
  readonly workspace: WorkspaceStore;

  readonly api: ApiClient;
  readonly realtime: RealtimeClient;

  constructor() {
    this.ui = new UiStore();
    this.workspace = new WorkspaceStore();

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

    // Centre de notifications : avant l'ApiClient (qui s'en sert dans onError).
    // Branché sur realtime.onNotice (close codes RFC 6455 interprétés, etc.).
    this.notifications = new NotificationStore(this.realtime);

    this.api = new ApiClient({
      // Session BFF (P6 J3) : plus de Bearer — le cookie HttpOnly part seul
      // (`credentials: "same-origin"` posé par ApiClient).
      // API souveraine (Ph.3) : GET data plane via le pont `api.request` quand
      // la socket est connectée — même action, même snapshot que le REST.
      // Kill switch global : UiStore.apiViaSocket (Hub, persisté).
      socket: this.realtime,
      socketEnabled: () => this.ui.apiViaSocket,
      onUnauthorized: () => {
        // 401 → on force logout pour relancer le flow.
        void this.auth?.logout();
      },
      onError: ({ method, status, message }) => {
        // 401 = déjà géré (logout). GET = chargement de page, l'erreur est rendue
        // par <DataState> dans la vue → pas de toast redondant. On toaste les
        // MUTATIONS (POST/PUT/DELETE) qui n'ont pas d'autre feedback visible.
        if (status === 401 || method === "GET") return;
        this.notifications.notify("error", message, {
          title: `Erreur ${status}`,
          source: "api",
          code: status,
        });
      },
    });

    const authService = new AuthService(this.api);
    this.auth = new AuthStore(authService);
    this.connection = new ConnectionStore(this.realtime, realtimeUrl());
    this.chat = new ChatStore(this.realtime);
    this.admin = new AdminStore(this.api);
    this.profiler = new ProfilerStore(this.api);

    // Au CHANGEMENT D'IDENTITÉ (login / logout / bascule sous un onglet ouvert),
    // purge les caches de données scopés à l'utilisateur (réponses d'endpoints
    // admin mémorisées) : aucune donnée d'une identité précédente ne survit dans
    // un store singleton. Le remontage React (clé `AuthGuard`) vide les états
    // locaux des pages ; ceci couvre les stores hors arbre. RootStore = singleton
    // de durée de vie applicative → pas de disposal nécessaire.
    reaction(
      () => this.auth.user?.id ?? null,
      () => this.admin.reset(),
    );

    // Aide au DEV uniquement : déclencher un toast depuis la console
    // (`nodefonyNotify("success","coucou")`) pour vérifier le centre de
    // notifications sans avoir à provoquer une vraie erreur. Jamais en prod.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (
        window as unknown as {
          nodefonyNotify?: (level: NoticeLevel, message: string) => void;
        }
      ).nodefonyNotify = (level, message) =>
        this.notifications.notify(level, message, {
          title: "Test",
          source: "server",
        });
    }
  }
}
