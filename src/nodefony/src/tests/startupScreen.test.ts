/*
 *   L'écran de démarrage — un bilan, trois rendus (#533).
 *
 *   Ce que ces tests verrouillent :
 *   - l'ordre fixe de l'écran humain (verdict → Ouvrir → À regarder → faits →
 *     Détail → où lire la suite) et qu'AUCUNE information de l'ancien écran ne
 *     se perde (processus, pare-feu, données, journal, modules ignorés) ;
 *   - qu'un port INTERNE de Vite n'est jamais présenté comme une adresse à
 *     ouvrir — l'ancien écran le faisait, et c'est le premier lien qu'on cliquait ;
 *   - que le rendu machine ne porte aucune séquence ANSI ;
 *   - le choix du rendu : explicite d'abord, puis la capacité CONSTATÉE.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
import {
  buildStartupView,
  diffReload,
  formatSeconds,
  readOutputFlag,
  relativizeLine,
  renderReloadHuman,
  renderReloadPlain,
  renderStartupHuman,
  renderStartupPlain,
  renderActivity,
  SCREEN_SYMBOLS,
  renderStatusBlock,
  renderStatusLine,
  resolveOutputMode,
  startupSections,
  supportsHyperlinks,
  truncateMiddle,
  type IStartupExtras,
  type IStartupView,
} from "../service/dev/startupScreen";
import {
  CLEAR_SCREEN,
  RESET_SCREEN,
  devBuildIssueNotice,
  isDebugRequested,
} from "../service/dev/outputMode";
import {
  ERASE_LINE,
  StatusLine,
  eraseBlock,
  fitStatus,
  type IStatusStream,
} from "../service/dev/statusLine";
import { DEV_CHANNEL, isDevChannelMessage } from "../service/dev/devChannel";
import { visibleWidth } from "../runtime/textWidth";
import { brandMark } from "../cli/brand";
import { createPalette } from "../kernel/checks/report";
import {
  collectBootNotices,
  openableHost,
  resolveBootLinks,
  type IBootNotice,
  type IBootReport,
} from "../kernel/bootReport";
import type { DevProcessInfo } from "../service/dev/devProcess";

const ESC = "\x1b";

const notices: IBootNotice[] = [
  {
    code: "REALTIME_LOCAL_ONLY",
    level: "info",
    message: "Temps réel limité à ce processus",
  },
  {
    code: "DB_SQLITE_FALLBACK",
    level: "warning",
    message: "Base « default » en repli SQLite (/app/var/databases/app.db)",
    fix: "NF_DATABASE_URL=postgres://… dans .env.local",
  },
  {
    code: "FIREWALL_PUBLIC_ROUTES",
    level: "warning",
    message: "Tes routes métier sont PUBLIQUES",
    fix: 'use("@nodefony/security", { areas: { main: { pattern: "^/api", authenticators: ["session"] } } })',
  },
];

const servers = [
  {
    type: "http",
    scheme: "http",
    port: 5151,
    address: "127.0.0.1",
    url: "http://127.0.0.1:5151",
  },
  {
    type: "websocket",
    scheme: "ws",
    port: 5151,
    address: "127.0.0.1",
    url: "ws://127.0.0.1:5151",
  },
  {
    type: "https",
    scheme: "https",
    port: 5152,
    address: "127.0.0.1",
    url: "https://127.0.0.1:5152",
  },
  {
    type: "websocket-secure",
    scheme: "wss",
    port: 5152,
    address: "127.0.0.1",
    url: "wss://127.0.0.1:5152",
  },
];

/** Un rapport de boot complet, tel que le noyau le rend. */
function report(extra: Partial<IBootReport> = {}): IBootReport {
  return {
    durationMs: 6800,
    modulesLoaded: Array.from({ length: 16 }, (_, i) => `m${i}`),
    manifestEntries: 18,
    modulesSkipped: [],
    modulesGated: [
      { module: "@nodefony/mongoose", reason: "condition non remplie" },
      { module: "@nodefony/redis", reason: "condition non remplie" },
    ],
    warnings: 0,
    errors: 0,
    criticals: null,
    serversExpected: true,
    serversListening: servers,
    healthy: true,
    open: resolveBootLinks(servers, [
      { id: "studio", label: "Studio", path: "/nodefony" },
    ]),
    notices: collectBootNotices([], undefined, [], notices),
    ...extra,
  };
}

const proc = (role: DevProcessInfo["role"], pid: number): DevProcessInfo =>
  ({
    pid,
    ppid: 1,
    role,
    label: role,
    uptimeSec: 3600,
    rssKb: 64000,
    cpu: 0,
    command: "node",
  }) as unknown as DevProcessInfo;

