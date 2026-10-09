/**
 * DebugBar — toolbar de debug par-page type Symfony WDT, **dev-only**, pensée
 * comme une **vitrine du realtime Nodefony** (on doit *voir* le framework
 * respirer en direct).
 *
 * 2ᵉ consommateur navigateur du Core isomorphe après Studio : MÊME backbone
 * realtime (WS JSON-RPC 2.0, canaux `nodefony:supervision` / `nodefony:syslog`) via
 * {@link NodefonySocket}. Aucun rendu serveur splicé dans le body : le serveur
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
import { NodefonySocket } from "../realtime/NodefonySocket";
import {
  DebugBarModel,
  type DebugBarView,
  type FeedLog,
  type StatsPayload,
} from "./model";
import {
  fmtClock,
  formatBytes,
  formatUptime,
  gauge,
  sparklinePoints,
} from "./format";
import { observeViteHmr, type HmrEvent } from "./hmr";
import { FeedView } from "./feedView";
import {
  exposedKernels,
  KERNEL_PROBE_EVENT,
  type IKernelProbe,
} from "../announce";
import type {
  NodefonyKernelEvent,
  NodefonyKernelIdentity,
} from "../INodefonyKernel";
import { installNetworkInterceptor, type NetEntry } from "./network";
import {
  NetworkModel,
  computeWaterfall,
  isError as isNetError,
  type ProfileEntry,
} from "./profile";
import {
  PLATFORM_CHANNELS,
  PLATFORM_EVENTS,
} from "../../realtime/platformChannels";

/** Canaux realtime consommés (figés, alignés sur les providers Studio). */
const CHANNELS = {
  // Canal DÉDIÉ à la debug bar (≠ `nodefony:supervision`, réservé à la page
  // Supervision) : mêmes sondes process, ticker séparé côté serveur → la barre,
  // présente en permanence en dev, ne maintient PAS le canal supervision actif.
  stats: PLATFORM_CHANNELS.debugbar,
  syslog: PLATFORM_CHANNELS.syslog,
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
type TabId = "realtime" | "network" | "perf" | "logs" | "kernel" | "runtime";
const TAB_IDS: readonly string[] = [
  "realtime",
  "network",
  "perf",
  "logs",
  "kernel",
  "runtime",
] satisfies TabId[];

/** Vrai si la valeur (relue du `localStorage`, donc quelconque) nomme un onglet. */
function isTabId(value: string): value is TabId {
  return TAB_IDS.includes(value);
}

/**
 * Élément le plus proche de la cible d'un événement qui répond au sélecteur.
 *
 * La cible n'est pas toujours un `Element` : un nœud texte, le document ou la
 * fenêtre n'ont pas de `closest`.
 */
function closestFrom(
  target: EventTarget | null,
  selector: string,
): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>(selector)
    : null;
}

/** Contexte frontend injecté par le builder Vite (@nodefony/frontend) en dev. */
export interface DebugBarFrontend {
  /** Type de preset : `react19` | `vue3` | `angular` | `vanilla`. */
  framework?: string;
  /** Nom logique de l'entrée frontend (bundle). */
  name?: string;
  /**
   * Préfixe des URLs servies par Vite, reconnu par simple inclusion : le
   * chemin relayé `/_vite/<famille>` (même origine que la page), ou une
   * origine complète pour un serveur Vite joint directement.
   */
  viteOrigin?: string;
}

export interface DebugBarOptions {
  /** URL/chemin du WS realtime. Défaut : `/nodefony/studio/api/realtime`. */
  url?: string;
  /** Client realtime injectable (partage / tests). Sinon créé en interne. */
  client?: NodefonySocket;
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
  /**
   * Environnement du serveur, connu AU RENDU de la page (`development`…).
   * Affiché tout de suite, sans attendre la socket — qui ne s'ouvre qu'avec le
   * panneau. Les mesures du serveur le remplacent dès qu'elles arrivent.
   */
  env?: string;
}

/**
 * L'explication de chaque valeur de l'onglet Noyau — courte, au survol et au
 * focus. Une seule table : le libellé affiché est la clé.
 */
const KERNEL_HELP: ReadonlyMap<string, string> = new Map([
  [
    "application",
    "Nom donné au noyau (option name) ; « CLIENT KERNEL » si l'application n'en donne pas.",
  ],
  [
    "état",
    "créé → démarrage (boot) → prêt → terminé. Prêt : l'application peut s'afficher, socket ouverte ou non.",
  ],
  ["démarrée à", "Appel à boot()."],
  [
    "prête en",
    "Délai de boot() à prêt — inclut l'ouverture de la socket quand elle s'ouvre au démarrage.",
  ],
  ["terminée à", "terminate() : départ de la page, ou appel de l'application."],
  [
    "annonce console",
    "Badge et détail replié dans la console du navigateur (option banner).",
  ],
  ["services", "Services composés par le noyau — kernel.get(nom)."],
  [
    "compte",
    "Clé déclarée par setIdentity : ce que l'application AFFIRME, pas ce que le serveur a vérifié.",
  ],
  ["depuis", "Heure de la dernière déclaration de compte."],
  [
    "changements de compte",
    "Depuis l'ouverture de la barre. Même clé redéclarée (profil rafraîchi) : pas un changement.",
  ],
  [
    "socket",
    "État de la socket. Le bouton « Temps réel » de la barre règle le FLUX, pas la connexion.",
  ],
  ["adresse", "URL de la socket partagée — une seule connexion par URL."],
  [
    "s'ouvre",
    "Option connectOnBoot. false : socket authentifiée, elle attend setIdentity — jamais anonyme.",
  ],
  [
    "origine",
    "Option realtime : socket créée par le noyau, fournie par l'application, ou aucune.",
  ],
]);

function kernelHelp(label: string): string | undefined {
  return KERNEL_HELP.get(label);
}

/** L'état du noyau, en français — le code (`ready`…) reste dans l'infobulle des outils. */
const KERNEL_STATE_LABEL: Readonly<Record<string, string>> = {
  created: "créé",
  booting: "démarrage",
  ready: "prêt",
  terminated: "terminé",
};

/** Les événements du noyau, dits en clair — le nom d'API reste en infobulle. */
const KERNEL_EVENT_LABEL: Readonly<Record<string, string>> = {
  onBoot: "démarrage",
  onReady: "prêt",
  onIdentityChange: "compte",
  onVisibility: "à l'écran",
  onOnline: "réseau",
  onTerminate: "terminé",
};

/**
 * Le logo Nodefony (`src/nodefony/assets/nodefony-logo.svg`), en ligne :
 * coordonnées arrondies au dixième — invisible à 18 px, et plus léger dans
 * le bundle de chaque application qui monte la barre.
 */
const NODEFONY_LOGO = `<svg class="nflogo" viewBox="0 0 107 170.4" aria-hidden="true"><path fill="#0067ba" d="M0 85.2C0 42.7 52.7 13.6 86.7 0C90.8 0.4 94.8 1.8 98.3 3.9C79.8 12.7 61.7 21.2 45.8 34.1C30 47 16.4 64.3 16.4 85.2C16.4 106.1 30 123.4 45.8 136.3C61.7 149.2 79.8 157.7 98.3 166.5C94.8 168.6 90.8 170 86.7 170.4C52.7 156.8 0 127.7 0 85.2Z"/><path fill="#448438" d="M33.1 85.2C33.1 56 68 35.3 91.7 25.6C95.2 26.7 99.3 28.3 102.6 30.2C81.3 40 49.3 58.1 49.3 85.2C49.3 112.3 81.3 130.4 102.6 140.2C99.3 142.1 95.2 143.8 91.7 144.9C68 135.1 33.1 114.4 33.1 85.2Z"/><path fill="#00a0f2" d="M64.7 85.2C64.7 68.7 82.2 57.6 95.7 51.6C99.6 52.5 103.4 54.6 107 56.4C101.4 60.1 95.3 63 90.3 67.6C85.2 72.2 81.3 78.5 81.3 85.2C81.3 91.9 85.2 98.2 90.3 102.8C95.3 107.4 101.4 110.3 107 114C103.4 115.8 99.6 117.9 95.7 118.8C82.2 112.8 64.7 101.7 64.7 85.2Z"/></svg>`;

/** Une clé de compte abrégée pour l'œil (souvent un UUID) — la complète va en infobulle. */
function shortKey(key: string): string {
  return key.length > 14 ? `${key.slice(0, 6)}…${key.slice(-5)}` : key;
}

/** Le nom de l'environnement, en français — le code reste dans l'infobulle. */
const ENV_LABEL: Readonly<Record<string, string>> = {
  development: "développement",
  production: "production",
  test: "test",
  staging: "pré-production",
};

/** Métadonnées d'affichage par framework (couleur de marque officielle). */
const FRAMEWORKS: Record<string, { label: string; color: string }> = {
  react19: { label: "React 19", color: "#61dafb" },
  react: { label: "React", color: "#61dafb" },
  vue3: { label: "Vue 3", color: "#42b883" },
  vue: { label: "Vue", color: "#42b883" },
  angular: { label: "Angular", color: "#dd0031" },
  vanilla: { label: "Vanilla", color: "#f7df1e" },
};

