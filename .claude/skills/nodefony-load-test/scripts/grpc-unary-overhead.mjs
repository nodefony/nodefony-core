// Surcoût du pipeline Nodefony par appel gRPC UNAIRE, et débit de ses refus
// (#695, critères 8 et 27 ; ADR-0026 D4 et D5).
//
// Critère 8 — deux camps, MÊME contrat (`EchoService.Say`), MÊME gestionnaire,
// MÊME transport chiffré (TLS — la production n'ouvre pas h2c) :
//   nodefony       — la route servie par Nodefony : pipeline complet (contexte,
//                    portée, pare-feu, gardes, journal) puis Connect.
//   adaptateur-nu  — `connectNodeAdapter` seul sur `http2.createSecureServer`,
//                    dans un process à part : ce que paierait l'application
//                    sans le framework.
// nodefony − adaptateur-nu = ce que le pipeline coûte par appel (µs assumées :
// il porte la sécurité, la corrélation et l'observabilité ; aucun objectif de
// « battre » l'adaptateur nu).
//
// Critère 27 — le MÊME refus sur la MÊME route (`GuardedEchoService/Member`,
// zone JWT, appel sans jeton), dans les deux formes que rend D5 :
//   refus-grpc  — `application/grpc` : 200 + `grpc-status: 16`.
//   refus-json  — protocole Connect `application/json` : 401 + JSON.
//
// Deux mesures par camp et par passe :
//   série   — un appel à la fois, sur une session : latence par appel.
//   charge  — `--workers` processus clients, `--concurrency` appels en vol
//             chacun : appels/s du serveur, d'où ses µs par appel.
// Décor : un exemplaire `production` JETABLE (`startSpareApp`, ports attribués,
// le serveur de développement n'est pas touché), journal nul, modules de banc
// chargés par dérogation (les zones du module `test` viennent avec lui). Camps
// ALTERNÉS à chaque passe, une passe de chauffe non comptée, médiane de N.
// CHAQUE réponse est vérifiée (statut HTTP, `grpc-status`) : une seule réponse
// fausse invalide la passe.
/**
 * @usage    node .claude/skills/nodefony-load-test/scripts/grpc-unary-overhead.mjs
 * @usage    node .claude/skills/nodefony-load-test/scripts/grpc-unary-overhead.mjs --runs 9 --sizes 16
 * @option   --runs         passes comptées par camp et par charge utile (défaut 7, plus une de chauffe)
 * @option   --sizes        longueurs de la phrase envoyée, en octets, séparées par des virgules (défaut 16,1024)
 * @option   --calls        appels chronométrés par passe série (défaut 2000)
 * @option   --seconds      durée d'une passe sous charge (défaut 3)
 * @option   --workers      processus clients sous charge (défaut 2)
 * @option   --concurrency  appels en vol par processus client (défaut 32)
 * @option   --out          données JSON (défaut tmp/bench/grpc-unary-overhead.json)
 * @option   --profile      dossier : profil CPU de l'exemplaire production sous le seul camp `--camp`, à lire par profile-analyze.mjs
 * @option   --camp         camp profilé (défaut nodefony ; refus-grpc, refus-json)
 * @option   --profile-seconds  durée de charge du profil (défaut 25, ≥ 20)
 * @option   --serve-raw    interne : démarre le serveur du camp adaptateur-nu
 * @option   --load         interne : processus client d'une passe sous charge
 * @output   tableau série/charge par camp, surcoût du pipeline (8), rapport des refus (27) et verdict de séparation ; code 1 si une passe est invalide
 */

import http2 from "node:http2";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const certDir = path.join(
  repoRoot,
  "nodefony",
  "config",
  "certificates",
  "server",
);
const echoPb = path.join(
  repoRoot,
  "src",
  "modules",
  "test",
  "dist",
  "nodefony",
  "gen",
  "nodefony",
  "test",
  "v1",
  "echo_pb.js",
);
const SAY_PATH = "/nodefony.test.v1.EchoService/Say";
const MEMBER_PATH = "/nodefony.test.v1.GuardedEchoService/Member";
const PASS_TIMEOUT_MS = 120_000;

