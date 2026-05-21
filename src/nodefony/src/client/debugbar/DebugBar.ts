/**
 * DebugBar — toolbar de debug par-page type Symfony WDT, **dev-only**, pensée
 * comme une **vitrine du realtime Nodefony** (psychologie produit : on doit
 * *voir* le framework respirer en direct, pas juste lire des chiffres).
 *
 * 2ᵉ consommateur navigateur du Core isomorphe après Studio : se branche sur le
 * MÊME backbone realtime (WS JSON-RPC 2.0, canaux `dashboard:stats` /
 * `syslog:stream`) via {@link RealtimeClient}. Aucun rendu serveur splicé dans
 * le body (≠ l'ancien monitoring-bundle) : le serveur *collecte*, le client *rend*.
 *
 * Le `RealtimeClient` mesure lui-même son débit (`framesReceived`, `getStats()`)
 * → la barre affiche un **pouls live msg/s + VU-mètre** : c'est le différenciateur
 * « HTTP et WebSocket co-citoyens, push natif, 0 polling » rendu tangible.
 *
 * Vanilla TS + **Shadow DOM** + sparklines **SVG maison** — zéro dépendance UI
 * (React/Mantine/recharts) pour se monter sur n'importe quelle page
 * (React/Vue/Angular/HTML) sans présumer du framework hôte ni polluer ses styles.
 *
 * MVP = live only. Le profiler par `requestId` (timeline par requête) arrivera
 * avec le collecteur serveur (WDT complet).
 */
import { RealtimeClient } from "../realtime/RealtimeClient";
import type { RealtimeState } from "../realtime/RealtimeClient";
import {
  DebugBarModel,
  type FeedLog,
  type StatsPayload,
  type SyslogPayload,
} from "./model";
import { formatBytes, formatUptime, gauge, sparklinePoints } from "./format";
import { connectViteHmr, type HmrEvent } from "./hmr";

/** Canaux realtime consommés (figés, alignés sur les providers Studio). */
const CHANNELS = {
  stats: "dashboard:stats",
  syslog: "syslog:stream",
} as const;

/** Endpoint WS realtime par défaut (porté par Studio aujourd'hui, RealtimeService demain). */
const DEFAULT_PATH = "/nodefony/studio/api/realtime";
const HOST_ID = "nodefony-debugbar";

/** Dimensions des sparklines (unités viewBox SVG). */
const MINI_W = 46;
const MINI_H = 16;
const CHART_W = 260;
const CHART_H = 46;
const RT_POINTS = 60;

/** Contexte frontend injecté par le builder Vite (@nodefony/frontend) en dev. */
export interface DebugBarFrontend {
  /** Type de preset : `react19` | `vue3` | `angular` | `vanilla`. */
  framework?: string;
  /** Nom logique de l'entrée frontend (bundle). */
  name?: string;
  /** Origine du serveur Vite (ex. `https://127.0.0.1:5173`). */
  viteOrigin?: string;
  /** WS HMR Vite à observer (ex. `wss://127.0.0.1:5173/`). */
  hmrUrl?: string;
}

export interface DebugBarOptions {
  /** URL/chemin du WS realtime. Défaut : `/nodefony/studio/api/realtime`. */
  url?: string;
  /** Client realtime injectable (partage / tests). Sinon créé en interne. */
  client?: RealtimeClient;
  /** Position verticale du widget. Défaut `bottom`. */
  position?: "bottom" | "top";
  /** Ouvre le panneau au montage. Défaut `false`. */
  open?: boolean;
  /** Contexte frontend (active la carte Frontend + la sonde HMR Vite). */
  frontend?: DebugBarFrontend;
}

/** Métadonnées d'affichage par framework (couleur de marque officielle). */
const FRAMEWORKS: Record<string, { label: string; color: string }> = {
  react19: { label: "React 19", color: "#61dafb" },
  react: { label: "React", color: "#61dafb" },
  vue3: { label: "Vue 3", color: "#42b883" },
  vue: { label: "Vue", color: "#42b883" },
  angular: { label: "Angular", color: "#dd0031" },
  vanilla: { label: "Vanilla", color: "#f7df1e" },
};

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.bar {
  position: fixed; left: 0; right: 0; z-index: 2147483000;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #e8eaed;
  background: rgba(18,20,25,.86); backdrop-filter: blur(14px) saturate(140%);
  --blue:#0067ba; --blue2:#3aa0ff; --orange:#ff8a3d; --ok:#36b37e; --warn:#ffab00;
  --crit:#ff5630; --info:#4c9aff; --muted:#8a9099; --line:#2a2e36; --card:rgba(28,31,38,.7);
  box-shadow: 0 -8px 40px rgba(0,0,0,.5);
}
.bar.bottom { bottom: 0; }
.bar.top { top: 0; }
.bar::before {
  content:""; position:absolute; left:0; right:0; height:2px;
  background: linear-gradient(90deg, var(--blue), var(--blue2), var(--orange));
  background-size: 200% 100%; animation: flow 4s linear infinite; opacity:.9;
}
.bar.bottom::before { top:0; } .bar.top::before { bottom:0; }
@keyframes flow { to { background-position: 200% 0; } }