const extras: IStartupExtras = {
  version: "10.0.0",
  environment: "development",
  root: "/app",
  frontend: {
    bundles: 3,
    ready: 2,
    names: ["react", "vue", "studio"],
    detail: ["react, studio · Vite interne :5173", "vue · Vite interne :5181"],
  },
  data: ["default → sqlite /app/var/databases/app.db"],
  processes: [proc("supervisor", 100), proc("server", 101), proc("vite", 102)],
  firewall: [
    {
      name: "nodefony-admin",
      pattern: "^\\/nodefony\\/api",
      authenticators: ["session"],
    },
  ],
  supervised: true,
  inspector: null,
};

const view = (
  r: Partial<IBootReport> = {},
  e: Partial<IStartupExtras> = {},
): IStartupView => buildStartupView(report(r), { ...extras, ...e });

const human = (v: IStartupView, columns = 80, color = false): string[] =>
  renderStartupHuman(v, { color, hyperlinks: false, columns });

describe("écran humain — ordre fixe, rien de perdu", () => {
  it("rend chaque section attendue, dans l'ordre", () => {
    const v = view();
    expect(startupSections(v)).to.deep.equal([
      "verdict",
      "open",
      "notices",
      "listen",
      "frontend",
      "modules",
      "journal",
      "detail.data",
      "detail.frontend",
      "detail.processes",
      "detail.firewall",
      "footer",
    ]);
    const text = human(v).join("\n");
    const markers = [
      "✓  Prêt en 6,8 s — Nodefony 10.0.0 · development",
      "OUVRIR",
      "À REGARDER (3)",
      "ÉTAT",
      "Écoute",
      "Frontend",
      "Modules",
      "Journal",
      "DÉTAIL",
      "Données",
      "Processus",
      "Pare-feu",
      "état machine : nodefony status --json",
    ];
    let at = -1;
    for (const marker of markers) {
      const next = text.indexOf(marker, at + 1);
      expect(next, `« ${marker} » absent ou hors d'ordre`).to.be.greaterThan(
        at,
      );
      at = next;
    }
  });

  it("garde les informations de l'ancien écran : tableaux, modules ignorés, journal", () => {
    const text = human(view()).join("\n");
    expect(text).to.match(/RÔLE\s+PID\s+PPID/);
    expect(text).to.match(/ZONE\s+MODULE\s+PATTERN\s+AUTH\s+ACCÈS/);
    // Une ligne repliée reste une phrase : on la lit espaces normalisés.
    const flat = text.replace(/\s+/g, " ");
    expect(flat).to.contain(
      "2 ignorés : mongoose, redis (condition non remplie)",
    );
    expect(text).to.contain("1 superviseur · 1 serveur · 1 Vite");
    expect(text).to.contain("aucun warning");
    const noisy = human(
      view({ warnings: 1, errors: 1, criticals: ["x : boom"] }),
    ).join("\n");
    // Le geste « --debug » tient sur sa ligne, jamais coupé au repli.
    expect(noisy).to.contain("détail : nodefony development --debug");
    expect(noisy).to.contain("1 ERROR · 1 WARNING");
    // Le détail décrit le pare-feu ; le constat « publiques » est en haut, une fois.
    expect(text).to.contain("1 aire framework, aucune zone applicative");
    expect(text).to.contain(
      "HTTP + WS 127.0.0.1:5151 · HTTP/2 + WSS 127.0.0.1:5152",
    );
  });

  it("n'offre JAMAIS un port interne de Vite comme adresse à ouvrir", () => {
    const lines = human(view());
    const open = lines.slice(
      lines.findIndex((l) => l.includes("OUVRIR")),
      lines.findIndex((l) => l.includes("À REGARDER")),
    );
    expect(open.join("\n")).to.contain(
      "➜  Application   https://localhost:5152/",
    );
    expect(open.join("\n")).to.contain(
      "➜  Studio        https://localhost:5152/nodefony",
    );
    // Le port de Vite n'apparaît QUE sur une ligne qui le dit interne.
    for (const line of lines.filter((l) => /:51(73|81)\b/.test(l))) {
      expect(line).to.contain("Vite interne");
      expect(line).to.not.contain("➜");
    }
  });

  it("trie les points du plus urgent au détail et donne le geste sous chacun", () => {
    const text = human(view()).join("\n");
    expect(text.indexOf("⚠  Base")).to.be.lessThan(
      text.indexOf("ℹ  Temps réel"),
    );
    expect(text).to.contain("→ NF_DATABASE_URL=postgres://… dans .env.local");
  });

  it("replie une liste ENTRE deux noms — jamais un « · » en tête, jamais un nom coupé", () => {
    const names = [
      "test-frontend-react",
      "test-frontend-vue",
      "test-frontend-angular",
      "test-frontend-svelte",
      "mediasoup",
      "studio",
    ];
    const lines = human(
      view(
        {},
        {
          frontend: {
            bundles: 6,
            ready: 3,
            names,
            detail: [
              `${names.slice(0, 4).join(", ")}, studio · Vite interne :5177`,
              // La ligne exacte de la capture réelle, qui laissait « :5173 » orphelin.
              "test-frontend-react, test-frontend-svelte, studio · Vite interne :5173",
            ],
          },
        },
      ),
    );
    for (const line of lines)
      expect(line.trimStart().startsWith("·"), line).to.equal(false);
    const text = lines.join("\n");
    for (const name of names) expect(text).to.contain(name);
    for (const line of lines.filter((l) => l.includes("test-frontend"))) {
      expect(line, "un nom de bundle coupé").to.not.contain("…");
    }
    // La qualification reste avec son port : jamais « Vite interne » seul en fin
    // de ligne et « :5173 » orphelin sur la suivante.
    expect(text).to.contain("Vite interne :5173");
    for (const line of lines) expect(line.trim(), line).to.not.match(/^:\d+$/);
  });

  it("rend les chemins RELATIFS au projet", () => {
    const text = human(view()).join("\n");
    expect(text).to.contain("default → sqlite var/databases/app.db");
    expect(text).to.contain("(var/databases/app.db)");
    expect(text).to.not.contain("/app/var");
  });

  it("tient dans 80 colonnes, sauf un geste à coller et les tableaux partagés", () => {
    for (const columns of [80, 120, 200]) {
      for (const line of human(view(), columns)) {
        if (line.includes("→ ") || /^\s{16}\S/.test(line)) continue;
        expect(line.length, line).to.be.at.most(80);
      }
    }
  });

  it("sans couleur : aucune séquence ANSI, même dans les tableaux", () => {
    expect(human(view()).join("\n")).to.not.contain(ESC);
    expect(human(view(), 80, true).join("\n")).to.contain(ESC);
  });

  it("le sens tient au SYMBOLE, pas à la couleur", () => {
    const text = human(view()).join("\n");
    expect(text).to.match(/⚠ {2}Tes routes métier/);
    expect(text).to.match(/ℹ {2}Temps réel/);
  });

  it("hyperliens OSC 8 sur les adresses quand le terminal les rend", () => {
    const text = renderStartupHuman(view(), {
      color: false,
      hyperlinks: true,
      columns: 80,
    }).join("\n");
    expect(text).to.contain(`${ESC}]8;;https://localhost:5152/${ESC}\\`);
  });

  it("un point BLOQUANT change le verdict", () => {
    const blocking = view({
      notices: collectBootNotices(
        [],
        undefined,
        [
          {
            name: "drizzle:schema:default",
            ready: false,
            reason: "1 migration",
          },
        ],
        [],
      ),
    });
    expect(human(blocking)[0]).to.contain(
      "✗  Démarré en 6,8 s, mais un point bloque",
    );
  });

  it("aucun serveur : le verdict le dit, et rien à ouvrir", () => {
    const failed = view({ healthy: false, serversListening: [], open: [] });
    expect(human(failed)[0]).to.contain("✗  Aucun serveur n'a démarré");
    expect(startupSections(failed)).to.not.include("open");
  });
});

