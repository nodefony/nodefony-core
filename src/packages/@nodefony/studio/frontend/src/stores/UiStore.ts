import { makeAutoObservable } from "mobx";
import type { StudioPalette } from "../theme";

const THEME_KEY = "nodefony.studio.theme";
const PALETTE_KEY = "nodefony.studio.palette";
const RAIL_KEY = "nodefony.studio.sidebar.rail";
// v2 : la sémantique par défaut a changé (groupes PLIÉS au démarrage) → nouvelle
// clé pour repartir propre, sans hériter d'un ancien état « tout déplié ».
const GROUPS_KEY = "nodefony.studio.sidebar.groups.v2";
/** Clé PARTAGÉE avec le widget Core (`nodefony/debugbar`) → état synchronisé. */
const DEBUGBAR_KEY = "nf.debugbar.visible";
/** Cadence adaptative (AIMD) de la socket — politique globale, pilotée depuis le Hub. */
const ADAPTIVE_KEY = "nf.realtime.adaptive";
/** Temps réel actif — persisté (l'utilisateur veut retrouver son choix au reload). */
const LIVE_KEY = "nf.realtime.live";
/** API par la socket (pont `api.request`) — kill switch du data plane duplex. */
const API_SOCKET_KEY = "nf.api.socket";

/** Handle global exposé par la debug bar Core (`window.__NODEFONY_DEBUGBAR__`). */
interface DebugBarHandle {
  setVisible(v: boolean): void;
}

export type ThemeMode = "light" | "dark" | "auto";

/**
 * UiStore — préférences d'affichage du shell admin, persistées en localStorage.
 *
 * Sidebar v2 : mode rail (icônes seules), groupes repliables (état par groupe),
 * filtre rapide (transient, non persisté — repart vide à chaque session).
 */
export class UiStore {
  theme: ThemeMode = "dark";
  /** Palette de marque active (orange historique ou bleu Nodefony). Persisté. */
  palette: StudioPalette = "nodefony";
  /** Mode rail : navbar étroite icônes-seules (desktop). Persisté. */
  rail = false;
  /**
   * État de pliage par groupe. Sémantique : **plié par défaut** (la sidebar est
   * dense en 10.0.0) — un groupe est OUVERT seulement si explicitement `false`.
   * Absent / `true` = plié. Persisté.
   */
  collapsedGroups: Record<string, boolean> = {};
  /** Filtre live de la nav (libellés). Transient — jamais persisté. */
  navQuery = "";
  /** Debug bar Nodefony visible (dev). Persisté, partagé avec le widget Core. */
  debugBar = true;
  /**
   * Cadence ADAPTATIVE (AIMD) de la socket Nodefony — politique GLOBALE pilotée depuis
   * le Hub. Les pages consommatrices de canaux d'état (ORM, supervision…) la suivent :
   * la socket recule la cadence sous famine puis la remonte quand c'est sain. Persisté.
   */
  adaptiveCadence = false;
  /**
   * Temps réel ACTIF — interrupteur GLOBAL partagé par toutes les pages realtime
   * (Cluster / Supervision / ORM). **Persisté** (`nf.realtime.live`) : l'utilisateur
   * retrouve son choix au rechargement. Activer sur une page = actif sur toutes
   * (1 seul état). La granularité (`:ms`) reste locale à chaque page.
   */
  realtimeLive = false;
  /**
   * API PAR LA SOCKET — quand la Socket Nodefony est connectée, les GET du data
   * plane passent par le pont `api.request` (même action controller, même
   * snapshot que le REST — « API souveraine »). OFF = tout repasse en fetch HTTP.
   * Défaut ON (Studio dogfoode le duplex). Persisté.
   */
  apiViaSocket = true;

  constructor() {
    makeAutoObservable(this);
    this.loadPrefs();
  }

  setRealtimeLive(v: boolean): void {
    this.realtimeLive = v;
    try {
      localStorage.setItem(LIVE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  toggleRealtimeLive(): void {
    this.setRealtimeLive(!this.realtimeLive);
  }

  setDebugBar(v: boolean): void {
    this.debugBar = v;
    this.applyDebugBar();
  }

  toggleDebugBar(): void {
    this.setDebugBar(!this.debugBar);
  }

  /** Écrit la pref + pilote la barre auto-injectée via son handle global. */
  private applyDebugBar(): void {
    try {
      localStorage.setItem(DEBUGBAR_KEY, this.debugBar ? "1" : "0");
    } catch {
      /* ignore */
    }
    const w = window as unknown as { __NODEFONY_DEBUGBAR__?: DebugBarHandle };
    w.__NODEFONY_DEBUGBAR__?.setVisible(this.debugBar);
  }

  setTheme(mode: ThemeMode): void {
    this.theme = mode;
    this.persist();
  }

  toggleTheme(): void {
    this.theme = this.theme === "dark" ? "light" : "dark";
    this.persist();
  }

  toggleRail(): void {
    this.rail = !this.rail;
    this.persist();
  }

  setPalette(p: StudioPalette): void {
    this.palette = p;
    this.persist();
  }

  togglePalette(): void {
    this.palette = this.palette === "nodefony" ? "orange" : "nodefony";
    this.persist();
  }

  isGroupCollapsed(id: string): boolean {
    // Plié par défaut : seul un `false` explicite (déplié à la main) ouvre le groupe.
    return this.collapsedGroups[id] !== false;
  }

  toggleGroup(id: string): void {
    this.collapsedGroups[id] = !this.isGroupCollapsed(id);
    this.persist();
  }

  setNavQuery(q: string): void {
    this.navQuery = q;
  }

  setAdaptiveCadence(v: boolean): void {
    this.adaptiveCadence = v;
    this.persist();
  }

  toggleAdaptiveCadence(): void {
    this.setAdaptiveCadence(!this.adaptiveCadence);
  }

  setApiViaSocket(v: boolean): void {
    this.apiViaSocket = v;
    try {
      localStorage.setItem(API_SOCKET_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  toggleApiViaSocket(): void {
    this.setApiViaSocket(!this.apiViaSocket);
  }

  private loadPrefs(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark" || t === "auto") this.theme = t;
      const p = localStorage.getItem(PALETTE_KEY);
      if (p === "orange" || p === "nodefony") this.palette = p;
      this.rail = localStorage.getItem(RAIL_KEY) === "1";
      this.debugBar = localStorage.getItem(DEBUGBAR_KEY) !== "0";
      this.adaptiveCadence = localStorage.getItem(ADAPTIVE_KEY) === "1";
      this.realtimeLive = localStorage.getItem(LIVE_KEY) === "1";
      // Défaut ON : seul un "0" explicite (coupé à la main) désactive le pont.
      this.apiViaSocket = localStorage.getItem(API_SOCKET_KEY) !== "0";
      const g = localStorage.getItem(GROUPS_KEY);
      if (g) {
        const parsed: unknown = JSON.parse(g);
        if (parsed && typeof parsed === "object") {
          this.collapsedGroups = parsed as Record<string, boolean>;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(THEME_KEY, this.theme);
      localStorage.setItem(PALETTE_KEY, this.palette);
      localStorage.setItem(RAIL_KEY, this.rail ? "1" : "0");
      localStorage.setItem(ADAPTIVE_KEY, this.adaptiveCadence ? "1" : "0");
      localStorage.setItem(GROUPS_KEY, JSON.stringify(this.collapsedGroups));
    } catch {
      /* ignore */
    }
  }
}