.strip { display: flex; align-items: center; gap: 16px; padding: 6px 14px; cursor: pointer; }
.strip:hover { background: rgba(255,255,255,.03); }
.brand { display:flex; align-items:center; gap:8px; font-weight:800; letter-spacing:.2px; }
.brand .logo { color: var(--blue2); font-size:13px; filter: drop-shadow(0 0 6px rgba(58,160,255,.6)); }
.brand .name { background: linear-gradient(90deg,#fff,var(--blue2)); -webkit-background-clip:text;
  background-clip:text; -webkit-text-fill-color:transparent; }
.rt-pill { display:flex; align-items:center; gap:5px; padding:2px 9px; border-radius:11px;
  font-size:10px; font-weight:800; letter-spacing:.6px; text-transform:uppercase;
  color:var(--muted); background:#22262e; border:1px solid var(--line); }
.rt-pill.live { color:#fff; border-color:rgba(58,160,255,.5);
  background: linear-gradient(90deg, rgba(0,103,186,.35), rgba(255,138,61,.25));
  box-shadow: 0 0 14px rgba(58,160,255,.35); }
.rt-pill .bolt { animation: bolt 1.6s ease-in-out infinite; }
.rt-pill.live .bolt { color: var(--orange); }
@keyframes bolt { 0%,100%{opacity:.5;transform:scale(.9)} 50%{opacity:1;transform:scale(1.15)} }

.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; color: var(--muted); }
.dot.connected { background: var(--ok); color: var(--ok); animation: pulse 2s infinite; }
.dot.connecting, .dot.reconnecting { background: var(--warn); color: var(--warn); }
.dot.error, .dot.disconnected { background: var(--crit); color: var(--crit); }
@keyframes pulse { 0%{box-shadow:0 0 0 0 currentColor} 70%{box-shadow:0 0 0 5px transparent} 100%{box-shadow:0 0 0 0 transparent} }

.metric { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.metric .k { color: var(--muted); text-transform: uppercase; font-size: 9px; letter-spacing:.5px; }
.metric .v { font-weight: 700; min-width: 34px; }
.mini { width: ${MINI_W}px; height: ${MINI_H}px; display:block; }
.mini polyline { fill:none; stroke-width:1.5; vector-effect:non-scaling-stroke; }
.chip { display:flex; align-items:center; gap:5px; padding:1px 8px; border-radius:10px;
  background:#22262e; font-weight:700; }
.chip .k { color: var(--muted); font-size:9px; text-transform:uppercase; }
.spacer { flex: 1; }
.toggle { color: var(--muted); font-size: 11px; transition: transform .25s; }
.bar.open .toggle { transform: rotate(180deg); }
.ok{color:var(--ok)} .warn{color:var(--warn)} .crit{color:var(--crit)} .info{color:var(--info)} .muted{color:var(--muted)} .blue{color:var(--blue2)}
.spark.ok{stroke:var(--ok)} .spark.warn{stroke:var(--warn)} .spark.crit{stroke:var(--crit)} .spark.rt{stroke:var(--blue2)}
.area.ok{fill:rgba(54,179,126,.12)} .area.warn{fill:rgba(255,171,0,.14)} .area.crit{fill:rgba(255,86,48,.16)} .area.rt{fill:rgba(58,160,255,.16)}

.panel { display:none; gap:14px; padding:14px; max-height:48vh; overflow:auto;
  border-top:1px solid var(--line);
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); align-items:start; }
.bar.open .panel { display:grid; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:11px 13px; }
.card.hero { border-color: rgba(58,160,255,.35);
  background: linear-gradient(160deg, rgba(0,103,186,.16), rgba(28,31,38,.7) 60%); }
.card > h4 { margin:0 0 9px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); font-weight:800; display:flex; gap:6px; align-items:center; }

.hero .big { font-size:30px; font-weight:800; line-height:1; letter-spacing:-.5px;
  background:linear-gradient(90deg,var(--blue2),var(--orange)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.hero .big small { font-size:12px; -webkit-text-fill-color:var(--muted); color:var(--muted); font-weight:700; margin-left:4px; }
.hero svg { width:100%; height:38px; display:block; margin:6px 0 8px; }
.hero polyline { fill:none; stroke-width:1.75; vector-effect:non-scaling-stroke; }
.tag { margin-top:9px; padding-top:8px; border-top:1px solid var(--line); color:var(--muted);
  font-size:10px; line-height:1.5; }
.tag b { color:#cfd3d8; }

.chart { margin-bottom:10px; } .chart:last-child { margin-bottom:0; }
.chart .hd { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:2px; }
.chart .lbl { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.5px; }
.chart .val { font-weight:700; font-size:13px; }
.chart .peak { color:var(--muted); font-size:9px; }
.chart svg { width:100%; height:${CHART_H}px; display:block; }
.chart polyline { fill:none; stroke-width:1.5; vector-effect:non-scaling-stroke; }

.kv { display:flex; justify-content:space-between; gap:8px; padding:2px 0; }
.kv .k { color:var(--muted); } .kv .v { font-weight:600; text-align:right; overflow:hidden; text-overflow:ellipsis; }

.counts { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.feed { font-size:11px; max-height:160px; overflow:auto; border-top:1px solid var(--line); padding-top:6px; }
.feed .empty { color:var(--muted); padding:6px 0; }
.log { display:flex; gap:7px; padding:2px 0; align-items:baseline; border-bottom:1px solid rgba(255,255,255,.04); animation: fadein .3s; }
@keyframes fadein { from{opacity:0;transform:translateY(-2px)} to{opacity:1} }
.log .sev { flex:none; width:54px; font-size:9px; font-weight:800; text-transform:uppercase; }
.log .mod { flex:none; color:var(--muted); max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.log .txt { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.card.fe { border-color: rgba(255,138,61,.3);
  background: linear-gradient(160deg, rgba(255,138,61,.12), rgba(28,31,38,.7) 60%); }
.fw { display:flex; align-items:center; gap:9px; margin-bottom:9px; }
.fw .badge { padding:2px 10px; border-radius:7px; font-weight:800; font-size:11px; color:#0b0d10; }
.fw .name { color:var(--muted); }
.hmr-big { font-size:26px; font-weight:800; line-height:1; transition: color .2s; }
.hmr-big.hmr-flash { color: var(--orange); text-shadow: 0 0 14px rgba(255,138,61,.7); }
.fe svg { width:100%; height:34px; display:block; margin:6px 0 8px; }
.fe polyline { fill:none; stroke-width:1.75; vector-effect:non-scaling-stroke; }
.spark.fe { stroke:var(--orange); } .area.fe { fill:rgba(255,138,61,.16); }

.env-badge { padding:2px 9px; border-radius:6px; font-size:10px; font-weight:800;
  letter-spacing:.6px; text-transform:uppercase; color:#0b0d10; background:var(--muted); }
.env-badge.dev { background: var(--ok); } .env-badge.prod { background: var(--crit); color:#fff; }
.env-badge.test { background: var(--warn); } .env-badge.staging { background:#a06bff; color:#fff; }
.branch { display:flex; align-items:center; gap:5px; padding:2px 9px; border-radius:6px;
  background:#22262e; font-weight:700; max-width:260px; cursor:help; }
.branch .git { color:var(--blue2); } .branch span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ctrl { color:var(--muted); cursor:pointer; padding:0 4px; font-weight:800; font-size:13px; line-height:1; }
.ctrl:hover { color:#fff; }

.minbar { position:fixed; z-index:2147483000; display:none; align-items:center; gap:8px;
  padding:6px 13px; border-radius:22px; cursor:pointer;
  font:12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color:#e8eaed;
  background:rgba(18,20,25,.92); backdrop-filter:blur(12px);
  border:1px solid rgba(58,160,255,.45); box-shadow:0 4px 20px rgba(0,0,0,.5); }
.minbar:hover { border-color:#3aa0ff; box-shadow:0 4px 26px rgba(58,160,255,.4); }
.minbar.bottom { bottom:14px; } .minbar.top { top:14px; }
.minbar.dock-left { left:14px; } .minbar.dock-right { right:14px; }
.minbar .dot { width:8px; height:8px; border-radius:50%; background:#36b37e; }
.minbar .dot.connected { background:#36b37e; } .minbar .dot.disconnected,.minbar .dot.error { background:#ff5630; }
.minbar .dot.connecting,.minbar .dot.reconnecting { background:#ffab00; }
.minbar .mlogo { color:#ff8a3d; } .minbar .mrate { font-weight:800; }
.minbar .mbadge { font-size:9px; font-weight:800; text-transform:uppercase; color:#8a9099; }
`;

function pushCap(arr: number[], v: number, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.shift();
}

/** Clés de persistance localStorage (état chrome de la barre). */
const LS = {
  visible: "nf.debugbar.visible",
  min: "nf.debugbar.min",
  side: "nf.debugbar.side",
} as const;

function lsGet(key: string, def: string): string {
  try {
    return localStorage.getItem(key) ?? def;
  } catch {
    return def;
  }
}
function lsSet(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* private mode / SSR */
  }
}

/**
 * Handle global exposé sur `window.__NODEFONY_DEBUGBAR__` — permet à une app
 * (ex. Studio) de piloter la visibilité de la barre auto-injectée sans la
 * remonter. Bridge entre le widget (Core) et un store applicatif.
 */
export interface DebugBarHandle {
  isVisible(): boolean;
  setVisible(v: boolean): void;
  toggle(): void;
  minimize(): void;
  restore(): void;
}

const GLOBAL_KEY = "__NODEFONY_DEBUGBAR__";

/**
 * Widget DOM. Lazy : ne construit le Shadow DOM qu'au `mount()`. Idempotent
 * (un seul `#nodefony-debugbar` par page).
 */
export class DebugBar {
  private readonly client: RealtimeClient;
  private readonly model = new DebugBarModel();
  private readonly url: string;
  private readonly position: "bottom" | "top";
  private readonly startOpen: boolean;
  private readonly ownClient: boolean;
  private readonly frontend: DebugBarFrontend | null;

  private host: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  // Chrome persistant (localStorage) : visible / réduit en chip / côté du dock.
  private visible: boolean;
  private minimized: boolean;
  private side: "left" | "right";
  private rafPending = false;
  private feedLen = -1;
  // Pouls realtime — débit msg/s dérivé du compteur de frames du client.
  private prevFrames = 0;
  private rtRate = 0;
  private rtPeak = 0;
  private readonly rtSeries: number[] = [];
  // Pouls HMR Vite — observé via la sonde `connectViteHmr`.
  private viteConnected = false;
  private hmrCount = 0;
  private hmrPrev = 0;
  private hmrRate = 0;
  private hmrLast = "—";
  private readonly hmrSeries: number[] = [];
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: Array<() => void> = [];
  private readonly el: Record<string, Element> = Object.create(null);

  constructor(opts: DebugBarOptions = {}) {
    this.url = opts.url ?? DEFAULT_PATH;
    this.position = opts.position ?? "bottom";
    this.startOpen = opts.open ?? false;
    this.ownClient = !opts.client;
    this.frontend = opts.frontend ?? null;
    this.client = opts.client ?? new RealtimeClient({ url: this.url });
    this.visible = lsGet(LS.visible, "1") !== "0";
    this.minimized = lsGet(LS.min, "0") === "1";
    this.side = lsGet(LS.side, "right") === "left" ? "left" : "right";
  }

  /** Construit le DOM, branche le realtime et ouvre la connexion. No-op si déjà monté. */
  mount(): this {
    if (typeof document === "undefined") return this;
    if (document.getElementById(HOST_ID)) return this;
    this.buildDom();
    this.wireRealtime();
    this.wireHmr();
    this.applyChrome();
    this.registerHandle();
    if (this.ownClient) {
      this.client.connect(this.url).catch(() => {
        /* reconnexion gérée par le client */
      });
    }
    this.render();
    return this;
  }

  /** Détache listeners, ferme la connexion (si propriétaire) et retire le DOM. */
  unmount(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
    if (this.ownClient) this.client.disconnect();
    this.unregisterHandle();
    this.host?.remove();
    this.host = null;
    this.bar = null;
  }

  // ── Chrome (visibilité / réduction / dock) ──────────────────────────────

  /** Affiche/masque la barre (pilotable depuis une app via le handle global). */
  setVisible(v: boolean): void {
    this.visible = v;
    lsSet(LS.visible, v ? "1" : "0");
    this.applyChrome();
  }

  private setMinimized(v: boolean): void {
    this.minimized = v;
    lsSet(LS.min, v ? "1" : "0");
    this.applyChrome();
  }

  private toggleSide(): void {
    this.side = this.side === "left" ? "right" : "left";
    lsSet(LS.side, this.side);
    this.applyChrome();
  }

  /** Applique l'état chrome au DOM (display + classes de dock). */
  private applyChrome(): void {
    if (!this.host || !this.bar) return;
    this.host.style.display = this.visible ? "" : "none";
    this.bar.style.display = this.minimized ? "none" : "";
    const min = this.el.minbar as HTMLElement | undefined;
    if (min) {
      min.style.display = this.minimized ? "flex" : "none";
      min.setAttribute("class", `minbar ${this.position} dock-${this.side}`);
    }
  }

  private registerHandle(): void {
    const handle: DebugBarHandle = {
      isVisible: () => this.visible,
      setVisible: (v) => this.setVisible(v),
      toggle: () => this.setVisible(!this.visible),
      minimize: () => this.setMinimized(true),
      restore: () => this.setMinimized(false),
    };
    (globalThis as unknown as Record<string, DebugBarHandle>)[GLOBAL_KEY] =
      handle;
  }

  private unregisterHandle(): void {
    try {
      delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
    } catch {
      /* noop */
    }
  }

  // ── DOM ───────────────────────────────────────────────────────────────

  private buildDom(): void {
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    const bar = document.createElement("div");
    bar.className = `bar ${this.position}${this.startOpen ? " open" : ""}`;
    bar.innerHTML = this.template();
    const minbar = document.createElement("div");
    minbar.className = `minbar ${this.position} dock-${this.side}`;
    minbar.innerHTML = `<span class="dot" data-el="mdot"></span><span class="mlogo">⚡</span><span class="mrate" data-el="mrate">0/s</span><span class="mbadge" data-el="mEnv"></span>`;
    shadow.append(style, bar, minbar);
    document.body.appendChild(host);
    this.host = host;
    this.bar = bar;
    // Le conteneur `.minbar` n'a pas de [data-el] → on garde la ref directement
    // (sinon `applyChrome` ne peut pas l'afficher → barre réduite = invisible).
    this.el.minbar = minbar;
    shadow.querySelectorAll("[data-el]").forEach((node) => {
      const key = node.getAttribute("data-el");
      if (key) this.el[key] = node;
    });
    // Déplier/replier le panneau (clic sur le bandeau, hors boutons de contrôle).
    const strip = bar.querySelector(".strip")!;
    const onStrip = (): void => {
      bar.classList.toggle("open");
    };
    strip.addEventListener("click", onStrip);
    this.disposers.push(() => strip.removeEventListener("click", onStrip));
    // Boutons de contrôle (stopPropagation : ne pas déplier le panneau).
    this.wireBtn("btnMin", (e) => {
      e.stopPropagation();
      this.setMinimized(true);
    });
    this.wireBtn("btnSide", (e) => {
      e.stopPropagation();
      this.toggleSide();
    });
    // Chip réduit → restaure la barre complète.
    const onMin = (): void => this.setMinimized(false);
    minbar.addEventListener("click", onMin);
    this.disposers.push(() => minbar.removeEventListener("click", onMin));
  }

  private wireBtn(key: string, handler: (e: Event) => void): void {
    const node = this.el[key];
    if (!node) return;
    node.addEventListener("click", handler);
    this.disposers.push(() => node.removeEventListener("click", handler));
  }

  private template(): string {
    return `
      <div class="strip">
        <span class="dot" data-el="dot"></span>
        <span class="brand"><span class="logo">◆</span><span class="name">nodefony</span></span>
        <span class="env-badge" data-el="envBadge">env</span>
        <span class="branch" data-el="branch" title="branche git"><span class="git">⎇</span><span data-el="branchName">—</span></span>
        <span class="rt-pill" data-el="rtPill"><span class="bolt">⚡</span> realtime</span>
        ${this.miniMetric("rt", "rt", "rtMini", "0/s")}
        ${this.miniMetric("cpu", "cpu", "cpuMini", "0%")}
        ${this.miniMetric("mem", "mem", "memMini", "0%")}
        <span class="metric"><span class="k">loop</span><span class="v" data-el="loop">0ms</span></span>
        <span class="spacer"></span>
        <span class="chip"><span class="k">logs</span><span data-el="logs">0</span></span>
        <span class="chip"><span class="k">err</span><span class="crit" data-el="err">0</span></span>
        <span class="chip"><span class="k">warn</span><span class="warn" data-el="warn">0</span></span>
        <span class="ctrl" data-el="btnSide" title="Changer de côté">⇄</span>
        <span class="ctrl" data-el="btnMin" title="Réduire">—</span>
        <span class="toggle">▴</span>
      </div>
      <div class="panel">
        <div class="card hero">
          <h4><span class="blue">⚡</span> Realtime</h4>
          <div class="big"><span data-el="rtBig">0</span><small>msg/s</small></div>
          <svg viewBox="0 0 ${CHART_W} 38" preserveAspectRatio="none">
            <polygon class="area rt" data-el="rtArea" points=""/>
            <polyline class="spark rt" data-el="rtLine" points=""/>
          </svg>
          ${this.kv("transport", "rtTransport")}
          ${this.kv("protocole", "rtProto")}
          ${this.kv("état", "rtState")}
          ${this.kv("frames reçues", "rtFrames")}
          ${this.kv("pic", "rtPeak")}
          <div class="tag"><b>HTTP &amp; WebSocket, même contexte.</b> Push natif, <b>0 polling</b> — chaque chiffre ci-dessus arrive en temps réel par le Core isomorphe.</div>
        </div>
        ${this.frontendCard()}
        <div class="card">
          <h4>Performance</h4>
          ${this.chart("CPU", "cpuVal", "cpuPeak", "cpuLine", "cpuArea")}
          ${this.chart("Heap", "heapVal", "heapPeak", "heapLine", "heapArea")}
          ${this.chart("Event loop", "loopVal", "loopPeak", "loopLine", "loopArea")}
        </div>
        <div class="card">
          <h4>Runtime</h4>
          ${this.kv("app", "appName")}
          ${this.kv("version", "appVersion")}
          ${this.kv("environnement", "envRow")}
          ${this.kv("branche", "branchRow")}
          ${this.kv("pid", "pid")}
          ${this.kv("uptime", "uptime")}
          ${this.kv("instance", "instance")}
          ${this.kv("cpu cores", "cores")}
          ${this.kv("loadavg", "load")}
          ${this.kv("rss", "rss")}
          ${this.kv("heap used", "heapUsed")}
          ${this.kv("heap total", "heapTotal")}
          ${this.kv("heap limit", "heapLimit")}
          ${this.kv("external", "external")}
        </div>
        <div class="card">
          <h4>Logs</h4>
          <div class="counts">
            <span class="chip"><span class="k">total</span><span data-el="cTotal">0</span></span>
            <span class="chip"><span class="k">err</span><span class="crit" data-el="cErr">0</span></span>
            <span class="chip"><span class="k">warn</span><span class="warn" data-el="cWarn">0</span></span>
            <span class="chip"><span class="k">dropped</span><span class="muted" data-el="cDrop">0</span></span>
          </div>
          <div class="feed" data-el="feed"><div class="empty">en attente de logs…</div></div>
        </div>
      </div>`;
  }

  private miniMetric(
    label: string,
    valKey: string,
    sparkKey: string,
    init: string,
  ): string {
    return `<span class="metric">
      <span class="k">${label}</span>
      <span class="v" data-el="${valKey}">${init}</span>
      <svg class="mini" viewBox="0 0 ${MINI_W} ${MINI_H}" preserveAspectRatio="none">
        <polyline class="spark ok" data-el="${sparkKey}" points=""/>
      </svg>
    </span>`;
  }

  private chart(
    label: string,
    valKey: string,
    peakKey: string,
    lineKey: string,
    areaKey: string,
  ): string {
    return `<div class="chart">
      <div class="hd">
        <span class="lbl">${label}</span>
        <span><span class="val" data-el="${valKey}">—</span> <span class="peak" data-el="${peakKey}"></span></span>
      </div>
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none">
        <polygon class="area ok" data-el="${areaKey}" points=""/>
        <polyline class="spark ok" data-el="${lineKey}" points=""/>
      </svg>
    </div>`;
  }

  private kv(label: string, key: string): string {
    return `<div class="kv"><span class="k">${label}</span><span class="v" data-el="${key}">—</span></div>`;
  }

  /** Carte Frontend / HMR — affichée seulement si un contexte frontend est fourni. */
  private frontendCard(): string {
    if (!this.frontend) return "";
    const fw = FRAMEWORKS[this.frontend.framework ?? ""] ?? {
      label: this.frontend.framework ?? "Frontend",
      color: "#3aa0ff",
    };
    return `<div class="card fe">
      <h4><span style="color:${fw.color}">●</span> Frontend</h4>
      <div class="fw">
        <span class="badge" style="background:${fw.color}">${escapeHtml(fw.label)}</span>
        <span class="name">${escapeHtml(this.frontend.name ?? "")}</span>
      </div>
      <div class="hd"><span class="lbl">HMR hot updates</span><span class="hmr-big" data-el="hmrBig">0</span></div>
      <svg viewBox="0 0 ${CHART_W} 34" preserveAspectRatio="none">
        <polygon class="area fe" data-el="hmrArea" points=""/>
        <polyline class="spark fe" data-el="hmrLine" points=""/>
      </svg>
      ${this.kv("bundler", "feVite")}
      ${this.kv("dernier module", "hmrLast")}
      <div class="tag"><b>Backend &amp; frontend, un seul process.</b> HMR Vite branché au runtime Nodefony — sauvegarde un composant, la barre pulse.</div>
    </div>`;
  }

  // ── Realtime ──────────────────────────────────────────────────────────

  private wireRealtime(): void {
    const offState = this.client.on("__state__", (...a) => {
      this.model.setState(a[0] as RealtimeState);
      if (a[0] === "connected") this.subscribeAll();
      this.scheduleRender();
    });
    // `__stats__` : tick 1/s du client → échantillonne le débit msg/s (pouls realtime).
    const offTick = this.client.on("__stats__", () => {
      this.sampleThroughput();
      this.scheduleRender();
    });
    const offStats = this.client.on(CHANNELS.stats, (...a) => {
      const p = a[0];
      if (p && typeof p === "object") this.model.ingestStats(p as StatsPayload);
      this.scheduleRender();
    });
    const offSyslog = this.client.on(CHANNELS.syslog, (...a) => {
      const p = a[0];
      if (p && typeof p === "object")
        this.model.ingestSyslog(p as SyslogPayload);
      this.scheduleRender();
    });
    this.disposers.push(offState, offTick, offStats, offSyslog);
    if (this.client.state === "connected") this.subscribeAll();
  }

  private subscribeAll(): void {
    this.client.emit("subscribe", { channel: CHANNELS.stats });
    this.client.emit("subscribe", { channel: CHANNELS.syslog });
  }

  private sampleThroughput(): void {
    const total = this.client.framesReceived;
    this.rtRate = Math.max(0, total - this.prevFrames);
    this.prevFrames = total;
    if (this.rtRate > this.rtPeak) this.rtPeak = this.rtRate;
    pushCap(this.rtSeries, this.rtRate, RT_POINTS);
    // Échantillonne aussi le débit HMR sur le même tick 1/s.
    this.hmrRate = Math.max(0, this.hmrCount - this.hmrPrev);
    this.hmrPrev = this.hmrCount;
    pushCap(this.hmrSeries, this.hmrRate, RT_POINTS);
  }

  // ── HMR Vite ──────────────────────────────────────────────────────────

  private wireHmr(): void {
    const url = this.frontend?.hmrUrl;
    if (!url) return;
    const dispose = connectViteHmr(url, (e) => this.onHmr(e));
    this.disposers.push(dispose);
  }

  private onHmr(e: HmrEvent): void {
    if (e.kind === "connected") {
      this.viteConnected = true;
    } else if (e.kind === "update") {
      this.hmrCount++;
      this.hmrLast = e.path ?? "(module)";
      this.flashHmr();
    } else if (e.kind === "full-reload") {
      this.hmrCount++;
      this.hmrLast = e.path ?? "full reload";
      this.flashHmr();
    }
    this.scheduleRender();
  }

  /** Pulse visuel du compteur HMR à chaque hot-update (psychologie : ça vit). */
  private flashHmr(): void {
    const node = this.el.hmrBig;
    if (!node) return;
    node.setAttribute("class", "hmr-big hmr-flash");
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      node.setAttribute("class", "hmr-big");
    }, 600);
  }

  // ── Rendu ─────────────────────────────────────────────────────────────

  private scheduleRender(): void {
    if (typeof requestAnimationFrame === "undefined") {
      this.render();
      return;
    }
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.render();
    });
  }

  private text(key: string, value: string): void {
    const node = this.el[key];
    if (node) node.textContent = value;
  }

  /** className safe pour HTML *et* SVG (SVGElement.className n'est pas une string). */
  private cls(key: string, value: string): void {
    this.el[key]?.setAttribute("class", value);
  }

  private setPoints(
    lineKey: string,
    areaKey: string | null,
    series: number[],
    tier: string,
    height: number,
    max?: number,
  ): void {
    const pts = sparklinePoints(series, CHART_W, height, max);
    this.el[lineKey]?.setAttribute("points", pts);
    this.el[lineKey]?.setAttribute("class", `spark ${tier}`);
    if (areaKey) {
      const area = this.el[areaKey];
      if (area) {
        area.setAttribute(
          "points",
          pts ? `${pts} ${CHART_W},${height} 0,${height}` : "",
        );
        area.setAttribute("class", `area ${tier}`);
      }
    }
  }

  private render(): void {
    if (!this.bar) return;
    const v = this.model.view;
    const live = v.state === "connected";
    const cpuT = gauge(v.cpuPercent);
    const memT = gauge(v.heapPercent);
    const loopT = gauge(v.eventLoopMs, 50, 200);

    // app meta (env + branche git) — la signature « framework realtime »
    const env = v.env || (live ? "—" : "");
    this.text("envBadge", env || "env");
    this.cls("envBadge", `env-badge ${envClass(v.env)}`);
    this.text("branchName", v.branch || "—");
    this.el.branch?.setAttribute(
      "title",
      v.branch ? `branche git : ${v.branch}` : "branche git",
    );
    this.text("mEnv", v.env);

    // realtime hook
    this.cls("dot", `dot ${v.state}`);
    this.cls("mdot", `dot ${v.state}`);
    this.text("mrate", `${this.rtRate}/s`);
    this.cls("rtPill", live ? "rt-pill live" : "rt-pill");
    this.text("rt", `${this.rtRate}/s`);
    this.cls("rt", "v blue");
    this.el.rtMini?.setAttribute("points", sparklinePoints(this.rtSeries, MINI_W, MINI_H));
    this.el.rtMini?.setAttribute("class", "spark rt");
    this.text("rtBig", String(this.rtRate));
    this.setPoints("rtLine", "rtArea", this.rtSeries, "rt", 38);
    this.text("rtTransport", "WebSocket");
    this.text("rtProto", "JSON-RPC 2.0");
    this.text("rtState", v.state);
    this.cls("rtState", `v ${live ? "ok" : "warn"}`);
    this.text("rtFrames", String(this.client.framesReceived));
    this.text("rtPeak", `${this.rtPeak}/s`);

    // frontend / HMR
    if (this.frontend) {
      this.text("hmrBig", String(this.hmrCount));
      this.setPoints("hmrLine", "hmrArea", this.hmrSeries, "fe", 34);
      this.text("feVite", this.viteConnected ? "Vite · connecté" : "Vite · …");
      this.cls("feVite", `v ${this.viteConnected ? "ok" : "warn"}`);
      this.text("hmrLast", this.hmrLast);
    }

    // strip metrics
    this.text("cpu", `${v.cpuPercent}%`);
    this.cls("cpu", `v ${cpuT}`);
    this.text("mem", `${v.heapPercent}%`);
    this.cls("mem", `v ${memT}`);
    this.text("loop", `${v.eventLoopMs}ms`);
    this.cls("loop", `v ${loopT}`);
    this.text("logs", String(v.logTotal));
    this.text("err", String(v.errorCount));
    this.text("warn", String(v.warnCount));
    this.el.cpuMini?.setAttribute("points", sparklinePoints(v.cpuSeries, MINI_W, MINI_H, 100));
    this.el.cpuMini?.setAttribute("class", `spark ${cpuT}`);
    this.el.memMini?.setAttribute("points", sparklinePoints(v.heapSeries, MINI_W, MINI_H, 100));
    this.el.memMini?.setAttribute("class", `spark ${memT}`);

    // perf charts
    this.text("cpuVal", `${v.cpuPercent}%`);
    this.text("cpuPeak", v.cpuPeak ? `peak ${v.cpuPeak}%` : "");
    this.cls("cpuVal", `val ${cpuT}`);
    this.setPoints("cpuLine", "cpuArea", v.cpuSeries, cpuT, CHART_H, 100);
    this.text("heapVal", `${v.heapPercent}%`);
    this.text("heapPeak", v.heapPeak ? `peak ${v.heapPeak}%` : "");
    this.cls("heapVal", `val ${memT}`);
    this.setPoints("heapLine", "heapArea", v.heapSeries, memT, CHART_H, 100);
    this.text("loopVal", `${v.eventLoopMs}ms`);
    this.text("loopPeak", v.eventLoopPeak ? `peak ${v.eventLoopPeak}ms` : "");
    this.cls("loopVal", `val ${loopT}`);
    this.setPoints("loopLine", "loopArea", v.loopSeries, loopT, CHART_H);

    // runtime
    this.text("appName", v.appName || "—");
    this.text("appVersion", v.appVersion || "—");
    this.text("envRow", v.debug ? `${v.env} · debug` : v.env || "—");
    this.text("branchRow", v.branch || "—");
    this.text("pid", String(v.pid));
    this.text("uptime", formatUptime(v.uptime));
    this.text("instance", v.instanceId);
    this.text("cores", String(v.cpuCount));
    this.text("load", v.loadavg.map((n) => n.toFixed(2)).join(" ") || "—");
    this.text("rss", formatBytes(v.rss));
    this.text("heapUsed", formatBytes(v.heapUsed));
    this.text("heapTotal", formatBytes(v.heapTotal));
    this.text("heapLimit", formatBytes(v.heapLimit));
    this.text("external", formatBytes(v.external));

    // logs
    this.text("cTotal", String(v.logTotal));
    this.text("cErr", String(v.errorCount));
    this.text("cWarn", String(v.warnCount));
    this.text("cDrop", String(v.dropped));
    this.renderFeed(v.feed);
  }

  private renderFeed(feed: FeedLog[]): void {
    const node = this.el.feed;
    if (!node || feed.length === this.feedLen) return;
    this.feedLen = feed.length;
    if (feed.length === 0) {
      node.innerHTML = `<div class="empty">en attente de logs…</div>`;
      return;
    }
    let html = "";
    for (let i = feed.length - 1; i >= 0; i--) {
      const l = feed[i]!;
      const tier =
        l.severity <= 3
          ? "crit"
          : l.severity === 4
            ? "warn"
            : l.severity === 7
              ? "muted"
              : "info";
      html += `<div class="log"><span class="sev ${tier}">${escapeHtml(l.name)}</span><span class="mod">${escapeHtml(l.module)}</span><span class="txt">${escapeHtml(l.text)}</span></div>`;
    }
    node.innerHTML = html;
  }
}

/** Mappe un nom d'environnement vers une classe de couleur du badge. */
function envClass(env: string): string {
  const e = env.toLowerCase();
  if (e.startsWith("prod")) return "prod";
  if (e.startsWith("dev")) return "dev";
  if (e.startsWith("test")) return "test";
  if (e.startsWith("stag")) return "staging";
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default DebugBar;
