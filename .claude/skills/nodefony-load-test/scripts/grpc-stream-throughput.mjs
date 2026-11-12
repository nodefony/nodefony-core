#!/usr/bin/env node
// Débit d'un flux serveur gRPC comparé à la socket binaire (#695, critère 22 ;
// ADR-0026 D4 « plancher par message de l'adaptateur »).
//
// Trois camps, MÊME transport chiffré (TLS — la production n'ouvre pas h2c),
// MÊME charge utile, MÊME client minimal qui compte des trames sans décoder :
//   grpc   — `EchoService.Watch` servi par Nodefony (Connect), h2 TLS
//   socket — `codec:burst` sur la socket CBOR de Nodefony (`/api/live/codec`), wss
//   h2-nu  — serveur `node:http2` seul, dans un process à part, qui écrit des
//            trames gRPC encodées UNE fois : le même fil, sans adaptateur.
//   h2-écriture — le même écrivain nu, qui écrit comme l'adaptateur (promesse +
//            deux écouteurs par message, `writeLikeConnect`), sans le reste.
// grpc − h2-nu (µs par message, petite charge) = plancher de l'adaptateur ;
// h2-écriture − h2-nu en isole la part due à sa discipline d'écriture. (Écarté
// sur mesure : attendre le rappel de chaque écriture coûte 37 µs/msg, l'adaptateur
// n'en paie que 8 — il ne l'attend que sous contre-pression.)
//
// Décor : un exemplaire `production` JETABLE (`startSpareApp`, ports attribués,
// le serveur de développement n'est pas touché), journal nul, codec CBOR, modules
// de banc chargés par dérogation. Camps ALTERNÉS à chaque passe (la dérive
// thermique porte sur tous), médiane de N passes, une passe de chauffe non comptée.
// Une passe n'est valide que si les N messages ET leurs octets sont arrivés.
/**
 * @usage    node .claude/skills/nodefony-load-test/scripts/grpc-stream-throughput.mjs
 * @usage    node .claude/skills/nodefony-load-test/scripts/grpc-stream-throughput.mjs --runs 9 --sizes 16,65536
 * @option   --runs   passes comptées par camp et par charge (défaut 7, plus une de chauffe)
 * @option   --sizes  charges utiles en octets, séparées par des virgules (défaut 16,1024,16384,65536)
 * @option   --out    données JSON (défaut tmp/bench/grpc-stream-throughput.json)
 * @option   --profile  dossier : profil CPU du serveur sous le seul camp grpc (première charge de --sizes), à lire par profile-analyze.mjs
 * @option   --profile-seconds  durée de charge du profil (défaut 25, ≥ 20)
 * @option   --serve-raw  interne : démarre le serveur `node:http2` des camps h2-nu et h2-écriture
 * @output   tableau msg/s et µs/msg par camp, plancher de l'adaptateur et verdict de séparation ; code 1 si une passe est invalide
 */

import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const certDir = path.join(
  repoRoot,
  "nodefony",
  "config",
  "certificates",
  "server",
);
const WATCH_PATH = "/nodefony.test.v1.EchoService/Watch";
const CBOR_PROTOCOL = "nodefony.jsonrpc.cbor.v1";
const PASS_TIMEOUT_MS = 60_000;
const CLIENT_WINDOW = 16 * 1024 * 1024;

// ── Protobuf minimal (varint, champs 1 à 3) ─────────────────────────────────

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** Trame gRPC (préfixe 5 octets) autour d'un message déjà encodé. */
function grpcFrame(message) {
  const frame = Buffer.allocUnsafe(5 + message.length);
  frame[0] = 0;
  frame.writeUInt32BE(message.length, 1);
  frame.set(message, 5);
  return frame;
}

/** `WatchRequest { burst, bytes, follow: false }`. */
function watchRequest(count, bytes) {
  return grpcFrame(
    Uint8Array.from([0x08, ...varint(count), 0x10, ...varint(bytes)]),
  );
}

/**
 * Longueur du champ `payload` d'un `WatchResponse` reçu (−1 s'il manque) : la
 * garde de validité exacte — comparer la taille du message laisserait
 * l'enveloppe protobuf masquer un octet manquant (vu : garde muette sur mutation).
 */
