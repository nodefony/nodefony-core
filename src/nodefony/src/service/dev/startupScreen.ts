/**
 * L'écran de démarrage — UN bilan, TROIS rendus.
 *
 * Une seule liste de faits ({@link IStartupView}, bâtie depuis le rapport de
 * boot) et trois façons de la dire : `human` (un terminal, couleurs et
 * symboles), `plain` (un agent, une intégration continue, un fichier : une
 * ligne par fait, zéro séquence ANSI, des codes stables) et `json` (le bilan
 * entier, schéma versionné). Jamais trois listes : elles divergeraient.
 *
 * Tout ce module est PUR — aucune lecture d'environnement, aucune écriture :
 * l'appelant injecte la capacité du terminal, la largeur, les faits. C'est ce
 * qui permet d'éprouver chaque rendu sur un bilan fabriqué, sans démarrer un
 * noyau ni capturer une sortie standard.
 */
import { stripVTControlCharacters } from "node:util";
import type {
  IBootLink,
  IBootModuleGated,
  IBootNotice,
  IBootReport,
  IBootServerInfo,
  BootNoticeLevel,
} from "../../kernel/bootReport";
import { openableHost } from "../../kernel/bootReport";
import { fitStatus } from "./statusLine";
import {
  createPalette,
  pluralize,
  usableWidth,
  wrap,
  wrapList,
  type IPalette,
} from "../../kernel/checks/report";
import type { DevProcessInfo } from "./devProcess";
import { renderProcessTable } from "./devStatusReport";
import {
  cleanZonePattern,
  isFrameworkZone,
  renderZoneTable,
  type IFirewallZoneView,
} from "./firewallZones";

/** Version du schéma du bilan machine — incrémentée à toute rupture de forme. */
export const STARTUP_SCHEMA_VERSION = 1;

export {
  resolveOutputMode,
  readOutputFlag,
  type StartupOutputMode,
} from "./outputMode";

/** Largeur maximale de l'écran humain, même sur un terminal plus large. */
const SCREEN_MAX_WIDTH = 80;

/** Gouttière de l'écran : tout part de cette marge. */
const GUTTER = "  ";

/** Retrait du contenu d'une section, sous son titre. */
const ITEM = "    ";

/** Largeur de la colonne des libellés (« Processus » + air). */
const LABEL_WIDTH = 12;

/** Le jeu de caractères de l'écran — cf `resolveBrandCharset`, la règle du logo. */
export type ScreenCharset = "unicode" | "ascii";

/** Les symboles qui portent le sens à la place de la couleur. */
export interface IScreenSymbols {
  ok: string;
  fail: string;
  warn: string;
  info: string;
  open: string;
  fix: string;
  reload: string;
  brand: string;
}

/**
 * Les symboles, par jeu de caractères. La console Windows classique (police
 * Consolas, hors Windows Terminal) n'a ni `✓` ni `⚠` : elle afficherait des
 * carrés, et le sens — que la couleur ne porte JAMAIS seule — serait perdu.
 * Le choix ne se déduit pas ici : il suit la règle du logo, une seule.
 */
export const SCREEN_SYMBOLS: Record<ScreenCharset, IScreenSymbols> = {
  unicode: {
    ok: "✓",
    fail: "✗",
    warn: "⚠",
    info: "ℹ",
    open: "➜",
    fix: "→",
    reload: "↻",
    brand: "⬢",
  },
  ascii: {
    ok: "v",
    fail: "x",
    warn: "!",
    info: "i",
    open: ">",
    fix: "->",
    reload: "~",
    brand: "*",
  },
};

/** Symbole d'une gravité. */
function levelSymbol(level: BootNoticeLevel, sym: IScreenSymbols): string {
  return level === "error"
    ? sym.fail
    : level === "warning"
      ? sym.warn
      : sym.info;
}

/** Mot-clé du rendu machine pour une gravité. */
const PLAIN_LEVEL: Record<BootNoticeLevel, string> = {
  error: "error",
  warning: "warn",
  info: "info",
};

/**
 * Le terminal rend-il les hyperliens OSC 8 ?
 *
 * Cette capacité ne se SONDE pas : aucun terminal ne répond à une question sur
 * OSC 8. Le seul fait disponible est l'identité que le terminal DÉCLARE lui-même
 * dans l'environnement — on n'active donc que ceux qui la déclarent et rendent
 * ces liens, et `FORCE_HYPERLINK` (convention répandue) tranche dans les deux
 * sens. Hors terminal : jamais.
 *
 * @param env - l'environnement, injecté.
 * @param isTerminal - `stdout` est-il un terminal ?
 * @returns `true` s'il faut émettre des hyperliens.
 */
export function supportsHyperlinks(
  env: Readonly<Record<string, string | undefined>>,
  isTerminal: boolean,
): boolean {
  const forced = env.FORCE_HYPERLINK;
  if (forced !== undefined && forced !== "") return forced !== "0";
  if (!isTerminal) return false;
  if (env.WT_SESSION) return true; // Windows Terminal
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return true;
  if (env.KONSOLE_VERSION) return true;
  if (Number(env.VTE_VERSION ?? 0) >= 5000) return true; // GNOME Terminal & co
  return HYPERLINK_TERMINALS.has(env.TERM_PROGRAM ?? "");
}

/** Terminaux qui se déclarent par `TERM_PROGRAM` et rendent les liens OSC 8. */
const HYPERLINK_TERMINALS: ReadonlySet<string> = new Set([
  "iTerm.app",
  "WezTerm",
  "vscode",
  "ghostty",
]);