describe("rendu machine — une ligne par fait, zéro ANSI", () => {
  it("porte verdict, adresses, points avec code stable et geste", () => {
    const lines = renderStartupPlain(view());
    expect(lines[0]).to.equal(
      "nodefony: ready 6.8s version=10.0.0 env=development",
    );
    expect(lines).to.include("open.app: https://localhost:5152/");
    expect(lines).to.include("open.studio: https://localhost:5152/nodefony");
    expect(lines).to.include(
      "warn DB_SQLITE_FALLBACK: Base « default » en repli SQLite (var/databases/app.db) — fix: NF_DATABASE_URL=postgres://… dans .env.local",
    );
    expect(lines).to.include(
      "info REALTIME_LOCAL_ONLY: Temps réel limité à ce processus",
    );
    expect(lines.at(-1)).to.equal(
      "state: nodefony status --json · var/last-boot.json",
    );
  });

  it("aucune séquence ANSI, même si un module en glisse une", () => {
    const v = view({
      notices: [
        { code: "X", level: "info", message: `${ESC}[31mrouge${ESC}[0m` },
      ],
    });
    expect(renderStartupPlain(v).join("\n")).to.not.contain(ESC);
  });
});

describe("choix du rendu", () => {
  it("explicite d'abord, puis NF_OUTPUT, puis la capacité du terminal", () => {
    expect(resolveOutputMode("json", { NF_OUTPUT: "plain" }, true)).to.equal(
      "json",
    );
    expect(resolveOutputMode(undefined, { NF_OUTPUT: "plain" }, true)).to.equal(
      "plain",
    );
    expect(resolveOutputMode(undefined, {}, true)).to.equal("human");
    expect(resolveOutputMode(undefined, {}, false)).to.equal("plain");
  });

  it("ne devine pas une IA : les variables d'agent ne choisissent rien", () => {
    const agent = {
      AI_AGENT: "claude-code",
      CLAUDECODE: "1",
      TERM: "xterm-256color",
    };
    expect(resolveOutputMode(undefined, agent, true)).to.equal("human");
    expect(resolveOutputMode(undefined, agent, false)).to.equal("plain");
  });

  it("refuse une valeur inconnue en nommant sa source", () => {
    expect(() => resolveOutputMode("yaml", {}, true)).toThrow(/--output=yaml/);
    expect(() =>
      resolveOutputMode(undefined, { NF_OUTPUT: "x" }, true),
    ).toThrow(/NF_OUTPUT=x/);
  });

  it("--debug se lit sur argv (court ou long)", () => {
    expect(isDebugRequested(["node", "nf", "dev", "-d"])).to.equal(true);
    expect(isDebugRequested(["node", "nf", "dev", "--debug"])).to.equal(true);
    expect(isDebugRequested(["node", "nf", "dev"])).to.equal(false);
  });

  it("un build de démarrage en échec devient un point du bilan", () => {
    // Le rappel du superviseur défile et l'écran est remis à zéro au succès :
    // c'est le point d'attention qui garde le verdict visible.
    const notice = devBuildIssueNotice("build INCOMPLET — dist existant");
    expect(notice.code).to.equal("DEV_BUILD_INCOMPLETE");
    expect(notice.message).to.equal("build INCOMPLET — dist existant");
    expect(notice.fix).to.contain("npm run build");
  });

  it("lit --output sous ses deux formes", () => {
    expect(readOutputFlag(["node", "nf", "dev", "--output", "json"])).to.equal(
      "json",
    );
    expect(readOutputFlag(["node", "nf", "dev", "--output=plain"])).to.equal(
      "plain",
    );
    expect(readOutputFlag(["node", "nf", "dev"])).to.equal(undefined);
  });

  it("hyperliens : déclarés par le terminal, jamais hors terminal", () => {
    expect(supportsHyperlinks({ TERM_PROGRAM: "iTerm.app" }, true)).to.equal(
      true,
    );
    expect(supportsHyperlinks({ TERM_PROGRAM: "iTerm.app" }, false)).to.equal(
      false,
    );
    expect(
      supportsHyperlinks({ TERM_PROGRAM: "Apple_Terminal" }, true),
    ).to.equal(false);
    expect(
      supportsHyperlinks({ FORCE_HYPERLINK: "0", WT_SESSION: "1" }, true),
    ).to.equal(false);
    expect(supportsHyperlinks({ FORCE_HYPERLINK: "1" }, false)).to.equal(true);
  });
});

