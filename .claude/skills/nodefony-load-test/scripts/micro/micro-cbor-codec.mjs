/**
 * Micro-banc du codec CBOR de Nodefony (`src/nodefony/src/realtime/codec/`) face à
 * JSON natif, `cbor-x` (JavaScript pur, entrée `index.js` — sans l'accélérateur C++) et
 * `cborg` — octets, encodage, décodage, sur les trames des bancs de l'ADR-0022 §2.
 *
 * Ce qu'il mesure : le codec tel que le bundler du produit le compile. La source TS est
 * bâtie à chaque run par `rolldown` (le bundler des 19 configs du dépôt) dans
 * `tmp/bench/cbor-codec-build/` — ni un `dist` qui peut être périmé, ni un chargeur TS
 * tiers qui transformerait autrement. Rien n'est lu dans `dist/`.
 *
 * Un PROCESS par codec (convention des micro-bancs du dépôt) : dans un même process, le
 * code d'un codec réchauffe ou pollue celui du voisin — mesuré ici, cbor-x passait de
 * 1,1 µs seul à 1,5 µs entrelacé. Chaque enfant mesure son codec sur toutes les trames,
 * les enfants sont lancés à la suite (jamais en parallèle : ils se voleraient le CPU).
 *
 * Validité AVANT la mesure (règle n°1 du skill) : pour chaque codec et chaque trame,
 * `decode(encode(trame))` doit rendre la trame (les `Uint8Array` comparés octet à
 * octet) ; pour le nôtre, en plus, exactement `JSON.parse(JSON.stringify(trame))` sur
 * les trames sans octets (ADR-0022 §2 : JSON est la référence). Une cellule invalide
 * n'a pas de chiffre et le banc sort en 1.
 *
 * Protocole : réchauffe, puis RUNS tours (7) de SAMPLE_MS (60 ms) par cellule, médiane
 * en ns/op. Deux passages séparés sont attendus avant de retenir un écart :
 * `--against <rapport précédent>` dit, cellule par cellule, si le signe de
 * « nôtre − cbor-x » et « nôtre − cborg » est le même aux deux passages.
 *
 * Usage :
 *   node .claude/skills/nodefony-load-test/scripts/micro/micro-cbor-codec.mjs \
 *     [--libs <dossier node_modules ou son parent>] [--runs 7] [--ms 60] \
 *     [--against tmp/bench/cbor-codec-<horodatage>.json]
 *
 * `cbor-x` et `cborg` ne sont PAS des dépendances du dépôt : les installer dans un
 * dossier à part (`npm i --prefix <dossier> cbor-x@1.6.8 cborg@6.2.0`) et le donner
 * par `--libs` (défaut : `tmp/bench/cbor-libs`).
 *
 * Rapport : `tmp/bench/cbor-codec-<horodatage>.json` (décor + toutes les médianes),
 * et le tableau Markdown sur la sortie standard.
 * Mode enfant (interne) : --child <JSON|ours|cborx|cborg>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..", "..");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const RUNS = Number(argValue("--runs", "7"));
const SAMPLE_MS = Number(argValue("--ms", "60"));
const against = argValue("--against", null);
const childCodec = argValue("--child", null);
let libsDir = path.resolve(
  repoRoot,
  argValue("--libs", path.join("tmp", "bench", "cbor-libs")),
);
if (
  path.basename(libsDir) !== "node_modules" &&
  existsSync(path.join(libsDir, "node_modules"))
) {
  libsDir = path.join(libsDir, "node_modules");
}
const buildDir = path.join(repoRoot, "tmp", "bench", "cbor-codec-build");
const builtCodec = path.join(buildDir, "cbor-codec.mjs");
const CODEC_IDS = ["JSON", "ours", "cborx", "cborg"];

// ---------------------------------------------------------------------------
// Trames (celles des bancs de l'ADR-0022 §2)
// ---------------------------------------------------------------------------
const rpc = (params) => ({ jsonrpc: "2.0", method: "partie:jouer", params });
const frames = {
  "texte court": rpc({ coup: "e4", joueur: "alice", tour: 12 }),
  "texte unicode": rpc({ text: "Été 🎉 — こんにちは, Ελληνικά" }),
  "50 objets": rpc({
    rows: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `service-${i}`,
      cpu: i * 1.37,
      mem: 1000 + i * 17,
      ok: i % 3 !== 0,
      tags: ["prod", "eu-west"],
    })),
  }),
  "500 nombres": rpc({ pts: Array.from({ length: 500 }, (_, i) => i * 0.25) }),
  "texte 8 Ko": rpc({ t: "lorem ipsum dolor sit amet ".repeat(300) }),
  "binaire 4 Ko": rpc({ data: new Uint8Array(4096).fill(7) }),
  "binaire 64 Ko": rpc({ data: new Uint8Array(65536).fill(7) }),
  "binaire 1 Mo": rpc({ data: new Uint8Array(1 << 20).fill(9) }),
};
const hasBytes = (frame) => frame.params.data instanceof Uint8Array;

// ---------------------------------------------------------------------------
// Enfant : un codec, toutes les trames
// ---------------------------------------------------------------------------
const version = (name) =>
  JSON.parse(readFileSync(path.join(libsDir, name, "package.json"), "utf8"))
    .version;

async function loadCodec(id) {
  switch (id) {
    case "JSON":
      return {
        label: "JSON natif",
        enc: (v) => JSON.stringify(v),
        dec: (s) => JSON.parse(s),
        size: (s) => Buffer.byteLength(s, "utf8"),
        binary: false,
      };
    case "ours": {
      const ours = await import(
        `${pathToFileURL(builtCodec).href}?t=${Date.now()}`
      );
      return {
        label: "nôtre",
        enc: (v) => ours.encodeCbor(v),
        dec: (b) => ours.decodeCbor(b),
        size: (b) => b.byteLength,
        binary: true,
      };
    }
    case "cborx": {
      const cborX = await import(
        pathToFileURL(path.join(libsDir, "cbor-x", "index.js")).href
      );
      // CBOR standard (réglage retenu par l'ADR-0022 §2) : pas de records, maps → objets,
      // Uint8Array sans étiquette, pas de compaction propriétaire.
      const x = new cborX.Encoder({
        useRecords: false,
        mapsAsObjects: true,
        tagUint8Array: false,
        pack: false,
      });
      return {
        label: `cbor-x ${version("cbor-x")} (JS pur)`,
        enc: (v) => x.encode(v),
        dec: (b) => x.decode(b),
        size: (b) => b.byteLength,
        binary: true,
      };
    }
    case "cborg": {
      const cborg = await import(
        pathToFileURL(path.join(libsDir, "cborg", "cborg.js")).href
      );
      return {
        label: `cborg ${version("cborg")}`,
        enc: (v) => cborg.encode(v),
        dec: (b) => cborg.decode(b),
        size: (b) => b.byteLength,
        binary: true,
      };
    }
    default:
      throw new Error(`codec inconnu : ${id}`);
  }
}

/** Ramène tout `Uint8Array` (Buffer compris) à un Uint8Array nu, pour une égalité profonde loyale. */
const plainBytes = (v) => {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (Array.isArray(v)) return v.map(plainBytes);
  if (v !== null && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = plainBytes(v[k]);
    return o;
  }
  return v;
};

