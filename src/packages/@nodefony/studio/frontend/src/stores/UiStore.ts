import { makeAutoObservable } from "mobx";

const THEME_KEY = "nodefony.studio.theme";
const SIDEBAR_KEY = "nodefony.studio.sidebar";

export type ThemeMode = "light" | "dark" | "auto";

export class UiStore {
  theme: ThemeMode = "dark";
  sidebarCollapsed = false;

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

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.persist();
  }

  private loadPrefs(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark" || t === "auto") this.theme = t;
      const s = localStorage.getItem(SIDEBAR_KEY);
      if (s === "1") this.sidebarCollapsed = true;
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(THEME_KEY, this.theme);
      localStorage.setItem(SIDEBAR_KEY, this.sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}
