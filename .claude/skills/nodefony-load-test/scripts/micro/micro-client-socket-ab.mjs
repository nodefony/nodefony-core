/**
 * Micro-banc A/B — ce que coûte, PAR TRAME, la socket du NAVIGATEUR
 * (`NodefonySocket`), entre deux arbres de sources du cœur (avant / après un diff).
 *
 * Chaque arbre est BUNDLÉ par rolldown (le bundler du dépôt, minifié, plateforme
 * navigateur) : on mesure ce qu'une page exécute, pas les sources. La socket tourne
 * sur un transport factice, connexion accueillie (welcome émis), un écouteur posé.
 *
 * Chemins :
 * - `in-text`   : notification JSON reçue → décodage → journal → moteur → écouteur ;
 * - `out-text`  : `publish` → frame → sérialisation → journal → `transport.send` ;
 * - `in-cbor` / `out-cbor` : les mêmes sous codec CBOR retenu (arbre qui le porte) ;
 * - `in-bytes`  : notification CBOR portant 4 Ko d'octets (la voie du binaire routé) ;
 * - `in-bytes-json` : la MÊME charge sur une connexion restée en texte (convention
 *   `$bytes`, base64url) — la comparaison qui dit ce que le binaire rapporte.
 * Le parent imprime aussi la taille de chaque trame sur le fil, texte et CBOR.
 *
 * Protocole : un PROCESS par mesure (JIT frais), variantes ALTERNÉES, médiane de
 * RUNS. Validité : l'écouteur doit avoir vu chaque trame entrante, le transport
 * chaque trame sortante — sinon exit 1, aucun chiffre publié.
 *
 * Usage :
 *   node micro-client-socket-ab.mjs --a <src avant> --b <src après> [--runs 7]
 *   (un `src` = un dossier `src/nodefony/src`, ou sa copie : `git archive HEAD src/nodefony/src | tar -x -C …`)
 *   Un arbre dont la socket ne négocie pas de codec ne court que les chemins texte
 *   (capacité constatée à l'exécution, cf `socket.codec`).
 * Mode enfant (interne) : --child <bundle.mjs> <chemin>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WARM = 2e5;
const N = 1e6;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

if (args[0] === "--child") await child(args[1], args[2]);
else await parent();

/** Bundle la socket et le codec CBOR d'un arbre de sources → un module ESM. */
async function bundle(src, out) {
  const { rolldown } = await import(
    pathToFileURL(path.join(ROOT, "node_modules/rolldown/dist/index.mjs")).href
  );
  const entry = path.join(
    path.dirname(out),
    `${path.basename(out, ".mjs")}-entry.ts`,
  );
  const hasCodec = fs.existsSync(
    path.join(src, "realtime/codec/frameCodec.ts"),
  );
  // Sans codec écrit, les chemins CBOR ne peuvent même pas se construire.
  fs.writeFileSync(
    entry,
    `export { NodefonySocket } from ${JSON.stringify(path.join(src, "client/realtime/NodefonySocket.ts"))};\n` +
      (hasCodec
        ? `export { CBOR_FRAME_CODEC } from ${JSON.stringify(path.join(src, "realtime/codec/frameCodec.ts"))};\n` +
          `export { encodeCbor } from ${JSON.stringify(path.join(src, "realtime/codec/encode.ts"))};\n`
        : ""),
  );
  const b = await rolldown({
    input: entry,
    platform: "browser",
    onLog: () => {},
  });
  await b.write({
    file: out,
    format: "esm",
    minify: true,
    codeSplitting: false,
  });
  await b.close();
  fs.rmSync(entry);
  return hasCodec;
}

