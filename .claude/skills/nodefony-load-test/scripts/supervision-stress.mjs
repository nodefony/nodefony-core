#!/usr/bin/env node
/**
 * STRESS COMBINÉ « supervision » — pousse SIMULTANÉMENT 3 lanes (HTTP + WebSocket
 * connexions/messages + ORM/DB) en RAMPE par paliers, pour voir le dashboard de
 * SUPERVISION (CPU, mémoire/heap, GC, event-loop, handles) ET le dashboard ORM
 * bouger d'un seul coup d'œil, jusqu'à la rupture.
 *
 * « Intelligent » : la charge s'ACCUMULE à chaque palier (workers HTTP/ORM en plus,
 * connexions WS en plus, débit messages en plus), un palier est tenu `STAGE_MS`
 * pour laisser les sondes (≥1 s) afficher le changement, et on s'ARRÊTE à la
 * rupture (taux d'erreur du palier > ERR_RUPTURE) ou après `STAGES` paliers.
 *
 * Prérequis : serveur dev UP (bash .claude/skills/nodefony-start-server/start.sh).
 * Ouvre le dashboard Supervision (switch « Temps réel » ON) + le dashboard ORM
 * AVANT de lancer, pour regarder les widgets monter.
 *
 * À lancer depuis la RACINE du repo :
 *   node .claude/skills/nodefony-load-test/scripts/supervision-stress.mjs
 *   STAGES=10 WS_STEP=400 HTTP_STEP=80 run.sh stress     # plus agressif (rupture)
 *
 * ENV :
 *   HOST(127.0.0.1) PORT(5152)
 *   STAGES(6)        nombre de paliers de rampe
 *   STAGE_MS(10000)  durée d'un palier (ms) — ≥ la granularité du hub
 *   WS_STEP(200)     connexions WS ajoutées par palier
 *   HTTP_STEP(40)    workers HTTP (boucles concurrentes) ajoutés par palier
 *   ORM_STEP(4)      workers ORM ajoutés par palier (charge DB/connexions)
 *   MSG_HZ(4)        messages echo/s par connexion WS
 *   BATCH(50)        taille de batch d'ouverture WS (anti-AggregateError loopback)
 *   ERR_RUPTURE(0.30) seuil de taux d'erreur d'un palier → rupture
 *   HTTP_PATH(/nodefony/test/index)  ORM_PATH(/nodefony/orm/api/orms)
 *   WS_PATH(/nodefony/test/ws/echo)
 */
import https from "node:https";
import WebSocket from "ws";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 5152);
const STAGES = Number(process.env.STAGES ?? 6);
const STAGE_MS = Number(process.env.STAGE_MS ?? 10000);
const WS_STEP = Number(process.env.WS_STEP ?? 200);
const HTTP_STEP = Number(process.env.HTTP_STEP ?? 40);
const ORM_STEP = Number(process.env.ORM_STEP ?? 4);
const MSG_HZ = Number(process.env.MSG_HZ ?? 4);
const BATCH = Number(process.env.BATCH ?? 50);
const ERR_RUPTURE = Number(process.env.ERR_RUPTURE ?? 0.3);
const HTTP_PATH = process.env.HTTP_PATH ?? "/nodefony/test/index";
const ORM_PATH = process.env.ORM_PATH ?? "/nodefony/orm/api/orms";
const WS_PATH = process.env.WS_PATH ?? "/nodefony/test/ws/echo";
const WS_URL = `wss://${HOST}:${PORT}${WS_PATH}`;

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 10000,
  rejectUnauthorized: false,
});

let running = true;
const C = {
  http: { ok: 0, err: 0, latSum: 0 },
  orm: { ok: 0, err: 0, latSum: 0 },
  ws: { open: 0, failed: 0, msgIn: 0 },
};
const sockets = new Set();

/** 1 requête HTTP → met à jour les compteurs de la lane. */
function httpOnce(path, lane) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method: "GET",
        agent,
        rejectUnauthorized: false,
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => {
          lane.latSum += performance.now() - t0;
          if (res.statusCode >= 500) lane.err++;
          else lane.ok++;
          resolve();
        });
      },
    );
    req.on("error", () => {
      lane.err++;
      resolve();
    });
    req.end();
  });
}

/** Worker = boucle de requêtes tant que le test tourne (1 unité de concurrence). */
async function httpWorker(path, lane) {
  // oxlint-disable-next-line no-unmodified-loop-condition -- `running` est basculé en fin de campagne, depuis un autre contexte asynchrone : la règle ne suit pas cette écriture
  while (running) await httpOnce(path, lane);
}

/** Ouvre `n` connexions WS par batches ; chacune envoie un echo à MSG_HZ. */
async function openWs(n) {
  for (let i = 0; i < n; i += BATCH) {
    const chunk = Math.min(BATCH, n - i);
    await Promise.all(Array.from({ length: chunk }, () => openOne()));
  }
}
function openOne() {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
    } catch {
      C.ws.failed++;
      return resolve();
    }
    const period = Math.max(1, Math.round(1000 / MSG_HZ));
    let timer = null;
    ws.on("open", () => {
      C.ws.open++;
      sockets.add(ws);
      timer = setInterval(() => {
        if (ws.readyState === 1) ws.send("ping");
      }, period);
      resolve();
    });
    ws.on("message", () => {
      C.ws.msgIn++;
    });
    const done = () => {
      if (timer) clearInterval(timer);
      sockets.delete(ws);
    };
    ws.on("close", done);
    ws.on("error", () => {
      C.ws.failed++;
      done();
      resolve();
    });
  });
}

