import { makeAutoObservable } from "mobx";
import { notifications } from "@mantine/notifications";
import type { RealtimeClient, NodefonyNotice, NoticeLevel } from "nodefony";

/** Historique borné des notices (le hub affiche les incidents temps réel). */
const MAX_RECENT = 50;

/** Niveau de notice → couleur Mantine. */
const LEVEL_COLOR: Record<NoticeLevel, string> = {
  success: "teal",
  info: "blue",
  warning: "yellow",
  error: "red",
};

/**
 * Auto-fermeture (ms) par niveau. Toutes finies (même les erreurs) : un toast qui
 * ne part JAMAIS (`false`) remplit la pile et bloque la file d'attente → effet
 * « ça lague / ça tourne ». L'erreur reste plus longtemps (10 s) ; sa trace
 * durable est de toute façon dans l'historique du hub (`realtimeIncidents`).
 */
const LEVEL_AUTOCLOSE: Record<NoticeLevel, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 10000,
};

/**
 * Centre de notifications de Studio.
 *
 * Source unique des snackbars : consomme le flux **normalisé** de notices du
 * client temps réel (`RealtimeClient.onNotice` — close codes RFC 6455 interprétés,
 * erreurs serveur poussées, rétablissement) ET expose {@link notify} pour les
 * sources non-realtime (erreurs du data plane via `ApiClient`). Chaque notice →
 * toast Mantine + historique borné réutilisé par le hub.
 */
export class NotificationStore {
  /** Dernières notices reçues (ring borné), plus ancienne en tête. */
  recent: NodefonyNotice[] = [];

  constructor(realtime: RealtimeClient) {
    makeAutoObservable(this, {}, { autoBind: true });
    // Branché au constructeur (comme ConnectionStore) : le store vit autant que
    // la connexion partagée (singleton appli) → pas de dispose à gérer.
    realtime.onNotice((notice) => this.push(notice));

    // DEV uniquement : API brute Mantine sur window pour expérimenter le rendu
    // (auto-close court → la pile « défile »). Jamais en prod.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as unknown as { nfShow?: typeof notifications.show }).nfShow =
        notifications.show;
    }
  }

  /**
   * Pousse une notice : historique borné (toujours) + toast Mantine **sauf** pour
   * les notices `source:"realtime"`. Raison : une coupure/reconnexion du transport
   * est déjà signalée par le `ConnectionOverlay` plein écran (flou + compte à
   * rebours) → un toast en plus serait un doublon. On les garde toutefois dans
   * l'historique (`realtimeIncidents`, hub) car l'overlay est éphémère. Les
   * erreurs serveur poussées (`server`, WS ouvert) et data plane (`api`) n'ont
   * PAS d'overlay → elles, on les toaste.
   */
  push(notice: NodefonyNotice): void {
    this.recent.push(notice);
    if (this.recent.length > MAX_RECENT) {
      this.recent.splice(0, this.recent.length - MAX_RECENT);
    }
    if (notice.source === "realtime") return;
    notifications.show({
      color: LEVEL_COLOR[notice.level],
      title: notice.title,
      message: notice.message,
      autoClose: LEVEL_AUTOCLOSE[notice.level],
      withBorder: true,
    });
  }

  /**
   * Crée et pousse une notice normalisée depuis une source non-realtime (data
   * plane HTTP, action utilisateur). Évite de dupliquer la forme `NodefonyNotice`.
   */
  notify(
    level: NoticeLevel,
    message: string,
    opts: {
      title?: string;
      source?: NodefonyNotice["source"];
      code?: number;
    } = {},
  ): void {
    this.push({
      level,
      message,
      title: opts.title,
      source: opts.source ?? "api",
      code: opts.code,
      ts: Date.now(),
    });
  }

  /**
   * Incidents temps réel récents (sources `realtime`/`server`), plus récent en
   * tête — alimente le bloc « incidents » du hub (criticités qui cassent le live).
   */
  get realtimeIncidents(): NodefonyNotice[] {
    return this.recent
      .filter((n) => n.source === "realtime" || n.source === "server")
      .slice()
      .reverse();
  }

  /** Vide l'historique (n'affecte pas les toasts déjà affichés). */
  clear(): void {
    this.recent = [];
  }
}
