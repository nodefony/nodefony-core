// Banc du terminal du superviseur (#896) — sans serveur, sur le `dist` du cœur.
// Usage : node --expose-gc .claude/skills/nodefony-load-test/scripts/micro/micro-supervisor-terminal-ab.mjs <label> [racine-dist] [runs]
//   racine-dist : dossier qui contient `service/dev/DevTerminal.js` (défaut : le dist du dépôt).
//   Pour un A/B : copier le dist AVANT le levier (`cp -R src/nodefony/dist/node tmp/bench/dist-896-before`).
// Sortie : une ligne JSON (médianes de N runs) + le détail par run sur stderr.
//
// Mesures :
//  1. frame.*   — ns par image en rafale, plein écran 120×40, barre prête : 4 lignes colorées
//                 par image ; historique de 100 (petite charge) et de 10 000 entrées.
//  2. barTick   — ns par image quand SEULE la barre change (graduation runtime).
//  3. scroll    — ns par touche PgUp/PgDn + image, remonté dans 10 000 entrées.
//  4. ingest.*  — µs par ligne ingérée, paquets de 4/16/64 Kio, couleurs ou non, plein écran
//                 (sans dessin) et inline (barre affichée, écho au terminal).
//  5. inline.*  — appels `write` et octets émis par paquet sur la surface inline.
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const label = process.argv[2] ?? "?";
const distRoot = path.resolve(
  root,
  process.argv[3] || "src/nodefony/dist/node",
);
const RUNS = Number(process.argv[4] ?? 7);
const ONLY = process.argv[5] ?? ""; // "frame" | "bar" | "scroll" | "ingest" — vide = tout (profil ciblé)
const want = (s) => !ONLY || ONLY.split(",").includes(s);
const load = (f) => import(pathToFileURL(path.join(distRoot, f)).href);
const { DevTerminal } = await load("service/dev/DevTerminal.js");
const { brandMark } = await load("cli/brand.js");

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[s.length >> 1]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ── Minuteurs : l'image est programmée par setTimeout(16 ms) ; on la capture
//    pour la dessiner de façon synchrone, au moment choisi par le banc.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let captured = [];
const FAKE = Symbol("fake-timer");
function captureTimers() {
  globalThis.setTimeout = (fn, ms, ...args) => {
    const handle = {
      [FAKE]: true,
      fn,
      args,
      ms,
      cancelled: false,
      unref() {
        return this;
      },
      ref() {
        return this;
      },
      hasRef: () => false,
    };
    captured.push(handle);
    return handle;
  };
  globalThis.clearTimeout = (h) => {
    if (h?.[FAKE]) h.cancelled = true;
    else realClearTimeout(h);
  };
}
function releaseTimers() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  captured = [];
}
/** Exécute les minuteurs en attente (l'image) ; rend leur nombre. */
function flush() {
  const run = captured;
  captured = [];
  let n = 0;
  for (const h of run)
    if (!h.cancelled) {
      h.fn(...h.args);
      n++;
    }
  return n;
}

// ── Faux flux et faux clavier.
function output(columns, rows) {
  const out = {
    columns,
    rows,
    isTTY: true,
    writes: 0,
    bytes: 0,
    write(chunk) {
      out.writes++;
      out.bytes +=
        typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      return true;
    },
  };
  return out;
}
function input() {
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

// ── Données : une ligne de journal type, ~100 octets.
const ESC = "\x1b";
let lineNo = 0;
function line(color) {
  const n = lineNo++;
  return color
    ? `${ESC}[32mINFO${ESC}[0m  ${ESC}[36mHTTP${ESC}[0m  GET /api/users/${n} ${ESC}[32m200${ESC}[0m 1.${n % 10} ms — req ${n.toString(16).padStart(8, "0")}\n`
    : `INFO  HTTP  GET /api/users/${n} 200 1.${n % 10} ms - req ${n.toString(16).padStart(8, "0")} ......\n`;
}
function packet(bytes, color) {
  let s = "";
  let count = 0;
  while (Buffer.byteLength(s) < bytes) {
    s += line(color);
    count++;
  }
  return { buf: Buffer.from(s), lines: count };
}

const readyView = {
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
const ctx = { project: "mon-app", readyAt: "16:48", reloads: 0 };

function makeTerminal({ fullscreen, columns = 120, rows = 40, color = true }) {
  const stdout = output(columns, rows);
  const kb = input();
  const terminal = new DevTerminal({
    stdout,
    color,
    charset: "unicode",
    mark: brandMark("unicode", color),
    project: "mon-app",
    version: "10.0.0",
    ...(fullscreen
      ? { fullscreen: { input: kb, synchronized: true, onQuit() {} } }
      : {}),
  });
  terminal.setRuntime({
    rssBytes: 200 * 1024 * 1024,
    cpuPercent: 2,
    eluPercent: 3,
  });
  terminal.setStatus(readyView, ctx, "ready");
  return { terminal, stdout, kb };
}

function prefill(terminal, entries) {
  let left = entries;
  while (left > 0) {
    let s = "";
    const n = Math.min(left, 200);
    for (let i = 0; i < n; i++) s += line(true);
    terminal.ingest("server", "out", Buffer.from(s));
    left -= n;
  }
  flush();
}

// 1. Rafale en direct : 4 lignes par image.
function benchFrame(history, frames = 600) {
  captureTimers();
  const { terminal, stdout } = makeTerminal({ fullscreen: true });
  prefill(terminal, history);
  const chunks = [];
  for (let i = 0; i < frames; i++)
    chunks.push(Buffer.from(line(true) + line(true) + line(true) + line(true)));
  for (let i = 0; i < 200; i++) {
    terminal.ingest("server", "out", chunks[i]);
    flush();
  } // chauffe
  globalThis.gc?.();
  const w0 = stdout.writes,
    b0 = stdout.bytes;
  let drawNs = 0,
    ingestNs = 0,
    drawn = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    terminal.ingest("server", "out", chunks[i]);
    const t1 = performance.now();
    drawn += flush();
    const t2 = performance.now();
    ingestNs += (t1 - t0) * 1e6;
    drawNs += (t2 - t1) * 1e6;
  }
  const res = {
    nsPerFrame: drawNs / drawn,
    ingestNsPerFrame: ingestNs / frames,
    bytesPerFrame: (stdout.bytes - b0) / drawn,
    writesPerFrame: (stdout.writes - w0) / drawn,
  };
  terminal.close();
  releaseTimers();
  return res;
}

// 2. Seule la barre change.
function benchBarTick(frames = 600) {
  captureTimers();
  const { terminal, stdout } = makeTerminal({ fullscreen: true });
  prefill(terminal, 100);
  globalThis.gc?.();
  const b0 = stdout.bytes;
  let ns = 0,
    drawn = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    terminal.setRuntime({
      rssBytes: (200 + (i % 50)) * 1024 * 1024,
      cpuPercent: i % 7,
      eluPercent: i % 5,
    });
    drawn += flush();
    ns += (performance.now() - t0) * 1e6;
  }
  const res = {
    nsPerFrame: ns / drawn,
    bytesPerFrame: (stdout.bytes - b0) / drawn,
  };
  terminal.close();
  releaseTimers();
  return res;
}

