/**
 * DebugBar — toolbar de debug par-page type Symfony WDT, **dev-only**, pensée
 * comme une **vitrine du realtime Nodefony** (on doit *voir* le framework
 * respirer en direct).
 *
 * 2ᵉ consommateur navigateur du Core isomorphe après Studio : MÊME backbone
 * realtime (WS JSON-RPC 2.0, canaux `dashboard:stats` / `syslog:stream`) via
 * {@link RealtimeClient}. Aucun rendu serveur splicé dans le body : le serveur
 * *collecte*, le client *rend*.
 *
 * UI : **onglets** (Realtime / Network / Perf / Logs / Runtime) — un seul pane
 * rendu/visible à la fois (≠ grid fourre-tout) + **poignée de resize** (hauteur
 * persistée). Vanilla TS + **Shadow DOM** + sparklines **SVG maison** — 0 dep UI.
 *
 * Perf scroll (critique) : fond OPAQUE sur le panneau (le `backdrop-filter:blur`
 * sur le conteneur scrollable recompositait à chaque frame), `contain:content`
 * par pane, et la liste Network en **mise à jour incrémentale** (nœuds stables,
 * jamais de rebuild `innerHTML` global → le clic n'est plus perdu, le scroll ne
 * saute plus).
 *
 * Panneau **Network** (dev-only) : intercepte `fetch`/`XHR` (header-only,
 * défensif, réversible) → liste des appels AJAX ; clic sur un appel → fetch du
 * profil serveur (`/nodefony/profiler/api/{requestId}`, corrélé via le header
 * `X-Request-Id`) → **waterfall des phases** du pipeline. SPA-first : on profile
 * les appels, pas la page. Le `traceparent` W3C (RFC-propre) est aussi remonté.
 */
import { RealtimeClient } from "../realtime/RealtimeClient";
import type { RealtimeState } from "../realtime/RealtimeClient";
import {
  DebugBarModel,
  type DebugBarView,
  type FeedLog,
  type StatsPayload,
  type SyslogPayload,
} from "./model";
import { formatBytes, formatUptime, gauge, sparklinePoints } from "./format";
import { observeViteHmr, type HmrEvent } from "./hmr";
import { installNetworkInterceptor, type NetEntry } from "./network";
import {
  NetworkModel,
  computeWaterfall,
  isError as isNetError,
  type ProfileEntry,
} from "./profile";

/** Canaux realtime consommés (figés, alignés sur les providers Studio). */
const CHANNELS = {
  stats: "dashboard:stats",
  syslog: "syslog:stream",
} as const;

/** Endpoint WS realtime par défaut (porté par Studio aujourd'hui, RealtimeService demain). */
const DEFAULT_PATH = "/nodefony/studio/api/realtime";
/** Base du data-plane profiler (data-plane admin `IAdminApi` namespace `profiler`). */
const DEFAULT_PROFILER_BASE = "/nodefony/profiler/api";
const HOST_ID = "nodefony-debugbar";

/** Dimensions des sparklines (unités viewBox SVG). */
const MINI_W = 58;
const MINI_H = 20;
const CHART_W = 260;
const CHART_H = 46;
const RT_POINTS = 60;

/** Borne basse de hauteur du panneau (px). */
const PANEL_H_MIN = 140;
/**
 * Hauteur par défaut = **fraction de l'écran** (≈48 % du viewport) — gros écran
 * → grand panneau, petit écran → panneau modeste. Bornée [300, 640] pour rester
 * raisonnable aux extrêmes.
 */
function defaultPanelH(): number {
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return Math.min(640, Math.max(300, Math.round(vh * 0.48)));
}
/** Hauteur mini à l'ouverture d'un profil (waterfall confortable) ≈55 % écran. */
function detailPanelH(): number {
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return Math.min(680, Math.max(360, Math.round(vh * 0.55)));
}

/** Onglets disponibles (ordre d'affichage). */
type TabId = "realtime" | "network" | "perf" | "logs" | "runtime";

