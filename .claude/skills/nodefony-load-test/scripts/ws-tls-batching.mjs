/**
 * ws-tls-batching.mjs — pourquoi l'écho WebSocket sort plus RAPIDE en TLS qu'en
 * clair sur `capacity.mjs`, preuve sur un serveur `ws` NU (sans Nodefony).
 *
 * Le constat qui l'a fait écrire : `capacity.mjs` rendait 63 383 msg/s en TLS
 * contre 40 415 en clair, alors que le TLS AJOUTE du travail. Ce banc rejoue le
 * même client (8 sockets, 16 messages de 5 octets en vol, durée fixe) contre un
 * serveur `ws` sans framework, en paires alternées, et compte côté serveur :
 *
 *   - l'ELU de la fenêtre et le temps de boucle par message ;
 *   - les MESSAGES PAR LECTURE du socket (évènements `data` du flux brut).
 *
 * Mesuré (Node 26.10, macOS, 12 cœurs) : ~7 messages par lecture en TLS contre
 * ~2,5 en clair, et ~5,7 µs de boucle par message contre ~10,5. Le déchiffrement
 * remet des blocs qui portent plusieurs trames ; en clair chaque petit segment
 * réveille le serveur presque seul — un appel système, un rappel JS, une analyse
 * de trame pour 2,5 messages. Le coût FIXE par lecture domine tant que les
 * messages sont petits : ce n'est pas un gain du TLS, c'est la lecture d'un
 * trafic en rafale. Messages par lecture, TLS contre clair : 6,8 / 2,4 à
 * 5 octets, 5,4 / 2,2 à 1 Ko (TLS encore devant, ~88 000 contre ~65-77 000
 * msg/s) ; à 4 Ko le chiffrement coûte plus que le regroupement ne rapporte et
 * le clair repasse devant (~45 000 contre ~40 000). Bascule entre 1 et 4 Ko.
 *
 * Usage (depuis la racine du dépôt) :
 *   node .claude/skills/nodefony-load-test/scripts/ws-tls-batching.mjs
 *   WS_BATCH_PAYLOAD=4096 node …/ws-tls-batching.mjs   # messages plus gros
 *
 * Certificat : auto-signé, généré par `openssl` dans un dossier temporaire.
 */
import { execFileSync, fork } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const CLIENTS = 8;
const WINDOW = 16;
const SECONDS = 5;
const PAYLOAD = Number(process.env.WS_BATCH_PAYLOAD ?? 5);
const RUNS = 3;

// ── côté serveur (processus enfant : son ELU ne mesure que lui) ──────────────
if (process.argv[2] === "serve") {
  const tls = process.argv[3] === "1";
  const srv = tls
    ? https.createServer({
        key: fs.readFileSync(process.argv[4]),
        cert: fs.readFileSync(process.argv[5]),
      })
    : http.createServer();
  const wss = new WebSocket.Server({ server: srv, perMessageDeflate: false });
  let reads = 0;
  let msgs = 0;
  wss.on("connection", (ws, req) => {
    req.socket.on("data", () => reads++);
    ws.on("message", (m) => {
      msgs++;
      ws.send(m);
    });
  });
  let e0 = null;
  process.on("message", (cmd) => {
    if (cmd === "start") {
      e0 = performance.eventLoopUtilization();
      reads = 0;
      msgs = 0;
    } else if (cmd === "stop") {
      const e = performance.eventLoopUtilization(e0);
      process.send({ elu: e.utilization, activeMs: e.active, reads, msgs });
    }
  });
  srv.listen(0, "127.0.0.1", () => process.send({ port: srv.address().port }));
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-tls-batching-"));
  const key = path.join(dir, "k.pem");
  const cert = path.join(dir, "c.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { stdio: "ignore" },
  );

  const run = async (tls) => {
    const child = fork(import.meta.filename, [
      "serve",
      tls ? "1" : "0",
      key,
      cert,
    ]);
    const port = await new Promise((r) =>
      child.once("message", (m) => r(m.port)),
    );
    const url = `${tls ? "wss" : "ws"}://127.0.0.1:${port}/`;
    const socks = await Promise.all(
      Array.from(
        { length: CLIENTS },
        () =>
          new Promise((res, rej) => {
            const w = new WebSocket(url, {
              rejectUnauthorized: false,
              perMessageDeflate: false,
            });
            w.once("open", () => res(w));
            w.once("error", rej);
          }),
      ),
    );
    const frame = "x".repeat(PAYLOAD);
    const once = async () => {
      child.send("start");
      const t0 = performance.now();
      const deadline = t0 + SECONDS * 1000;
      let total = 0;
      await Promise.all(
        socks.map(
          (ws) =>
            new Promise((resolve) => {
              let inFlight = 0;
              const fire = () => {
                inFlight++;
                ws.send(frame);
              };
              const onMessage = () => {
                inFlight--;
                total++;
                if (performance.now() < deadline) fire();
                else if (inFlight === 0) {
                  ws.off("message", onMessage);
                  resolve();
                }
              };
              ws.on("message", onMessage);
              for (let i = 0; i < WINDOW; i++) fire();
            }),
        ),
      );
      const secs = (performance.now() - t0) / 1000;
      child.send("stop");
      const s = await new Promise((r) => child.once("message", r));
      return {
        rate: Math.round(total / secs),
        elu: Number(s.elu.toFixed(2)),
        usPerMsg: Number(((s.activeMs * 1000) / s.msgs).toFixed(1)),
        msgsPerRead: Number((s.msgs / s.reads).toFixed(2)),
      };
    };
    await once(); // chauffe (JIT), non comptée
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await once());
    for (const s of socks) s.terminate();
    child.kill();
    return runs;
  };

  console.log(
    `ws nu — ${CLIENTS} sockets × ${WINDOW} en vol · ${PAYLOAD} o · ${SECONDS} s × ${RUNS} · paires alternées`,
  );
  // Paires ALTERNÉES : la dérive de la machine porte sur les deux transports.
  for (const tls of [false, true, false, true]) {
    for (const r of await run(tls))
      console.log(
        `  ${tls ? "TLS  " : "clair"}  ${String(r.rate).padStart(7)} msg/s  ELU ${r.elu}  ${r.usPerMsg} µs/msg  ${r.msgsPerRead} msg/lecture`,
      );
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