// ── Fil : un message `{ sentence }` (champ 1, chaîne), encodé UNE fois ──────

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** `SayRequest` et `MemberRequest` ont la même forme : `string sentence = 1`. */
function sentenceFrame(bytes) {
  const text = Buffer.from("x".repeat(bytes));
  const message = Buffer.concat([
    Buffer.from([0x0a, ...varint(text.length)]),
    text,
  ]);
  const head = Buffer.alloc(5);
  head.writeUInt32BE(message.length, 1);
  return Buffer.concat([head, message]);
}

/** La requête et le verdict attendu de chaque camp. */
function campSpec(camp, bytes) {
  const grpcHeaders = (p) => ({
    ":method": "POST",
    ":path": p,
    "content-type": "application/grpc",
    te: "trailers",
  });
  switch (camp) {
    case "nodefony":
    case "adaptateur-nu":
      return {
        headers: grpcHeaders(SAY_PATH),
        body: sentenceFrame(bytes),
        ok: (status, grpc) => status === 200 && grpc === "0",
      };
    case "refus-grpc":
      return {
        headers: grpcHeaders(MEMBER_PATH),
        body: sentenceFrame(bytes),
        ok: (status, grpc) => status === 200 && grpc === "16",
      };
    case "refus-json":
      return {
        headers: {
          ":method": "POST",
          ":path": MEMBER_PATH,
          "content-type": "application/json",
          "connect-protocol-version": "1",
        },
        body: Buffer.from(JSON.stringify({ sentence: "x".repeat(bytes) })),
        ok: (status) => status === 401,
      };
    default:
      throw new Error(`camp inconnu : ${camp}`);
  }
}

function connect(port) {
  const session = http2.connect(`https://127.0.0.1:${port}`, {
    rejectUnauthorized: false,
  });
  session.on("error", () => undefined);
  session.on("goaway", (code) => {
    session.goawayCode = code;
  });
  return session;
}

/** Un appel ; rappel avec `true` si la réponse est celle qu'attend le camp. */
function call(session, spec, done) {
  const stream = session.request(spec.headers);
  let status = 0;
  let grpc;
  stream.on("response", (h) => {
    status = Number(h[":status"]);
    if (h["grpc-status"] !== undefined) grpc = String(h["grpc-status"]);
  });
  stream.on("trailers", (h) => {
    if (h["grpc-status"] !== undefined) grpc = String(h["grpc-status"]);
  });
  stream.on("error", () => undefined);
  stream.on("close", () =>
    done(
      spec.ok(status, grpc),
      status === 0
        ? `sans réponse (RST ${stream.rstCode}${session.goawayCode === undefined ? "" : `, GOAWAY ${session.goawayCode}`})`
        : `${status}/${grpc ?? "-"}`,
    ),
  );
  stream.resume();
  stream.end(spec.body);
}

const callP = (session, spec) =>
  new Promise((resolve) =>
    call(session, spec, (ok, got) => resolve([ok, got])),
  );

// ── Passe série : un appel à la fois ────────────────────────────────────────

async function serialPass(port, spec, calls) {
  const session = connect(port);
  await once(session, "connect");
  try {
    for (let i = 0; i < 200; i++) await callP(session, spec);
    let bad = 0;
    const seen = new Map();
    const start = performance.now();
    for (let i = 0; i < calls; i++) {
      const [ok, got] = await callP(session, spec);
      if (!ok) {
        bad++;
        seen.set(got, (seen.get(got) ?? 0) + 1);
      }
    }
    const us = ((performance.now() - start) * 1000) / calls;
    if (bad > 0)
      throw new Error(
        `${bad}/${calls} réponses inattendues (statut/grpc-status : ${[...seen].map(([k, v]) => `${k} ×${v}`).join(", ")})`,
      );
    return us;
  } finally {
    session.close();
  }
}

