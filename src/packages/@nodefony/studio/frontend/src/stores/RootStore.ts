import { reaction } from "mobx";
import { ApiClient } from "../services/ApiClient";
import { AuthService } from "../services/AuthService";
import {
  createClientKernel,
  RealtimeClient,
  Syslog,
  installErrorCapture,
  installRequestIdProvider,
  installSyslogUplink,
} from "nodefony";
import type { ClientIdentity, ClientKernel, NoticeLevel } from "nodefony";
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
  /**
   * Le noyau client du framework — il porte la composition technique, le cycle
   * de vie de la page et, surtout, le cycle d'identité (ADR-0007 D9). Ce qui
   * vivait ici en glue MobX vit désormais dans le framework, où toute
   * application en hérite au lieu de le recopier.
   */
  readonly kernel: ClientKernel;
  readonly realtime: RealtimeClient;
  /** Journal des incidents de CETTE page, remonté au pod (#35). */
  readonly browserLog: Syslog;

  constructor() {
    this.ui = new UiStore();
    this.workspace = new WorkspaceStore();

    // Connexion realtime PARTAGÉE par URL : la même socket sert Studio ET la
    // barre de debug (qui appelle aussi RealtimeClient.shared sur la même URL)
    // → une seule connexion WebSocket, pas deux. C'est le noyau qui la compose
    // désormais : `RealtimeClient.shared` reste dessous, mais l'application ne
    // le nomme plus — elle déclare ce qu'elle veut, le noyau le fournit.
    //
    // `connectOnBoot: false` : la socket de Studio est AUTHENTIFIÉE. Elle
    // s'ouvre au login (`setIdentity`), jamais au démarrage — ouvrir avant de
    // savoir qui se connecte produirait une connexion anonyme que le pod refuse.
    this.kernel = createClientKernel({
      name: "STUDIO",
      connectOnBoot: false,
      realtime: {
        url: realtimeUrl(),
        autoReconnect: true,
        // Backoff court : dès que le serveur revient, on se reconnecte en ≤4s
        // (sinon l'overlay « reste » pendant le long backoff par défaut de 30s).
        reconnectDelay: 800,
        reconnectDelayMax: 4000,
      },
    });
    const realtime = this.kernel.get("realtime");
    if (!realtime) {
      // Le registre est typé : ceci ne peut arriver que si la composition
      // ci-dessus a changé. Une garde plutôt qu'une conversion de type forcée —
      // c'est précisément le défaut que le contrat portait avant d'être exercé.
      throw new Error(
        "RootStore : le noyau client n'a pas composé de socket temps réel.",
      );
    }
    this.realtime = realtime;

    // #35 — Studio est une application front comme une autre : ses propres
    // erreurs remontent au pod par le canal montant, au lieu de mourir dans une
    // console que personne n'a ouverte. Journal DÉDIÉ plutôt que celui de la
    // page : ce qui part sur le fil est ainsi exactement ce qu'on a décidé d'y
    // mettre. Le pod écrasera de toute façon l'origine (`browser`) — le
    // `moduleName` posé ici ne sert qu'au débogage local.
    // Aucun retrait n'est prévu : RootStore vit aussi longtemps que le document
    // (cf la note sur l'absence de disposal plus bas).
    this.browserLog = new Syslog({ moduleName: "studio" });
    installRequestIdProvider();
    installErrorCapture({ syslog: this.browserLog });
    installSyslogUplink({
      syslog: this.browserLog,
      publisher: this.realtime,
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
        // 401 INATTENDU du data-plane (les sondes `/auth/*` sont déjà exclues côté
        // ApiClient) = session perdue en cours d'usage → on nettoie l'état LOCAL
        // (→ page login) SANS `POST /auth/logout` : un POST détruirait une session
        // potentiellement encore VALIDE (401 transitoire au reload) et effacerait
        // le cookie → déconnexion permanente sur un simple hoquet. Le logout serveur
        // reste réservé au clic explicite de l'utilisateur.
        this.auth?.clearLocalSession();
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

    // ── Cycle d'identité — DÉLÉGUÉ au noyau client (ADR-0007 D9) ───────────
    //
    // L'application DÉCLARE qui est connecté ; le noyau en tire les conséquences
    // de sécurité. Les deux gardes qui vivaient ici — ne couper la socket que
    // sur un VRAI changement de compte, et la rouvrir HORS de cette garde —
    // sont désormais dans le framework (`ClientKernel.setIdentity`), donc
    // valables pour TOUTE application Nodefony et non plus pour celle-ci seule.
    // C'est tout l'objet du portage : une règle de sécurité ne doit pas dépendre
    // de la qualité du câblage artisanal de chaque application.
    reaction(
      () => this.auth.user?.id ?? null,
      (id) => {
        this.kernel.setIdentity(id === null ? null : { key: String(id) });
      },
    );

    // Ce qui reste ici est ce qui appartient VRAIMENT à Studio : SES caches.
    // Le noyau n'en connaît aucun — il notifie, l'application purge.
    this.kernel.on("onIdentityChange", (...args) => {
      const [, previous] = args as [
        ClientIdentity | null,
        ClientIdentity | null,
      ];
      // Purge les réponses d'endpoints admin mémorisées : aucune donnée d'une
      // identité précédente ne survit dans un store singleton. Le remontage
      // React (clé `AuthGuard`) vide les états locaux des pages ; ceci couvre
      // les stores hors arbre.
      this.admin.reset();
      // `previous === null` = 1ᵉʳ chargement (ou F5) : la MÊME identité se
      // recharge, ne pas effacer ses bureaux. Le noyau n'émet que sur un
      // changement de clé, donc ce seul test suffit à reconnaître un VRAI
      // changement de compte.
      if (previous === null) return;
      // État user-scoped en `localStorage` (bureaux personnels + filtres/onglets
      // des consoles) : device-local et non lié à l'identité → sur un poste
      // partagé il fuiterait d'une identité à la suivante. Les préférences
      // device pures (apparence, rebonjour de login, debug bar) sont préservées.
      this.workspace.resetForIdentity();
      try {
        if (typeof localStorage !== "undefined") {
          const kill: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith("studio.") || k.startsWith("nf.datagrid:")))
              kill.push(k);
          }
          for (const k of kill) localStorage.removeItem(k);
        }
      } catch {
        /* storage indisponible — non bloquant */
      }
    });

    // Démarre le noyau : pont des événements de page, `onBoot`/`onReady`. La
    // socket, elle, reste fermée jusqu'au login (`connectOnBoot: false`).
    void this.kernel.boot();

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
