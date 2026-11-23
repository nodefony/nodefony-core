// Preuve à l'écran (#896) : la sortie de DevTerminal rendue par un VRAI émulateur
// (@xterm/headless), relevée cellule par cellule (texte, largeur, couleurs, styles)
// après chaque étape de 5 scénarios.
// Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-supervisor-terminal-screen.mjs <racine-dist> <sortie.json>
// Comparer deux dists : lancer deux fois, puis diff des deux JSON.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import xterm from "@xterm/headless";

const { Terminal } = xterm;
const root = process.cwd();
const distRoot = path.resolve(
  root,
  process.argv[2] || "src/nodefony/dist/node",
);
const outFile = process.argv[3];
const load = (f) => import(pathToFileURL(path.join(distRoot, f)).href);
const { DevTerminal } = await load("service/dev/DevTerminal.js");
const { brandMark } = await load("cli/brand.js");

// ── Minuteurs capturés : l'image se dessine quand le scénario le décide.
// Horloge figée : la toupie et l'heure suivent Date.now, le relevé doit être rejouable.
Date.now = () => 1_790_000_000_000;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let captured = [];
const FAKE = Symbol("fake");
const fakeSetTimeout = (fn, ms, ...args) => {
  const h = {
    [FAKE]: true,
    fn,
    args,
    cancelled: false,
    unref() {
      return this;
    },
    ref() {
      return this;
    },
    hasRef: () => false,
  };
  captured.push(h);
  return h;
};
globalThis.setTimeout = fakeSetTimeout;
globalThis.clearTimeout = (h) => {
  if (h?.[FAKE]) h.cancelled = true;
  else realClearTimeout(h);
};
globalThis.setInterval = () => ({
  unref() {
    return this;
  },
  ref() {
    return this;
  },
});
globalThis.clearInterval = () => {};
function flush() {
  for (let guard = 0; guard < 10 && captured.length > 0; guard++) {
    const run = captured;
    captured = [];
    for (const h of run) if (!h.cancelled) h.fn(...h.args);
  }
}

// ── Un écran : le flux écrit dans xterm, relevé à la demande.
function screen(columns, rows) {
  const term = new Terminal({
    cols: columns,
    rows,
    allowProposedApi: true,
    scrollback: 1000,
    convertEol: true,
  }); // onlcr d'un vrai TTY;
  let pending = "";
  const stdout = {
    columns,
    rows,
    isTTY: true,
    writes: 0,
    write(chunk) {
      stdout.writes++;
      pending +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    },
  };
  const drain = async () => {
    // xterm traite son tampon par de VRAIS minuteurs : on les lui rend le temps du vidage.
    const d = pending;
    pending = "";
    globalThis.setTimeout = realSetTimeout;
    try {
      await new Promise((resolve) => term.write(d, resolve));
    } finally {
      globalThis.setTimeout = fakeSetTimeout;
    }
  };
  return {
    term,
    stdout,
    async resize(c, r) {
      await drain();
      stdout.columns = c;
      stdout.rows = r;
      term.resize(c, r);
    },
    async snap() {
      await drain();
      const buf = term.buffer.active;
      const text = [],
        attrs = [];
      const cell = buf.getNullCell();
      for (let y = 0; y < term.rows; y++) {
        const line = buf.getLine(buf.viewportY + y);
        text.push(line ? line.translateToString(true) : "");
        let runs = "",
          last = "";
        const width = line ? term.cols : 0;
        for (let x = 0; x < width; x++) {
          line.getCell(x, cell);
          const key = [
            cell.getWidth(),
            cell.getFgColorMode(),
            cell.getFgColor(),
            cell.getBgColorMode(),
            cell.getBgColor(),
            cell.isBold(),
            cell.isDim(),
            cell.isItalic(),
            cell.isUnderline(),
            cell.isInverse(),
          ]
            .map(Number)
            .join(".");
          if (key !== last) {
            runs += `${x}:${key} `;
            last = key;
          }
        }
        attrs.push(runs.trim());
      }
      return { cursor: [buf.cursorX, buf.cursorY], text, attrs };
    },
  };
}
function keyboard() {
  const listeners = [];
  return {
    setRawMode() {},
    resume() {},
    pause() {},
    on(_e, l) {
      listeners.push(l);
    },
    removeListener(_e, l) {
      const i = listeners.indexOf(l);
      if (i !== -1) listeners.splice(i, 1);
    },
    type(s) {
      for (const l of listeners) l(Buffer.from(s));
    },
  };
}

const ESC = "\x1b";
const view = {
  schema: 1,
  ready: true,
  durationMs: 1200,
  version: "10.0.0",
  environment: "development",
  open: [{ id: "app", label: "Application", url: "http://127.0.0.1:5151" }],
  notices: [],
  listening: [],
  frontend: null,
  modules: { loaded: 12, gated: [], failed: 0 },
  journal: { warnings: 0, errors: 0, criticals: [] },
  data: [],
  processes: null,
  firewall: null,
  supervised: true,
  inspector: null,
};
const ctx = (reloads = 0) => ({
  project: "mon-app",
  readyAt: "16:48",
  reloads,
});
const logLine = (n) =>
  `${ESC}[32mINFO${ESC}[0m  ${ESC}[36mHTTP${ESC}[0m  GET /api/users/${n} ${ESC}[1;32m200${ESC}[0m 1.${n % 10} ms — 漢字 👍🏽 req ${n.toString(16).padStart(6, "0")}\n`;