// ── Passe sous charge : processus clients ───────────────────────────────────

/** Processus client : `concurrency` appels en vol jusqu'à l'échéance. */
async function loadWorker(argJson) {
  const { port, camp, bytes, ms, concurrency } = JSON.parse(argJson);
  const spec = campSpec(camp, bytes);
  const session = connect(port);
  await once(session, "connect");
  let counting = false;
  let stop = false;
  let calls = 0;
  let bad = 0;
  const seen = {};
  let inFlight = 0;
  let resolveIdle;
  const idle = new Promise((r) => (resolveIdle = r));
  const launch = () => {
    inFlight++;
    call(session, spec, (ok, got) => {
      inFlight--;
      if (counting) {
        calls++;
        if (!ok) {
          bad++;
          seen[got] = (seen[got] ?? 0) + 1;
        }
      }
      if (!stop) launch();
      else if (inFlight === 0) resolveIdle();
    });
  };
  for (let i = 0; i < concurrency; i++) launch();
  // Chauffe non comptée : les sessions et le JIT des deux côtés.
  await new Promise((r) => setTimeout(r, 300));
  counting = true;
  const start = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  counting = false;
  const elapsed = performance.now() - start;
  stop = true;
  await idle;
  session.close();
  process.stdout.write(`${JSON.stringify({ calls, bad, seen, elapsed })}\n`);
}

async function loadPass(port, camp, bytes, opts) {
  const args = JSON.stringify({
    port,
    camp,
    bytes,
    ms: opts.seconds * 1000,
    concurrency: opts.concurrency,
  });
  const workers = Array.from({ length: opts.workers }, () => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--load", args],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    return once(child, "exit").then(() => JSON.parse(out));
  });
  const results = await Promise.all(workers);
  const bad = results.reduce((s, r) => s + r.bad, 0);
  if (bad > 0) {
    const seen = {};
    for (const r of results)
      for (const [k, v] of Object.entries(r.seen)) seen[k] = (seen[k] ?? 0) + v;
    throw new Error(
      `${bad} réponses inattendues sous charge (statut/grpc-status : ${Object.entries(
        seen,
      )
        .map(([k, v]) => `${k} ×${v}`)
        .join(", ")})`,
    );
  }
  // Débit total : somme des débits de chaque client sur sa propre fenêtre.
  const rate = results.reduce((s, r) => s + r.calls / (r.elapsed / 1000), 0);
  return rate;
}

// ── Camp adaptateur-nu : Connect seul, même gestionnaire ────────────────────

async function serveRaw() {
  const { connectNodeAdapter } = await import("@connectrpc/connect-node");
  const { EchoService } = await import(pathToFileURL(echoPb).href);
  // Le gestionnaire du module test (`GrpcEchoController#say`), au détail près
  // de la corrélation : le `requestId` est le travail du pipeline.
  const sayCalls = new Map();
  const handler = connectNodeAdapter({
    routes: (router) =>
      router.service(EchoService, {
        say(request, ctx) {
          if (ctx.requestHeader.get("x-fail") === "plain") {
            throw new Error("panne voulue (x-fail)");
          }
          const witness = ctx.requestHeader.get("x-witness") ?? "";
          if (!sayCalls.has(witness) && sayCalls.size >= 1024) sayCalls.clear();
          const calls = (sayCalls.get(witness) ?? 0) + 1;
          sayCalls.set(witness, calls);
          return {
            sentence: request.sentence,
            requestId: "",
            instance: 1,
            calls,
          };
        },
      }),
  });
  const server = http2.createSecureServer(
    {
      key: fs.readFileSync(path.join(certDir, "privkey.pem")),
      cert: fs.readFileSync(path.join(certDir, "fullchain.pem")),
    },
    handler,
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
}

async function startRaw() {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--serve-raw"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const [line] = await once(child.stdout, "data");
  const { port } = JSON.parse(String(line));
  return { port, stop: () => child.kill("SIGTERM") };
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** L'exemplaire `production` jetable du banc, `extraEnv` en plus du décor. */
async function startApp(extraEnv = {}) {
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
      NF_WITH_DEV_MODULES: "1",
      NF_WITH_DEV_MODULES_TTL_MIN: "120",
      ...extraEnv,
    },
  });
  return { app, httpsPort };
}