function avg(lane) {
  const n = lane.ok + lane.err;
  return n ? (lane.latSum / n).toFixed(0) : "—";
}
function ratio(lane) {
  const n = lane.ok + lane.err;
  return n ? lane.err / n : 0;
}

async function main() {
  console.log(`\n  STRESS COMBINÉ SUPERVISION → ${HOST}:${PORT}`);
  console.log(`  HTTP ${HTTP_PATH} · ORM ${ORM_PATH} · WS ${WS_PATH}`);
  console.log(
    `  ${STAGES} paliers × ${STAGE_MS / 1000}s — +${WS_STEP} WS, +${HTTP_STEP} http, +${ORM_STEP} orm /palier — rupture > ${(ERR_RUPTURE * 100).toFixed(0)}%\n`,
  );

  let httpWk = 0,
    ormWk = 0;
  let last = { http: 0, orm: 0, msg: 0 };
  // Reporter 1 s — débit (delta) + charge cumulée.
  const reporter = setInterval(() => {
    const httpN = C.http.ok + C.http.err;
    const ormN = C.orm.ok + C.orm.err;
    const httpRps = httpN - last.http;
    const ormRps = ormN - last.orm;
    const msgRps = C.ws.msgIn - last.msg;
    last = { http: httpN, orm: ormN, msg: C.ws.msgIn };
    process.stdout.write(
      `\r  WS ${String(C.ws.open).padStart(5)} | HTTP ${String(httpRps).padStart(5)} rps ⌀${avg(C.http)}ms ${(ratio(C.http) * 100).toFixed(0)}%err | ORM ${String(ormRps).padStart(4)} rps ⌀${avg(C.orm)}ms ${(ratio(C.orm) * 100).toFixed(0)}%err | msgIn ${String(msgRps).padStart(6)}/s   `,
    );
  }, 1000);

  let ruptured = false;
  // oxlint-disable-next-line no-unmodified-loop-condition -- `running` est basculé en fin de campagne, depuis un autre contexte asynchrone : la règle ne suit pas cette écriture
  for (let stage = 1; stage <= STAGES && running; stage++) {
    // Ajoute la charge du palier.
    for (let i = 0; i < HTTP_STEP; i++) httpWorker(HTTP_PATH, C.http);
    for (let i = 0; i < ORM_STEP; i++) httpWorker(ORM_PATH, C.orm);
    httpWk += HTTP_STEP;
    ormWk += ORM_STEP;
    await openWs(WS_STEP);
    console.log(
      `\n  ═══ PALIER ${stage}/${STAGES} — WS ${C.ws.open} · http×${httpWk} · orm×${ormWk} ═══`,
    );

    // Mesure le palier : snapshot erreurs avant/après la tenue.
    const before = {
      he: C.http.err,
      hn: C.http.ok + C.http.err,
      oe: C.orm.err,
      on: C.orm.ok + C.orm.err,
    };
    await new Promise((r) => setTimeout(r, STAGE_MS));
    const hReq = C.http.ok + C.http.err - before.hn;
    const oReq = C.orm.ok + C.orm.err - before.on;
    const errRatio =
      (C.http.err - before.he + (C.orm.err - before.oe)) /
      Math.max(1, hReq + oReq);
    if (errRatio > ERR_RUPTURE || C.ws.failed > WS_STEP) {
      ruptured = true;
      console.log(
        `\n\n  ‼ RUPTURE @ palier ${stage} — erreurs ${(errRatio * 100).toFixed(1)}% (seuil ${(ERR_RUPTURE * 100).toFixed(0)}%), WS échecs ${C.ws.failed} — arrêt`,
      );
      break;
    }
  }

  running = false;
  clearInterval(reporter);
  if (!ruptured)
    console.log(
      `\n\n  ✓ ${STAGES} paliers tenus sans rupture (seuil non atteint)`,
    );
  console.log(
    `\n  ── TOTAL ── HTTP ${C.http.ok}/${C.http.ok + C.http.err} ok (⌀${avg(C.http)}ms) · ORM ${C.orm.ok}/${C.orm.ok + C.orm.err} ok (⌀${avg(C.orm)}ms) · WS open ${C.ws.open} (échecs ${C.ws.failed}) · msgIn ${C.ws.msgIn}`,
  );
  console.log("  Cleanup…");
  for (const ws of sockets) {
    try {
      ws.terminate();
    } catch {
      /* noop */
    }
  }
  agent.destroy();
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => {
  running = false;
  console.log("\n  SIGINT — cleanup");
  for (const ws of sockets) {
    try {
      ws.terminate();
    } catch {
      /* noop */
    }
  }
  agent.destroy();
  setTimeout(() => process.exit(0), 300);
});

main().catch((e) => {
  console.error("\n  FATAL:", e?.message ?? e);
  process.exit(1);
});