describe("adresses à ouvrir", () => {
  it("bouclage et joker deviennent localhost ; une adresse précise reste", () => {
    expect(openableHost("127.0.0.1")).to.equal("localhost");
    expect(openableHost("0.0.0.0")).to.equal("localhost");
    expect(openableHost("::")).to.equal("localhost");
    expect(openableHost("::1")).to.equal("localhost");
    expect(openableHost("192.168.1.5")).to.equal("192.168.1.5");
    expect(openableHost("fe80::1")).to.equal("[fe80::1]");
  });

  it("HTTPS d'abord, repli HTTP, rien sans serveur web", () => {
    expect(resolveBootLinks(servers, [])[0]?.url).to.equal(
      "https://localhost:5152/",
    );
    expect(resolveBootLinks(servers.slice(0, 1), [])[0]?.url).to.equal(
      "http://localhost:5151/",
    );
    expect(
      resolveBootLinks(
        [],
        [{ id: "studio", label: "Studio", path: "/nodefony" }],
      ),
    ).to.deep.equal([]);
  });
});

describe("rechargement à chaud — une ligne, puis ce qui a changé", () => {
  const previous = { open: view().open, notices: view().notices };

  it("rien de neuf", () => {
    const v = view({ durationMs: 900 });
    const diff = diffReload(previous, v);
    const lines = renderReloadHuman(diff, v, {
      color: false,
      hyperlinks: false,
      columns: 80,
    });
    expect(lines).to.deep.equal(["  ↻  Rechargé en 900 ms — rien de neuf"]);
    expect(renderReloadPlain(diff, v)).to.deep.equal([
      "nodefony: reloaded 0.9s added=0 resolved=0",
    ]);
  });

  it("un point apparu se COMPTE (il est dans À regarder), un point disparu se dit résolu", () => {
    const v = view({
      notices: [
        notices[0] as IBootNotice,
        notices[2] as IBootNotice,
        {
          code: "MODULE_FAILED",
          level: "warning",
          message: "module x en échec",
        },
      ],
    });
    const diff = diffReload(previous, v);
    expect(diff.added.map((n) => n.code)).to.deep.equal(["MODULE_FAILED"]);
    expect(diff.resolved.map((n) => n.code)).to.deep.equal([
      "DB_SQLITE_FALLBACK",
    ]);
    const text = renderReloadHuman(diff, v, {
      color: false,
      hyperlinks: false,
      columns: 80,
    }).join("\n");
    expect(text).to.contain("1 nouveau point · 1 résolu");
    // L'apparu est dans « À regarder », juste dessous : pas répété ici.
    expect(text).to.not.contain("module x en échec");
    expect(text).to.contain("✓  résolu : Base « default » en repli SQLite");
  });
});