const STYLES =
  `
:host { all: initial; }
* { box-sizing: border-box; }
.bar {
  position: fixed; left: 0; right: 0; z-index: 2147483000;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #e8eaed;
  ` +
  // Fond OPAQUE (pas de backdrop-filter sur le conteneur scrollable : il
  // recompositait le blur à chaque frame de scroll → lag). Blur seulement sur
  // .strip (fin, non scrollé).
  `
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

` +
  // Strip responsive : police (et tout le contenu en em) scale avec la largeur
  // d'écran, bornée 12→15px. Padding scale aussi.
  `
.strip { display: flex; align-items: center; gap: clamp(12px,1.1vw,20px);
  padding: clamp(8px,1vh,13px) clamp(14px,1.4vw,26px); cursor: pointer;
  font-size: clamp(12px, 0.35vw + 8px, 16px); flex-wrap: nowrap; overflow: hidden;
  background: rgba(20,22,26,.6); backdrop-filter: blur(14px) saturate(140%); }
.strip:hover { background: rgba(255,255,255,.03); }
.brand { display:flex; align-items:center; gap:8px; font-weight:800; letter-spacing:.2px; flex:none; }
.brand .logo, .minbar .mlogo { display:flex; align-items:center; flex:none; }
.nflogo { display:block; height:18px; width:auto; }
.brand .name, .minbar .mname { background: linear-gradient(90deg,#5fa04e,#3aa0ff); -webkit-background-clip:text;
  background-clip:text; -webkit-text-fill-color:transparent; }
.rt-pill { display:flex; align-items:center; gap:5px; padding:.2em .7em; border-radius:11px; flex:none;
  font-size:.76em; font-weight:800; letter-spacing:.6px; text-transform:uppercase;
  color:var(--muted); background:#22262e; border:1px solid var(--line); }
.rt-pill.connected { color:#fff; border-color:rgba(58,160,255,.5);
  background: linear-gradient(90deg, rgba(0,103,186,.35), rgba(255,138,61,.25));
  box-shadow: 0 0 14px rgba(58,160,255,.35); }
.rt-pill .bolt { animation: bolt 1.6s ease-in-out infinite; }
.rt-pill.connected .bolt { color: var(--orange); }
@keyframes bolt { 0%,100%{opacity:.5;transform:scale(.9)} 50%{opacity:1;transform:scale(1.15)} }

.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; color: var(--muted); }
.dot.connected { background: var(--ok); color: var(--ok); animation: pulse 2s infinite; }
.dot.connecting, .dot.reconnecting { background: var(--warn); color: var(--warn); }
.dot.error { background: var(--crit); color: var(--crit); }
` +
  // Fermée n'est pas en panne : une socket qu'on n'a pas encore ouverte (elle s'ouvre
  // avec le panneau) reste neutre. Le rouge est réservé à l'erreur.
  `
.dot.disconnected { background: var(--muted); color: var(--muted); }
@keyframes pulse { 0%{box-shadow:0 0 0 0 currentColor} 70%{box-shadow:0 0 0 5px transparent} 100%{box-shadow:0 0 0 0 transparent} }

.metric { display: flex; align-items: center; gap: 6px; white-space: nowrap; flex:none; }
.metric .k { color: var(--muted); text-transform: uppercase; font-size: .76em; letter-spacing:.5px; }
.metric .v { font-weight: 700; min-width: 2.6em; font-size: 1em; }
.mini { width: 3.8em; height: 1.35em; display:block; }
.mini polyline { fill:none; stroke-width:1.5; vector-effect:non-scaling-stroke; }
.chip { display:flex; align-items:center; gap:6px; padding:.2em .7em; border-radius:11px; flex:none;
  background:#22262e; font-weight:700; font-size:.92em; white-space:nowrap; }
.chip .k { color: var(--muted); font-size:.82em; text-transform:uppercase; }
.chip .hmrv { color: var(--orange); }
.spacer { flex: 1 1 auto; min-width: 8px; }
.ok{color:var(--ok)} .warn{color:var(--warn)} .crit{color:var(--crit)} .info{color:var(--info)} .muted{color:var(--muted)} .blue{color:var(--blue2)}
.spark.ok{stroke:var(--ok)} .spark.warn{stroke:var(--warn)} .spark.crit{stroke:var(--crit)} .spark.rt{stroke:var(--blue2)}
.area.ok{fill:rgba(54,179,126,.12)} .area.warn{fill:rgba(255,171,0,.14)} .area.crit{fill:rgba(255,86,48,.16)} .area.rt{fill:rgba(58,160,255,.16)}

` +
  // ── Panneau : resize + onglets + panes ────────────────────────────────────
  `
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
` +
  // Intitulés de carte, PAS des titres : la barre se superpose à une page qui a son
  // propre plan (h1, h2…) ; des <h4> s'y inséraient en sautant des niveaux (axe :
  // heading-order). Un outil superposé ne touche pas au plan de l'application.
  `
.card > .ttl { margin:0 0 9px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); font-weight:800; display:flex; gap:6px; align-items:center; }

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
` +
  // ── Explorateur de journal ───────────────────────────────────────────────
  `
.counts { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px; }
.counts .spacer { flex:1 1 auto; }
.counts button { font: inherit; color: inherit; background:none; border:1px solid transparent; cursor:pointer; }
.chip.sevf { border-color: var(--line); }
.chip.sevf.on { border-color: var(--ok); color:#fff; }
.search { font: inherit; font-size:11px; color:inherit; background:rgba(255,255,255,.04);
  border:1px solid var(--line); border-radius:6px; padding:3px 8px; min-width:120px; max-width:220px; }
.search::placeholder { color: var(--muted); }
.toolbtn { font: inherit; font-size:12px; line-height:1; color:var(--muted); background:none;
  border:1px solid var(--line); border-radius:6px; padding:3px 7px; cursor:pointer; }
.toolbtn:hover { color:#fff; }
.toolbtn.on { color:var(--ok); border-color:var(--ok); }
` +
  // ── Journal fenêtré (feedView.ts) ────────────────────────────────────────
  // Colonnes ALIGNÉES (l'œil descend une colonne, il ne cherche pas l'heure ligne
  // par ligne), chiffres à chasse fixe, zébrure discrète, filet coloré à gauche
  // pour ce qui compte (erreur, alerte). Lignes de hauteur FIXE : c'est ce qui
  // rend le fenêtrage exact. Positionnées par transform — aucune mise en page.
  `
.pane.logp.active { display:flex; flex-direction:column; padding:10px 14px 12px; }
.logbody { flex:1; min-height:0; display:flex; gap:10px; }
.feedbox { --cols: 88px 62px 120px minmax(0,1fr) 70px; position:relative; flex:1; min-width:0;
  display:flex; flex-direction:column; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#111317; }
.loghead { display:grid; grid-template-columns:var(--cols); gap:10px; flex:none; height:26px; align-items:center;
  padding:0 10px 0 12px; border-bottom:1px solid var(--line); background:#171a20;
  font:600 10px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); }
.feedscroll { position:relative; flex:1; min-height:0; overflow-y:auto; overflow-x:hidden;
  contain:strict; overscroll-behavior:contain; outline:none; }
.feedscroll:focus-visible { box-shadow: inset 0 0 0 2px var(--ok); }
.feedspacer { width:1px; }
.feedlayer { position:absolute; top:0; left:0; right:0; }
.log { position:absolute; top:0; left:0; right:0; height:22px; display:grid; grid-template-columns:var(--cols);
  gap:10px; align-items:center; padding:0 10px; border-left:2px solid transparent; cursor:pointer;
  font-size:11.5px; line-height:22px; }
.log[hidden] { display:none; }
.log.odd { background:rgba(255,255,255,.022); }
.log:hover { background:rgba(255,255,255,.06); }
.log.sel { background:rgba(58,160,255,.16); }
.log.t-crit { border-left-color:var(--crit); }
.log.t-warn { border-left-color:var(--warn); }
.log .ts { color:var(--muted); font-variant-numeric:tabular-nums; }
.log .sev { font:700 9.5px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; letter-spacing:.4px; text-transform:uppercase; }
.log .mod { color:#9aa3ae; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.log .txt { color:#e8eaed; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.log .rid { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; }
.feedjump { position:absolute; top:34px; left:50%; transform:translateX(-50%); z-index:2; height:28px; padding:0 12px; border-radius:999px;
  font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#fff; cursor:pointer;
  background:#0067ba; border:1px solid #3aa0ff; box-shadow:0 4px 16px rgba(0,0,0,.45); }
.feedjump:hover { background:#0a78d1; }
.feedjump[hidden], .feedempty[hidden], .logside[hidden] { display:none; }
.feedempty { position:absolute; inset:26px 0 0 0; display:flex; align-items:center; justify-content:center;
  color:var(--muted); pointer-events:none; }
.logside { width:340px; flex:none; overflow:auto; padding:10px 12px; border:1px solid var(--line);
  border-radius:8px; background:#16191e; }
.sidehead { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;
  font:600 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); }
@media (max-width: 900px) { .logside { width:240px; } .feedbox { --cols: 78px 54px 90px minmax(0,1fr) 0; } }
` +
  // ── Onglet Noyau ──
  `
.kv .k.help { cursor:help; text-decoration: underline dotted rgba(138,144,153,.6); text-underline-offset:3px; }
.kv .k.help:focus-visible { outline:2px solid var(--ok); outline-offset:2px; border-radius:3px; }
.tab .tdot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--ok); margin-left:4px; vertical-align:middle; }
.tab .tdot[hidden] { display:none; }
.strip .kchip { gap:6px; padding:.25em .7em; border:1px solid var(--line); color:#c4c9d1; }
.kchip::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--muted); flex:none; }
.kchip.st-ready::before { background:var(--ok); } .kchip.st-ready .kstate { color:#7fd3ac; }
.kchip.st-booting::before { background:var(--warn); } .kchip.st-booting .kstate { color:#ffcf66; }
.kchip.st-terminated::before { background:var(--crit); } .kchip.st-terminated .kstate { color:#ff8f75; }
.kchip .word + .word::before { content:"·"; margin-right:5px; color:#4a5160; }
.chip .word { font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; letter-spacing:0; }
.strip .env-badge { font:600 11.5px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; text-transform:none; letter-spacing:0; }
.kintro { margin:0 0 12px; color:#c4c9d1; font:400 12.5px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.kwarn { margin:0 0 12px; color:var(--warn); }
.kv .v[title] { cursor:default; }
.kempty { max-width:640px; color:#c4c9d1; line-height:1.6; }
.kempty p { margin:6px 0; }
.kempty code, .card code { color:#9ecbff; }
.card.kevents { grid-column: 1 / -1; }
.kev { display:grid; grid-template-columns: 96px 150px minmax(0,1fr); gap:10px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.04); }
.kev .ts { color:var(--muted); font-variant-numeric:tabular-nums; }
.kev .kn { color:#9ecbff; }
.kev .kd { color:#e8eaed; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.drow { display:flex; gap:8px; padding:1px 0; }
.drow .dk { color:var(--muted); min-width:92px; flex:none; }
.drow .dv { word-break:break-word; }

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

` +
  // Badge d'environnement : une puce SOMBRE comme ses voisines, la couleur portée
  // par un point et par le texte. Un aplat vert vif tranchait sur toute la bande
  // et attirait l'œil sur l'information la moins changeante de l'écran.
  `
.env-badge { display:flex; align-items:center; gap:6px; padding:.25em .7em; border-radius:11px; flex:none;
  font-size:.76em; font-weight:700; letter-spacing:.5px; text-transform:uppercase;
  color:#c4c9d1; background:#22262e; border:1px solid var(--line); }
.env-badge[hidden] { display:none; }
.env-badge::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--muted); flex:none; }
.env-badge.dev::before { background:var(--ok); } .env-badge.dev { color:#7fd3ac; }
.env-badge.prod::before { background:var(--crit); } .env-badge.prod { color:#ff8f75; border-color:rgba(255,86,48,.45); }
.env-badge.test::before { background:var(--warn); } .env-badge.test { color:#ffcf66; }
.env-badge.staging::before { background:#a06bff; } .env-badge.staging { color:#c7a6ff; }
.branch[hidden] { display:none; }
` +
  // La branche : une puce sombre comme celle de l'environnement — l'icône dit
  // « git », le nom se lit en police d'interface ; le mot « branche » est dans
  // l'infobulle. Une étiquette en majuscules + un nom en chasse fixe juraient.
  `.branch { display:flex; align-items:center; gap:6px; padding:.25em .7em; border-radius:11px; flex:none;
  max-width:220px; background:#22262e; border:1px solid var(--line); color:#c4c9d1;
  font:600 11.5px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.branch .ico { width:14px; height:14px; color:var(--blue2); }
.branch span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
` +
  // Les contrôles et les indicateurs du bandeau sont de VRAIS <button> : ils
  // s'atteignent au clavier et s'annoncent. Ce bloc leur retire l'apparence
  // native que le navigateur leur donne, sans leur retirer leur nature.
  `
.strip button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; }
.strip button:focus-visible, .tab:focus-visible, .toolbtn:focus-visible {
  outline: 2px solid var(--ok); outline-offset: 2px; border-radius: 4px; }
.goto:hover .v, .goto:hover .k { color: #fff; }

` +
  // ── Infobulles ────────────────────────────────────────────────────────────
  // Maison, et non l'attribut « title » du navigateur : celui-là met environ une
  // seconde à venir, ne se style pas, et surtout n'apparaît JAMAIS au focus
  // clavier — l'aide restait donc inaccessible à qui n'utilise pas la souris.
  // Celle-ci s'ouvre au survol ET au focus, ce qui la rend utilisable par tout le
  // monde. En CSS pur : aucun script, aucun écouteur, rien à libérer.
  `
[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 9px); left: 50%; transform: translateX(-50%);
  width: max-content; max-width: 280px; white-space: normal; text-align: left;
  background: #0b0b0d; color: #f2f2f2; border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 9px; font-size: 11px; line-height: 1.45;
  font-weight: 400; text-transform: none; letter-spacing: 0;
  box-shadow: 0 6px 20px rgba(0,0,0,.5);
  opacity: 0; visibility: hidden; transition: opacity .12s ease; pointer-events: none; z-index: 20;
}
[data-tip]:hover::after, [data-tip]:focus-visible::after { opacity: 1; visibility: visible; }
` +
  // Barre ancrée en haut : l'infobulle bascule dessous, sinon elle sort de l'écran.
  `
.bar.top [data-tip]::after { bottom: auto; top: calc(100% + 9px); }
` +
  // Dans un panneau défilant, une infobulle ouverte AU-DESSUS est rognée par le
  // bord : elle s'ouvre dessous, alignée sur le libellé.
  `
.pane [data-tip]::after { bottom: auto; top: calc(100% + 6px); left: 0; transform: none; }
` +
  // Les bords : l'infobulle se recale pour ne pas déborder de la fenêtre.
  `
.strip > :first-child[data-tip]::after { left: 0; transform: none; }
.strip > :last-child[data-tip]::after { left: auto; right: 0; transform: none; }
@media (prefers-reduced-motion: reduce) { [data-tip]::after { transition: none; } }

` +
  // Contrôles de la barre. Trois choix, chacun contre un défaut vu à l'écran :
  // — une police d'INTERFACE, pas le monospace des mesures : un libellé de bouton
  // se lit, il ne s'aligne pas en colonne ;
  // — des icônes TRACÉES (SVG, 16 px, trait 1,6) : les glyphes de police (▴, ▁, ⇄)
  // changent de taille et de graisse d'une police à l'autre, et lisaient
  // « grossier » ;
  // — une hiérarchie : « Réduire » et « Ouvrir » sont un seul contrôle segmenté,
  // discret ; seul « Ouvrir » porte l'accent, en couleur de texte, pas en aplat.
  // Cible : 28 px de haut, au-delà des 24 px de WCAG 2.5.8.
  `
.strip button.ui, .strip .ui button { font: 600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0; }
.ico { width: 16px; height: 16px; flex: none; display: block; }
.ico path { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.seg { display: flex; align-items: stretch; flex: none; border: 1px solid var(--line);
  border-radius: 8px; background: #1a1d23; overflow: hidden; }
.strip .seg button { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px;
  color: #b8bec8; transition: background .15s, color .15s; }
.strip .seg button + button { border-left: 1px solid var(--line); }
.strip .seg button:hover { background: #242933; color: #fff; }
.strip .seg button:focus-visible { outline-offset: -2px; }
.strip .seg button.toggle { color: var(--blue2); }
.strip .seg button.toggle:hover { color: #fff; background: rgba(0,103,186,.35); }
.toggle .chev { transition: transform .2s ease; }
.bar.open .toggle .chev { transform: rotate(180deg); }
` +
  // « Temps réel » : UN contrôle, qui dit l'état ET le bascule. Il y en avait
  // deux — une pastille « REALTIME » (la connexion) et un interrupteur « Direct »
  // (l'abonnement) — et personne ne savait lequel lire. L'état est écrit en
  // toutes lettres à côté du nom ; la couleur ne fait que le confirmer.
  `
.strip button.rt { display:flex; align-items:center; gap:8px; height:28px; padding:0 12px 0 10px; flex:none;
  border:1px solid var(--line); border-radius:999px; background:#1a1d23; color:#b8bec8;
  transition: border-color .15s, background .15s, color .15s; }
.strip button.rt:hover { border-color:#4a5160; color:#fff; }
.rt .rt-dot { width:8px; height:8px; border-radius:50%; background:#5b6270; flex:none; }
.rt .rt-name { color:#e8eaed; }
.rt .rt-state { color:var(--muted); font-weight:500; }
.rt .rt-state::before { content:"·"; margin-right:6px; color:#4a5160; }
.strip button.rt.live { border-color:rgba(54,179,126,.55); background:rgba(54,179,126,.1); }
.rt.live .rt-dot { background:var(--ok); animation: rtpulse 2s ease-out infinite; }
.rt.live .rt-state { color:var(--ok); }
.strip button.rt.wait { border-color:rgba(255,171,0,.5); }
.rt.wait .rt-dot { background:var(--warn); }
.rt.wait .rt-state { color:var(--warn); }
.rt.paused .rt-dot { background:var(--blue2); }
.strip button.rt.refused { border-color:rgba(255,86,48,.55); background:rgba(255,86,48,.08); }
.rt.refused .rt-dot { background:var(--crit); }
.rt.refused .rt-state { color:var(--crit); }
@keyframes rtpulse { 0% { box-shadow:0 0 0 0 rgba(54,179,126,.6); } 70% { box-shadow:0 0 0 6px rgba(54,179,126,0); } 100% { box-shadow:0 0 0 0 rgba(54,179,126,0); } }
.strip button.brand { display:flex; align-items:center; gap:8px; font-weight:800; letter-spacing:.2px; border-radius:7px; padding:4px 8px; margin:-4px -8px; }
.strip button.brand:hover { background:rgba(58,160,255,.12); }
@media (prefers-reduced-motion: reduce) { .toggle .chev { transition: none; } .rt.live .rt-dot { animation: none; } }
` +
  // Écran étroit : les libellés se replient, l'icône et le nom accessible restent.
  `
@media (max-width: 1100px) { .seg .lbl { display: none; } .strip .seg button { padding: 0 8px; } }
.conn-refused { color: var(--crit); border-color: rgba(255,86,48,.5); }

.minbar { position:fixed; z-index:2147483000; display:none; align-items:center; gap:9px;
  min-height:36px; padding:7px 9px 7px 14px; border-radius:22px; cursor:pointer; margin:0;
  font:13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color:#e8eaed;
  background:rgba(18,20,25,.92); backdrop-filter:blur(12px);
  border:1px solid rgba(58,160,255,.45); box-shadow:0 4px 20px rgba(0,0,0,.5); }
.minbar:hover { border-color:#3aa0ff; box-shadow:0 4px 26px rgba(58,160,255,.4); }
.minbar.bottom { bottom:14px; } .minbar.top { top:14px; }
.minbar.dock-left { left:14px; } .minbar.dock-right { right:14px; }
.minbar .dot { width:8px; height:8px; border-radius:50%; background:#36b37e; }
.minbar .dot.connected { background:#36b37e; color:#36b37e; } .minbar .dot.error { background:#ff5630; }
.minbar .dot.disconnected { background:#8a9099; }
.minbar .dot.connecting,.minbar .dot.reconnecting { background:#ffab00; }
.minbar .mlogo { color:#ff8a3d; } .minbar .mrate { font-weight:800; }
.minbar .mbadge { font:600 11.5px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#c4c9d1; }
.minbar .mbadge.dev { color:#7fd3ac; } .minbar .mbadge.prod { color:#ff8f75; }
.minbar .mbadge.test { color:#ffcf66; } .minbar .mbadge.staging { color:#c7a6ff; }
.minbar .mname { font-weight:800; }
.minbar .mopen { display:flex; align-items:center; gap:4px; font:600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color:#3aa0ff; padding:4px 6px 4px 10px; border-left:1px solid #2a2e36; }
.minbar .mopen .ico { width:16px; height:16px; }
.minbar .mopen .ico path { fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.minbar:hover .mopen { color:#fff; }
.minbar:focus-visible { outline:2px solid #36b37e; outline-offset:2px; }
.side-choice { display:flex; gap:6px; margin-top:6px; }
.side-choice .toolbtn[aria-pressed="true"] { color:#fff; border-color:#3aa0ff; background:rgba(58,160,255,.15); }

` +
  // ── Network ───────────────────────────────────────────────────────────────
  `
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
.wf-bar.identity { background:#ff5c8a; }
.det-loading,.det-err { color:var(--muted); padding:6px 0; } .det-err { color:var(--crit); }

` +
  // Network pane = split DevTools : liste (scroll) + détail (scroll), détail
  // TOUJOURS visible (≠ tout dans un seul scroll où le détail finit hors écran).
  `
.pane.np.active { display:flex; flex-direction:column; padding:0; }
.np .net-head { padding:10px 14px 8px; flex:none; margin:0; }
.np .net-list { flex:1 1 auto; min-height:56px; overflow:auto; padding:0 14px; border-top:1px solid var(--line); }
` +
  // Détail : placeholder = petit (flex:0). Sélection active (.np.sel) → le détail
  // prend une vraie part (60%) avec son propre scroll → le waterfall est visible,
  // la liste se réduit.
  `
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
  const max = typeof window !== "undefined" ? window.innerHeight * 0.85 : 700;
  if (h < PANEL_H_MIN) return PANEL_H_MIN;
  if (h > max) return Math.round(max);
  return Math.round(h);
}

/**
 * Version du format de l'état persisté.
 *
 * Elle existe pour une raison précise : ces clés survivent aux mises à jour du
 * framework, dans un navigateur que personne ne nettoie. Le jour où l'une change
 * de sens, une valeur écrite par une version d'avant est lue comme si elle
 * disait la même chose — et la barre s'ouvre dans un état incohérent que
 * l'utilisateur ne sait pas défaire. Au changement de version, tout est purgé :
 * on perd une préférence d'affichage, ce qui ne coûte rien, plutôt que de
 * charger un état dont on ne sait rien.
 */
const LS_VERSION = "1";

/** Clés de persistance localStorage (état chrome de la barre). */
const LS = {
  /** Version du format — jamais purgée, c'est elle qui décide de la purge. */
  version: "nf.debugbar.v",
  visible: "nf.debugbar.visible",
  min: "nf.debugbar.min",
  side: "nf.debugbar.side",
  tab: "nf.debugbar.tab",
  h: "nf.debugbar.h",
  // Temps réel OFF par défaut (perf) : opt-in via le bouton de la barre — sinon
  // la barre maintiendrait les tickers (stats + syslog) en permanence en dev.
  live: "nf.debugbar.live",
} as const;

/**
 * Toutes les clés que la barre écrit sur CE navigateur.
 *
 * Cette liste n'est pas décorative : elle est ce que la barre AFFICHE dans son
 * onglet Runtime et ce que sa purge efface. Trois choses qui doivent rester
 * d'accord, donc une seule source.
 */
function lsKeys(): string[] {
  return Object.values(LS);
}

/** Efface l'état persisté de la barre — et rien d'autre du stockage de l'app. */
function lsPurge(): void {
  try {
    for (const k of lsKeys()) localStorage.removeItem(k);
  } catch {
    /* private mode / SSR */
  }
}

/**
 * Purge l'état si le format a changé depuis la dernière visite.
 *
 * Appelée avant toute lecture — sinon on lirait justement les valeurs qu'on
 * s'apprête à jeter.
 */
function lsMigrate(): void {
  try {
    if (localStorage.getItem(LS.version) === LS_VERSION) return;
    lsPurge();
    localStorage.setItem(LS.version, LS_VERSION);
  } catch {
    /* private mode / SSR */
  }
}

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
  private readonly client: NodefonySocket;
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
  // Temps réel (abonnements stats+syslog) — OFF par défaut (perf), opt-in bouton.
  private live: boolean;
  /** dispose des abonnements realtime (null quand OFF). */
  private liveOff: (() => void) | null = null;
  private rafPending = false;
  /** Filtre de sévérité de l'onglet Logs — `all` par défaut. */
  private feedSev: "all" | "err" | "warn" = "all";
  /** Recherche courante, déjà en minuscules (comparée telle quelle). */
  private feedQuery = "";
  /**
   * Affichage suspendu. Les entrées continuent d'arriver dans le modèle : à la
   * reprise, la liste se reconstruit complète — mettre en pause ne fait pas
   * perdre ce qui s'est passé pendant, ce qui serait le pire des deux mondes.
   */
  private feedPaused = false;
  /** La liste affichée doit être refaite (changement de filtre ou de recherche). */
  private feedDirty = false;
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
  private readonly el = Object.create(null) as Partial<Record<string, Element>>;
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
  /** Le journal fenêtré (null tant que la barre n'est pas montée). */
  private feedView: FeedView | null = null;
  /** Dernière séquence remise à la vue — ce qui la dépasse est neuf. */
  private feedSeen = 0;
  /** Séquence à laquelle « vider » a été demandé : rien d'antérieur ne s'affiche. */
  private feedCleared = 0;
  // ── Noyau client (onglet « Noyau ») ──
  /** La sonde du noyau observé — gardée après sa mort, pour montrer « terminé ». */
  private kprobe: IKernelProbe | null = null;
  private kstate = "";
  private kident: NodefonyKernelIdentity | null = null;
  private kidentChanges = 0;
  private kidentAt = 0;
  /** Journal des événements du noyau, le plus récent en premier, borné. */
  private kevents: Array<{ t: number; name: string; detail: string }> = [];
  private kdirty = true;
  private koff: (() => void) | null = null;
  /** Le serveur a refusé la socket faute de session administrateur (1008). */
  private refused = false;
  /** Environnement transmis au montage — en attendant celui des mesures. */
  private readonly initialEnv: string;
  private detailVersion = 0;
  private detailRendered = -1;

  constructor(opts: DebugBarOptions = {}) {
    this.url = opts.url ?? DEFAULT_PATH;
    this.position = opts.position ?? "bottom";
    this.startOpen = opts.open ?? false;
    this.initialEnv = opts.env ?? "";
    // Client TOUJOURS partagé : `opts.client` explicite OU le singleton par URL
    // (`NodefonySocket.shared`) → mutualise la socket avec l'app hôte (Studio).
    // Jamais « possédé » → la barre ne déconnecte JAMAIS au démontage.
    this.ownClient = false;
    this.frontend = opts.frontend ?? null;
    this.networkEnabled = opts.network !== false;
    this.profilerBase = (opts.profilerBase ?? DEFAULT_PROFILER_BASE).replace(
      /\/$/,
      "",
    );
    this.client = opts.client ?? NodefonySocket.shared({ url: this.url });
    // AVANT la première lecture : un état écrit par un format précédent est
    // jeté ici, pas interprété plus bas.
    lsMigrate();
    this.visible = lsGet(LS.visible, "1") !== "0";
    this.minimized = lsGet(LS.min, "0") === "1";
    this.side = lsGet(LS.side, "right") === "left" ? "left" : "right";
    const tab = lsGet(LS.tab, "realtime");
    this.activeTab = isTabId(tab) ? tab : "realtime";
    this.panelH = clampH(
      parseInt(lsGet(LS.h, String(defaultPanelH())), 10) || defaultPanelH(),
    );
    this.live = lsGet(LS.live, "0") === "1";
  }

  /** Construit le DOM, branche le realtime et ouvre la connexion. No-op si déjà monté. */
  mount(): this {
    if (typeof document === "undefined") return this;
    if (document.getElementById(HOST_ID)) return this;
    this.buildDom();
    this.wireRealtime();
    this.wireHmr();
    this.wireNetwork();
    this.wireKernel();
    this.applyChrome();
    this.registerHandle();
    // Pas de connexion au montage : la socket est PARTAGÉE avec l'application
    // hôte, et c'est elle qui décide quand l'ouvrir. La console d'administration
    // garde la sienne fermée jusqu'au login — l'ouvrir ici partait sans session,
    // et le serveur la refusait (1008) à chaque affichage de l'écran de
    // connexion. La barre se connecte quand on lui demande des données : panneau
    // ouvert, ou direct activé (y compris retrouvé actif au rechargement).
    if (this.startOpen || this.live) this.ensureConnected();
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
      document.documentElement.style.removeProperty(
        "--nodefony-debugbar-height",
      );
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

  private setSide(side: "left" | "right"): void {
    this.side = side;
    lsSet(LS.side, side);
    this.applyChrome();
  }

  /**
   * Déplie ou replie le panneau — le SEUL endroit qui bascule cet état.
   *
   * Il porte aussi ce qu'un lecteur d'écran doit entendre : `aria-expanded` sur
   * le bouton qui commande, et un nom qui dit l'action à venir (« Déplier » /
   * « Replier »), pas l'état courant — un nom qui décrit l'état laisse
   * l'utilisateur deviner ce que le bouton va faire.
   */
  private setOpen(open: boolean): void {
    const bar = this.bar;
    if (!bar) return;
    bar.classList.toggle("open", open);
    const verb = open ? "Fermer" : "Ouvrir";
    const btn = this.el.btnToggle;
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", `${verb} le panneau de débogage`);
      btn.setAttribute(
        "data-tip",
        `${verb} le panneau : temps réel, réseau, performances, journaux`,
      );
    }
    this.text("toggleLbl", verb);
    this.el.btnBrand?.setAttribute("aria-expanded", open ? "true" : "false");
    // Le panneau ouvert est une DEMANDE de données : c'est là, et non au
    // montage, que la connexion s'ouvre.
    if (open) this.ensureConnected();
    this.render();
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
      t.classList.toggle(
        "active",
        t.getAttribute("data-tab") === this.activeTab,
      ),
    );
    const panes = this.bar?.querySelectorAll(".pane");
    panes?.forEach((p) =>
      p.classList.toggle(
        "active",
        p.getAttribute("data-pane") === this.activeTab,
      ),
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
    this.el.btnSideLeft?.setAttribute(
      "aria-pressed",
      this.side === "left" ? "true" : "false",
    );
    this.el.btnSideRight?.setAttribute(
      "aria-pressed",
      this.side === "right" ? "true" : "false",
    );
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

  /**
   * Détecte le noyau client de la page — à tout moment : il peut naître avant
   * la barre, ou après (le registre et son événement vivent sur le global, la
   * barre étant servie par une autre instance du module que l'application).
   */
  private wireKernel(): void {
    const pick = (): void => {
      const list = exposedKernels();
      const probe = list[list.length - 1] ?? null;
      // Un noyau retiré du registre (terminé) reste affiché : l'onglet dit
      // « terminé » au lieu de disparaître sous les yeux.
      if (probe && probe !== this.kprobe) this.attachKernel(probe);
      this.kdirty = true;
      this.scheduleRender();
    };
    pick();
    const target = globalThis as {
      addEventListener?: (t: string, h: () => void) => void;
      removeEventListener?: (t: string, h: () => void) => void;
    };
    target.addEventListener?.(KERNEL_PROBE_EVENT, pick);
    this.disposers.push(() => {
      target.removeEventListener?.(KERNEL_PROBE_EVENT, pick);
      this.koff?.();
      this.koff = null;
    });
  }

  /** S'abonne au noyau — par les MÊMES briques que les liaisons de vue. */
  private attachKernel(probe: IKernelProbe): void {
    this.koff?.();
    this.kprobe = probe;
    // Amorce : ce que le noyau a daté AVANT l'arrivée de la barre.
    const tl = probe.timeline();
    this.kevents = (
      [
        ["onBoot", tl.booting],
        ["onReady", tl.ready],
      ] as const
    )
      .filter(
        (e): e is readonly ["onBoot" | "onReady", number] => e[1] !== undefined,
      )
      .map(([name, t]) => ({ t, name, detail: "" }))
      .reverse();
    this.kidentChanges = 0;
    this.kidentAt = 0;
    const k = probe.kernel;
    const offs: Array<() => void> = [];
    // L'état et l'identité se lisent SUR les événements du noyau, auxquels la
    // barre s'abonne de toute façon pour son journal : un second abonnement
    // (`observeKernel*`) ne dirait rien de plus et pèserait dans le bundle.
    this.kstate = k.state;
    this.kident = k.identity;
    const events: NodefonyKernelEvent[] = [
      "onBoot",
      "onReady",
      "onIdentityChange",
      "onVisibility",
      "onOnline",
      "onTerminate",
    ];
    for (const name of events) {
      const handler = (...args: unknown[]): void => {
        this.kstate = k.state;
        if (name === "onIdentityChange") {
          this.kident = k.identity;
          this.kidentChanges++;
          this.kidentAt = Date.now();
        }
        this.logKernelEvent(name, args);
      };
      k.on(name, handler);
      offs.push(() => k.off(name, handler));
    }
    this.koff = () => {
      for (const off of offs) off();
    };
  }

  /** Une ligne du journal des événements — ce que l'événement a dit, en clair. */
  private logKernelEvent(name: NodefonyKernelEvent, args: unknown[]): void {
    // Le noyau ne connaît pas d'« anonyme » : avant le premier setIdentity(),
    // il n'a AUCUN compte déclaré (null). Le journal dit le geste — connexion,
    // déconnexion, changement — pas un état qui n'existe pas.
    const keyOf = (v: unknown): string | null =>
      v && typeof v === "object" && "key" in v ? String(v.key) : null;
    let detail = "";
    if (name === "onIdentityChange") {
      const next = keyOf(args[0]);
      const prev = keyOf(args[1]);
      detail =
        prev === null && next !== null
          ? `connexion de ${shortKey(next)}`
          : next === null && prev !== null
            ? `déconnexion de ${shortKey(prev)}`
            : `changement de compte : ${shortKey(prev ?? "")} → ${shortKey(next ?? "")}`;
    } else if (name === "onVisibility")
      // `visibilitychange` du navigateur : l'application peut suspendre son
      // travail quand personne ne regarde.
      detail = args[0]
        ? "la page est de nouveau à l'écran"
        : "la page n'est plus à l'écran (autre onglet du navigateur, fenêtre réduite)";
    else if (name === "onOnline")
      detail = args[0]
        ? "connexion internet rétablie"
        : "connexion internet perdue (hors ligne)";
    this.kevents.unshift({ t: Date.now(), name, detail });
    if (this.kevents.length > 100) this.kevents.length = 100;
    this.kdirty = true;
    this.scheduleRender();
  }

  /**
   * L'onglet « Nodefony client » — quatre cartes, chacune répond à UNE question du
   * développeur : mon application tourne-t-elle ? pour quel compte ? ma socket
   * est-elle ouverte, et sinon pourquoi ? que s'est-il passé ? Reconstruit
   * seulement quand quelque chose a changé.
   */
  private renderKernel(): void {
    const body = this.el.kBody;
    if (!(body instanceof HTMLElement) || !this.kdirty) return;
    this.kdirty = false;
    const probe = this.kprobe;
    if (!probe) {
      body.innerHTML = `<div class="kempty">
        <div class="ttl">Cette page ne compose pas de noyau client</div>
        <p>Le noyau (<code>NodefonyKernel</code>) démarre l'application dans le navigateur, porte le compte connecté et tient la socket vers le serveur. Une page peut s'en passer : chaque brique s'emploie aussi seule.</p>
        <p>Pour le voir ici : <code>new NodefonyKernel({ realtime: { url } })</code>, puis le passer au fournisseur de votre front (<code>kernel={…}</code>).</p>
      </div>`;
      return;
    }
    const kv = (k: string, v: string, cls = "", full = ""): string => {
      const help = kernelHelp(k);
      const label = help
        ? `<span class="k help" tabindex="0" data-tip="${escapeHtml(help)}">${escapeHtml(k)}</span>`
        : `<span class="k">${escapeHtml(k)}</span>`;
      const title = full ? ` title="${escapeHtml(full)}"` : "";
      return `<div class="kv">${label}<span class="v ${cls}"${title}>${escapeHtml(v)}</span></div>`;
    };
    const at = (t: number | undefined): string => (t ? fmtClock(t) : "—");
    const k = probe.kernel;
    const tl = probe.timeline();
    const opts = probe.options;
    const state = this.kstate;
    const ident = this.kident;

    // État de l'application
    const stateText =
      state === "created"
        ? "créé — pas démarré"
        : state === "booting"
          ? "démarrage…"
          : (KERNEL_STATE_LABEL[state] ?? state);
    const stateCls =
      state === "ready" ? "ok" : state === "terminated" ? "crit" : "warn";
    const readyIn =
      tl.ready !== undefined && tl.booting !== undefined
        ? `${Math.max(0, tl.ready - tl.booting)} ms`
        : "—";
    const banner =
      opts.banner === "false"
        ? "aucune"
        : opts.banner === "true"
          ? "forcée"
          : "auto — détaillée en développement";
    const services = probe
      .rows()
      .filter(([label]) => label.startsWith("service · "))
      .map(([label]) => label.slice("service · ".length))
      .join(", ");

    // Connexion au serveur — l'état normal se dit, l'anomalie aussi.
    const socket = k.get("realtime");
    const sockState = socket?.state ?? "";
    const opensAtLogin = opts.connectOnBoot === "false";
    let sockText = "aucune";
    let sockCls = "muted";
    if (socket) {
      if (sockState === "connected") {
        sockText = "ouverte";
        sockCls = "ok";
      } else if (sockState === "connecting" || sockState === "reconnecting") {
        sockText = sockState === "connecting" ? "connexion…" : "reconnexion…";
        sockCls = "warn";
      } else if (this.refused) {
        sockText =
          "refusée par le serveur (1008) — pas de session administrateur";
        sockCls = "crit";
      } else if (ident) {
        sockText = "fermée alors qu'un compte est déclaré — voir la console";
        sockCls = "crit";
      } else if (opensAtLogin) {
        sockText =
          "fermée — volontairement : s'ouvrira à la déclaration du compte";
      } else if (state === "ready") {
        sockText = "le démarrage n'a pas pu l'ouvrir — reconnexion automatique";
        sockCls = "warn";
      } else {
        sockText = sockState === "error" ? "en erreur" : "fermée";
        sockCls = sockState === "error" ? "crit" : "muted";
      }
    }
    const origin =
      opts.realtime === "aucun"
        ? "aucune — realtime: false"
        : opts.realtime === "socket fournie"
          ? "fournie par l'application"
          : "créée par le noyau";
    const relays =
      opts.browserEvents === "false"
        ? "navigateur non relayé (browserEvents: false)"
        : "relaie : page à l'écran ou non, connexion internet, fermeture de la page";
    const many = exposedKernels().length > 1;
    const events = this.kevents
      .map(
        (e) =>
          `<div class="kev"><span class="ts">${fmtClock(e.t)}</span><span class="kn" data-tip="${escapeHtml(e.name)}" tabindex="0">${escapeHtml(KERNEL_EVENT_LABEL[e.name] ?? e.name)}</span><span class="kd">${escapeHtml(e.detail)}</span></div>`,
      )
      .join("");

    body.innerHTML = `<p class="kintro">Ce que Nodefony fait dans votre navigateur (<code>NodefonyKernel</code>) : démarrer l'application, porter le compte connecté, tenir la socket vers le serveur.</p>
    ${many ? `<p class="kwarn">${exposedKernels().length} noyaux sur la page — le plus récent est affiché.</p>` : ""}
    <div class="cards">
      <div class="card hero">
        <div class="ttl">État de l'application</div>
        ${kv("application", probe.name)}
        ${kv("état", stateText, stateCls)}
        ${kv("démarrée à", at(tl.booting))}
        ${kv("prête en", readyIn)}
        ${tl.terminated ? kv("terminée à", at(tl.terminated), "crit") : ""}
        ${kv("annonce console", banner, "muted")}
        ${services ? kv("services", services) : ""}
      </div>
      <div class="card">
        <div class="ttl">Compte déclaré</div>
        ${kv("compte", ident ? shortKey(ident.key) : "aucun — pas encore déclaré", ident ? "ok" : "muted", ident?.key ?? "")}
        ${kv("depuis", at(this.kidentAt))}
        ${kv("changements de compte", String(this.kidentChanges))}
        <div class="tag">Changer de compte coupe et rouvre la socket : rien ne part avec le jeton du compte précédent.</div>
      </div>
      <div class="card">
        <div class="ttl">Connexion au serveur</div>
        ${kv("socket", sockText, sockCls)}
        ${socket ? kv("adresse", socket.url ?? "fournie sans adresse", "", socket.url ?? "") : ""}
        ${kv("s'ouvre", opensAtLogin ? "à la déclaration du compte (login)" : "au démarrage (boot)")}
        ${kv("origine", origin)}
      </div>
      <div class="card kevents">
        <div class="ttl">Événements <span class="muted">— le plus récent en haut · ${escapeHtml(relays)}</span></div>
        ${events || `<div class="muted">Aucun événement depuis l'ouverture de la barre.</div>`}
      </div>
    </div>`;
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
    // Un REPÈRE de page, pas un `div` anonyme. Tout ce que la barre affiche vit
    // dans son Shadow DOM, et un audit d'accessibilité le voit : sans repère,
    // chacun de ses libellés est compté « hors de tout point de repère »
    // (règle `region` d'axe — seize occurrences mesurées sur une page de la
    // console d'administration, toutes venant d'ici). `complementary` est le
    // rôle juste : un contenu d'appoint, séparable du contenu principal.
    host.setAttribute("role", "complementary");
    host.setAttribute("aria-label", "Barre de débogage Nodefony");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    const bar = document.createElement("div");
    bar.className = `bar ${this.position}${this.startOpen ? " open" : ""}`;
    bar.innerHTML = this.template();
    // Un BOUTON, pas une division : la pastille est le seul chemin de retour vers
    // la barre, et une division n'est atteignable ni au clavier ni par un lecteur
    // d'écran. Son libellé dit ce que fait le clic.
    const minbar = document.createElement("button");
    minbar.type = "button";
    minbar.className = `minbar ${this.position} dock-${this.side}`;
    minbar.setAttribute("aria-label", "Afficher la barre de débogage Nodefony");
    minbar.innerHTML = `<span class="dot" data-el="mdot"></span><span class="mlogo">${NODEFONY_LOGO}</span><span class="mname">nodefony</span><span class="mrate" data-el="mrate">0/s</span><span class="mbadge" data-el="mEnv"></span><span class="mopen">Ouvrir<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></span>`;
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
    // ── Replier / déplier ──────────────────────────────────────────────────
    //
    // 🔴 Un BOUTON DÉDIÉ, et lui seul. Le bandeau entier écoutait le clic :
    // lire une métrique, sélectionner le nom de l'application ou viser une puce
    // refermait le panneau, et les trois contrôles devaient arrêter la
    // propagation pour y survivre — un `stopPropagation` par contrôle ajouté est
    // le signe qu'on lutte contre son propre écouteur. Le bandeau ne bascule
    // plus rien ; ce qu'il porte est cliquable pour ce que ça fait.
    const strip = bar.querySelector(".strip");
    if (!strip) throw new Error("DebugBar : gabarit sans bandeau `.strip`");
    this.wireBtn("btnToggle", () =>
      this.setOpen(!bar.classList.contains("open")),
    );
    // Chaque indicateur MÈNE à l'onglet qui le détaille (et déplie au passage).
    const onGoto = (ev: Event): void => {
      const t = closestFrom(ev.target, ".goto");
      const id = t?.getAttribute("data-goto") as TabId | null;
      if (!id) return;
      this.setOpen(true);
      this.setTab(id);
    };
    strip.addEventListener("click", onGoto);
    this.disposers.push(() => strip.removeEventListener("click", onGoto));
    // Contrôles de fenêtre. Plus de `stopPropagation` : plus rien au-dessus
    // d'eux n'écoute le clic.
    // Le logo bascule le panneau : c'est là que l'œil et la souris vont en
    // premier. Lui SEUL — la bande entière ne bascule toujours rien.
    this.wireBtn("btnBrand", () =>
      this.setOpen(!bar.classList.contains("open")),
    );
    this.wireBtn("btnMin", () => this.setMinimized(true));
    this.wireBtn("btnSideLeft", () => this.setSide("left"));
    this.wireBtn("btnSideRight", () => this.setSide("right"));
    this.wireBtn("btnLive", () => this.setLive(!this.live));
    this.updateLiveBtn();
    // Onglets.
    const tabsBar = bar.querySelector(".tabs");
    if (tabsBar) {
      const onTab = (ev: Event): void => {
        const t = closestFrom(ev.target, ".tab");
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
      this.disposers.push(() =>
        resize.removeEventListener("pointerdown", onDown),
      );
    }
    // ── Barre d'outils du journal ──────────────────────────────────────────
    const counts = bar.querySelector(".counts");
    if (counts) {
      const onSev = (ev: Event): void => {
        const t = closestFrom(ev.target, ".sevf");
        const sev = t?.getAttribute("data-sev");
        if (sev !== "all" && sev !== "err" && sev !== "warn") return;
        // Recliquer le filtre actif le retire : un filtre qu'on ne sait pas
        // enlever se transforme en écran vide qu'on croit cassé.
        this.feedSev = this.feedSev === sev ? "all" : sev;
        counts
          .querySelectorAll(".sevf")
          .forEach((n) =>
            n.classList.toggle(
              "on",
              n.getAttribute("data-sev") === this.feedSev &&
                this.feedSev !== "all",
            ),
          );
        this.feedDirty = true;
        this.render();
      };
      counts.addEventListener("click", onSev);
      this.disposers.push(() => counts.removeEventListener("click", onSev));
    }
    const search = this.el.logSearch as HTMLInputElement | undefined;
    if (search) {
      const onSearch = (): void => {
        this.feedQuery = search.value.trim().toLowerCase();
        this.feedDirty = true;
        this.render();
      };
      search.addEventListener("input", onSearch);
      this.disposers.push(() => search.removeEventListener("input", onSearch));
    }
    this.wireBtn("btnPause", () => {
      this.feedPaused = !this.feedPaused;
      const b = this.el.btnPause;
      if (b) {
        b.setAttribute("aria-pressed", this.feedPaused ? "true" : "false");
        b.classList.toggle("on", this.feedPaused);
        b.textContent = this.feedPaused ? "▶" : "⏸";
        const tip = this.feedPaused
          ? "Reprendre l'affichage — la liste se recompose avec ce qui est arrivé pendant la pause"
          : "Suspendre l'affichage — les entrées continuent d'arriver et se rattrapent à la reprise";
        b.setAttribute("data-tip", tip);
      }
      // À la reprise, on refait la liste : le tampon a bougé pendant la pause.
      if (!this.feedPaused) {
        this.feedDirty = true;
        this.render();
      }
    });
    this.wireBtn("btnCopy", () => {
      // Tout le jeu affiché, une ligne par entrée — l'écran ne porte qu'une
      // fenêtre, copier le DOM ne rendrait que quelques lignes.
      const text = (this.feedView?.shown ?? [])
        .map(
          (l) =>
            `${fmtClock(l.ts)} ${l.name} ${l.module} ${l.text}${l.requestId ? ` [${l.requestId}]` : ""}`,
        )
        .join("\n");
      // Absent hors contexte sécurisé (HTTP autre que localhost) malgré lib.dom.
      void (navigator.clipboard as Clipboard | undefined)?.writeText(text).then(
        () => this.flashBtn("btnCopy", "✓"),
        // Le presse-papiers peut être refusé (contexte non sécurisé, permission) :
        // le dire vaut mieux qu'un bouton qui ne réagit pas.
        () => this.flashBtn("btnCopy", "✗"),
      );
    });
    this.wireBtn("btnClearFeed", () => {
      // On ne touche pas au modèle : la barre n'efface rien côté serveur. On
      // retient seulement OÙ la liste a été vidée — tout ce qui arrive ensuite
      // s'affiche.
      const feed = this.model.view.feed;
      this.feedCleared = feed.at(-1)?.seq ?? 0;
      this.feedDirty = true;
      this.render();
    });
    // Le journal : une vue FENÊTRÉE (quelques dizaines de nœuds recyclés, quel
    // que soit le tampon). Le détail s'ouvre dans un volet À CÔTÉ — l'ouvrir
    // dans la liste poussait les lignes sous l'œil.
    const feedBox = this.el.feedBox;
    if (feedBox instanceof HTMLElement) {
      const view = new FeedView(feedBox, {
        onSelect: (entry) => this.showLogDetail(entry),
        tierOf: (sev) => DebugBar.tierOf(sev),
        formatTime: fmtClock,
      });
      this.feedView = view;
      this.disposers.push(() => {
        view.destroy();
        this.feedView = null;
      });
    }
    const side = this.el.logSide;
    if (side instanceof HTMLElement) {
      const onSide = (ev: Event): void => {
        if (closestFrom(ev.target, "[data-act='close']"))
          this.feedView?.select(-1);
      };
      side.addEventListener("click", onSide);
      this.disposers.push(() => side.removeEventListener("click", onSide));
    }

    this.wireBtn("btnPurge", () => {
      lsPurge();
      this.flashBtn("btnPurge", "état effacé ✓");
      // La purge ne remet pas la barre à zéro sous les doigts de l'utilisateur :
      // ce qui est effacé, c'est ce qu'on RELIRA au prochain chargement. Refermer
      // la barre ou la déplacer maintenant serait un effet de bord surprenant.
    });

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
    this.disposers.push(() =>
      window.removeEventListener("resize", onWinResize),
    );
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

  /**
   * Retour visuel bref sur un bouton d'action.
   *
   * Une copie réussie ne change rien à l'écran : sans ce clin d'œil, on ne sait
   * pas si le clic a porté, et on reclique.
   */
  private flashBtn(key: string, glyph: string): void {
    const b = this.el[key];
    if (!b) return;
    const before = b.textContent;
    b.textContent = glyph;
    const t = setTimeout(() => {
      b.textContent = before;
    }, 900);
    // Un widget démonté avant la fin du délai ne doit pas écrire dans un DOM
    // détaché : le minuteur est libéré comme tout le reste.
    this.disposers.push(() => clearTimeout(t));
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
        <button type="button" class="brand" data-el="btnBrand" aria-controls="nf-db-panel" aria-expanded="${this.startOpen}" data-tip="Barre de débogage Nodefony (développement uniquement) — cliquer pour ouvrir ou fermer le panneau"><span class="logo">${NODEFONY_LOGO}</span><span class="name">nodefony</span></button>
        <span class="env-badge" data-el="envBadge" data-tip="Environnement dans lequel tourne l'application">env</span>
        <span class="branch" data-el="branch" data-tip="Branche git de la copie de travail" hidden><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5v11M5 13.5a1.5 1.5 0 1 0 0-.01M11 5.5a1.5 1.5 0 1 0 0-.01M11 7c0 3.5-6 2.5-6 5"/></svg><span data-el="branchName"></span></span>
        <button type="button" class="rt ui" data-el="btnLive" aria-pressed="false" data-tip="Temps réel"><span class="rt-dot" aria-hidden="true"></span><span class="rt-name">Temps réel</span><span class="rt-state" data-el="rtCtlState">arrêté</span></button>
        ${this.miniMetric("rt", "rt", "rtMini", "0/s", "realtime", "Messages temps réel reçus par seconde — cliquer pour ouvrir l'onglet Realtime")}
        ${this.miniMetric("cpu", "cpu", "cpuMini", "0%", "perf", "Charge processeur du serveur — cliquer pour ouvrir l'onglet Perf")}
        ${this.miniMetric("mem", "mem", "memMini", "0%", "perf", "Mémoire utilisée par le serveur — cliquer pour ouvrir l'onglet Perf")}
        <span class="spacer"></span>
        ${this.networkEnabled ? `<button type="button" class="chip goto" data-goto="network" data-tip="Requêtes réseau observées — cliquer pour ouvrir l'onglet Network"><span class="k">net</span><span class="blue" data-el="netChip">0</span></button>` : ""}
        <button type="button" class="chip goto kchip" data-goto="kernel" data-el="kChip" data-tip="Nodefony client de la page (NodefonyKernel) — cliquer pour ouvrir l'onglet" hidden><span class="word">client</span><span class="word kstate" data-el="kChipState"></span></button>
        ${this.frontend ? `<button type="button" class="chip goto" data-goto="realtime" data-tip="Mises à jour à chaud (HMR) appliquées depuis le chargement de la page — cliquer pour ouvrir le détail"><span class="k">hmr</span><span class="hmrv" data-el="hmrChip">0</span></button>` : ""}
        <button type="button" class="chip goto" data-goto="logs" data-tip="Entrées de journal reçues — cliquer pour ouvrir l'onglet Logs"><span class="k">logs</span><span data-el="logs">0</span></button>
        <button type="button" class="chip goto" data-goto="logs" data-tip="Erreurs et alertes — cliquer pour ouvrir l'onglet Logs"><span class="k">err</span><span class="crit" data-el="err">0</span></button>
        <div class="seg ui">
          <button type="button" data-el="btnMin" aria-label="Réduire la barre en pastille" data-tip="Réduire la barre en une pastille, dans un coin de l'écran"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 11.5h9"/></svg><span class="lbl">Réduire</span></button>
          <button type="button" class="toggle" data-el="btnToggle" aria-expanded="${this.startOpen}" aria-controls="nf-db-panel" aria-label="${this.startOpen ? "Fermer" : "Ouvrir"} le panneau de débogage" data-tip="${this.startOpen ? "Fermer" : "Ouvrir"} le panneau : temps réel, réseau, performances, journaux"><span class="lbl" data-el="toggleLbl">${this.startOpen ? "Fermer" : "Ouvrir"}</span><svg class="ico chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>
        </div>
      </div>
      <div class="panelwrap" id="nf-db-panel">
        <div class="resize" data-el="resize" title="Redimensionner"></div>
        <div class="tabs">
          <button class="tab" data-tab="realtime">Realtime</button>
          ${this.networkEnabled ? `<button class="tab" data-tab="network">Network <span class="tcount" data-el="netTab">0</span></button>` : ""}
          <button class="tab" data-tab="perf">Perf</button>
          <button class="tab" data-tab="logs">Logs <span class="tcount" data-el="logsTab">0</span></button>
          <button class="tab" data-tab="kernel">Nodefony client <span class="tdot" data-el="kTabDot" hidden></span></button>
          <button class="tab" data-tab="runtime">Runtime</button>
        </div>
        <div class="panes" data-el="panes">
          ${this.realtimePane()}
          ${this.networkEnabled ? this.networkPane() : ""}
          ${this.perfPane()}
          ${this.logsPane()}
          <div class="pane" data-pane="kernel"><div data-el="kBody"></div></div>
          ${this.runtimePane()}
        </div>
      </div>`;
  }

  private realtimePane(): string {
    return `<div class="pane" data-pane="realtime"><div class="cards">
      <div class="card hero">
        <div class="ttl"><span class="blue">⚡</span> Realtime</div>
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
        <div class="ttl">Performance</div>
        ${this.chart("CPU", "cpuVal", "cpuPeak", "cpuLine", "cpuArea")}
        ${this.chart("Heap", "heapVal", "heapPeak", "heapLine", "heapArea")}
        ${this.chart("Event loop", "loopVal", "loopPeak", "loopLine", "loopArea")}
      </div>
    </div></div>`;
  }

  /**
   * L'onglet Logs — une petite console de lecture, pas une liste qui défile.
   *
   * Ce qu'elle porte, et pourquoi : un FILTRE par sévérité et une RECHERCHE
   * (sans quoi on lit le bruit au lieu de son incident) ; une PAUSE (sans quoi
   * la ligne qu'on essaie de lire s'en va) ; une COPIE (une trace se colle dans
   * un ticket) ; et le DÉTAIL d'une entrée, où vit le `requestId` — le champ qui
   * relie ce journal à sa requête, et que la barre recevait sans jamais le
   * montrer.
   */
  private logsPane(): string {
    return `<div class="pane logp" data-pane="logs">
      <div class="counts">
        <button type="button" class="chip sevf" data-sev="all" data-tip="Tout afficher"><span class="k">total</span><span data-el="cTotal">0</span></button>
        <button type="button" class="chip sevf" data-sev="err" data-tip="N'afficher que les erreurs (sévérité 0 à 3)"><span class="k">err</span><span class="crit" data-el="cErr">0</span></button>
        <button type="button" class="chip sevf" data-sev="warn" data-tip="N'afficher que les alertes (sévérité 4)"><span class="k">warn</span><span class="warn" data-el="cWarn">0</span></button>
        <span class="chip" data-tip="Entrées écartées par le serveur faute de place dans le tampon — le flux était plus rapide que l'envoi"><span class="k">dropped</span><span class="muted" data-el="cDrop">0</span></span>
        <span class="spacer"></span>
        <input class="search" data-el="logSearch" type="search" placeholder="rechercher…"
               aria-label="Filtrer les journaux sur leur texte, leur module ou leur requête" />
        <button type="button" class="toolbtn" data-el="btnPause" aria-pressed="false" data-tip="Suspendre l'affichage — les entrées continuent d'arriver et se rattrapent à la reprise">⏸</button>
        <button type="button" class="toolbtn" data-el="btnCopy" data-tip="Copier les entrées affichées (tout le jeu filtré, pas seulement l'écran) dans le presse-papiers">⧉</button>
        <button type="button" class="toolbtn" data-el="btnClearFeed" data-tip="Vider la liste affichée (n'efface rien côté serveur)">⌫</button>
      </div>
      <div class="logbody">
        <div class="feedbox" data-el="feedBox">
          <div class="loghead" aria-hidden="true"><span>heure</span><span>niveau</span><span>module</span><span>message</span><span>requête</span></div>
        </div>
        <aside class="logside" data-el="logSide" aria-label="Détail de l'entrée" hidden></aside>
      </div>
    </div>`;
  }

  /**
   * Ce que la barre garde sur CE navigateur — écrit noir sur blanc.
   *
   * Une console de développement qui écrit dans le stockage local sans le dire
   * est exactement ce qu'on reproche aux autres. La liste est dérivée des clés
   * réelles, donc elle ne peut pas mentir par oubli, et le bouton efface
   * précisément celles-là — jamais le stockage de l'application hôte.
   */
  private storageCard(): string {
    const rows = lsKeys()
      .map(
        (k) =>
          `<div class="drow"><span class="dk">${escapeHtml(k.replace("nf.debugbar.", ""))}</span><span class="dv">${escapeHtml(lsGet(k, "—"))}</span></div>`,
      )
      .join("");
    return `<div class="card">
      <div class="ttl">Stockage local</div>
      <div class="tag">Ces valeurs vivent dans ce navigateur, sur cet appareil. Elles ne quittent jamais la page et ne concernent que l'apparence de la barre.</div>
      ${rows}
      <div class="tag" style="margin-top:8px">Pastille réduite — le coin où elle se pose quand la barre est réduite.</div>
      <div class="side-choice">
        <button type="button" class="toolbtn" data-el="btnSideLeft" aria-pressed="false">◧ À gauche</button>
        <button type="button" class="toolbtn" data-el="btnSideRight" aria-pressed="false">◨ À droite</button>
      </div>
      <div style="margin-top:8px"><button type="button" class="toolbtn" data-el="btnPurge" data-tip="Effacer les préférences de la barre sur ce navigateur — l'application n'est pas touchée">Purger l'état de la barre</button></div>
    </div>`;
  }

  private runtimePane(): string {
    return `<div class="pane" data-pane="runtime"><div class="cards">
      ${this.storageCard()}
      <div class="card">
        <div class="ttl">Runtime</div>
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

  /**
   * Un indicateur du bandeau — et un RACCOURCI vers l'onglet qui le détaille.
   *
   * C'est un `<button>` et non un `<span>` : le bandeau ne se replie plus au
   * clic (c'était le défaut principal — lire une valeur refermait le panneau),
   * donc chaque indicateur peut faire quelque chose d'utile de son propre clic.
   * Mener à l'onglet qui explique le chiffre est ce que l'utilisateur attend,
   * et un bouton l'annonce et s'atteint au clavier.
   */
  private miniMetric(
    label: string,
    valKey: string,
    sparkKey: string,
    init: string,
    goto: TabId,
    tip: string,
  ): string {
    return `<button type="button" class="metric goto" data-goto="${goto}" data-tip="${escapeHtml(tip)}">
      <span class="k">${label}</span>
      <span class="v" data-el="${valKey}">${init}</span>
      <svg class="mini" viewBox="0 0 ${MINI_W} ${MINI_H}" preserveAspectRatio="none">
        <polyline class="spark ok" data-el="${sparkKey}" points=""/>
      </svg>
    </button>`;
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
      <div class="ttl"><span style="color:${fw.color}">●</span> Frontend</div>
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
    // Listeners TOUJOURS branchés (gratuit : `.on` ne génère aucun trafic réseau ;
    // les handlers ne firent que si un canal est abonné). L'état + le pouls de
    // frames restent vivants même OFF (la socket est partagée avec l'app hôte).
    const offState = this.client.onState((state) => {
      this.model.setState(state);
      if (state === "connected") this.refused = false;
      this.scheduleRender();
    });
    // Un refus d'accès (1008) ne doit pas se lire comme une panne : la barre lit
    // les données d'ADMINISTRATION, et sans session administrateur le serveur
    // ferme la socket. On le dit, avec le geste qui le lève.
    const offNotice = this.client.onNotice((notice) => {
      if (notice.source !== "realtime" || notice.code !== 1008) return;
      this.refused = true;
      this.scheduleRender();
    });
    this.disposers.push(offNotice);
    const offTick = this.client.onStats(() => {
      // OFF → on N'ÉCHANTILLONNE PAS : le compteur de frames est GLOBAL au client
      // partagé (frames des autres consommateurs, ex. Studio) → sinon le graphe
      // « frames/s » continuerait de bouger alors que la barre est désactivée.
      if (!this.live) return;
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
      if (p && typeof p === "object") this.model.ingestSyslog(p);
      this.scheduleRender();
    });
    this.model.setState(this.client.state);
    this.disposers.push(offState, offTick, offStats, offSyslog, () => {
      this.stopLive();
    });
    // Abonnements (tickers serveur) gérés par le bouton « Temps réel » — OFF par
    // défaut (perf). Si la préférence persistée est ON, on démarre au montage.
    if (this.live) this.startLive();
  }

  /**
   * Démarre les abonnements realtime (tickers serveur stats+syslog). REF-COMPTÉ
   * (UNE fois) sur le client PARTAGÉ : un canal reste actif tant qu'un
   * consommateur le veut ; le client ré-abonne seul au reconnect. Idempotent.
   */
  private startLive(): void {
    if (this.liveOff) return;
    this.client.subscribe(CHANNELS.stats);
    this.client.subscribe(CHANNELS.syslog);
    this.liveOff = () => {
      this.client.unsubscribe(CHANNELS.stats);
      this.client.unsubscribe(CHANNELS.syslog);
    };
  }

  /**
   * Ouvre la connexion partagée — à la DEMANDE (panneau ouvert, direct activé),
   * jamais au montage. `connect()` sans argument : il réutilise l'adresse déjà
   * portée par la socket partagée (repasser `this.url`, relative, écraserait la
   * clé), et il est sans effet si l'hôte l'a déjà ouverte.
   */
  private ensureConnected(): void {
    this.client.connect().catch(() => {
      /* la reconnexion et l'état se lisent par `onState` / `onNotice` */
    });
  }

  /** Arrête les abonnements realtime (relâche la réf de la barre). Idempotent. */
  private stopLive(): void {
    if (!this.liveOff) return;
    this.liveOff();
    this.liveOff = null;
  }

  /** Active/désactive le temps réel (bouton de la barre) + persiste la préférence. */
  setLive(v: boolean): void {
    if (v === this.live && !!this.liveOff === v) return;
    this.live = v;
    lsSet(LS.live, v ? "1" : "0");
    if (v) {
      // Recale la base du compteur GLOBAL → pas de pic « frames/s » au 1ᵉʳ tick.
      this.prevFrames = this.client.framesReceived;
      this.ensureConnected();
      this.startLive();
    } else {
      this.stopLive();
      // Fige le graphe « frames/s » à 0 (sinon il resterait sur sa dernière valeur).
      this.rtRate = 0;
      pushCap(this.rtSeries, 0, RT_POINTS);
    }
    this.updateLiveBtn();
    this.scheduleRender();
  }

  /** Met à jour l'aspect du bouton « Temps réel » selon l'état. */
  private updateLiveBtn(): void {
    this.renderRealtimeControl(this.model.view.state);
  }

  /**
   * Le contrôle « Temps réel » — UN état lisible, tiré de deux faits : la
   * connexion (partagée avec l'hôte) et l'abonnement de la barre (le direct).
   *
   * | direct | connexion          | affiché            |
   * | ------ | ------------------ | ------------------ |
   * | —      | refusée (1008)     | accès refusé       |
   * | oui    | ouverte            | en direct          |
   * | oui    | pas encore ouverte | connexion…         |
   * | non    | ouverte            | en pause           |
   * | non    | fermée             | arrêté             |
   */
  private renderRealtimeControl(state: string): void {
    const btn = this.el["btnLive"] as HTMLElement | undefined;
    if (!btn) return;
    const connected = state === "connected";
    let mode: "refused" | "live" | "wait" | "paused" | "off";
    if (this.refused && !connected) mode = "refused";
    else if (this.live && connected) mode = "live";
    // Direct demandé mais socket pas (encore) ouverte : c'est une attente, pas
    // un arrêt — afficher « arrêté » démentirait le clic qu'on vient de faire.
    else if (this.live) mode = "wait";
    else if (connected) mode = "paused";
    else mode = "off";
    const label = {
      refused: "accès refusé",
      live: "en direct",
      wait: "connexion…",
      paused: "en pause",
      off: "arrêté",
    }[mode];
    const tip = {
      refused:
        "Accès refusé : la barre lit les données d'administration. Connecte-toi à la console (/nodefony) avec un compte administrateur, puis réessaie.",
      live: "Mesures et journaux poussés en direct par le serveur — cliquer pour arrêter.",
      wait: "Connexion au serveur en cours — cliquer pour arrêter.",
      paused:
        "Connecté, mais rien n'est poussé — cliquer pour recevoir mesures et journaux en direct.",
      off: "Arrêté : rien n'est poussé — cliquer pour démarrer. Coupé par défaut : le direct maintient des compteurs côté serveur.",
    }[mode];
    this.text("rtCtlState", label);
    btn.setAttribute("class", `rt ui ${mode}`);
    btn.setAttribute("data-tip", tip);
    btn.setAttribute("aria-pressed", this.live ? "true" : "false");
    // Pas d'`aria-label` : le texte VISIBLE (« Temps réel arrêté ») est le nom.
    // Un nom réécrit qui ne le reprend pas mot pour mot viole WCAG 2.5.3 — et
    // trompe qui pilote à la voix en lisant l'écran.
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
    // Préfixe du dev server Vite (modules ESM + HMR, relayés sous `/_vite/`) — ces appels
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
        const row = closestFrom(ev.target, ".net-row");
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
        if (closestFrom(ev.target, '[data-act="close"]')) this.deselect();
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
        if (node)
          node.innerHTML = `<div class="empty">en attente d'appels AJAX (fetch / XHR)…</div>`;
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
    const [m, path, rid, status, dur] = row.children as unknown as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
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
          new CustomEvent(PLATFORM_EVENTS.debugbarSelect, {
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
      case "kernel":
        this.renderKernel();
        break;
      case "runtime":
        this.renderRuntime(v);
        break;
    }
  }

  /** Bandeau toujours visible (chips + pouls) — léger. */
  private renderStrip(v: DebugBarView): void {
    const cpuT = gauge(v.cpuPercent);
    const memT = gauge(v.heapPercent);
    // env + branche
    // Ce qu'on ne sait pas ne s'affiche pas : un badge « env » ou une branche
    // « — » se lisent comme des valeurs, et ne disent rien.
    const env = v.env || this.initialEnv;
    this.text("envBadge", ENV_LABEL[env] ?? env);
    this.cls("envBadge", `env-badge ${envClass(env)}`);
    this.el.envBadge?.toggleAttribute("hidden", !env);
    this.el.envBadge?.setAttribute(
      "data-tip",
      `Environnement du serveur : ${env}`,
    );
    this.text("branchName", v.branch);
    this.el.branch?.toggleAttribute("hidden", !v.branch);
    this.el.branch?.setAttribute(
      "data-tip",
      `Branche git de la copie de travail : ${v.branch}`,
    );
    // La pastille dit l'environnement comme la bande : même mot, même couleur.
    this.text("mEnv", ENV_LABEL[env] ?? env);
    this.cls("mEnv", `mbadge ${envClass(env)}`);
    this.cls("mdot", `dot ${v.state}`);
    this.text("mrate", `${this.rtRate}/s`);
    this.renderRealtimeControl(v.state);
    this.text("hmrChip", String(this.hmrCount));
    const kchip = this.el.kChip;
    if (kchip instanceof HTMLElement) {
      kchip.hidden = this.kprobe === null;
      kchip.setAttribute("class", `chip goto kchip st-${this.kstate}`);
      this.text("kChipState", KERNEL_STATE_LABEL[this.kstate] ?? this.kstate);
    }
    const kdot = this.el.kTabDot;
    if (kdot instanceof HTMLElement) kdot.hidden = this.kprobe === null;
    this.text("rt", `${this.rtRate}/s`);
    this.cls("rt", "v blue");
    this.el.rtMini?.setAttribute(
      "points",
      sparklinePoints(this.rtSeries, MINI_W, MINI_H),
    );
    this.el.rtMini?.setAttribute("class", "spark rt");
    // mini cpu / mem / loop
    this.text("cpu", `${v.cpuPercent}%`);
    this.cls("cpu", `v ${cpuT}`);
    this.text("mem", `${v.heapPercent}%`);
    this.cls("mem", `v ${memT}`);
    this.el.cpuMini?.setAttribute(
      "points",
      sparklinePoints(v.cpuSeries, MINI_W, MINI_H, 100),
    );
    this.el.cpuMini?.setAttribute("class", `spark ${cpuT}`);
    this.el.memMini?.setAttribute(
      "points",
      sparklinePoints(v.heapSeries, MINI_W, MINI_H, 100),
    );
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

  /** Classe de couleur d'une entrée, dérivée de sa sévérité RFC 5424. */
  private static tierOf(severity: number): string {
    if (severity <= 3) return "crit";
    if (severity === 4) return "warn";
    if (severity === 7) return "muted";
    return "info";
  }

  /** L'entrée passe-t-elle le filtre de sévérité et la recherche en cours ? */
  private feedMatch(l: FeedLog): boolean {
    if (this.feedSev === "err" && l.severity > 3) return false;
    if (this.feedSev === "warn" && l.severity !== 4) return false;
    const q = this.feedQuery;
    if (q === "") return true;
    return (
      l.text.toLowerCase().includes(q) ||
      l.module.toLowerCase().includes(q) ||
      l.msgid.toLowerCase().includes(q) ||
      (l.requestId ?? "").toLowerCase().includes(q)
    );
  }

  /** Ouvre (ou referme) le volet de détail d'une entrée. */
  private showLogDetail(entry: FeedLog | null): void {
    const side = this.el.logSide;
    if (!(side instanceof HTMLElement)) return;
    side.hidden = entry === null;
    side.innerHTML =
      entry === null
        ? ""
        : `<div class="sidehead"><span>Détail</span><button type="button" class="toolbtn" data-act="close" aria-label="Fermer le détail">✕</button></div>${this.feedDetail(entry)}`;
  }

  /** Le détail d'une entrée — ce qu'on colle dans un ticket. */
  private feedDetail(l: FeedLog): string {
    const row = (k: string, v: string): string =>
      `<div class="drow"><span class="dk">${k}</span><span class="dv">${escapeHtml(v)}</span></div>`;
    return `<div class="logdetail">
      ${row("horodatage", new Date(l.ts).toISOString())}
      ${row("sévérité", `${l.name} (${l.severity})`)}
      ${row("module", l.module)}
      ${l.msgid ? row("catégorie", l.msgid) : ""}
      ${l.pid ? row("worker (pid)", String(l.pid)) : ""}
      ${row("séquence", String(l.uid))}
      ${l.requestId ? row("requête", l.requestId) : ""}
      ${row("message", l.text)}
    </div>`;
  }

  /**
   * Rendu du journal — la vue fenêtrée reçoit le jeu, elle ne peint que l'écran.
   *
   * Sans filtre, le jeu EST le tampon du modèle (aucune copie). Avec un filtre,
   * une recherche ou après « vider », il est recalculé — seulement quand quelque
   * chose a changé, et seulement panneau ouvert sur cet onglet (`render`) :
   * barre fermée, le flux ne fait qu'entrer dans le tampon.
   */
  private renderFeed(feed: FeedLog[]): void {
    const view = this.feedView;
    if (!view || this.feedPaused) return;
    const last = feed.at(-1)?.seq ?? 0;
    const refilter = this.feedDirty;
    if (!refilter && last === this.feedSeen) return;
    const since = this.feedSeen;
    this.feedSeen = last;
    this.feedDirty = false;
    const filtering =
      this.feedSev !== "all" || this.feedQuery !== "" || this.feedCleared > 0;
    const list = filtering
      ? feed.filter((l) => l.seq > this.feedCleared && this.feedMatch(l))
      : feed;
    let appended = -1;
    if (!refilter) {
      appended = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        if ((list[i]?.seq ?? 0) <= since) break;
        appended++;
      }
    }
    const emptyText =
      feed.length === 0
        ? "en attente de journaux…"
        : this.feedCleared > 0 && !this.feedQuery && this.feedSev === "all"
          ? "liste vidée — les nouvelles entrées s'afficheront ici."
          : "aucune entrée ne correspond au filtre.";
    view.setEntries(list, appended, emptyText);
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
    node.parentElement?.classList.toggle("sel", hasSel);
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
      (p.error
        ? kv("erreur", `<span class="crit">${escapeHtml(p.error)}</span>`)
        : "") +
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
        (q.connector
          ? `<span class="net-rid">${escapeHtml(q.connector)}</span>`
          : "") +
        (typeof q.rows === "number"
          ? `<span class="net-dur">${q.rows} rows</span>`
          : "") +
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
  if (
    m === "get" ||
    m === "post" ||
    m === "put" ||
    m === "patch" ||
    m === "delete"
  )
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
  const tid = seg.at(1) ?? p.traceparent;
  if (!tid) return "—";
  return tid.length > 12 ? tid.slice(0, 12) + "…" : tid;
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