/** Ce que le frontend a servi, tel que le bilan le résume. */
export interface IStartupFrontend {
  /** Bundles déclarés. */
  bundles: number;
  /** Instances du serveur d'assets réellement prêtes (0 = échec total). */
  ready: number;
  /** Noms des bundles. */
  names: string[];
  /** Détail par instance (`react, vue · Vite interne :5173`) — ports INTERNES. */
  detail: string[];
}

/**
 * Le bilan de démarrage, prêt à rendre — la forme du rendu `json`.
 *
 * Construit par {@link buildStartupView} ; chaque champ est un FAIT, jamais un
 * texte mis en forme pour un rendu particulier (sauf les lignes de détail, que
 * leurs modules écrivent déjà lisibles).
 */
export interface IStartupView {
  /** Version du schéma ({@link STARTUP_SCHEMA_VERSION}). */
  schema: number;
  /** Les serveurs attendus écoutent-ils ? */
  ready: boolean;
  /** Durée du démarrage, en millisecondes. */
  durationMs: number;
  /** Version de Nodefony. */
  version: string;
  /** Environnement d'exécution. */
  environment: string;
  /** Adresses à ouvrir. */
  open: IBootLink[];
  /** Points d'attention, triés. */
  notices: IBootNotice[];
  /** Serveurs en écoute (adresses de LIAISON, pas d'ouverture). */
  listening: IBootServerInfo[];
  /** Frontend servi — `null` sans frontend. */
  frontend: IStartupFrontend | null;
  /** Composition du démarrage. */
  modules: {
    loaded: number;
    gated: IBootModuleGated[];
    failed: number;
  };
  /** Journal du démarrage. */
  journal: { warnings: number; errors: number; criticals: string[] };
  /** Connexions de données (`default → sqlite var/app.db`), chemins relatifs. */
  data: string[];
  /** Processus du projet — `null` quand l'observation n'a pas pu être menée. */
  processes: DevProcessInfo[] | null;
  /** Zones du pare-feu — `null` sans pare-feu. */
  firewall: IFirewallZoneView[] | null;
  /** Rechargement automatique (superviseur), ou `--no-watch`. */
  supervised: boolean;
  /** URL du débogueur ouvert dans le serveur (`ws://127.0.0.1:9229/…`), ou `null`. */
  inspector: string | null;
}

/** Ce que le rapport de boot ne porte pas, et que l'appelant observe. */
export interface IStartupExtras {
  /** Version de Nodefony. */
  version: string;
  /** Environnement d'exécution. */
  environment: string;
  /** Racine du projet — les chemins des détails lui deviennent relatifs. */
  root: string;
  /** Frontend servi, ou `null`. */
  frontend: IStartupFrontend | null;
  /** Lignes de détail des connexions de données. */
  data: readonly string[];
  /** Processus observés, ou `null`. */
  processes: readonly DevProcessInfo[] | null;
  /** Zones du pare-feu, ou `null`. */
  firewall: readonly IFirewallZoneView[] | null;
  /** Rechargement automatique (superviseur), ou `--no-watch`. */
  supervised: boolean;
  /** URL du débogueur, ou `null`. */
  inspector: string | null;
}

/**
 * Rend un chemin absolu RELATIF au projet, dans une ligne de texte.
 *
 * Les deux séparateurs sont essayés : la racine est native, mais une ligne
 * peut avoir été composée avec des `/` (axiome 2 — normaliser avant de
 * comparer).
 *
 * @param line - la ligne.
 * @param root - racine absolue du projet.
 * @returns la ligne, racine retirée.
 */
export function relativizeLine(line: string, root: string): string {
  if (!root) return line;
  const forward = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const native = root.replace(/[\\/]+$/, "");
  return line
    .split(`${native}\\`)
    .join("")
    .split(`${native}/`)
    .join("")
    .split(`${forward}/`)
    .join("");
}

/**
 * Bâtit le bilan à rendre depuis le rapport de boot et ce que l'appelant observe.
 *
 * @param report - le rapport de boot (vérité unique du noyau).
 * @param extras - les faits observés hors du rapport.
 * @returns le bilan.
 */
export function buildStartupView(
  report: IBootReport,
  extras: IStartupExtras,
): IStartupView {
  const rel = (line: string): string => relativizeLine(line, extras.root);
  return {
    schema: STARTUP_SCHEMA_VERSION,
    ready: report.healthy,
    durationMs: report.durationMs,
    version: extras.version,
    environment: extras.environment,
    open: report.open,
    notices: report.notices.map((n) => ({
      ...n,
      message: rel(n.message),
      fix: n.fix === undefined ? undefined : rel(n.fix),
    })),
    listening: report.serversListening,
    frontend: extras.frontend
      ? { ...extras.frontend, detail: extras.frontend.detail.map(rel) }
      : null,
    modules: {
      loaded: report.modulesLoaded.length,
      gated: report.modulesGated,
      failed: report.modulesSkipped.length,
    },
    journal: {
      warnings: report.warnings,
      errors: report.errors,
      criticals: report.criticals ?? [],
    },
    data: extras.data.map(rel),
    processes: extras.processes ? [...extras.processes] : null,
    firewall: extras.firewall ? [...extras.firewall] : null,
    supervised: extras.supervised,
    inspector: extras.inspector,
  };
}

/**
 * Une durée au format français : « 850 ms », « 6,8 s ».
 *
 * @param ms - la durée en millisecondes.
 * @returns la durée lisible.
 */
export function formatSeconds(ms: number): string {
  if (ms < 1000) return `${Math.round(Math.max(0, ms))} ms`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/**
 * Coupe un texte trop long AU MILIEU — le début et la fin d'un chemin portent
 * l'information (la racine et le fichier), le milieu se devine.
 *
 * @param text - le texte.
 * @param max - longueur maximale.
 * @returns le texte, raccourci si besoin (`var/…/app.db`).
 */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max || max < 5) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Les options d'un rendu humain — toutes CONSTATÉES par l'appelant. */