// 3. Défilement au clavier, remonté.
function benchScroll(keys = 600) {
  captureTimers();
  const { terminal, kb, stdout } = makeTerminal({ fullscreen: true });
  prefill(terminal, 10_000);
  for (let i = 0; i < 40; i++) {
    kb.type(`${ESC}[5~`);
    flush();
  } // remonter
  globalThis.gc?.();
  const b0 = stdout.bytes;
  let ns = 0;
  for (let i = 0; i < keys; i++) {
    const t0 = performance.now();
    kb.type(i % 2 ? `${ESC}[6~` : `${ESC}[5~`);
    flush();
    ns += (performance.now() - t0) * 1e6;
  }
  const res = { nsPerKey: ns / keys, bytesPerKey: (stdout.bytes - b0) / keys };
  terminal.close();
  releaseTimers();
  return res;
}

// 4 et 5. Ingestion par paquets.
function benchIngest({
  fullscreen,
  size,
  color,
  totalBytes = 4 * 1024 * 1024,
}) {
  captureTimers();
  const { terminal, stdout } = makeTerminal({ fullscreen });
  if (fullscreen) flush();
  const count = Math.max(8, Math.ceil(totalBytes / size));
  const packets = [];
  let lines = 0;
  for (let i = 0; i < count; i++) {
    const p = packet(size, color);
    packets.push(p.buf);
    lines += p.lines;
  }
  for (let i = 0; i < 4; i++) terminal.ingest("server", "out", packets[i]); // chauffe
  globalThis.gc?.();
  const w0 = stdout.writes,
    b0 = stdout.bytes;
  const t0 = performance.now();
  for (const p of packets) terminal.ingest("server", "out", p);
  const ms = performance.now() - t0;
  const res = {
    usPerLine: (ms * 1000) / lines,
    writesPerPacket: (stdout.writes - w0) / count,
    bytesPerPacket: (stdout.bytes - b0) / count,
  };
  captured = []; // l'image du plein écran n'est pas dessinée : on mesure l'ingestion seule
  terminal.close();
  releaseTimers();
  return res;
}

const metrics = {};
const add = (k, v) => (metrics[k] ??= []).push(v);
for (let r = 0; r < RUNS; r++) {
  lineNo = 0;
  for (const h of want("frame") ? [100, 10_000] : []) {
    const f = benchFrame(h);
    add(`frame.h${h}.nsPerFrame`, f.nsPerFrame);
    add(`frame.h${h}.ingestNsPerFrame`, f.ingestNsPerFrame);
    add(`frame.h${h}.bytesPerFrame`, f.bytesPerFrame);
    add(`frame.h${h}.writesPerFrame`, f.writesPerFrame);
  }
  if (want("bar")) {
    const b = benchBarTick();
    add("barTick.nsPerFrame", b.nsPerFrame);
    add("barTick.bytesPerFrame", b.bytesPerFrame);
  }
  if (want("scroll")) {
    const s = benchScroll();
    add("scroll.nsPerKey", s.nsPerKey);
    add("scroll.bytesPerKey", s.bytesPerKey);
  }
  for (const fullscreen of want("ingest") ? [true, false] : []) {
    for (const kib of [4, 16, 64]) {
      for (const color of [false, true]) {
        const k = `ingest.${fullscreen ? "full" : "inline"}.${kib}k.${color ? "color" : "plain"}`;
        const i = benchIngest({ fullscreen, size: kib * 1024, color });
        add(`${k}.usPerLine`, i.usPerLine);
        if (!fullscreen) {
          add(`${k}.writesPerPacket`, i.writesPerPacket);
          add(`${k}.bytesPerPacket`, i.bytesPerPacket);
        }
      }
    }
  }
  process.stderr.write(`run ${r + 1}/${RUNS} fait\n`);
}
const out = { label, runs: RUNS, node: process.version };
for (const [k, v] of Object.entries(metrics)) {
  const m = median(v);
  out[k] = m >= 100 ? Math.round(m) : +m.toFixed(3);
}
console.log(JSON.stringify(out, null, 1));