/** Mesure UN chemin sur UN bundle, imprime `ns/trame` en JSON. */
async function child(bundlePath, which) {
  const m = await import(pathToFileURL(bundlePath).href);
  const cbor = which.endsWith("cbor") || which.startsWith("in-bytes");
  // `in-bytes-json` : codec offert, mais serveur resté en texte (pas de champ `codec`).
  const announce = cbor && which !== "in-bytes-json";
  let sent = 0;
  let deliver = null;
  const transport = {
    readyState: 0,
    bufferedAmount: 0,
    connect() {},
    send() {
      sent++;
    },
    close() {},
    onOpen(cb) {
      this.open = cb;
    },
    onMessage(cb) {
      deliver = cb;
    },
    onClose() {},
    onError() {},
  };
  const socket = new m.NodefonySocket(
    {
      url: "ws://bench/realtime",
      banner: false,
      probe: false,
      heartbeatInterval: 0,
      ...(cbor ? { codec: m.CBOR_FRAME_CODEC } : {}),
    },
    () => transport,
  );
  const p = socket.connect();
  transport.readyState = 1;
  transport.open();
  deliver(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "realtime:welcome",
      params: {
        ts: 1,
        protocol: "jsonrpc-2.0",
        channels: [],
        methods: [],
        ...(announce ? { codec: m.CBOR_FRAME_CODEC.protocol } : {}),
      },
    }),
  );
  await p;
  // Capacité CONSTATÉE : une socket sans négociation (pas de `codec`) ne court
  // pas les chemins CBOR — elle n'en sait rien, ce n'est pas un échec.
  if (cbor && socket.codec === undefined) {
    console.log(JSON.stringify({ ns: null }));
    process.exit(0);
  }
  if (announce && socket.codec !== m.CBOR_FRAME_CODEC.protocol) {
    console.error("codec CBOR non retenu");
    process.exit(1);
  }
  let seen = 0;
  socket.on("bench:tick", () => {
    seen++;
  });
  const payload = { n: 1, s: "x", t: 1730000000000 };
  const frame = { jsonrpc: "2.0", method: "bench:tick", params: payload };
  const text = JSON.stringify(frame);
  const step = {
    "in-text": () => deliver(text),
    "out-text": () => socket.publish("bench:tick", payload),
    "in-cbor": () => {
      const raw = m.encodeCbor(frame);
      return () => deliver(raw);
    },
    "out-cbor": () => socket.publish("bench:tick", payload),
    "in-bytes": () => {
      const raw = m.encodeCbor({
        jsonrpc: "2.0",
        method: "bench:tick",
        params: { delta: new Uint8Array(4096) },
      });
      return () => deliver(raw);
    },
    "in-bytes-json": () => {
      const raw = m.CBOR_FRAME_CODEC.textCodec.encode({
        jsonrpc: "2.0",
        method: "bench:tick",
        params: { delta: new Uint8Array(4096) },
      });
      return () => deliver(raw);
    },
    sizes: null,
  }[which];
  if (which === "sizes") {
    const small = frame;
    const bytes = {
      jsonrpc: "2.0",
      method: "bench:tick",
      params: { delta: new Uint8Array(4096) },
    };
    const t = m.CBOR_FRAME_CODEC.textCodec;
    console.log(
      JSON.stringify({
        sizes: {
          "petit objet": {
            texte: JSON.stringify(small).length,
            cbor: m.encodeCbor(small).byteLength,
          },
          "4 Ko d'octets": {
            texte: t.encode(bytes).length,
            cbor: m.encodeCbor(bytes).byteLength,
          },
        },
      }),
    );
    process.exit(0);
  }
  if (step === undefined) throw new Error(`chemin inconnu : ${which}`);
  const run =
    which === "in-cbor" || which.startsWith("in-bytes") ? step() : step;
  const outbound = which.startsWith("out");
  for (let i = 0; i < WARM; i++) run();
  const before = outbound ? sent : seen;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) run();
  const ns = Number(process.hrtime.bigint() - t0) / N;
  const done = (outbound ? sent : seen) - before;
  if (done !== N) {
    console.error(`${which} : ${done} trames traitées pour ${N}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ns }));
  // La socket garde ses minuteurs (échantillonneur de stats) : sans sortie
  // explicite l'enfant ne rend jamais la main, et le parent attend pour toujours.
  socket.disconnect();
  process.exit(0);
}

async function parent() {
  const a = opt("--a");
  const b = opt("--b");
  const runs = Number(opt("--runs", "7"));
  if (!a || !b) {
    console.error("usage : --a <src avant> --b <src après> [--runs 7]");
    process.exit(2);
  }
  const dir = path.join(ROOT, "tmp/bench");
  fs.mkdirSync(dir, { recursive: true });
  const bundleA = path.join(dir, "client-socket-a.mjs");
  const bundleB = path.join(dir, "client-socket-b.mjs");
  await bundle(path.resolve(a), bundleA);
  await bundle(path.resolve(b), bundleB);
  const self = fileURLToPath(import.meta.url);
  const measure = (file, which) => {
    const r = spawnSync(process.execPath, [self, "--child", file, which], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    return JSON.parse(r.stdout.trim().split("\n").pop()).ns;
  };
  const median = (xs) =>
    [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  {
    const r = spawnSync(process.execPath, [self, "--child", bundleB, "sizes"], {
      encoding: "utf8",
    });
    const line = r.stdout.trim().split("\n").pop();
    if (r.status === 0 && line) {
      const { sizes } = JSON.parse(line);
      console.log("Taille sur le fil (B) :");
      console.table(
        Object.fromEntries(
          Object.entries(sizes).map(([k, v]) => [
            k,
            { ...v, "gain %": ((1 - v.cbor / v.texte) * 100).toFixed(0) },
          ]),
        ),
      );
    }
  }
  const rows = [];
  for (const which of [
    "in-text",
    "out-text",
    "in-cbor",
    "out-cbor",
    "in-bytes",
    "in-bytes-json",
  ]) {
    const A = [];
    const B = [];
    for (let i = 0; i < runs; i++) {
      const na = measure(bundleA, which);
      const nb = measure(bundleB, which);
      if (na !== null) A.push(na);
      if (nb !== null) B.push(nb);
    }
    const ma = A.length ? median(A) : NaN;
    const mb = B.length ? median(B) : NaN;
    rows.push({
      chemin: which,
      "A ns/trame": A.length ? ma.toFixed(1) : "—",
      "B ns/trame": B.length ? mb.toFixed(1) : "—",
      "écart %":
        A.length && B.length ? (((mb - ma) / ma) * 100).toFixed(1) : "—",
      "B min–max": B.length
        ? `${Math.min(...B).toFixed(0)}–${Math.max(...B).toFixed(0)}`
        : "—",
    });
  }
  console.table(rows);
}