const lines = (from, count) => {
  let s = "";
  for (let i = 0; i < count; i++) s += logLine(from + i);
  return s;
};
const long = `${ESC}[33mWARN${ESC}[0m ${"très-longue-ligne-".repeat(12)}fin\n`;
const hostile = `avant${ESC}[10;5H${ESC}]52;c;ZWNobw==\x07${ESC}]0;titre\x07${ESC}[3K${ESC}[2Kaprès\tTAB ${ESC}]8;;https://x.test\x07lien${ESC}]8;;\x07\n`;

function make(sc, { fullscreen, kb }) {
  const t = new DevTerminal({
    stdout: sc.stdout,
    color: true,
    charset: "unicode",
    mark: brandMark("unicode", true),
    project: "mon-app",
    version: "10.0.0",
    ...(fullscreen
      ? { fullscreen: { input: kb, synchronized: true, onQuit() {} } }
      : {}),
  });
  t.setRuntime({ rssBytes: 200 * 1024 * 1024, cpuPercent: 2, eluPercent: 3 });
  t.setStatus(view, ctx(0), "ready");
  return t;
}

const result = {};
async function scenario(name, fn) {
  const steps = [];
  await fn(async (step, sc) => {
    flush();
    steps.push({ step, ...(await sc.snap()) });
  });
  result[name] = steps;
}

// 1. Surface inline : la barre sous le journal relayé, paquets coupés, puis rechargement.
await scenario("1-inline", async (snap) => {
  const sc = screen(100, 20);
  const t = make(sc, { fullscreen: false });
  await snap("barre", sc);
  t.ingest("server", "out", Buffer.from(lines(0, 6)));
  await snap("6 lignes", sc);
  const p = Buffer.from(lines(6, 3) + long + "sans fin de ligne");
  t.ingest("server", "out", p.subarray(0, 37));
  t.ingest("server", "out", p.subarray(37));
  await snap("paquet coupé + ligne partielle", sc);
  t.ingest("server", "out", Buffer.from(" … suite\n" + hostile));
  await snap("fin de ligne + séquences hostiles", sc);
  t.setStatus(view, ctx(1), "ready");
  await snap("rechargement", sc);
  t.close();
});

// 2. Plein écran en direct : rafale, page qui défile.
await scenario("2-plein-ecran-direct", async (snap) => {
  const sc = screen(120, 30);
  const kb = keyboard();
  const t = make(sc, { fullscreen: true, kb });
  await snap("vide", sc);
  t.ingest("server", "out", Buffer.from(lines(0, 10)));
  await snap("page courte", sc);
  for (let i = 0; i < 30; i++) {
    t.ingest("server", "out", Buffer.from(lines(10 + i * 4, 4)));
    flush();
  }
  t.ingest("server", "out", Buffer.from(long + hostile + "partielle"));
  await snap("page pleine + longue + hostile + partielle", sc);
  t.close();
});

// 3. Défilement au clavier.
await scenario("3-defilement", async (snap) => {
  const sc = screen(120, 30);
  const kb = keyboard();
  const t = make(sc, { fullscreen: true, kb });
  t.ingest("server", "out", Buffer.from(lines(0, 2000)));
  await snap("bas", sc);
  kb.type(`${ESC}[5~`);
  await snap("PgUp", sc);
  kb.type(`${ESC}[5~`);
  kb.type(`${ESC}[5~`);
  await snap("PgUp ×3", sc);
  t.ingest("server", "out", Buffer.from(lines(2000, 5)));
  await snap("remonté, 5 lignes arrivent", sc);
  kb.type(`${ESC}[6~`);
  await snap("PgDn", sc);
  t.close();
});

// 4. Largeur : redimensionnement, colonnes étroites, graphèmes larges.
await scenario("4-largeur", async (snap) => {
  const sc = screen(120, 24);
  const kb = keyboard();
  const t = make(sc, { fullscreen: true, kb });
  t.ingest("server", "out", Buffer.from(lines(0, 40) + long));
  await snap("120 colonnes", sc);
  for (const [c, r] of [
    [40, 24],
    [12, 16],
    [3, 12],
    [2, 10],
    [80, 20],
  ]) {
    await sc.resize(c, r);
    t.resize();
    await snap(`${c}×${r}`, sc);
  }
  t.close();
});

// 5. Seule la barre change : mesures vivantes, rechargements, phases.
await scenario("5-barre", async (snap) => {
  const sc = screen(120, 20);
  const kb = keyboard();
  const t = make(sc, { fullscreen: true, kb });
  t.ingest("server", "out", Buffer.from(lines(0, 8)));
  await snap("prête", sc);
  t.setRuntime({ rssBytes: 310 * 1024 * 1024, cpuPercent: 47, eluPercent: 12 });
  await snap("mesures changent", sc);
  t.setStatus(view, ctx(3), "ready");
  await snap("3 rechargements", sc);
  t.setStatus(view, ctx(3), "restarting");
  await snap("redémarrage", sc);
  t.setStatus(view, ctx(4), "ready");
  await snap("de nouveau prête", sc);
  t.close();
});

fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
const steps = Object.values(result).reduce((n, s) => n + s.length, 0);
process.stdout.write(
  `${Object.keys(result).length} scénarios, ${steps} relevés → ${outFile}\n`,
);
process.exit(0);