/** Contexte frontend injecté par le builder Vite (@nodefony/frontend) en dev. */
export interface DebugBarFrontend {
  /** Type de preset : `react19` | `vue3` | `angular` | `vanilla`. */
  framework?: string;
  /** Nom logique de l'entrée frontend (bundle). */
  name?: string;
  /** Origine du serveur Vite (ex. `https://127.0.0.1:5173`). */
  viteOrigin?: string;
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
  /**
   * Active le panneau Network (intercepte `fetch`/`XHR`). Défaut `true`.
   * `false` → aucun monkey-patch des globals (opt-out total).
   */
  network?: boolean;
  /** Base du data-plane profiler. Défaut `/nodefony/profiler/api`. */
  profilerBase?: string;
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
  /* Fond OPAQUE (pas de backdrop-filter sur le conteneur scrollable : il
     recompositait le blur à chaque frame de scroll → lag). Blur seulement sur
     .strip (fin, non scrollé). */
  background: #14161a;
  --blue:#0067ba; --blue2:#3aa0ff; --orange:#ff8a3d; --ok:#36b37e; --warn:#ffab00;
  --crit:#ff5630; --info:#4c9aff; --muted:#8a9099; --line:#2a2e36; --card:#1c1f26;
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

/* Strip responsive : police (et tout le contenu en em) scale avec la largeur
   d'écran, bornée 12→15px. Padding scale aussi. */
.strip { display: flex; align-items: center; gap: clamp(12px,1.1vw,20px);
  padding: clamp(8px,1vh,13px) clamp(14px,1.4vw,26px); cursor: pointer;
  font-size: clamp(12px, 0.35vw + 8px, 16px); flex-wrap: nowrap; overflow: hidden;
  background: rgba(20,22,26,.6); backdrop-filter: blur(14px) saturate(140%); }
.strip:hover { background: rgba(255,255,255,.03); }
.brand { display:flex; align-items:center; gap:8px; font-weight:800; letter-spacing:.2px; flex:none; }
.brand .logo { color: var(--blue2); font-size:1.05em; filter: drop-shadow(0 0 6px rgba(58,160,255,.6)); }
.brand .name { background: linear-gradient(90deg,#fff,var(--blue2)); -webkit-background-clip:text;
  background-clip:text; -webkit-text-fill-color:transparent; }
.rt-pill { display:flex; align-items:center; gap:5px; padding:.2em .7em; border-radius:11px; flex:none;
  font-size:.76em; font-weight:800; letter-spacing:.6px; text-transform:uppercase;
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

.metric { display: flex; align-items: center; gap: 6px; white-space: nowrap; flex:none; }
.metric .k { color: var(--muted); text-transform: uppercase; font-size: .76em; letter-spacing:.5px; }
.metric .v { font-weight: 700; min-width: 2.6em; font-size: 1em; }
.mini { width: 3.8em; height: 1.35em; display:block; }
.mini polyline { fill:none; stroke-width:1.5; vector-effect:non-scaling-stroke; }
.chip { display:flex; align-items:center; gap:6px; padding:.2em .7em; border-radius:11px; flex:none;
  background:#22262e; font-weight:700; font-size:.92em; white-space:nowrap; }
.chip .k { color: var(--muted); font-size:.82em; text-transform:uppercase; }
.spacer { flex: 1 1 auto; min-width: 8px; }
.toggle { color: var(--muted); font-size: .85em; transition: transform .25s; flex:none; }
.bar.open .toggle { transform: rotate(180deg); }
.ok{color:var(--ok)} .warn{color:var(--warn)} .crit{color:var(--crit)} .info{color:var(--info)} .muted{color:var(--muted)} .blue{color:var(--blue2)}
.spark.ok{stroke:var(--ok)} .spark.warn{stroke:var(--warn)} .spark.crit{stroke:var(--crit)} .spark.rt{stroke:var(--blue2)}
.area.ok{fill:rgba(54,179,126,.12)} .area.warn{fill:rgba(255,171,0,.14)} .area.crit{fill:rgba(255,86,48,.16)} .area.rt{fill:rgba(58,160,255,.16)}

/* ── Panneau : resize + onglets + panes ──────────────────────────────────── */
.panelwrap { display:none; flex-direction:column; border-top:1px solid var(--line); }
.bar.open .panelwrap { display:flex; }
.resize { height:8px; cursor:ns-resize; display:flex; align-items:center; justify-content:center;
  flex:none; background:rgba(255,255,255,.015); }
.resize::after { content:""; width:42px; height:3px; border-radius:2px; background:var(--line); transition:background .15s; }
.resize:hover::after { background:var(--blue2); }
.tabs { display:flex; gap:2px; padding:0 8px; flex:none; border-bottom:1px solid var(--line);
  overflow-x:auto; scrollbar-width:none; }
.tabs::-webkit-scrollbar { display:none; }
.tab { padding:7px 12px; font:inherit; font-size:11px; font-weight:700; color:var(--muted);
  cursor:pointer; border:0; background:none; border-bottom:2px solid transparent;
  text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; display:flex; align-items:center; gap:5px; }
.tab:hover { color:#fff; }
.tab.active { color:#fff; border-bottom-color:var(--blue2); }
.tab .tcount { font-size:9px; padding:0 5px; border-radius:8px; background:#22262e; color:var(--muted); }
.tab.active .tcount { background:rgba(58,160,255,.25); color:#fff; }
.tab .tcount.crit { background:rgba(255,86,48,.3); color:#fff; }
.panes { overflow:hidden; }
.pane { display:none; height:100%; overflow:auto; padding:14px; contain:content; }
.pane.active { display:block; }
.cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:14px; align-items:start; }
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
.feed { font-size:11px; }
.feed .empty { color:var(--muted); padding:6px 0; }
.log { display:flex; gap:7px; padding:2px 0; align-items:baseline; border-bottom:1px solid rgba(255,255,255,.04); }
.log .sev { flex:none; width:54px; font-size:9px; font-weight:800; text-transform:uppercase; }
.log .mod { flex:none; color:var(--muted); max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.log .txt { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.card.fe { border-color: rgba(255,138,61,.3);
  background: linear-gradient(160deg, rgba(255,138,61,.12), rgba(28,31,38,.7) 60%); }
.fw { display:flex; align-items:center; gap:9px; margin-bottom:9px; }
.fw .badge { padding:2px 10px; border-radius:7px; font-weight:800; font-size:11px; color:#0b0d10; }
.fw .name { color:var(--muted); }
.fe .hd { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:2px; }
.fe .lbl { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.5px; }
.hmr-big { font-size:26px; font-weight:800; line-height:1; transition: color .2s; }
.hmr-big.hmr-flash { color: var(--orange); text-shadow: 0 0 14px rgba(255,138,61,.7); }
.fe svg { width:100%; height:34px; display:block; margin:6px 0 8px; }
.fe polyline { fill:none; stroke-width:1.75; vector-effect:non-scaling-stroke; }
.spark.fe { stroke:var(--orange); } .area.fe { fill:rgba(255,138,61,.16); }

.env-badge { padding:.2em .7em; border-radius:6px; font-size:.76em; font-weight:800;
  letter-spacing:.6px; text-transform:uppercase; color:#0b0d10; background:var(--muted); flex:none; }
.env-badge.dev { background: var(--ok); } .env-badge.prod { background: var(--crit); color:#fff; }
.env-badge.test { background: var(--warn); } .env-badge.staging { background:#a06bff; color:#fff; }
.branch { display:flex; align-items:center; gap:5px; padding:2px 9px; border-radius:6px; flex:none;
  background:#22262e; font-weight:700; max-width:200px; cursor:help; }
.branch .git { color:var(--blue2); } .branch span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ctrl { color:var(--muted); cursor:pointer; padding:0 4px; font-weight:800; font-size:1.05em; line-height:1; flex:none; }
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

/* ── Network ─────────────────────────────────────────────────────────────── */
.net-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.net-clear { margin-left:auto; color:var(--muted); cursor:pointer; font-size:10px;
  text-transform:uppercase; letter-spacing:.5px; padding:2px 6px; border-radius:6px; }
.net-clear:hover { color:#fff; background:rgba(255,255,255,.06); }
.net-list { border-top:1px solid var(--line); }
.net-list .empty { color:var(--muted); padding:8px 0; }
.net-row { display:flex; align-items:center; gap:9px; padding:3px 4px; cursor:pointer;
  border-bottom:1px solid rgba(255,255,255,.04); }
.net-row:hover { background:rgba(255,255,255,.04); }
.net-row.sel { background:rgba(58,160,255,.14); }
.net-row.err .net-path { color:#ffb4a6; }
.net-method { flex:none; width:46px; text-align:center; font-weight:800; font-size:9px;
  padding:1px 0; border-radius:5px; text-transform:uppercase; color:#0b0d10; background:var(--muted); }
.net-method.get { background:var(--blue2); } .net-method.post { background:var(--ok); }
.net-method.put,.net-method.patch { background:var(--orange); }
.net-method.delete { background:var(--crit); color:#fff; }
.net-method.ws { background:#a06bff; color:#fff; }
.net-path { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.net-status { flex:none; width:38px; text-align:center; font-weight:800; font-size:10px; }
.net-status.s2 { color:var(--ok); } .net-status.s3 { color:var(--info); }
.net-status.s4 { color:var(--warn); } .net-status.s5 { color:var(--crit); }
.net-status.sp { color:var(--muted); }
.net-dur { flex:none; width:58px; text-align:right; color:var(--muted); font-size:10px; }
.net-rid { flex:none; color:var(--blue2); font-size:9px; opacity:.7; }

.net-detail { margin-top:10px; border-top:1px solid var(--line); padding-top:10px; }
.net-detail .empty { color:var(--muted); }
.det-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap:2px 14px; margin-bottom:10px; }
.wf { display:flex; flex-direction:column; gap:3px; }
.wf-title { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
.wf-row { display:flex; align-items:center; gap:8px; }
.wf-name { flex:none; width:74px; text-align:right; color:#cfd3d8; font-size:10px; }
.wf-track { flex:1; position:relative; height:14px; background:rgba(255,255,255,.04); border-radius:3px; }
.wf-bar { position:absolute; top:0; bottom:0; border-radius:3px; min-width:2px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.wf-ms { flex:none; width:62px; text-align:right; color:var(--muted); font-size:10px; }
.wf-bar.parse { background:#4c9aff; } .wf-bar.resolve { background:#3aa0ff; }
.wf-bar.firewall { background:#ff8a3d; } .wf-bar.init { background:#a06bff; }
.wf-bar.action { background:#36b37e; } .wf-bar.render { background:#ffab00; }
.wf-bar.send { background:#00b8d9; } .wf-bar.other { background:#8a9099; }
.det-loading,.det-err { color:var(--muted); padding:6px 0; } .det-err { color:var(--crit); }

/* Network pane = split DevTools : liste (scroll) + détail (scroll), détail
   TOUJOURS visible (≠ tout dans un seul scroll où le détail finit hors écran). */
.pane.np.active { display:flex; flex-direction:column; padding:0; }
.np .net-head { padding:10px 14px 8px; flex:none; margin:0; }
.np .net-list { flex:1 1 auto; min-height:56px; overflow:auto; padding:0 14px; border-top:1px solid var(--line); }
/* Détail : placeholder = petit (flex:0). Sélection active (.np.sel) → le détail
   prend une vraie part (60%) avec son propre scroll → le waterfall est visible,
   la liste se réduit. */
.np .net-detail { flex:0 1 auto; max-height:50%; overflow:auto; padding:8px 14px 12px; margin-top:0; border-top:1px solid var(--line); }
.np.sel .net-list { flex:1 1 40%; min-height:48px; }
.np.sel .net-detail { flex:1 1 60%; max-height:none; }
.det-bar { display:flex; justify-content:flex-end; margin-bottom:2px; }
.det-close { cursor:pointer; color:var(--muted); font-weight:800; font-size:15px; line-height:1; padding:0 4px; }
.det-close:hover { color:#fff; }
`;

function pushCap(arr: number[], v: number, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.shift();
}

function clampH(h: number): number {
  const max =
    typeof window !== "undefined" ? window.innerHeight * 0.85 : 700;
  if (h < PANEL_H_MIN) return PANEL_H_MIN;
  if (h > max) return Math.round(max);
  return Math.round(h);
}

/** Clés de persistance localStorage (état chrome de la barre). */
const LS = {
  visible: "nf.debugbar.visible",
  min: "nf.debugbar.min",
  side: "nf.debugbar.side",
  tab: "nf.debugbar.tab",
  h: "nf.debugbar.h",
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
  private activeTab: TabId;
  private panelH: number;
  private rafPending = false;
  private feedLen = -1;
  // Pouls realtime — débit msg/s dérivé du compteur de frames du client.
  private prevFrames = 0;
  private rtRate = 0;
  private rtPeak = 0;
  private readonly rtSeries: number[] = [];
  // Pouls HMR Vite — observé via `observeViteHmr` (window CustomEvent, 0 socket).
  private viteConnected = false;
  private hmrCount = 0;
  private hmrPrev = 0;
  private hmrRate = 0;
  private hmrLast = "—";
  private readonly hmrSeries: number[] = [];
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: Array<() => void> = [];
  private readonly el: Record<string, Element> = Object.create(null);
  // Network — modèle + corrélation profiler serveur.
  private readonly networkEnabled: boolean;
  private readonly profilerBase: string;
  private readonly net = new NetworkModel();
  /** Observe la barre → publie sa hauteur (var CSS) pour l'app hôte. */
  private ro: ResizeObserver | null = null;
  // Nœuds de ligne PERSISTANTS (id → row) — mise à jour incrémentale, jamais de
  // rebuild innerHTML global (sinon clic perdu + scroll qui saute).
  private readonly netRows = new Map<number, HTMLElement>();
  private selectedRid: string | null = null;
  private selRowId: number | null = null;
  private selNoRid = false; // ligne cliquée sans requestId lisible
  private detailVersion = 0;
  private detailRendered = -1;

  constructor(opts: DebugBarOptions = {}) {
    this.url = opts.url ?? DEFAULT_PATH;
    this.position = opts.position ?? "bottom";
    this.startOpen = opts.open ?? false;
    // Client TOUJOURS partagé : `opts.client` explicite OU le singleton par URL
    // (`RealtimeClient.shared`) → mutualise la socket avec l'app hôte (Studio).
    // Jamais « possédé » → la barre ne déconnecte JAMAIS au démontage.
    this.ownClient = false;
    this.frontend = opts.frontend ?? null;
    this.networkEnabled = opts.network !== false;
    this.profilerBase = (opts.profilerBase ?? DEFAULT_PROFILER_BASE).replace(/\/$/, "");
    this.client = opts.client ?? RealtimeClient.shared({ url: this.url });
    this.visible = lsGet(LS.visible, "1") !== "0";
    this.minimized = lsGet(LS.min, "0") === "1";
    this.side = lsGet(LS.side, "right") === "left" ? "left" : "right";
    this.activeTab = (lsGet(LS.tab, "realtime") as TabId) || "realtime";
    this.panelH = clampH(
      parseInt(lsGet(LS.h, String(defaultPanelH())), 10) || defaultPanelH(),
    );
  }

  /** Construit le DOM, branche le realtime et ouvre la connexion. No-op si déjà monté. */
  mount(): this {
    if (typeof document === "undefined") return this;
    if (document.getElementById(HOST_ID)) return this;
    this.buildDom();
    this.wireRealtime();
    this.wireHmr();
    this.wireNetwork();
    this.applyChrome();
    this.registerHandle();
    // `connect()` SANS argument : utilise l'URL (normalisée wss) déjà portée par
    // le client partagé — ne PAS repasser `this.url` (relatif) qui écraserait la
    // clé. Idempotent : no-op si l'hôte (Studio) a déjà ouvert la socket. → 1 socket.
    this.client.connect().catch(() => {
      /* reconnexion gérée par le client */
    });
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
    this.ro?.disconnect();
    this.ro = null;
    try {
      document.documentElement.style.removeProperty("--nodefony-debugbar-height");
    } catch {
      /* noop */
    }
    this.host?.remove();
    this.host = null;
    this.bar = null;
  }

  // ── Chrome (visibilité / réduction / dock / onglet / hauteur) ────────────

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

  private setTab(tab: TabId): void {
    this.activeTab = tab;
    lsSet(LS.tab, tab);
    this.applyTab();
    this.render();
  }

  private setPanelH(h: number): void {
    this.panelH = clampH(h);
    const panes = this.el.panes as HTMLElement | undefined;
    if (panes) panes.style.height = `${this.panelH}px`;
  }

  /** Reflète l'onglet actif sur les boutons + panes. */
  private applyTab(): void {
    const tabs = this.bar?.querySelectorAll(".tab");
    tabs?.forEach((t) =>
      t.classList.toggle("active", t.getAttribute("data-tab") === this.activeTab),
    );
    const panes = this.bar?.querySelectorAll(".pane");
    panes?.forEach((p) =>
      p.classList.toggle("active", p.getAttribute("data-pane") === this.activeTab),
    );
  }

  /** Applique l'état chrome au DOM (display + classes de dock + hauteur). */
  private applyChrome(): void {
    if (!this.host || !this.bar) return;
    this.host.style.display = this.visible ? "" : "none";
    this.bar.style.display = this.minimized ? "none" : "";
    const min = this.el.minbar as HTMLElement | undefined;
    if (min) {
      min.style.display = this.minimized ? "flex" : "none";
      min.setAttribute("class", `minbar ${this.position} dock-${this.side}`);
    }
    this.setPanelH(this.panelH);
    this.applyTab();
    this.publishHeight();
  }

  /**
   * Publie la hauteur occupée par la barre (dock bas, visible, dépliée) en
   * variable CSS `--nodefony-debugbar-height` sur `:root`. L'app hôte (Studio)
   * la réserve en `padding-bottom` → le contenu n'est jamais masqué. `0px` si
   * masquée / réduite (chip flottante) / dockée en haut.
   */
  private publishHeight(): void {
    if (typeof document === "undefined") return;
    const h =
      this.visible && !this.minimized && this.position === "bottom" && this.bar
        ? this.bar.offsetHeight
        : 0;
    document.documentElement.style.setProperty(
      "--nodefony-debugbar-height",
      `${h}px`,
    );
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
    this.el.minbar = minbar;
    // Publie la hauteur occupée (dock bas) en var CSS `:root` → l'app hôte
    // (Studio) réserve un padding-bottom et n'est jamais masquée. Le
    // ResizeObserver couvre déplier/replier/resize/réduire/masquer en une fois.
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.publishHeight());
      this.ro.observe(bar);
    }
    shadow.querySelectorAll("[data-el]").forEach((node) => {
      const key = node.getAttribute("data-el");
      if (key) this.el[key] = node;
    });
    // Déplier/replier le panneau (clic sur le bandeau, hors boutons de contrôle).
    const strip = bar.querySelector(".strip")!;
    const onStrip = (): void => {
      bar.classList.toggle("open");
      this.render();
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
    // Onglets.
    const tabsBar = bar.querySelector(".tabs");
    if (tabsBar) {
      const onTab = (ev: Event): void => {
        const t = (ev.target as HTMLElement | null)?.closest?.(".tab");
        const id = t?.getAttribute("data-tab") as TabId | null;
        if (id) this.setTab(id);
      };
      tabsBar.addEventListener("click", onTab);
      this.disposers.push(() => tabsBar.removeEventListener("click", onTab));
    }
    // Poignée de resize.
    const resize = this.el.resize as HTMLElement | undefined;
    if (resize) {
      const onDown = (e: PointerEvent): void => this.startResize(e);
      resize.addEventListener("pointerdown", onDown);
      this.disposers.push(() => resize.removeEventListener("pointerdown", onDown));
    }
    // Chip réduit → restaure la barre complète.
    const onMin = (): void => this.setMinimized(false);
    minbar.addEventListener("click", onMin);
    this.disposers.push(() => minbar.removeEventListener("click", onMin));
    // Resize fenêtre → re-clamp la hauteur (jamais > 85vh, ne déborde pas sur
    // un écran réduit). Throttle léger via rAF.
    let resizePending = false;
    const onWinResize = (): void => {
      if (resizePending) return;
      resizePending = true;
      requestAnimationFrame(() => {
        resizePending = false;
        this.setPanelH(this.panelH);
      });
    };
    window.addEventListener("resize", onWinResize);
    this.disposers.push(() => window.removeEventListener("resize", onWinResize));
  }

  private startResize(ev: PointerEvent): void {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = this.panelH;
    const onMove = (e: PointerEvent): void => {
      const delta =
        this.position === "bottom" ? startY - e.clientY : e.clientY - startY;
      this.setPanelH(startH + delta);
    };
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      lsSet(LS.h, String(this.panelH));
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
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
        <span class="spacer"></span>
        ${this.networkEnabled ? `<span class="chip"><span class="k">net</span><span class="blue" data-el="netChip">0</span></span>` : ""}
        <span class="chip"><span class="k">logs</span><span data-el="logs">0</span></span>
        <span class="chip"><span class="k">err</span><span class="crit" data-el="err">0</span></span>
        <span class="ctrl" data-el="btnSide" title="Changer de côté">⇄</span>
        <span class="ctrl" data-el="btnMin" title="Réduire">—</span>
        <span class="toggle">▴</span>
      </div>
      <div class="panelwrap">
        <div class="resize" data-el="resize" title="Redimensionner"></div>
        <div class="tabs">
          <button class="tab" data-tab="realtime">Realtime</button>
          ${this.networkEnabled ? `<button class="tab" data-tab="network">Network <span class="tcount" data-el="netTab">0</span></button>` : ""}
          <button class="tab" data-tab="perf">Perf</button>
          <button class="tab" data-tab="logs">Logs <span class="tcount" data-el="logsTab">0</span></button>
          <button class="tab" data-tab="runtime">Runtime</button>
        </div>
        <div class="panes" data-el="panes">
          ${this.realtimePane()}
          ${this.networkEnabled ? this.networkPane() : ""}
          ${this.perfPane()}
          ${this.logsPane()}
          ${this.runtimePane()}
        </div>
      </div>`;
  }

  private realtimePane(): string {
    return `<div class="pane" data-pane="realtime"><div class="cards">
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
        <div class="tag"><b>HTTP &amp; WebSocket, même contexte.</b> Push natif, <b>0 polling</b> — chaque chiffre arrive en temps réel par le Core isomorphe.</div>
      </div>
      ${this.frontendCard()}
    </div></div>`;
  }

  private networkPane(): string {
    return `<div class="pane np" data-pane="network">
      <div class="net-head">
        <span class="chip"><span class="k">total</span><span data-el="netTotal">0</span></span>
        <span class="chip"><span class="k">err</span><span class="crit" data-el="netErr">0</span></span>
        <span class="chip"><span class="k">pending</span><span class="muted" data-el="netPend">0</span></span>
        <span class="net-clear" data-el="netClear" title="vider la liste">vider</span>
      </div>
      <div class="net-list" data-el="netList"><div class="empty">en attente d'appels AJAX (fetch / XHR)…</div></div>
      <div class="net-detail" data-el="netDetail"><div class="empty">clique un appel → profil serveur (waterfall des phases, route, user).</div></div>
    </div>`;
  }

  private perfPane(): string {
    return `<div class="pane" data-pane="perf"><div class="cards">
      <div class="card">
        <h4>Performance</h4>
        ${this.chart("CPU", "cpuVal", "cpuPeak", "cpuLine", "cpuArea")}
        ${this.chart("Heap", "heapVal", "heapPeak", "heapLine", "heapArea")}
        ${this.chart("Event loop", "loopVal", "loopPeak", "loopLine", "loopArea")}
      </div>
    </div></div>`;
  }

  private logsPane(): string {
    return `<div class="pane" data-pane="logs">
      <div class="counts">
        <span class="chip"><span class="k">total</span><span data-el="cTotal">0</span></span>
        <span class="chip"><span class="k">err</span><span class="crit" data-el="cErr">0</span></span>
        <span class="chip"><span class="k">warn</span><span class="warn" data-el="cWarn">0</span></span>
        <span class="chip"><span class="k">dropped</span><span class="muted" data-el="cDrop">0</span></span>
      </div>
      <div class="feed" data-el="feed"><div class="empty">en attente de logs…</div></div>
    </div>`;
  }

  private runtimePane(): string {
    return `<div class="pane" data-pane="runtime"><div class="cards">
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
    </div></div>`;
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
      <div class="tag"><b>Backend &amp; frontend, un seul process.</b> HMR Vite branché au runtime — sauvegarde un composant, la barre pulse.</div>
    </div>`;
  }

  // ── Realtime ──────────────────────────────────────────────────────────

  private wireRealtime(): void {
    const offState = this.client.on("__state__", (...a) => {
      this.model.setState(a[0] as RealtimeState);
      if (a[0] === "connected") this.subscribeAll();
      this.scheduleRender();
    });
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
    this.hmrRate = Math.max(0, this.hmrCount - this.hmrPrev);
    this.hmrPrev = this.hmrCount;
    pushCap(this.hmrSeries, this.hmrRate, RT_POINTS);
  }

  // ── HMR Vite ──────────────────────────────────────────────────────────

  private wireHmr(): void {
    // Observe le HMR via l'événement window `nodefony:hmr` (pont createHotContext
    // injecté côté page) — AUCUNE connexion WebSocket ouverte (≠ ancienne sonde).
    if (!this.frontend) return;
    const dispose = observeViteHmr((e) => this.onHmr(e));
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

  private flashHmr(): void {
    const node = this.el.hmrBig;
    if (!node) return;
    node.setAttribute("class", "hmr-big hmr-flash");
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      node.setAttribute("class", "hmr-big");
    }, 600);
  }

  // ── Network ─────────────────────────────────────────────────────────────

  private wireNetwork(): void {
    if (!this.networkEnabled) return;
    // Origine du dev server Vite (cross-origin : modules ESM + HMR) — ces appels
    // n'ont pas de X-Request-Id et ne sont pas des requêtes Nodefony → on les
    // exclut du panneau (sinon il est noyé de bruit non profilable).
    const viteOrigin = this.frontend?.viteOrigin ?? "";
    const uninstall = installNetworkInterceptor({
      onChange: (e) => this.onNetEntry(e),
      ignore: (url) =>
        url.includes(this.profilerBase) ||
        url.includes("/@vite/") ||
        url.includes("/@fs/") ||
        url.includes("/node_modules/.vite/") ||
        (viteOrigin !== "" && url.includes(viteOrigin)),
    });
    this.disposers.push(uninstall);
    // Délégation sur le conteneur PERSISTANT (jamais reconstruit en innerHTML).
    const list = this.el.netList as HTMLElement | undefined;
    if (list) {
      const onClick = (ev: Event): void => {
        const row = (ev.target as HTMLElement | null)?.closest?.(".net-row") as
          | HTMLElement
          | null;
        if (!row) return;
        const rid = row.dataset.rid;
        this.selectRow(row, rid || null);
      };
      list.addEventListener("click", onClick);
      this.disposers.push(() => list.removeEventListener("click", onClick));
    }
    // Bouton ✕ du détail (délégué : le détail est re-rendu en innerHTML).
    const detail = this.el.netDetail as HTMLElement | undefined;
    if (detail) {
      const onDetail = (ev: Event): void => {
        const t = ev.target as HTMLElement | null;
        if (t?.closest?.('[data-act="close"]')) this.deselect();
      };
      detail.addEventListener("click", onDetail);
      this.disposers.push(() => detail.removeEventListener("click", onDetail));
    }
    const clear = this.el.netClear as HTMLElement | undefined;
    if (clear) {
      const onClear = (e: Event): void => {
        e.stopPropagation();
        this.net.clear();
        this.netRows.clear();
        this.selectedRid = null;
        this.selRowId = null;
        const node = this.el.netList;
        if (node) node.innerHTML = `<div class="empty">en attente d'appels AJAX (fetch / XHR)…</div>`;
        this.detailVersion++;
        this.scheduleRender();
      };
      clear.addEventListener("click", onClear);
      this.disposers.push(() => clear.removeEventListener("click", onClear));
    }
  }

  private onNetEntry(e: NetEntry): void {
    this.net.ingest(e);
    // MAJ incrémentale de la ligne (nœud stable) — pas de rebuild global.
    this.upsertNetRow(e);
    if (e.requestId && e.requestId === this.selectedRid) this.detailVersion++;
    this.scheduleRender();
  }

  /** Crée ou met à jour le nœud de ligne d'un appel (jamais d'innerHTML global). */
  private upsertNetRow(e: NetEntry): void {
    const list = this.el.netList as HTMLElement | undefined;
    if (!list) return;
    let row = this.netRows.get(e.id);
    if (!row) {
      // Première ligne → retire le placeholder "empty".
      if (this.netRows.size === 0) list.textContent = "";
      row = document.createElement("div");
      row.className = "net-row";
      row.innerHTML =
        `<span class="net-method"></span>` +
        `<span class="net-path"></span>` +
        `<span class="net-rid"></span>` +
        `<span class="net-status"></span>` +
        `<span class="net-dur"></span>`;
      this.netRows.set(e.id, row);
      list.insertBefore(row, list.firstChild); // newest en haut
      // Cap DOM (aligné sur le cap du modèle).
      while (this.netRows.size > 80 && list.lastElementChild) {
        const last = list.lastElementChild as HTMLElement;
        // Retrouve l'id de la dernière ligne pour purger la map.
        for (const [id, n] of this.netRows) {
          if (n === last) {
            this.netRows.delete(id);
            break;
          }
        }
        last.remove();
      }
    }
    this.fillNetRow(row, e);
  }

  /** Remplit/actualise les cellules d'une ligne (textContent → 0 échappement). */
  private fillNetRow(row: HTMLElement, e: NetEntry): void {
    row.dataset.rid = e.requestId ?? "";
    const sel = e.requestId && e.requestId === this.selectedRid;
    row.className = `net-row${sel ? " sel" : ""}${isNetError(e) ? " err" : ""}`;
    const [m, path, rid, status, dur] = row.children as unknown as HTMLElement[];
    m.className = `net-method ${methodClass(e.method)}`;
    m.textContent = e.method;
    path.textContent = e.path;
    path.title = e.url;
    rid.textContent = e.requestId ? shortId(e.requestId) : "";
    if (e.pending) {
      status.className = "net-status sp";
      status.textContent = "···";
    } else if (e.error) {
      status.className = "net-status s5";
      status.textContent = "ERR";
    } else {
      status.className = `net-status s${statusFamily(e.status)}`;
      status.textContent = e.status === null ? "—" : String(e.status);
    }
    dur.textContent = e.durationMs === null ? "" : `${e.durationMs}ms`;
  }

  /** Sélectionne une ligne (highlight) + déclenche le fetch du profil. */
  private selectRow(row: HTMLElement, rid: string | null): void {
    // Highlight : retire l'ancien, pose le nouveau (pas de re-render de liste).
    if (this.selRowId !== null) {
      this.netRows.get(this.selRowId)?.classList.remove("sel");
    }
    row.classList.add("sel");
    const idEntry = [...this.netRows.entries()].find(([, n]) => n === row);
    this.selRowId = idEntry ? idEntry[0] : null;
    this.selectedRid = rid;
    this.selNoRid = !rid;
    this.detailVersion++;
    // Garantit une hauteur de panneau suffisante pour voir le waterfall (sinon
    // le détail à 60% d'un petit panneau reste illisible). Transitoire (non
    // persisté → ne piétine pas la hauteur choisie par l'utilisateur au resize).
    const minDetail = detailPanelH();
    if (rid && this.panelH < minDetail) this.setPanelH(minDetail);
    if (rid && !this.net.profileState(rid)) this.fetchProfile(rid);
    // Pont vers une app hôte (ex. Studio) : un clic sur une requête sélectionne
    // le même requestId dans sa page Profiler. CustomEvent → 0 couplage (no-op
    // si aucun listener). Le widget est vanilla/Shadow DOM, l'hôte est libre.
    if (rid && typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("nodefony:debugbar:select", {
            detail: { requestId: rid },
          }),
        );
      } catch {
        /* CustomEvent indispo (très vieux env) → ignore */
      }
    }
    this.scheduleRender();
  }

  /** Fetch `/{profilerBase}/{requestId}` (ignoré par l'intercepteur). */
  private fetchProfile(requestId: string): void {
    if (typeof fetch === "undefined") return;
    this.net.setProfileState(requestId, { status: "loading" });
    fetch(`${this.profilerBase}/${encodeURIComponent(requestId)}`, {
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        if (res.status === 404) {
          this.net.setProfileState(requestId, { status: "missing" });
          return;
        }
        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok || !ct.includes("application/json")) {
          // Réponse non-JSON = souvent le fallback SPA de Vite (path
          // `/nodefony/profiler/api` non proxifié) → message actionnable.
          this.net.setProfileState(requestId, {
            status: "error",
            message: res.ok
              ? "réponse non-JSON (path profiler non proxifié par Vite ?)"
              : `HTTP ${res.status}`,
          });
          return;
        }
        const profile = (await res.json()) as ProfileEntry;
        this.net.setProfileState(requestId, { status: "ready", profile });
      })
      .catch((err: unknown) => {
        this.net.setProfileState(requestId, {
          status: "error",
          message: err instanceof Error ? err.message : "fetch failed",
        });
      })
      .finally(() => {
        if (requestId === this.selectedRid) this.detailVersion++;
        this.scheduleRender();
      });
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
    this.renderStrip(v);
    if (!this.bar.classList.contains("open")) return; // panneau fermé → stop
    switch (this.activeTab) {
      case "realtime":
        this.renderRealtimePane(v);
        break;
      case "network":
        this.renderNetwork();
        break;
      case "perf":
        this.renderPerf(v);
        break;
      case "logs":
        this.renderLogsPane(v);
        break;
      case "runtime":
        this.renderRuntime(v);
        break;
    }
  }

  /** Bandeau toujours visible (chips + pouls) — léger. */
  private renderStrip(v: DebugBarView): void {
    const live = v.state === "connected";
    const cpuT = gauge(v.cpuPercent);
    const memT = gauge(v.heapPercent);
    // env + branche
    this.text("envBadge", v.env || "env");
    this.cls("envBadge", `env-badge ${envClass(v.env)}`);
    this.text("branchName", v.branch || "—");
    this.el.branch?.setAttribute(
      "title",
      v.branch ? `branche git : ${v.branch}` : "branche git",
    );
    this.text("mEnv", v.env);
    // realtime
    this.cls("dot", `dot ${v.state}`);
    this.cls("mdot", `dot ${v.state}`);
    this.text("mrate", `${this.rtRate}/s`);
    this.cls("rtPill", live ? "rt-pill live" : "rt-pill");
    this.text("rt", `${this.rtRate}/s`);
    this.cls("rt", "v blue");
    this.el.rtMini?.setAttribute("points", sparklinePoints(this.rtSeries, MINI_W, MINI_H));
    this.el.rtMini?.setAttribute("class", "spark rt");
    // mini cpu / mem / loop
    this.text("cpu", `${v.cpuPercent}%`);
    this.cls("cpu", `v ${cpuT}`);
    this.text("mem", `${v.heapPercent}%`);
    this.cls("mem", `v ${memT}`);
    this.el.cpuMini?.setAttribute("points", sparklinePoints(v.cpuSeries, MINI_W, MINI_H, 100));
    this.el.cpuMini?.setAttribute("class", `spark ${cpuT}`);
    this.el.memMini?.setAttribute("points", sparklinePoints(v.heapSeries, MINI_W, MINI_H, 100));
    this.el.memMini?.setAttribute("class", `spark ${memT}`);
    // chips
    if (this.networkEnabled) {
      this.text("netChip", String(this.net.total));
      this.cls("netChip", this.net.errors > 0 ? "crit" : "blue");
      this.text("netTab", String(this.net.total));
      this.cls("netTab", this.net.errors > 0 ? "tcount crit" : "tcount");
    }
    this.text("logs", String(v.logTotal));
    this.text("err", String(v.errorCount));
    this.text("logsTab", String(v.logTotal));
    this.cls("logsTab", v.errorCount > 0 ? "tcount crit" : "tcount");
  }

  private renderRealtimePane(v: DebugBarView): void {
    const live = v.state === "connected";
    this.text("rtBig", String(this.rtRate));
    this.setPoints("rtLine", "rtArea", this.rtSeries, "rt", 38);
    this.text("rtTransport", "WebSocket");
    this.text("rtProto", "JSON-RPC 2.0");
    this.text("rtState", v.state);
    this.cls("rtState", `v ${live ? "ok" : "warn"}`);
    this.text("rtFrames", String(this.client.framesReceived));
    this.text("rtPeak", `${this.rtPeak}/s`);
    if (this.frontend) {
      this.text("hmrBig", String(this.hmrCount));
      this.setPoints("hmrLine", "hmrArea", this.hmrSeries, "fe", 34);
      this.text("feVite", this.viteConnected ? "Vite · connecté" : "Vite · …");
      this.cls("feVite", `v ${this.viteConnected ? "ok" : "warn"}`);
      this.text("hmrLast", this.hmrLast);
    }
  }

  private renderPerf(v: DebugBarView): void {
    const cpuT = gauge(v.cpuPercent);
    const memT = gauge(v.heapPercent);
    const loopT = gauge(v.eventLoopMs, 50, 200);
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
  }

  private renderRuntime(v: DebugBarView): void {
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
  }

  private renderLogsPane(v: DebugBarView): void {
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

  // ── Rendu Network ───────────────────────────────────────────────────────

  private renderNetwork(): void {
    this.text("netTotal", String(this.net.total));
    this.text("netErr", String(this.net.errors));
    this.text("netPend", String(this.net.pending));
    if (this.detailVersion !== this.detailRendered) {
      this.detailRendered = this.detailVersion;
      this.renderDetail();
    }
  }

  private renderDetail(): void {
    const node = this.el.netDetail;
    if (!node) return;
    const rid = this.selectedRid;
    const hasSel = !!rid || this.selNoRid;
    // Donne une vraie hauteur au détail quand un profil est ouvert (sinon le
    // waterfall passe sous le pli, masqué par la liste).
    (node.parentElement as HTMLElement | null)?.classList.toggle("sel", hasSel);
    // Aucune sélection → placeholder, pas de bouton fermer.
    if (!hasSel) {
      node.innerHTML = `<div class="empty">clique un appel → profil serveur (waterfall des phases, route, user).</div>`;
      return;
    }
    // Barre avec bouton fermer (✕) — délégué sur le conteneur netDetail.
    const closeBar = `<div class="det-bar"><span class="det-close" data-act="close" title="Fermer le détail">✕</span></div>`;
    let body: string;
    if (!rid) {
      body = `<div class="det-err">cet appel n'a pas de requestId lisible — réponse sans header <b>X-Request-Id</b> (cross-origin sans Access-Control-Expose-Headers, ou appel hors Nodefony).</div>`;
    } else {
      const st = this.net.profileState(rid);
      if (!st || st.status === "loading") {
        body = `<div class="det-loading">profil <b>${escapeHtml(shortId(rid))}</b> — chargement…</div>`;
      } else if (st.status === "missing") {
        body = `<div class="det-err">profil introuvable (évincé du ring buffer, ou requête sans timing).</div>`;
      } else if (st.status === "error") {
        body = `<div class="det-err">erreur profiler : ${escapeHtml(st.message)}</div>`;
      } else {
        body = this.profileHtml(st.profile);
      }
    }
    node.innerHTML = closeBar + body;
  }

  /** Désélectionne la requête → referme le détail (placeholder). */
  private deselect(): void {
    if (this.selRowId !== null) {
      this.netRows.get(this.selRowId)?.classList.remove("sel");
    }
    this.selRowId = null;
    this.selectedRid = null;
    this.selNoRid = false;
    this.detailVersion++;
    this.scheduleRender();
  }

  /** Rend le détail d'un profil serveur (méta + waterfall des phases). */
  private profileHtml(p: ProfileEntry): string {
    const bars = computeWaterfall(p.phases);
    const total = p.durationMs === null ? "—" : `${p.durationMs}ms`;
    const kv = (k: string, val: string): string =>
      `<div class="kv"><span class="k">${k}</span><span class="v">${val}</span></div>`;
    const meta =
      `<div class="det-grid">` +
      kv("route", escapeHtml(p.route ?? "—")) +
      kv(
        "controller",
        escapeHtml(p.controller ? `${p.controller}.${p.action ?? "?"}` : "—"),
      ) +
      kv("status", `${p.status ?? "—"}`) +
      kv("total serveur", total) +
      kv("user", escapeHtml(p.user ?? "anonyme")) +
      kv("kind", p.kind) +
      kv("requestId", escapeHtml(shortId(p.requestId))) +
      kv("traceparent", escapeHtml(traceId(p))) +
      (p.error ? kv("erreur", `<span class="crit">${escapeHtml(p.error)}</span>`) : "") +
      `</div>`;
    let wf = "";
    if (bars.length === 0) {
      wf = `<div class="empty">aucune phase mesurée (timing désactivé ?).</div>`;
    } else {
      wf = `<div class="wf-title">timeline des phases (serveur)</div><div class="wf">`;
      for (const b of bars) {
        wf +=
          `<div class="wf-row">` +
          `<span class="wf-name">${escapeHtml(b.name)}</span>` +
          `<div class="wf-track"><div class="wf-bar ${b.tier}" style="left:${b.leftPct}%;width:${b.widthPct}%"></div></div>` +
          `<span class="wf-ms">${b.durationMs}ms</span>` +
          `</div>`;
      }
      wf += `</div>`;
    }
    return meta + wf + this.queriesHtml(p.queries);
  }

  /** Rend les requêtes ORM (SEAM futur) — vide tant qu'aucun adapter ne pushe. */
  private queriesHtml(queries: ProfileEntry["queries"]): string {
    if (!queries || queries.length === 0) return "";
    let out = `<div class="wf-title" style="margin-top:10px">requêtes ORM (${queries.length})</div><div class="net-list" style="border:0">`;
    for (const q of queries) {
      out +=
        `<div class="net-row" style="cursor:default">` +
        `<span class="net-path" title="${escapeHtml(q.sql)}">${escapeHtml(q.sql)}</span>` +
        (q.connector ? `<span class="net-rid">${escapeHtml(q.connector)}</span>` : "") +
        (typeof q.rows === "number" ? `<span class="net-dur">${q.rows} rows</span>` : "") +
        `<span class="net-dur">${q.durationMs}ms</span>` +
        `</div>`;
    }
    out += `</div>`;
    return out;
  }
}

/** Famille de status (2/3/4/5) → classe de couleur. `null` → 5 (inconnu). */
function statusFamily(status: number | null): number {
  if (status === null) return 5;
  return Math.floor(status / 100);
}

/** Méthode HTTP → classe de couleur du chip. */
function methodClass(method: string): string {
  const m = method.toLowerCase();
  if (m === "get" || m === "post" || m === "put" || m === "patch" || m === "delete")
    return m;
  return "ws";
}

/** Raccourci d'un id (1er bloc UUID, ou 8 chars). */
function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Extrait le trace-id (2ᵉ segment) d'un `traceparent` W3C, raccourci. */
function traceId(p: { traceparent: string | null }): string {
  if (!p.traceparent) return "—";
  const seg = p.traceparent.split("-");
  const tid = seg.length >= 2 ? seg[1] : p.traceparent;
  return tid && tid.length > 12 ? tid.slice(0, 12) + "…" : (tid ?? "—");
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