describe("mise en forme", () => {
  it("durées au format français", () => {
    expect(formatSeconds(6800)).to.equal("6,8 s");
    expect(formatSeconds(850)).to.equal("850 ms");
  });

  it("chemins relatifs, quel que soit le séparateur", () => {
    expect(relativizeLine("a /app/var/x.db b", "/app")).to.equal(
      "a var/x.db b",
    );
    expect(relativizeLine("C:\\app\\var\\x.db", "C:\\app")).to.equal(
      "var\\x.db",
    );
    expect(relativizeLine("C:/app/var/x.db", "C:\\app")).to.equal("var/x.db");
  });

  it("coupe au milieu", () => {
    expect(truncateMiddle("var/databases/nodefony-drizzle.db", 15)).to.equal(
      "var/dat…zzle.db",
    );
    expect(truncateMiddle("court", 15)).to.equal("court");
  });
});

describe("ligne d'état figée en bas — l'historique continue de se remplir", () => {
  /** Un flux de terminal factice qui enregistre tout ce qui s'y écrit. */
  const terminal = (columns = 80) => {
    const written: string[] = [];
    const stream: IStatusStream & { written: string[] } = {
      columns,
      written,
      write: (chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      },
    };
    return stream;
  };

  it("le contenu s'écrit À LA PLACE de la ligne d'état, qui se redessine dessous", () => {
    const out = terminal();
    const status = new StatusLine([out]);
    status.show("ÉTAT");
    out.write("GET / 200\n");
    // Effacée, contenu, redessinée : jamais de contenu collé à la ligne d'état.
    expect(out.written).to.deep.equal([
      "ÉTAT",
      ERASE_LINE,
      "GET / 200\n",
      "ÉTAT",
    ]);
    status.release();
  });

  it("une ligne non terminée ne reçoit pas la ligne d'état collée à elle", () => {
    const out = terminal();
    const status = new StatusLine([out]);
    status.show("ÉTAT");
    out.write("partiel");
    out.write(" suite\n");
    expect(out.written).to.deep.equal([
      "ÉTAT",
      ERASE_LINE,
      "partiel",
      " suite\n",
      "ÉTAT",
    ]);
    status.release();
  });

  it("une écriture sur la sortie d'ERREUR l'efface aussi", () => {
    const out = terminal();
    const err = terminal();
    const status = new StatusLine([out, err]);
    status.show("ÉTAT");
    err.write("boom\n");
    expect(out.written).to.deep.equal(["ÉTAT", ERASE_LINE, "ÉTAT"]);
    expect(err.written).to.deep.equal(["boom\n"]);
    status.release();
  });

  it("à la sortie : effacée, et le flux rendu tel qu'il était", () => {
    const out = terminal();
    const original = out.write;
    const status = new StatusLine([out]);
    status.show("ÉTAT");
    status.release();
    expect(out.write).to.equal(original);
    expect(out.written.at(-1)).to.equal(ERASE_LINE);
  });

  it("bornée à la largeur, couleurs non comptées — sinon elle se replie", () => {
    const line = `\x1b[36m${"x".repeat(100)}\x1b[0m`;
    const fitted = fitStatus(line, 40);
    expect(fitted.replace(/\x1b\[[0-9;]*m/g, "")).to.have.length(39);
    expect(fitted.endsWith("…\x1b[0m")).to.equal(true);
    expect(fitStatus("court", 40)).to.equal("court");
  });

  const ctx = { project: "mon-app", readyAt: "16:48", reloads: 0 };

  it("dit qui tourne, où l'ouvrir, l'état et depuis quand — l'aide à droite, jamais l'adresse WebSocket", () => {
    const text = renderStatusLine(view(), ctx, { color: false, columns: 170 });
    expect(
      text
        .trimEnd()
        .startsWith(
          " ⬢ mon-app  Nodefony 10.0.0 · development  ·  ➜ https://localhost:5152/  ·  ⚠ 2 à regarder à 16:48",
        ),
      text,
    ).to.equal(true);
    expect(text.endsWith("ctrl+c arrêter")).to.equal(true);
    expect(text.length).to.equal(169);
    expect(text).to.not.contain("wss://");
    expect(
      renderStatusLine(view({ notices: [] }), ctx, {
        color: false,
        columns: 170,
      }),
    ).to.contain("✓ prêt à 16:48");
  });

  // Un idéogramme prend DEUX colonnes : mesurée en unités de code, la ligne
  // croyait avoir la place de l'aide et débordait d'autant (ADR-0013 §9).
  it("se mesure en colonnes : un nom de projet en idéogrammes aligne l'aide au bord", () => {
    const text = renderStatusLine(
      view(),
      { ...ctx, project: "漢字漢字" },
      { color: false, columns: 170 },
    );
    expect(text.endsWith("ctrl+c arrêter")).to.equal(true);
    expect(visibleWidth(text)).to.equal(169);
  });

  it("le socket du débogueur et le mode sans rechargement s'y lisent", () => {
    const socket = "ws://127.0.0.1:9229/59d39463-7bb0-4853-89f5-d2607a809dd1";
    const debug = buildStartupView(report(), {
      ...extras,
      supervised: false,
      inspector: socket,
    });
    const bar = renderStatusLine(debug, ctx, { color: false, columns: 220 });
    expect(bar).to.contain(`débogueur ${socket}`);
    expect(bar).to.contain("sans rechargement");
    expect(bar).to.not.contain("wss://");
    // À l'étroit, le socket se réduit à `hôte:port` plutôt que de tomber, et
    // l'état du démarrage reste lisible.
    const narrow = renderStatusLine(debug, ctx, { color: false, columns: 90 });
    expect(narrow).to.contain("débogueur 127.0.0.1:9229");
    expect(narrow).to.not.contain("59d39463");
    expect(narrow).to.contain("⚠ 2 à regarder");
    const screen = human(debug).join("\n");
    expect(screen).to.match(
      /Mode\s+development · sans rechargement \(--no-watch\)/,
    );
    expect(screen).to.match(
      /Débogueur\s+127\.0\.0\.1:9229 — chrome:\/\/inspect/,
    );
    const plain = renderStartupPlain(debug);
    expect(plain).to.include(`inspector: ${socket}`);
    expect(plain).to.include("mode: env=development watch=off");
    expect(plain).to.include("open.websocket: wss://localhost:5152");
  });

  it("un BADGE en vidéo inverse la distingue d'une ligne du journal", () => {
    const colored = renderStatusLine(view(), ctx, {
      color: true,
      columns: 170,
    });
    expect(colored.startsWith("\x1b[7m\x1b[1m ⬢ mon-app \x1b[0m")).to.equal(
      true,
    );
    // Sans couleur (NO_COLOR), le badge reste lisible, en texte.
    expect(
      renderStatusLine(view(), ctx, { color: false, columns: 170 }).startsWith(
        " ⬢ mon-app ",
      ),
    ).to.equal(true);
    // Même au plus étroit, le badge reste : c'est l'identité de la barre.
    expect(
      renderStatusLine(view(), ctx, { color: false, columns: 20 }).startsWith(
        " ⬢ mon-app ",
      ),
    ).to.equal(true);
  });

  it("compte les rechargements", () => {
    expect(
      renderStatusLine(
        view(),
        { ...ctx, reloads: 3 },
        { color: false, columns: 160 },
      ),
    ).to.contain("↻ 3");
  });

  it("étroite : le moins utile tombe d'abord, l'état et l'adresse restent", () => {
    const text = renderStatusLine(
      view(),
      { ...ctx, reloads: 3 },
      { color: false, columns: 70 },
    );
    expect(text.length).to.be.at.most(69);
    expect(text).to.contain("⚠ 2 à regarder");
    expect(text).to.contain("https://localhost:5152/");
    expect(text).to.not.contain("ctrl+c");
    expect(text).to.not.contain("↻ 3");
    expect(text).to.not.contain("Nodefony 10.0.0");
  });

  it("console Windows classique : aucun symbole hors de sa police", () => {
    // Consolas et les polices bitmap ont le Latin-1, « · — … » et les flèches
    // simples (←↑→↓) ; ils n'ont ni ✓ ⚠ ℹ ⬢ ↻ ➜, ni le braille du spinner.
    const ascii = (t: string): boolean =>
      /^[\x20-\x7e·—…éèàâêôûùç«»À-ÿ←↑→↓]*$/u.test(t);
    const line = renderStatusLine(
      view(),
      { ...ctx, reloads: 2 },
      { color: false, columns: 200, charset: "ascii" },
    );
    expect(ascii(line), line).to.equal(true);
    const screen = renderStartupHuman(view(), {
      color: false,
      hyperlinks: false,
      columns: 80,
      charset: "ascii",
    }).filter((l) => !/[─]/.test(l)); // les filets de tableau sont dans Consolas
    for (const l of screen) expect(ascii(l), l).to.equal(true);
  });

  it("un bloc de plusieurs lignes s'efface en remontant, sans zone de défilement", () => {
    expect(eraseBlock(1)).to.equal(ERASE_LINE);
    expect(eraseBlock(3)).to.equal(`${ERASE_LINE}\x1b[1A\x1b[2K\x1b[1A\x1b[2K`);
    const out = terminal();
    const status = new StatusLine([out]);
    status.show(["SÉPARATEUR", "ÉTAT"]);
    out.write("log\n");
    expect(out.written).to.deep.equal([
      "SÉPARATEUR\nÉTAT",
      eraseBlock(2),
      "log\n",
      "SÉPARATEUR\nÉTAT",
    ]);
    status.release();
  });

  it("l'écran s'efface sans l'historique ; seul le menu l'efface aussi", () => {
    expect(CLEAR_SCREEN).to.not.contain("\x1b[3J");
    expect(RESET_SCREEN).to.contain("\x1b[3J");
  });
});

describe("bloc d'état avec le logo — et le canal qui le nourrit", () => {
  /** Un flux de terminal factice qui enregistre tout ce qui s'y écrit. */
  const terminal = () => {
    const written: string[] = [];
    const stream: IStatusStream & { written: string[] } = {
      columns: 80,
      written,
      write: (chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      },
    };
    return stream;
  };
  const ctx = { project: "mon-app", readyAt: "16:48", reloads: 2 };
  const visible = (t: string): number =>
    t.replace(/\x1b\[[0-9;]*m/g, "").length;

  it("6 lignes : la marque du logo à gauche, une information par ligne à droite", () => {
    const block = renderStatusBlock(
      view(),
      ctx,
      { color: false, columns: 100, rows: 40 },
      brandMark("unicode", false),
    );
    // Un filet, puis les 6 lignes du logo.
    expect(block).to.have.length(7);
    const lines = block ?? [];
    expect(lines[0]).to.equal("─".repeat(99));
    expect(lines[3]?.startsWith("⣸⡏⢠⣿⢁⣶⠟⠁")).to.equal(true);
    const text = lines.join("\n");
    expect(text).to.contain(" ⬢ mon-app ");
    expect(text).to.contain("development · rechargement auto");
    expect(text).to.contain("➜ https://localhost:5152/");
    expect(text).to.not.contain("wss://");
    expect(text).to.contain("⚠ 2 à regarder à 16:48  ·  ↻ 2");
    expect(text).to.contain("ctrl+c arrêter");
    // Aucune ligne ne se replie : l'effacement en remontant raterait sinon.
    for (const l of lines) expect(visible(l)).to.be.at.most(99);
  });

  it("en débogage : le socket complet sous l'état, et les points à regarder restent", () => {
    const socket = "ws://127.0.0.1:9229/59d39463-7bb0-4853-89f5-d2607a809dd1";
    const debug = buildStartupView(report(), { ...extras, inspector: socket });
    const lines =
      renderStatusBlock(
        debug,
        ctx,
        { color: false, columns: 100, rows: 40 },
        brandMark("unicode", false),
      ) ?? [];
    const at = (needle: string): number =>
      lines.findIndex((l) => l.includes(needle));
    expect(at(`débogueur ${socket}`)).to.equal(at("à regarder à 16:48") + 1);
    expect(lines.join("\n")).to.not.contain("wss://");
    // Les codes des points à regarder ne sont plus évincés par le débogueur.
    for (const n of debug.notices) expect(lines.join("\n")).to.contain(n.code);
  });

  it("trop étroit ou trop bas : pas de bloc, la ligne unique prend le relais", () => {
    const mark = brandMark("unicode", false);
    expect(
      renderStatusBlock(
        view(),
        ctx,
        { color: false, columns: 60, rows: 40 },
        mark,
      ),
    ).to.equal(null);
    expect(
      renderStatusBlock(
        view(),
        ctx,
        { color: false, columns: 120, rows: 12 },
        mark,
      ),
    ).to.equal(null);
  });

  it("console Windows classique : la marque ASCII du logo", () => {
    const mark = brandMark("ascii", false);
    expect(mark).to.have.length(6);
    for (const l of mark) expect(/^[\x20-\x7e]{8}$/.test(l), l).to.equal(true);
  });

  it("masqué (le serveur redémarre) : effacé, rien redessiné avant le prochain bilan", () => {
    const out = terminal();
    const status = new StatusLine([out]);
    status.show(["A", "B", "C"]);
    status.hide();
    out.write("log\n");
    status.show(["D"]);
    expect(out.written).to.deep.equal(["A\nB\nC", eraseBlock(3), "log\n", "D"]);
    status.release();
  });

  it("retiré deux fois (signal d'arrêt, puis exit) : effacé UNE fois", () => {
    const out = terminal();
    const status = new StatusLine([out]);
    status.show(["A", "B"]);
    status.release();
    status.release();
    expect(out.written).to.deep.equal(["A\nB", eraseBlock(2)]);
  });

  it("le canal n'accepte que SES messages, de types connus", () => {
    const context = { project: "mon-app", readyAt: "16:48", reloads: 0 };
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "status-view",
        view: view(),
        context,
      }),
    ).to.equal(true);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "resize",
        columns: 120,
        rows: 40,
      }),
    ).to.equal(true);
    // Le protocole d'effacement croisé de deux écrivains n'existe plus.
    for (const type of ["status", "status-erased"]) {
      expect(
        isDevChannelMessage({ channel: DEV_CHANNEL, type, lines: 6 }),
      ).to.equal(false);
    }
    // Un message de cluster (`process:msg`) n'est jamais pris pour le nôtre.
    expect(isDevChannelMessage({ type: "process:msg", data: {} })).to.equal(
      false,
    );
    expect(
      isDevChannelMessage({ channel: DEV_CHANNEL, type: "inconnu" }),
    ).to.equal(false);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "resize",
        columns: 0,
        rows: 40,
      }),
    ).to.equal(false);
    expect(
      isDevChannelMessage({
        channel: DEV_CHANNEL,
        type: "status-view",
        view: { version: 1 },
        context,
      }),
    ).to.equal(false);
    expect(isDevChannelMessage(null)).to.equal(false);
  });
});

