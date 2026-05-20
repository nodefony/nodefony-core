import { makeAutoObservable } from "mobx";
import type { StudioPalette } from "../theme";

const THEME_KEY = "nodefony.studio.theme";
const PALETTE_KEY = "nodefony.studio.palette";
const RAIL_KEY = "nodefony.studio.sidebar.rail";
const GROUPS_KEY = "nodefony.studio.sidebar.groups";

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
  /** Groupes repliés par id. `true` = replié. Persisté. */
  collapsedGroups: Record<string, boolean> = {};
  /** Filtre live de la nav (libellés). Transient — jamais persisté. */
  navQuery = "";

  constructor() {
    makeAutoObservable(this);
    this.loadPrefs();
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
    return this.collapsedGroups[id] === true;
  }

  toggleGroup(id: string): void {
    this.collapsedGroups[id] = !this.collapsedGroups[id];
    this.persist();
  }

  setNavQuery(q: string): void {
    this.navQuery = q;
  }

  private loadPrefs(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark" || t === "auto") this.theme = t;
      const p = localStorage.getItem(PALETTE_KEY);
      if (p === "orange" || p === "nodefony") this.palette = p;
      this.rail = localStorage.getItem(RAIL_KEY) === "1";
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
      localStorage.setItem(GROUPS_KEY, JSON.stringify(this.collapsedGroups));
    } catch {
      /* ignore */
    }
  }
}