/** `--expose-gc` posé par le parent : chaque échantillon part sans la dette GC du précédent (même règle pour tous les codecs). */
const collect = typeof globalThis.gc === "function" ? globalThis.gc : () => {};

const nsPerOp = (fn, ms) => {
  collect();
  let n = 0;
  const limit = BigInt(Math.round(ms * 1e6));
  const t0 = process.hrtime.bigint();
  let elapsed;
  do {
    fn();
    n++;
    elapsed = process.hrtime.bigint() - t0;
  } while (elapsed < limit);
  return Number(elapsed) / n;
};
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function runChild(id) {
  const c = await loadCodec(id);
  const out = { label: c.label, cells: {} };
  for (const [frameName, frame] of Object.entries(frames)) {
    if (!c.binary && hasBytes(frame)) {
      out.cells[frameName] = { validity: "n/a" };
      continue;
    }
    let validity = "ok";
    let encoded;
    try {
      encoded = c.enc(frame);
      const back = c.dec(encoded);
      if (!isDeepStrictEqual(plainBytes(back), plainBytes(frame)))
        validity = "≠ trame";
      if (
        id === "ours" &&
        !hasBytes(frame) &&
        !isDeepStrictEqual(back, JSON.parse(JSON.stringify(frame)))
      )
        validity = "≠ JSON";
    } catch (e) {
      validity = `lève ${e?.constructor?.name ?? "?"}`;
    }
    if (validity !== "ok") {
      out.cells[frameName] = { validity };
      continue;
    }
    // réchauffe (JIT), non comptée
    nsPerOp(() => c.enc(frame), SAMPLE_MS);
    nsPerOp(() => c.dec(encoded), SAMPLE_MS);
    const enc = [];
    const dec = [];
    for (let run = 0; run < RUNS; run++) {
      enc.push(nsPerOp(() => c.enc(frame), SAMPLE_MS));
      dec.push(nsPerOp(() => c.dec(encoded), SAMPLE_MS));
    }
    out.cells[frameName] = {
      validity,
      bytes: c.size(encoded),
      encNs: median(enc),
      decNs: median(dec),
    };
  }
  process.stdout.write(JSON.stringify(out));
}