export interface IHumanRenderOptions {
  /** Émettre des couleurs (`shouldColorize`). */
  color: boolean;
  /** Émettre des hyperliens OSC 8 ({@link supportsHyperlinks}). */
  hyperlinks: boolean;
  /** Largeur annoncée par le terminal, ou `undefined`. */
  columns: number | undefined;
  /** Rechargement à chaud : les processus n'ont pas été relevés. */
  reload?: boolean;
  /** Jeu de caractères (défaut `unicode`) — cf {@link SCREEN_SYMBOLS}. */
  charset?: ScreenCharset;
}

/**
 * Un lien cliquable OSC 8 — le texte affiché reste l'URL, pour qu'un terminal
 * qui ne rend pas le lien montre quand même l'adresse.
 *
 * @param url - la cible.
 * @returns la séquence.
 */
function osc8(url: string): string {
  return `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
}

/** Le mode de démarrage, en clair : environnement et rechargement. */
function startMode(view: IStartupView): string {
  return `${view.environment} · ${view.supervised ? "rechargement auto" : "sans rechargement (--no-watch)"}`;
}

/**
 * L'adresse WebSocket à OUVRIR (`wss://localhost:5152`) — WSS d'abord, repli
 * WS ; même règle d'hôte que les liens (`openableHost`).
 *
 * @param view - le bilan.
 * @returns l'adresse, ou `null` sans serveur WebSocket.
 */
export function websocketUrl(view: IStartupView): string | null {
  const ws =
    view.listening.find((s) => s.scheme === "wss") ??
    view.listening.find((s) => s.scheme === "ws");
  return ws ? `${ws.scheme}://${openableHost(ws.address)}:${ws.port}` : null;
}

/** `ws://127.0.0.1:9229/<id>` → `127.0.0.1:9229` — ce qu'on tape pour s'y attacher. */
function inspectorHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Libellés des serveurs, par schéma — l'ordre est celui de l'affichage. */
const SCHEME_LABEL: ReadonlyArray<readonly [string, string]> = [
  ["http", "HTTP"],
  ["ws", "WS"],
  ["https", "HTTP/2"],
  ["wss", "WSS"],
];

/**
 * Regroupe les serveurs par adresse de liaison : HTTP et WS partagent un port.
 *
 * @param servers - serveurs en écoute.
 * @returns `HTTP + WS 127.0.0.1:5151`, une entrée par adresse.
 */
function listenGroups(servers: readonly IBootServerInfo[]): string[] {
  const groups = new Map<string, string[]>();
  for (const [scheme, label] of SCHEME_LABEL) {
    for (const s of servers.filter((x) => x.scheme === scheme)) {
      const at = `${s.address ?? "127.0.0.1"}:${s.port}`;
      const labels = groups.get(at);
      if (labels) labels.push(label);
      else groups.set(at, [label]);
    }
  }
  return [...groups].map(([at, labels]) => `${labels.join(" + ")} ${at}`);
}

/**
 * Modules écartés par le gating, regroupés par raison.
 *
 * @param gated - modules écartés.
 * @returns `mongoose, redis (condition non remplie)`.
 */
function gatedSummary(gated: readonly IBootModuleGated[]): string {
  const byReason = new Map<string, string[]>();
  for (const g of gated) {
    const names = byReason.get(g.reason);
    if (names) names.push(shortModule(g.module));
    else byReason.set(g.reason, [shortModule(g.module)]);
  }
  return [...byReason]
    .map(([reason, names]) => `${names.join(", ")} (${reason})`)
    .join(" · ");
}

/** Décompte des processus par rôle : `1 superviseur · 1 serveur · 3 Vite`. */
function processSummary(processes: readonly DevProcessInfo[]): string {
  const roles: ReadonlyArray<readonly [string, string]> = [
    ["supervisor", "superviseur"],
    ["master", "master"],
    ["server", "serveur"],
    ["worker", "worker"],
    ["vite", "Vite"],
  ];
  const parts: string[] = [];
  for (const [role, label] of roles) {
    const n = processes.filter((p) => p.role === role).length;
    if (n) parts.push(`${n} ${label}${n > 1 && role !== "vite" ? "s" : ""}`);
  }
  return parts.join(" · ");
}

/** Synthèse du pare-feu : zones applicatives, ou le constat qu'il n'y en a pas. */
function firewallSummary(zones: readonly IFirewallZoneView[]): string {
  const app = zones.filter((z) => !isFrameworkZone(z)).length;
  const framework = zones.length - app;
  // Le constat « routes métier publiques » est un point d'attention, en haut :
  // le détail décrit, il ne le répète pas.
  if (!app)
    return `${pluralize(framework, "aire")} framework, aucune zone applicative`;
  const s = app > 1 ? "s" : "";
  return (
    `${app} zone${s} applicative${s}` +
    (framework ? ` · ${pluralize(framework, "aire")} framework` : "")
  );
}

/** Le verdict, en tête : prêt, prêt mais bloqué, ou échec. */
function verdict(view: IStartupView, p: IPalette, sym: IScreenSymbols): string {
  const took = formatSeconds(view.durationMs);
  const identity = p.dim(` — Nodefony ${view.version} · ${view.environment}`);
  if (!view.ready) {
    return (
      `${GUTTER}${p.failure(p.strong(`${sym.fail}  Aucun serveur n'a démarré`))}` +
      p.dim(` en ${took} — le processus va s'arrêter`)
    );
  }
  const blocking = view.notices.filter((n) => n.level === "error").length;
  if (blocking) {
    return (
      `${GUTTER}${p.failure(p.strong(`${sym.fail}  Démarré`))} ${p.dim(`en ${took},`)} ` +
      p.failure(
        blocking > 1
          ? `mais ${blocking} points bloquent`
          : "mais un point bloque",
      ) +
      identity
    );
  }
  return `${GUTTER}${p.ok(p.strong(`${sym.ok}  Prêt`))} ${p.dim(`en ${took}`)}${identity}`;
}

/** Un titre de section, à la manière du menu : MAJUSCULES, gras estompé. */
function sectionTitle(title: string, p: IPalette): string {
  return `${GUTTER}${p.strong(p.dim(title.toUpperCase()))}`;
}

/**
 * Les lignes d'un point d'attention : le constat (replié), puis le geste.
 *
 * Le geste n'est JAMAIS replié : c'est une commande ou une configuration à
 * coller, et un saut de ligne inséré la casserait. Un terminal étroit le
 * replie visuellement, le collage reste entier.
 */
function noticeLines(
  notice: IBootNotice,
  width: number,
  p: IPalette,
  sym: IScreenSymbols,
): string[] {
  const paint =
    notice.level === "error"
      ? p.failure
      : notice.level === "warning"
        ? p.warning
        : p.action;
  const pad = `${ITEM}   `;
  const body = wrap(notice.message, width, pad).map((l) => l.slice(pad.length));
  const lines = [
    `${ITEM}${paint(levelSymbol(notice.level, sym))}  ${body[0] ?? ""}`,
    ...body.slice(1).map((l) => `${pad}${l}`),
  ];
  if (notice.fix) lines.push(`${pad}${p.action(`${sym.fix} ${notice.fix}`)}`);
  return lines;
}

/** La colonne des valeurs, sous les libellés. */
const VALUE_PAD = " ".repeat(GUTTER.length + 2 + LABEL_WIDTH);

/** Un libellé de fait, en cyan comme les entrées du menu. */
function labelCell(text: string, p: IPalette): string {
  return `${ITEM}${p.action(text.padEnd(LABEL_WIDTH))}`;
}

/**
 * Une ligne de fait `Libellé    valeur`, repliée sous la colonne des valeurs.
 */
function factLines(
  name: string,
  value: string,
  width: number,
  p: IPalette,
): string[] {
  const body = wrap(value, width, VALUE_PAD).map((l) =>
    l.slice(VALUE_PAD.length),
  );
  return [
    `${labelCell(name, p)}${body[0] ?? ""}`,
    ...body.slice(1).map((l) => `${VALUE_PAD}${l}`),
  ];
}

/**
 * Lignes multiples sous un même libellé (détail). Chaque valeur se REPLIE —
 * couper une liste perdrait un nom ; seul un mot plus long que la colonne
 * (un chemin) se coupe, au milieu.
 */
function detailLines(
  name: string,
  values: readonly string[],
  width: number,
  p: IPalette,
): string[] {
  const max = width - VALUE_PAD.length;
  const out: string[] = [];
  for (const value of values) {
    // La queue après le dernier « · » est une qualification (`Vite interne
    // :5173`) : elle reste d'un seul tenant, jamais coupée de son port.
    const cut = value.lastIndexOf(" · ");
    const head = cut === -1 ? value : value.slice(0, cut);
    const tail = cut === -1 ? "" : value.slice(cut);
    const lines = wrap(head, width, VALUE_PAD).map((l) =>
      truncateMiddle(l.slice(VALUE_PAD.length), max),
    );
    const last = lines.length - 1;
    if (tail && (lines[last] ?? "").length + tail.length <= max) {
      lines[last] = `${lines[last] ?? ""}${p.dim(tail)}`;
    } else if (tail) {
      // Sur sa propre ligne, sans le séparateur : un « · » en tête de ligne
      // se lit comme une puce.
      lines.push(p.dim(truncateMiddle(tail.slice(" · ".length), max)));
    }
    for (const body of lines) {
      out.push(`${out.length === 0 ? labelCell(name, p) : VALUE_PAD}${body}`);
    }
  }
  return out;
}

/**
 * Une énumération sous un libellé — repliée ENTRE deux éléments, jamais au
 * milieu d'un nom ni avec un « · » en tête de ligne.
 */
function factListLines(
  name: string,
  head: string,
  items: readonly string[],
  width: number,
  p: IPalette,
): string[] {
  if (!items.length) return factLines(name, head, width, p);
  const units = [`${head} — ${items[0]}`, ...items.slice(1)];
  return wrapList(units, width - VALUE_PAD.length).map(
    (line, i) => `${i === 0 ? labelCell(name, p) : VALUE_PAD}${line}`,
  );
}

/** Nom court d'un module à l'écran : le préfixe du framework n'apprend rien. */
const shortModule = (name: string): string => name.replace(/^@nodefony\//, "");

/**
 * Les noms des sections que l'écran humain produit pour ce bilan, dans
 * l'ordre — la liste qu'un test compare pour garantir que rien ne se perd.
 *
 * @param view - le bilan.
 * @returns les titres de section présents.
 */
export function startupSections(view: IStartupView): string[] {
  const sections = ["verdict"];
  if (view.open.length) sections.push("open");
  if (view.notices.length) sections.push("notices");
  if (view.listening.length) sections.push("listen");
  if (view.frontend) sections.push("frontend");
  sections.push("modules", "journal");
  if (view.data.length) sections.push("detail.data");
  if (view.frontend?.detail.length) sections.push("detail.frontend");
  if (view.processes?.length) sections.push("detail.processes");
  if (view.firewall) sections.push("detail.firewall");
  sections.push("footer");
  return sections;
}

/**
 * L'écran de démarrage pour un humain : verdict → Ouvrir → À regarder → État
 * → Détail → où lire la suite. Même grammaire visuelle que le menu de
 * `nodefony` : titres en MAJUSCULES estompées, libellés en cyan alignés, une
 * ligne vide entre chaque bloc.
 *
 * L'actionnable en haut, le détail en bas — rien n'est retiré de ce qu'on
 * montrait, seul l'ordre change. Les ports internes du serveur d'assets
 * restent dans le détail, marqués comme tels, jamais comme une adresse.
 *
 * @param view - le bilan.
 * @param options - capacités constatées du terminal.
 * @returns les lignes, sans retour chariot final.
 */
export function renderStartupHuman(
  view: IStartupView,
  options: IHumanRenderOptions,
): string[] {
  const p = createPalette(options.color);
  const sym = SCREEN_SYMBOLS[options.charset ?? "unicode"];
  const width = Math.min(SCREEN_MAX_WIDTH, usableWidth(options.columns));
  // Les tableaux partagés avec `nodefony status` portent leurs propres
  // couleurs : sans couleur, on les retire à la sortie plutôt que de dupliquer
  // le gabarit.
  const table = (lines: string[]): string[] =>
    options.color ? lines : lines.map((l) => stripVTControlCharacters(l));
  const link = (url: string): string =>
    p.action(options.hyperlinks ? osc8(url) : url);
  const out: string[] = [verdict(view, p, sym)];

  if (view.open.length) {
    const w = Math.max(...view.open.map((l) => l.label.length)) + 3;
    out.push("", sectionTitle("Ouvrir", p));
    for (const l of view.open) {
      out.push(
        `${ITEM}${p.ok(sym.open)}  ${p.strong(l.label.padEnd(w))}${link(l.url)}`,
      );
    }
  }

  if (view.notices.length) {
    out.push("", sectionTitle(`À regarder (${view.notices.length})`, p));
    view.notices.forEach((n, i) => {
      if (i > 0) out.push("");
      out.push(...noticeLines(n, width, p, sym));
    });
  }

  out.push("", sectionTitle("État", p));
  out.push(...factLines("Mode", startMode(view), width, p));
  if (view.inspector) {
    out.push(
      ...factLines(
        "Débogueur",
        `${inspectorHost(view.inspector)} ${p.dim("— chrome://inspect, ou « Attach » dans l'éditeur")}`,
        width,
        p,
      ),
    );
  }
  if (view.listening.length) {
    out.push(
      ...factLines(
        "Écoute",
        listenGroups(view.listening).join(" · "),
        width,
        p,
      ),
    );
  }
  if (view.frontend) {
    const f = view.frontend;
    out.push(
      ...(f.ready > 0
        ? factListLines(
            "Frontend",
            `${pluralize(f.bundles, "bundle")} servi${f.bundles > 1 ? "s" : ""} par Nodefony, HMR compris`,
            f.names,
            width,
            p,
          )
        : factLines(
            "Frontend",
            p.failure(
              `${sym.fail} aucune instance Vite prête — aucun bundle servi`,
            ),
            width,
            p,
          )),
    );
  }
  const m = view.modules;
  let modules = `${m.loaded} chargé${m.loaded > 1 ? "s" : ""}`;
  if (m.gated.length) {
    modules += ` · ${m.gated.length} ignoré${m.gated.length > 1 ? "s" : ""} : ${gatedSummary(m.gated)}`;
  }
  if (m.failed) modules += ` · ${p.failure(`${m.failed} en échec`)}`;
  out.push(...factLines("Modules", modules, width, p));
  const j = view.journal;
  out.push(
    ...factLines(
      "Journal",
      !j.warnings && !j.errors
        ? p.ok("aucun warning")
        : [
            j.errors ? p.failure(pluralize(j.errors, "ERROR", "ERROR")) : "",
            j.warnings
              ? p.warning(pluralize(j.warnings, "WARNING", "WARNING"))
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
      width,
      p,
    ),
  );
  for (const c of j.criticals) {
    out.push(
      `${VALUE_PAD}${p.dim(`· ${truncateMiddle(c, width - VALUE_PAD.length - 2)}`)}`,
    );
  }
  // Le geste qui montre tout, sur sa propre ligne : collé au compte, il se
  // coupait en deux au repli (« (détail : » / « --debug) »).
  if (j.warnings || j.errors) {
    out.push(`${VALUE_PAD}${p.dim("détail : nodefony development --debug")}`);
  }

  // Le détail : un sous-bloc par sujet, séparés par une ligne vide.
  const blocks: string[][] = [];
  if (view.data.length)
    blocks.push(detailLines("Données", view.data, width, p));
  if (view.frontend?.detail.length) {
    blocks.push(detailLines("Frontend", view.frontend.detail, width, p));
  }
  if (view.processes === null && options.reload) {
    // Relever les processus coûte un `lsof` par processus hors Linux (plus
    // d'une seconde) : pas à chaque sauvegarde. On le DIT, avec où le lire.
    blocks.push(
      factLines(
        "Processus",
        p.dim("non relevés au rechargement — nodefony status"),
        width,
        p,
      ),
    );
  }
  if (view.processes?.length) {
    const lines: string[] = [];
    renderProcessTable(lines, view.processes, ITEM);
    blocks.push([
      ...factLines("Processus", processSummary(view.processes), width, p),
      ...table(lines),
    ]);
  }
  if (view.firewall) {
    const block = factLines(
      "Pare-feu",
      firewallSummary(view.firewall),
      width,
      p,
    );
    if (view.firewall.length) {
      const lines: string[] = [];
      renderZoneTable(lines, view.firewall, ITEM);
      block.push(...table(lines));
    }
    blocks.push(block);
  }
  if (blocks.length) {
    out.push("", sectionTitle("Détail", p));
    blocks.forEach((block, i) => {
      if (i > 0) out.push("");
      out.push(...block);
    });
  }

  out.push(
    "",
    `${GUTTER}${p.dim("état machine : nodefony status --json · diagnostic : nodefony doctor")}`,
  );
  return out;
}

/** Ce que la ligne d'état sait, en plus du bilan. */
export interface IStatusContext {
  /** Nom du projet. */
  project: string;
  /** Heure à laquelle le serveur est devenu prêt (`16:48`). */
  readyAt: string;
  /** Numéro du rechargement à chaud — `0` au premier démarrage. */
  reloads: number;
}

/** Un morceau de la ligne d'état, et sa priorité quand la place manque. */
interface IStatusSegment {
  text: string;
  /** Plus haute = gardée le plus longtemps. */
  priority: number;
}

/**
 * La ligne d'état figée en bas du terminal : qui tourne, où l'ouvrir, dans
 * quel état, depuis quand — ce qu'on veut lire sans remonter — et, à droite,
 * le geste pour arrêter.
 *
 * Elle S'ADAPTE à la largeur : quand la place manque, les morceaux les moins
 * utiles tombent d'abord (l'aide, le compte des rechargements, la version) ;
 * l'état et l'adresse restent jusqu'au bout. Jamais repliée : une ligne
 * d'état sur deux lignes ne s'effacerait plus d'un seul geste.
 *
 * @param view - le bilan.
 * @param ctx - projet, heure, rechargements.
 * @param options - couleur, largeur, jeu de caractères.
 * @returns la ligne, sans retour chariot.
 */
export function renderStatusLine(
  view: IStartupView,
  ctx: IStatusContext,
  options: {
    color: boolean;
    columns: number | undefined;
    charset?: ScreenCharset;
  },
): string {
  const p = createPalette(options.color);
  const sym = SCREEN_SYMBOLS[options.charset ?? "unicode"];
  const errors = view.notices.filter((n) => n.level === "error").length;
  const warnings = view.notices.filter((n) => n.level === "warning").length;
  const state = errors
    ? p.failure(
        `${sym.fail} ${pluralize(errors, "point")} bloquant${errors > 1 ? "s" : ""}`,
      )
    : warnings
      ? p.warning(`${sym.warn} ${warnings} à regarder`)
      : p.ok(`${sym.ok} prêt`);
  const app = view.open.find((l) => l.id === "app")?.url;
  const ws = websocketUrl(view);
  const segments: IStatusSegment[] = [
    {
      text: p.dim(
        `Nodefony ${view.version} · ${view.environment}` +
          (view.supervised ? "" : " · sans rechargement"),
      ),
      priority: 2,
    },
    ...(app
      ? [{ text: `${p.ok(sym.open)} ${p.action(app)}`, priority: 5 }]
      : []),
    // Le débogueur passe juste après l'état : c'est pour lui qu'on a lancé
    // `nodefony debug`, et son annonce par Node a défilé.
    ...(view.inspector
      ? [
          {
            text: p.warning(`débogueur ${inspectorHost(view.inspector)}`),
            priority: 5.5,
          },
        ]
      : []),
    ...(ws ? [{ text: p.dim(`WS ${ws}`), priority: 3 }] : []),
    { text: `${state} ${p.dim(`à ${ctx.readyAt}`)}`, priority: 6 },
    ...(ctx.reloads > 0
      ? [{ text: p.dim(`${sym.reload} ${ctx.reloads}`), priority: 1 }]
      : []),
  ];
  const hint = p.dim("ctrl+c arrêter");
  const width = Math.max(10, (options.columns ?? 80) - 1);
  const sep = p.dim("  ·  ");
  const visible = (t: string): number => stripVTControlCharacters(t).length;
  // Le BADGE de gauche, en vidéo inverse : c'est lui qui dit, au premier coup
  // d'œil, « ceci est la barre de Nodefony, pas une ligne du journal ». La
  // vidéo inverse prend les couleurs du thème du terminal (clair comme
  // sombre) et se rend partout, émulation libuv de Windows comprise. Jamais
  // retiré faute de place : c'est l'identité de la barre.
  const label = ` ${sym.brand} ${ctx.project} `;
  const badge = options.color ? `\x1b[7m\x1b[1m${label}\x1b[0m` : label;
  const kept = [...segments];
  const lineOf = (parts: IStatusSegment[]): string =>
    `${badge} ${parts.map((x) => x.text).join(sep)}`;
  // Retire le moins utile tant que ça ne tient pas.
  while (kept.length > 0 && visible(lineOf(kept)) > width) {
    const lowest = kept.reduce((a, b) => (b.priority < a.priority ? b : a));
    kept.splice(kept.indexOf(lowest), 1);
  }
  const line = lineOf(kept);
  // L'aide à droite, s'il reste de la place.
  const gap = width - visible(line) - visible(hint);
  return gap >= 3 ? `${line}${" ".repeat(gap)}${hint}` : line;
}

/** Largeur minimale pour le bloc d'état avec le logo — en deçà, une ligne. */
const STATUS_BLOCK_MIN_COLUMNS = 72;

/** Hauteur minimale du terminal pour le bloc d'état — en deçà, une ligne. */
const STATUS_BLOCK_MIN_ROWS = 20;

/**
 * Le bloc d'état figé en bas du terminal : un filet qui le sépare du journal,
 * puis la MARQUE du logo à gauche (6 lignes) et une information par ligne à
 * droite — ce qu'on veut lire sans
 * remonter : qui tourne et dans quel mode, où l'ouvrir, la WebSocket, l'état,
 * le débogueur ou les points à regarder, et le geste pour arrêter.
 *
 * Le logo fait du bloc quelque chose qu'on ne confond pas avec une ligne du
 * journal. Trop étroit ou trop bas pour lui, le terminal reçoit la ligne
 * unique de {@link renderStatusLine} : `null` le signale.
 *
 * @param view - le bilan.
 * @param ctx - projet, heure, rechargements.
 * @param options - couleur, largeur, hauteur, jeu de caractères.
 * @param mark - les 6 lignes de la marque (`brandMark`), largeur visible 8.
 * @returns les lignes du bloc, ou `null` si la place manque.
 */
export function renderStatusBlock(
  view: IStartupView,
  ctx: IStatusContext,
  options: {
    color: boolean;
    columns: number | undefined;
    rows: number | undefined;
    charset?: ScreenCharset;
  },
  mark: readonly string[],
): string[] | null {
  const columns = options.columns ?? 0;
  if (columns < STATUS_BLOCK_MIN_COLUMNS) return null;
  if ((options.rows ?? 0) < STATUS_BLOCK_MIN_ROWS) return null;
  const p = createPalette(options.color);
  const sym = SCREEN_SYMBOLS[options.charset ?? "unicode"];
  const errors = view.notices.filter((n) => n.level === "error").length;
  const warnings = view.notices.filter((n) => n.level === "warning").length;
  const state = errors
    ? p.failure(
        `${sym.fail} ${pluralize(errors, "point")} bloquant${errors > 1 ? "s" : ""}`,
      )
    : warnings
      ? p.warning(`${sym.warn} ${warnings} à regarder`)
      : p.ok(`${sym.ok} prêt`);
  const label = ` ${sym.brand} ${ctx.project} `;
  const badge = options.color ? `\x1b[7m\x1b[1m${label}\x1b[0m` : label;
  const app = view.open.find((l) => l.id === "app")?.url;
  const ws = websocketUrl(view);
  const pending = view.notices.map((n) => n.code).join(" · ");
  const info = [
    `${badge}  ${p.dim(`Nodefony ${view.version} · ${startMode(view)}`)}`,
    app ? `${p.ok(sym.open)} ${p.action(app)}` : "",
    ws ? p.dim(`WS  ${ws}`) : "",
    `${state} ${p.dim(`à ${ctx.readyAt}`)}` +
      (ctx.reloads > 0 ? p.dim(`  ·  ${sym.reload} ${ctx.reloads}`) : ""),
    view.inspector
      ? p.warning(
          `débogueur ${inspectorHost(view.inspector)} — chrome://inspect`,
        )
      : pending
        ? p.dim(pending)
        : "",
    p.dim("ctrl+c arrêter  ·  état : nodefony status --json"),
  ];
  // Chaque ligne bornée à la place qui reste à droite du logo : une ligne
  // repliée décalerait tout le bloc, et l'effacement en remontant raterait.
  const room = columns - 1 - 8 - 3;
  return [
    statusRule(columns, p),
    ...mark.map((logo, i) => {
      const text = info[i] ?? "";
      return text ? `${logo}   ${fitStatus(text, room + 1)}` : logo;
    }),
  ];
}

/**
 * Le filet qui ouvre la barre d'état, sur toute la largeur : sans lui, la
 * dernière ligne du JOURNAL — souvent repliée par le terminal quand elle est
 * plus longue que la fenêtre — se lisait comme une ligne de la barre.
 *
 * @param columns - largeur du terminal.
 * @param p - la palette.
 * @returns le filet, estompé (`─` est dans la police des consoles Windows).
 */
export function statusRule(columns: number | undefined, p: IPalette): string {
  return p.dim("─".repeat(Math.max(10, (columns ?? 80) - 1)));
}

/** Un point d'attention en une ligne machine. */
function plainNotice(n: IBootNotice): string {
  return (
    `${PLAIN_LEVEL[n.level]} ${n.code}: ${n.message}` +
    (n.fix ? ` — fix: ${n.fix}` : "")
  );
}

/** Une durée en secondes, point décimal (rendu machine). */
function plainSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** Retire toute séquence de contrôle d'une valeur — le rendu machine n'en porte aucune. */
const bare = (text: string): string => stripVTControlCharacters(text);

/**
 * Le bilan pour une machine : une ligne par fait, clé en anglais, message en
 * français, zéro séquence ANSI, zéro animation.
 *
 * Les clés et les codes sont STABLES — c'est sur eux qu'un agent ou un script
 * s'appuie ; les messages peuvent être reformulés.
 *
 * @param view - le bilan.
 * @returns les lignes, sans retour chariot final.
 */
export function renderStartupPlain(view: IStartupView): string[] {
  const out: string[] = [];
  const identity = `version=${view.version} env=${view.environment}`;
  const took = plainSeconds(view.durationMs);
  const blocking = view.notices.filter((n) => n.level === "error").length;
  out.push(
    !view.ready
      ? `nodefony: failed ${took} reason=no-server ${identity}`
      : blocking
        ? `nodefony: started ${took} blocking=${blocking} ${identity}`
        : `nodefony: ready ${took} ${identity}`,
  );
  for (const l of view.open) out.push(`open.${l.id}: ${l.url}`);
  const ws = websocketUrl(view);
  if (ws) out.push(`open.websocket: ${ws}`);
  if (view.inspector) out.push(`inspector: ${view.inspector}`);
  out.push(
    `mode: env=${view.environment} watch=${view.supervised ? "on" : "off"}`,
  );
  for (const n of view.notices) out.push(plainNotice(n));
  for (const s of view.listening) {
    out.push(`listen.${s.scheme}: ${s.address ?? "127.0.0.1"}:${s.port}`);
  }
  if (view.frontend) {
    const f = view.frontend;
    out.push(
      // `vite_ready` compte des INSTANCES Vite, pas des bundles : une
      // instance en sert plusieurs.
      `frontend: bundles=${f.bundles} vite_ready=${f.ready}` +
        (f.names.length ? ` names=${f.names.join(",")}` : ""),
    );
    for (const d of f.detail) out.push(`frontend.detail: ${d}`);
  }
  out.push(
    `modules: loaded=${view.modules.loaded} gated=${view.modules.gated.length} failed=${view.modules.failed}`,
  );
  for (const g of view.modules.gated) {
    out.push(`modules.gated: ${g.module} — ${g.reason}`);
  }
  out.push(
    `journal: warnings=${view.journal.warnings} errors=${view.journal.errors}`,
  );
  for (const c of view.journal.criticals) out.push(`journal.error: ${c}`);
  for (const d of view.data) out.push(`data: ${d}`);
  for (const proc of view.processes ?? []) {
    out.push(
      `process: role=${proc.role} pid=${proc.pid} ppid=${proc.ppid} uptime=${proc.uptimeSec}s rss=${proc.rssKb}kB cpu=${proc.cpu.toFixed(1)}`,
    );
  }
  for (const z of view.firewall ?? []) {
    const access =
      z.security === false
        ? "public"
        : z.allowsAnonymous || (z.authenticators ?? []).includes("anonymous")
          ? "anonymous"
          : "protected";
    out.push(
      `firewall: zone=${z.name} module=${isFrameworkZone(z) ? "framework" : "app"} ` +
        `pattern=${cleanZonePattern(z.pattern)} auth=${(z.authenticators ?? []).join(",") || "-"} access=${access}`,
    );
  }
  out.push("state: nodefony status --json · var/last-boot.json");
  return out.map(bare);
}

/** Ce qu'un rechargement a changé par rapport au démarrage précédent. */
export interface IReloadDiff {
  /** Points apparus. */
  added: IBootNotice[];
  /** Points disparus — corrigés entre deux sauvegardes. */
  resolved: IBootNotice[];
  /** Les adresses à ouvrir ont-elles changé ? */
  openChanged: boolean;
}

/** Clé d'identité d'un point : même code ET même constat. */
const noticeKey = (n: IBootNotice): string => `${n.code}\u0000${n.message}`;

/**
 * Compare deux bilans successifs du même serveur.
 *
 * @param previous - ce que le démarrage précédent a déclaré (`var/last-boot.json`).
 * @param view - le bilan du rechargement.
 * @returns ce qui a changé.
 */
export function diffReload(
  previous: { open?: readonly IBootLink[]; notices?: readonly IBootNotice[] },
  view: IStartupView,
): IReloadDiff {
  const before = new Set((previous.notices ?? []).map(noticeKey));
  const after = new Set(view.notices.map(noticeKey));
  const urls = (links: readonly IBootLink[]): string =>
    links.map((l) => `${l.id}=${l.url}`).join(" ");
  return {
    added: view.notices.filter((n) => !before.has(noticeKey(n))),
    resolved: (previous.notices ?? []).filter((n) => !after.has(noticeKey(n))),
    openChanged: urls(previous.open ?? []) !== urls(view.open),
  };
}

/**
 * Le rechargement à chaud, en une ligne : ce qui a changé depuis le
 * démarrage précédent. Le bilan complet suit dessous ; ce bloc ne dit donc que
 * ce que le bilan ne peut pas dire — les points RÉSOLUS, qui n'y sont plus.
 *
 * @param diff - ce qui a changé ({@link diffReload}).
 * @param view - le bilan du rechargement.
 * @param options - capacités constatées du terminal.
 * @returns les lignes.
 */
export function renderReloadHuman(
  diff: IReloadDiff,
  view: IStartupView,
  options: IHumanRenderOptions,
): string[] {
  const p = createPalette(options.color);
  const sym = SCREEN_SYMBOLS[options.charset ?? "unicode"];
  const width = Math.min(SCREEN_MAX_WIDTH, usableWidth(options.columns));
  const changes: string[] = [];
  if (diff.added.length) {
    changes.push(
      `${diff.added.length} nouveau${diff.added.length > 1 ? "x" : ""} point${diff.added.length > 1 ? "s" : ""}`,
    );
  }
  if (diff.resolved.length) {
    changes.push(
      `${diff.resolved.length} résolu${diff.resolved.length > 1 ? "s" : ""}`,
    );
  }
  if (diff.openChanged) changes.push("adresses changées");
  const out = [
    `${GUTTER}${p.action(p.strong(`${sym.reload}  Rechargé`))} ${p.dim(`en ${formatSeconds(view.durationMs)} —`)} ` +
      (changes.length ? changes.join(" · ") : p.dim("rien de neuf")),
  ];
  // Les points APPARUS sont dans « À regarder », juste dessous : on ne les
  // répète pas. Ceux qui ont DISPARU n'y sont plus — c'est ici qu'on les dit.
  for (const n of diff.resolved) {
    out.push(
      `${ITEM}${p.ok(sym.ok)}  ${p.dim(`résolu : ${truncateMiddle(n.message, width - ITEM.length - 13)}`)}`,
    );
  }
  return out;
}

/**
 * Le rechargement pour une machine : une ligne d'événement, puis les points
 * apparus et résolus, et les adresses si elles ont changé.
 *
 * @param diff - ce qui a changé.
 * @param view - le bilan du rechargement.
 * @returns les lignes.
 */
export function renderReloadPlain(
  diff: IReloadDiff,
  view: IStartupView,
): string[] {
  const out = [
    `nodefony: reloaded ${plainSeconds(view.durationMs)} added=${diff.added.length} resolved=${diff.resolved.length}`,
  ];
  for (const n of diff.added) out.push(plainNotice(n));
  for (const n of diff.resolved) out.push(`resolved ${n.code}: ${n.message}`);
  if (diff.openChanged) {
    for (const l of view.open) out.push(`open.${l.id}: ${l.url}`);
  }
  return out.map(bare);
}