describe("barre d'état — l'activité (partie centrale)", () => {
  const p = createPalette(false);
  it("en cours : tourniquet, libellé, étape, jauge du chargeur, durée", () => {
    const line = renderActivity(
      {
        label: "démarrage…",
        tone: "busy",
        frame: "⠙",
        step: "Services & ORM",
        progress: { done: 3, total: 5 },
        elapsedMs: 12_300,
      },
      p,
      SCREEN_SYMBOLS.unicode,
      false,
    );
    expect(line).to.equal(
      "⠙ démarrage…  ·  Services & ORM  ·  ▰▰▰▱▱ 3/5  ·  12,3 s",
    );
  });

  it("ASCII : la jauge `==--` ; sous la seconde, pas de durée", () => {
    const line = renderActivity(
      {
        label: "construction…",
        tone: "busy",
        frame: "|",
        progress: { done: 1, total: 2 },
        elapsedMs: 400,
      },
      p,
      SCREEN_SYMBOLS.ascii,
      true,
    );
    expect(line).to.equal("| construction…  ·  =- 1/2");
  });

  it("alerte et échec gardent leur symbole, jamais le tourniquet", () => {
    const sym = SCREEN_SYMBOLS.unicode;
    expect(
      renderActivity(
        { label: "build en échec", tone: "warning", frame: "⠙" },
        p,
        sym,
        false,
      ),
    ).to.equal(`${sym.warn} build en échec`);
    expect(
      renderActivity(
        { label: "arrêté", tone: "failed", frame: "⠙" },
        p,
        sym,
        false,
      ),
    ).to.equal(`${sym.fail} arrêté`);
  });

  it("canal : un boot-step bien formé passe ; libellé trop long, compteurs faux, refusés", () => {
    const step = (over: Record<string, unknown>) => ({
      channel: DEV_CHANNEL,
      type: "boot-step",
      step: "Modules",
      done: 1,
      total: 5,
      ...over,
    });
    expect(isDevChannelMessage(step({}))).to.equal(true);
    expect(isDevChannelMessage(step({ step: "x".repeat(81) }))).to.equal(false);
    expect(isDevChannelMessage(step({ step: "" }))).to.equal(false);
    expect(isDevChannelMessage(step({ done: 6 }))).to.equal(false);
    expect(isDevChannelMessage(step({ done: 1.5 }))).to.equal(false);
    expect(isDevChannelMessage(step({ total: 5000, done: 1 }))).to.equal(false);
  });
});