if (childCodec !== null) {
  await runChild(childCodec);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Parent : décor, build, enfants à la suite, rapport
// ---------------------------------------------------------------------------
if (
  !existsSync(path.join(libsDir, "cbor-x")) ||
  !existsSync(path.join(libsDir, "cborg"))
) {
  console.error(
    `cbor-x et cborg introuvables sous ${libsDir}\n` +
      `  → npm i --prefix <dossier> cbor-x@1.6.8 cborg@6.2.0 ; puis --libs <dossier>`,
  );
  process.exit(2);
}
mkdirSync(buildDir, { recursive: true });
const { build } = await import("rolldown");
await build({
  input: path.join(
    repoRoot,
    "src",
    "nodefony",
    "src",
    "realtime",
    "codec",
    "index.ts",
  ),
  platform: "neutral",
  output: { dir: buildDir, format: "esm", entryFileNames: "cbor-codec.mjs" },
  logLevel: "silent",
});

const results = {};
for (const id of CODEC_IDS) {
  const child = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      fileURLToPath(import.meta.url),
      "--child",
      id,
      "--libs",
      libsDir,
      "--runs",
      String(RUNS),
      "--ms",
      String(SAMPLE_MS),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (child.status !== 0) {
    console.error(`enfant ${id} en échec (${child.status}) :\n${child.stderr}`);
    process.exit(1);
  }
  results[id] = JSON.parse(child.stdout);
}

const report = {
  when: new Date().toISOString(),
  decor: {
    node: process.version,
    v8: process.versions.v8,
    platform: `${os.platform()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "?",
    loadavg: os.loadavg().map((x) => Number(x.toFixed(2))),
    runs: RUNS,
    sampleMs: SAMPLE_MS,
    isolation: "un process par codec, lancés à la suite",
    libs: {
      "cbor-x": version("cbor-x"),
      cborg: version("cborg"),
      entry: "cbor-x/index.js (JS pur)",
    },
    ours: "source TS bâtie par rolldown à chaque run (tmp/bench/cbor-codec-build/)",
  },
  labels: Object.fromEntries(CODEC_IDS.map((id) => [id, results[id].label])),
  cells: Object.fromEntries(
    Object.keys(frames).map((f) => [
      f,
      Object.fromEntries(CODEC_IDS.map((id) => [id, results[id].cells[f]])),
    ]),
  ),
};

const outDir = path.join(repoRoot, "tmp", "bench");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(
  outDir,
  `cbor-codec-${report.when.replace(/[:.]/g, "-")}.json`,
);
writeFileSync(outFile, JSON.stringify(report, null, 2));

const fmt = (ns) =>
  ns === undefined
    ? "—"
    : ns >= 1e6
      ? `${(ns / 1e6).toFixed(2)} ms`
      : ns >= 1000
        ? `${(ns / 1000).toFixed(1)} µs`
        : `${Math.round(ns)} ns`;
const ratio = (a, b) =>
  a === undefined || b === undefined ? "—" : `×${(a / b).toFixed(2)}`;

const lines = [];
lines.push(`# Codec CBOR — micro-banc (${report.when})`);
lines.push(``);
lines.push(
  `Décor : Node ${report.decor.node}, ${report.decor.platform}, ${report.decor.cpu}, charge ${report.decor.loadavg.join("/")}, médiane de ${RUNS} × ${SAMPLE_MS} ms, ${report.decor.isolation}. cbor-x ${report.decor.libs["cbor-x"]} (${report.decor.libs.entry}), cborg ${report.decor.libs.cborg}.`,
);
lines.push(``);
lines.push(
  `| trame | octets JSON / nôtre / cbor-x / cborg | enc JSON | enc nôtre | enc cbor-x | enc cborg | dec JSON | dec nôtre | dec cbor-x | dec cborg | nôtre/cbor-x enc·dec | nôtre/cborg enc·dec |`,
);
lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
const invalid = [];
for (const [f, byCodec] of Object.entries(report.cells)) {
  const g = (id) => byCodec[id];
  for (const id of CODEC_IDS) {
    const v = g(id)?.validity;
    if (v !== "ok" && v !== "n/a") invalid.push(`${f} / ${id} : ${v}`);
  }
  const bytes = CODEC_IDS.map((id) => g(id)?.bytes ?? "—").join(" / ");
  const o = g("ours"),
    x = g("cborx"),
    c = g("cborg"),
    j = g("JSON");
  lines.push(
    `| ${f} | ${bytes} | ${fmt(j?.encNs)} | ${fmt(o?.encNs)} | ${fmt(x?.encNs)} | ${fmt(c?.encNs)} | ${fmt(j?.decNs)} | ${fmt(o?.decNs)} | ${fmt(x?.decNs)} | ${fmt(c?.decNs)} | ${ratio(o?.encNs, x?.encNs)} · ${ratio(o?.decNs, x?.decNs)} | ${ratio(o?.encNs, c?.encNs)} · ${ratio(o?.decNs, c?.decNs)} |`,
  );
}
lines.push(``);
lines.push(
  invalid.length === 0
    ? `Validité : toutes les cellules relisent leur trame (le nôtre : ≡ JSON).`
    : `INVALIDE : ${invalid.join(" ; ")}`,
);

if (against) {
  const previous = JSON.parse(
    readFileSync(path.resolve(repoRoot, against), "utf8"),
  );
  lines.push(``);
  lines.push(`## Signe des écarts face au passage ${previous.when}`);
  lines.push(``);
  lines.push(
    `| trame | enc vs cbor-x | dec vs cbor-x | enc vs cborg | dec vs cborg |`,
  );
  lines.push(`|---|---|---|---|---|`);
  const sign = (cur, prev, other, key) => {
    const a = cur?.ours?.[key],
      b = cur?.[other]?.[key],
      pa = prev?.ours?.[key],
      pb = prev?.[other]?.[key];
    if ([a, b, pa, pb].some((v) => v === undefined)) return "—";
    const now = Math.sign(a - b),
      before = Math.sign(pa - pb);
    const word =
      now < 0
        ? `plus rapide (×${(a / b).toFixed(2)})`
        : now > 0
          ? `plus lent (×${(a / b).toFixed(2)})`
          : "égal";
    return now === before
      ? `${word} CONFIRMÉ`
      : `${word} — signe CHANGÉ : bruit`;
  };
  for (const f of Object.keys(report.cells)) {
    const cur = report.cells[f],
      prev = previous.cells?.[f];
    lines.push(
      `| ${f} | ${sign(cur, prev, "cborx", "encNs")} | ${sign(cur, prev, "cborx", "decNs")} | ${sign(cur, prev, "cborg", "encNs")} | ${sign(cur, prev, "cborg", "decNs")} |`,
    );
  }
}
lines.push(``);
lines.push(`Rapport : ${path.relative(repoRoot, outFile)}`);
console.log(lines.join("\n"));
process.exit(invalid.length === 0 ? 0 : 1);