function payloadLength(message) {
  let i = 0;
  if (message[0] === 0x08) {
    i = 1;
    while (message[i++] & 0x80);
  }
  if (message[i++] !== 0x12) return -1;
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    const b = message[i++];
    length |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return length;
  }
}

/** `WatchResponse { seq, payload }` — ce que Connect écrit pour un message. */
function watchResponse(seq, bytes) {
  const head = [
    ...(seq > 0 ? [0x08, ...varint(seq)] : []),
    0x12,
    ...varint(bytes),
  ];
  const message = new Uint8Array(head.length + bytes);
  message.set(head, 0);
  return grpcFrame(message);
}

// ── Camp h2-nu : serveur `node:http2` seul (process enfant) ─────────────────

/**
 * Recopie de `write` de `@connectrpc/connect-node`
 * (`node-universal-handler.js#write`, 2.x) : une promesse, deux écouteurs
 * `once` posés puis retirés, un rappel d'écriture — par message. La copie est
 * voulue : c'est la discipline qu'on mesure, sans le reste de l'adaptateur.
 */
function writeLikeConnect(stream, data) {
  return new Promise((resolve, reject) => {
    if (stream.errored) return error(stream.errored);
    stream.once("error", error);
    stream.once("drain", drain);
    const flushed = stream.write(data, "binary", (err) => {
      if (err && !flushed) {
        error(err);
        stream.once("error", () => undefined);
      }
    });
    if (flushed) drain();
    function error(err) {
      stream.off("error", error);
      stream.off("drain", drain);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    function drain() {
      stream.off("error", error);
      stream.off("drain", drain);
      resolve();
    }
  });
}

async function serveRaw() {
  const server = http2.createSecureServer({
    key: fs.readFileSync(path.join(certDir, "privkey.pem")),
    cert: fs.readFileSync(path.join(certDir, "fullchain.pem")),
  });
  server.on("stream", (stream, headers) => {
    stream.on("error", () => undefined);
    const count = Number(headers["x-count"]);
    const bytes = Number(headers["x-bytes"]);
    // Encodée une fois : le plancher d'un écrivain qui ne fait QUE écrire.
    const frame = watchResponse(1, bytes);
    const connectWrite = headers["x-connect-write"] === "1";
    stream.respond({ ":status": 200, "content-type": "application/grpc" });
    stream.resume();
    void (async () => {
      for (let i = 0; i < count; i++) {
        if (stream.destroyed) return;
        if (connectWrite) {
          await writeLikeConnect(stream, frame);
        } else if (!stream.write(frame)) {
          await once(stream, "drain").catch(() => undefined);
        }
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
}

async function startRaw() {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--serve-raw"],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const [line] = await once(child.stdout, "data");
  const { port } = JSON.parse(String(line));
  return { port, stop: () => child.kill("SIGTERM") };
}

// ── Clients : comptent des trames, ne décodent rien ─────────────────────────

/** Une passe d'un flux gRPC (camps grpc et h2-nu) : instants du 1ᵉʳ et du Nᵉ message. */
function grpcPass(port, count, bytes, rawHeaders) {
  return new Promise((resolve, reject) => {
    // Fenêtre de réception de 16 Mio (flux ET connexion), comme l'estimation de
    // bande passante de grpc-go : avec les 64 Kio par défaut de Node, chaque
    // message de 64 Kio attend un WINDOW_UPDATE — on mesurerait l'aller-retour
    // du client, pas le serveur.
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
      settings: { initialWindowSize: CLIENT_WINDOW },
    });
    session.on("error", () => undefined);
    session.once("connect", () => session.setLocalWindowSize(CLIENT_WINDOW));
    const stream = session.request({
      ":method": "POST",
      ":path": WATCH_PATH,
      "content-type": "application/grpc",
      te: "trailers",
      ...(rawHeaders === null
        ? {}
        : {
            "x-count": String(count),
            "x-bytes": String(bytes),
            "x-connect-write": rawHeaders.connectWrite ? "1" : "0",
          }),
    });
    let received = 0;
    let payloadBytes = 0;
    let first = 0;
    let pending = Buffer.alloc(0);
    let need = -1;
    const timer = setTimeout(
      () =>
        finish(
          new Error(`${received}/${count} messages en ${PASS_TIMEOUT_MS} ms`),
        ),
      PASS_TIMEOUT_MS,
    );
    const finish = (err, result) => {
      clearTimeout(timer);
      stream.close(http2.constants.NGHTTP2_CANCEL);
      session.close();
      if (err instanceof Error) reject(err);
      else resolve(result);
    };
    stream.on("response", (h) => {
      const status = h["grpc-status"];
      if (status !== undefined && status !== "0") {
        finish(
          new Error(
            `grpc-status ${String(status)} ${String(h["grpc-message"] ?? "")}`,
          ),
        );
      }
    });
    stream.on("error", (e) => finish(e));
    stream.on("data", (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      for (;;) {
        if (need < 0) {
          if (pending.length < 5) return;
          need = pending.readUInt32BE(1);
          pending = pending.subarray(5);
        }
        if (pending.length < need) return;
        const length = payloadLength(pending.subarray(0, need));
        if (length !== bytes) {
          return finish(
            new Error(
              `message ${received + 1} : payload de ${length} octets, ${bytes} attendus`,
            ),
          );
        }
        pending = pending.subarray(need);
        payloadBytes += length;
        need = -1;
        if (++received === 1) first = performance.now();
        if (received === count) {
          return finish(null, {
            first,
            last: performance.now(),
            received,
            payloadBytes,
          });
        }
      }
    });
    stream.end(watchRequest(count, bytes));
  });
}

/** Une passe sur la socket CBOR : N notifications `codec:item`, puis la réponse. */
async function socketPass(WebSocket, codec, port, count, bytes) {
  const ws = new WebSocket(
    `wss://127.0.0.1:${port}/api/live/codec`,
    [CBOR_PROTOCOL],
    {
      rejectUnauthorized: false,
    },
  );
  ws.on("error", () => undefined);
  await once(ws, "open");
  if (ws.protocol !== CBOR_PROTOCOL)
    throw new Error(`sous-protocole « ${ws.protocol} »`);
  return new Promise((resolve, reject) => {
    let received = 0;
    let payloadBytes = 0;
    let first = 0;
    let last = 0;
    const timer = setTimeout(
      () =>
        finish(
          new Error(`${received}/${count} messages en ${PASS_TIMEOUT_MS} ms`),
        ),
      PASS_TIMEOUT_MS,
    );
    const finish = (err, result) => {
      clearTimeout(timer);
      ws.terminate();
      if (err instanceof Error) reject(err);
      else resolve(result);
    };
    ws.on("close", () =>
      finish(new Error(`socket fermée à ${received}/${count}`)),
    );
    ws.on("message", (data, isBinary) => {
      // L'accueil part en texte : il ouvre la rafale.
      if (!isBinary) {
        ws.send(
          codec.encode({
            jsonrpc: "2.0",
            id: 1,
            method: "codec:burst",
            params: { count, bytes },
          }),
        );
        return;
      }
      if (received < count) {
        if (++received === 1) first = performance.now();
        if (received === count) last = performance.now();
        // Garde exacte sur le premier et le dernier message seulement : décoder
        // chaque trame mettrait le codec du CLIENT dans la mesure.
        if (received === 1 || received === count) {
          const item = codec.decode(new Uint8Array(data))?.params;
          const size = item?.data?.byteLength;
          if (item?.seq !== received - 1 || size !== bytes) {
            return finish(
              new Error(
                `message ${received} : seq ${String(item?.seq)}, payload de ${String(size)} octets, ${bytes} attendus`,
              ),
            );
          }
        }
        payloadBytes += bytes;
        return;
      }
      // La réponse de l'action arrive APRÈS ses notifications.
      const reply = codec.decode(new Uint8Array(data));
      const result = reply?.result;
      if (result?.sent !== count || result?.dropped !== 0) {
        return finish(
          new Error(`réponse ${JSON.stringify(reply?.error ?? result)}`),
        );
      }
      finish(null, { first, last, received, payloadBytes });
    });
  });
}

// ── Statistiques ───────────────────────────────────────────────────────────

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** N tel qu'une passe dure ~1 s ou plus sans dépasser ~200 Mo sur le fil. */
const countFor = (bytes) =>
  Math.max(500, Math.min(100_000, Math.floor(2e8 / Math.max(bytes, 1024))));

// ── Banc ───────────────────────────────────────────────────────────────────

/** L'exemplaire `production` jetable du banc, `extraEnv` en plus du décor. */
async function startApp(extraEnv) {
  const { startSpareApp } = await import("nodefony/testing");
  const httpsPort = await freePort();
  process.stdout.write(`exemplaire production jetable (https ${httpsPort})…\n`);
  const app = await startSpareApp({
    port: 0,
    httpsPort,
    root: repoRoot,
    timeoutMs: 120_000,
    env: {
      NODE_ENV: "production",
      NF_LOG_DRIVER: "null",
      NF_REALTIME_CODEC: "cbor",
      NF_WITH_DEV_MODULES: "1",
      NF_WITH_DEV_MODULES_TTL_MIN: "120",
      ...extraEnv,
    },
  });
  return { app, httpsPort };
}

/**
 * Profil CPU du serveur sous le seul camp `grpc` — de quoi découper le
 * plancher de l'adaptateur par fonction. Le flux tourne sans relâche
 * `seconds` secondes (≥ 20 : `profile-analyze.mjs` lit les 20 DERNIÈRES
 * secondes actives), puis l'exemplaire s'arrête et écrit son profil. Rend le
 * nombre de messages servis sur ces 20 s, à passer à `profile-analyze.mjs`.
 */
async function profileGrpc(dir, bytes, seconds) {
  fs.mkdirSync(dir, { recursive: true });
  const { app, httpsPort } = await startApp({
    NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir}`,
  });
  const count = countFor(bytes);
  let messages = 0;
  let busy = 0;
  try {
    // Chauffe (JIT), hors fenêtre utile.
    await grpcPass(httpsPort, count, bytes, null);
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      const r = await grpcPass(httpsPort, count, bytes, null);
      messages += r.received;
      busy += r.last - r.first;
    }
  } finally {
    // `stop()` tue d'un SIGKILL : Node n'écrit alors AUCUN profil. Arrêt
    // propre d'abord, par la commande du produit — l'état d'exécution du dépôt
    // désigne l'exemplaire jetable tant qu'il vit. `stop()` restaure ensuite.
    const bin = path.join(repoRoot, "src", "nodefony", "bin", "nodefony");
    const stopped = spawn(process.execPath, [bin, "stop"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    await once(stopped, "exit");
    await app.stop();
  }
  const written = fs.readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
  if (written.length === 0) {
    process.stdout.write(`aucun profil écrit dans ${dir}\n`);
    process.exitCode = 1;
    return;
  }
  const rate = messages / (busy / 1000);
  const inWindow = Math.round(rate * 20);
  process.stdout.write(
    `${messages} messages de ${bytes} o en ${seconds} s (${Math.round(rate)} msg/s)\n` +
      `profil : ${dir}\n` +
      `node .claude/skills/nodefony-load-test/scripts/profile-analyze.mjs ${dir} ${inWindow}\n`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      runs: { type: "string", default: "7" },
      sizes: { type: "string", default: "16,1024,16384,65536" },
      out: {
        type: "string",
        default: path.join("tmp", "bench", "grpc-stream-throughput.json"),
      },
      profile: { type: "string" },
      "profile-seconds": { type: "string", default: "25" },
    },
  });
  const runs = Number(values.runs);
  const sizes = values.sizes.split(",").map(Number);
  if (values.profile !== undefined) {
    return profileGrpc(
      path.resolve(values.profile),
      sizes[0],
      Number(values["profile-seconds"]),
    );
  }
  const { CBOR_FRAME_CODEC } = await import("nodefony/cbor");
  const { WebSocket } = await import("ws");

  const { app, httpsPort } = await startApp({});
  const raw = await startRaw();
  const camps = {
    grpc: (n, b) => grpcPass(httpsPort, n, b, null),
    socket: (n, b) => socketPass(WebSocket, CBOR_FRAME_CODEC, httpsPort, n, b),
    "h2-nu": (n, b) => grpcPass(raw.port, n, b, { connectWrite: false }),
    "h2-écriture": (n, b) => grpcPass(raw.port, n, b, { connectWrite: true }),
  };
  const names = Object.keys(camps);
  const results = [];
  let invalid = 0;
  try {
    for (const bytes of sizes) {
      const count = countFor(bytes);
      const samples = Object.fromEntries(names.map((n) => [n, []]));
      for (let run = 0; run <= runs; run++) {
        // Ordre tourné à chaque passe : aucun camp ne passe toujours en premier.
        const order = names.map((_, i) => names[(i + run) % names.length]);
        for (const name of order) {
          try {
            const r = await camps[name](count, bytes);
            if (r.payloadBytes < count * bytes)
              throw new Error(`${r.payloadBytes} octets < ${count * bytes}`);
            // Passe 0 = chauffe (JIT), jamais comptée.
            if (run > 0)
              samples[name].push((r.last - r.first) / (r.received - 1));
          } catch (e) {
            invalid++;
            process.stdout.write(
              `  ✗ ${name} ${bytes} o passe ${run} : ${e.message}\n`,
            );
          }
        }
      }
      for (const name of names) {
        const xs = samples[name];
        if (xs.length === 0) continue;
        const med = median(xs) * 1000; // µs par message
        const spread = ((Math.max(...xs) - Math.min(...xs)) / median(xs)) * 100;
        results.push({
          camp: name,
          bytes,
          count,
          runs: xs.length,
          usPerMsg: med,
          minUs: Math.min(...xs) * 1000,
          maxUs: Math.max(...xs) * 1000,
          msgPerSec: 1e6 / med,
          spreadPct: spread,
        });
      }
      process.stdout.write(`✓ ${bytes} o × ${count}\n`);
    }
  } finally {
    raw.stop();
    await app.stop();
  }

  const fmt = (x, d = 2) =>
    x.toLocaleString("fr-FR", { maximumFractionDigits: d });
  process.stdout.write(
    `\n| charge | camp | msg/s | µs/msg | dispersion |\n|---|---|---:|---:|---:|\n`,
  );
  for (const r of results) {
    process.stdout.write(
      `| ${r.bytes} o | ${r.camp} | ${fmt(r.msgPerSec, 0)} | ${fmt(r.usPerMsg)} | ${fmt(r.spreadPct, 1)} % |\n`,
    );
  }
  // Un écart ne se retient que si les séries ne se recouvrent pas : sous une
  // dispersion plus large que l'écart, il n'y a rien à conclure.
  const separated = (a, b) =>
    a.maxUs < b.minUs || b.maxUs < a.minUs ? "séparés" : "DANS LE BRUIT";
  for (const bytes of sizes) {
    const at = (camp) =>
      results.find((r) => r.camp === camp && r.bytes === bytes);
    const [g, s, n, c] = [
      at("grpc"),
      at("socket"),
      at("h2-nu"),
      at("h2-écriture"),
    ];
    if (g && n) {
      process.stdout.write(
        `${bytes} o — plancher adaptateur (grpc − h2-nu) : ${fmt(g.usPerMsg - n.usPerMsg)} µs/msg, ${separated(g, n)}`,
      );
    }
    if (c && n)
      process.stdout.write(
        ` · dont écriture de Connect (h2-écriture − h2-nu) : ${fmt(c.usPerMsg - n.usPerMsg)}, ${separated(c, n)}`,
      );
    if (g && s)
      process.stdout.write(
        ` · grpc/socket ×${fmt(g.usPerMsg / s.usPerMsg)}, ${separated(g, s)}`,
      );
    process.stdout.write("\n");
  }
  const decor = {
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    cpus: os.cpus()[0]?.model,
    runs,
    transport: "TLS (h2 / wss)",
  };
  fs.mkdirSync(path.dirname(values.out), { recursive: true });
  fs.writeFileSync(
    values.out,
    JSON.stringify({ decor, results, invalid }, null, 2),
  );
  process.stdout.write(
    `\ndonnées : ${values.out}${invalid ? ` — ${invalid} passe(s) INVALIDE(S)` : ""}\n`,
  );
  process.exitCode = invalid > 0 || results.length === 0 ? 1 : 0;
}

if (process.argv.includes("--serve-raw")) await serveRaw();
else await main();