/**
 * Profil CPU de l'exemplaire `production` sous le seul camp `camp`, en charge
 * continue `seconds` secondes (≥ 20 : `profile-analyze.mjs` lit les 20
 * DERNIÈRES secondes actives). Rend le nombre d'appels servis sur 20 s, à
 * passer à `profile-analyze.mjs` pour lire des µs PAR APPEL.
 */
async function profileCamp(dir, camp, bytes, seconds, loadOpts) {
  if (camp === "adaptateur-nu")
    throw new Error("le profil vise l'exemplaire Nodefony");
  fs.mkdirSync(dir, { recursive: true });
  const { app, httpsPort } = await startApp({
    NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir}`,
  });
  let rate = 0;
  try {
    // Chauffe (JIT), hors fenêtre utile.
    await loadPass(httpsPort, camp, bytes, { ...loadOpts, seconds: 2 });
    rate = await loadPass(httpsPort, camp, bytes, { ...loadOpts, seconds });
  } finally {
    // Arrêt GRACIEUX de l'exemplaire seul : un SIGKILL n'écrit AUCUN profil,
    // et `nodefony stop` arrêterait TOUS les process du projet — serveur de
    // développement de l'auteur compris.
    const outcome = await app.stop({ graceful: true });
    if (outcome !== "graceful") {
      process.stdout.write(`arrêt ${outcome} : profil probablement absent\n`);
    }
  }
  const written = fs.readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
  if (written.length === 0) {
    process.stdout.write(`aucun profil écrit dans ${dir}\n`);
    process.exitCode = 1;
    return;
  }
  const inWindow = Math.round(rate * 20);
  process.stdout.write(
    `${camp} : ${Math.round(rate)} appels/s pendant ${seconds} s\n` +
      `profil : ${dir}\n` +
      `node .claude/skills/nodefony-load-test/scripts/profile-analyze.mjs ${dir} ${inWindow}\n`,
  );
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} : plus de ${PASS_TIMEOUT_MS} ms`)),
        PASS_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function main() {
  const { values } = parseArgs({
    options: {
      runs: { type: "string", default: "7" },
      sizes: { type: "string", default: "16,1024" },
      calls: { type: "string", default: "2000" },
      seconds: { type: "string", default: "3" },
      workers: { type: "string", default: "2" },
      concurrency: { type: "string", default: "32" },
      out: {
        type: "string",
        default: path.join("tmp", "bench", "grpc-unary-overhead.json"),
      },
      profile: { type: "string" },
      camp: { type: "string", default: "nodefony" },
      "profile-seconds": { type: "string", default: "25" },
      "serve-raw": { type: "boolean", default: false },
      load: { type: "string" },
    },
  });
  if (values["serve-raw"]) return serveRaw();
  if (values.load !== undefined) return loadWorker(values.load);

  const runs = Number(values.runs);
  const sizes = values.sizes.split(",").map(Number);
  const calls = Number(values.calls);
  const loadOpts = {
    seconds: Number(values.seconds),
    workers: Number(values.workers),
    concurrency: Number(values.concurrency),
  };

  if (values.profile !== undefined) {
    return profileCamp(
      path.resolve(values.profile),
      values.camp,
      sizes[0],
      Number(values["profile-seconds"]),
      loadOpts,
    );
  }

  const { app, httpsPort } = await startApp();
  const raw = await startRaw();
  const portOf = (camp) => (camp === "adaptateur-nu" ? raw.port : httpsPort);
  const names = ["nodefony", "adaptateur-nu", "refus-grpc", "refus-json"];
  const results = [];
  let invalid = 0;
  try {
    for (const bytes of sizes) {
      const serial = Object.fromEntries(names.map((n) => [n, []]));
      const load = Object.fromEntries(names.map((n) => [n, []]));
      for (let run = 0; run <= runs; run++) {
        // Ordre tourné à chaque passe : aucun camp ne passe toujours en premier.
        const order = names.map((_, i) => names[(i + run) % names.length]);
        for (const name of order) {
          const spec = campSpec(name, bytes);
          try {
            const us = await withTimeout(
              serialPass(portOf(name), spec, calls),
              `${name} série`,
            );
            const rate = await withTimeout(
              loadPass(portOf(name), name, bytes, loadOpts),
              `${name} charge`,
            );
            // Passe 0 = chauffe (JIT), jamais comptée.
            if (run > 0) {
              serial[name].push(us);
              load[name].push(1e6 / rate);
            }
          } catch (e) {
            invalid++;
            process.stdout.write(
              `  ✗ ${name} ${bytes} o passe ${run} : ${e.message}\n`,
            );
          }
        }
        process.stdout.write(`  passe ${run}/${runs} (${bytes} o)\n`);
      }
      for (const name of names) {
        if (serial[name].length === 0) continue;
        const s = serial[name];
        const l = load[name];
        results.push({
          camp: name,
          bytes,
          runs: s.length,
          serialUs: median(s),
          serialMinUs: Math.min(...s),
          serialMaxUs: Math.max(...s),
          loadUs: median(l),
          loadMinUs: Math.min(...l),
          loadMaxUs: Math.max(...l),
          callsPerSec: 1e6 / median(l),
        });
      }
    }
  } finally {
    raw.stop();
    await app.stop();
  }

  const fmt = (x, d = 1) =>
    x.toLocaleString("fr-FR", { maximumFractionDigits: d });
  process.stdout.write(
    `\n| charge | camp | série µs/appel (min-max) | charge appels/s | charge µs/appel (min-max) |\n|---|---|---:|---:|---:|\n`,
  );
  for (const r of results) {
    process.stdout.write(
      `| ${r.bytes} o | ${r.camp} | ${fmt(r.serialUs)} (${fmt(r.serialMinUs)}-${fmt(r.serialMaxUs)}) | ${fmt(r.callsPerSec, 0)} | ${fmt(r.loadUs)} (${fmt(r.loadMinUs)}-${fmt(r.loadMaxUs)}) |\n`,
    );
  }
  // Un écart ne se retient que si les séries ne se recouvrent pas.
  const separated = (a, b, k) =>
    a[`${k}MaxUs`] < b[`${k}MinUs`] || b[`${k}MaxUs`] < a[`${k}MinUs`]
      ? "séparés"
      : "DANS LE BRUIT";
  for (const bytes of sizes) {
    const at = (camp) =>
      results.find((r) => r.camp === camp && r.bytes === bytes);
    const [n, a, g, j] = names.map(at);
    if (n && a) {
      process.stdout.write(
        `${bytes} o — critère 8, pipeline (nodefony − adaptateur-nu) : série ${fmt(n.serialUs - a.serialUs)} µs, ${separated(n, a, "serial")} · charge ${fmt(n.loadUs - a.loadUs)} µs, ${separated(n, a, "load")}\n`,
      );
    }
    if (g && j) {
      process.stdout.write(
        `${bytes} o — critère 27, refus-grpc / refus-json : série ×${fmt(g.serialUs / j.serialUs, 2)}, ${separated(g, j, "serial")} · charge ×${fmt(g.loadUs / j.loadUs, 2)}, ${separated(g, j, "load")}\n`,
      );
    }
  }
  const decor = {
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    cpus: os.cpus()[0]?.model,
    runs,
    calls,
    ...loadOpts,
    transport: "TLS (h2)",
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

await main();
