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
 *   HTTP_PATHS  routes de la lane HTTP, séparées par des virgules, servies EN
 *               ROTATION (charge hétérogène : JSON, contexte async, vue, flux SSE,
 *               statique, page, santé). HTTP_PATH (une seule route) reste accepté.
 *   ORM_PATH(/nodefony/orm/api/orms)  WS_PATH(/nodefony/test/ws/echo)
 *   REFUSAL_STEP(6)  workers de la lane REFUS ajoutés par palier (0 = sans refus)
 *   REFUSAL_PATHS    cibles de REFUS ATTENDUS, `<statut>[~]:<route>` séparées par
 *               des virgules (`~` = SANS session) : un vrai trafic porte des refus,
 *               que le pipeline sert autrement (pare-feu, rendu d'erreur, journal).
 *               Un refus au statut ANNONCÉ est un succès de la lane ; tout autre
 *               statut, une erreur. Défaut : 400 (tri non déclaré du data-plane),
 *               401 (zone d'administration sans session), 404, 500 sync et async.
 *   NF_BENCH_USER(admin) NF_BENCH_PASSWORD(secret-de-dev-42)  compte de la session
 *               (le data-plane ORM est en zone d'administration)
 *
 * Validité (RÈGLE N°1 du skill) : chaque cible doit répondre 2xx AVANT la mesure,
 * sinon sortie en code 2 sans aucun chiffre ; sous charge, tout statut hors 2xx
 * est une ERREUR — un 401 servi vite n'est pas une réponse —, sauf sur la lane
 * REFUS, où seul le statut annoncé par la cible compte. Code 1 si rien n'a réussi.
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
const HTTP_PATHS = (
  process.env.HTTP_PATHS ??
  process.env.HTTP_PATH ??
  "/nodefony/test/index,/nodefony/test/als/async,/nodefony/test/html,/nodefony/test/sse/three,/favicon.ico,/demo,/nodefony/kernel/api/livez"
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const REFUSAL_STEP = Number(process.env.REFUSAL_STEP ?? 6);
const REFUSAL_PATHS = (
  process.env.REFUSAL_PATHS ??
  "400:/nodefony/http/api/sessions/list?sort=nope,401~:/nodefony/orm/api/orms,404:/nodefony/test/does-not-exist,500:/nodefony/test/crash/sync,500:/nodefony/test/crash/async"
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean)
  .map(parseRefusal);
const USER = process.env.NF_BENCH_USER ?? "admin";
const PASSWORD = process.env.NF_BENCH_PASSWORD ?? "secret-de-dev-42";
const ORM_PATH = process.env.ORM_PATH ?? "/nodefony/orm/api/orms";
const WS_PATH = process.env.WS_PATH ?? "/nodefony/test/ws/echo";
const WS_URL = `wss://${HOST}:${PORT}${WS_PATH}`;

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 10000,
  rejectUnauthorized: false,
});

let running = true;
/**
 * Une cible de refus `<statut>[~]:<route>` → `{ path, expect, anonymous }`.
 *
 * @param {string} spec - la cible, telle que donnée dans REFUSAL_PATHS.
 */
function parseRefusal(spec) {
  const m = /^(\d{3})(~?):(\/.*)$/u.exec(spec);
  if (m === null) {
    console.error(
      `  ✗ cible de refus illisible : « ${spec} » (attendu <statut>[~]:<route>)`,
    );
    process.exit(2);
  }
  return { path: m[3], expect: Number(m[1]), anonymous: m[2] === "~" };
}

/** Cookie de session, posé une fois par `login()`. */
let cookie = "";
/** Statuts hors 2xx rencontrés, par code — le RÉSUMÉ dit ce qui a échoué. */
const failures = new Map();
const C = {
  http: { ok: 0, err: 0, latSum: 0 },
  orm: { ok: 0, err: 0, latSum: 0 },
  refusal: { ok: 0, err: 0, latSum: 0 },
  ws: { open: 0, failed: 0, msgIn: 0 },
};
const sockets = new Set();

/**
 * 1 requête HTTP → met à jour les compteurs de la lane. Succès : le statut
 * ANNONCÉ par la cible (`expect`), sinon un 2xx (RÈGLE N°1) ; le statut d'un
 * échec est compté par code et par route.
 *
 * @param {{ path: string, expect: number | null, anonymous: boolean }} target
 */
function httpOnce(target, lane) {
  const { path, expect, anonymous } = target;
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
        headers: cookie && !anonymous ? { cookie } : {},
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => {
          lane.latSum += performance.now() - t0;
          const status = res.statusCode ?? 0;
          const wanted =
            expect === null ? status >= 200 && status < 300 : status === expect;
          if (wanted) lane.ok++;
          else {
            lane.err++;
            const key = `${status} ${path}`;
            failures.set(key, (failures.get(key) ?? 0) + 1);
          }
          resolve();
        });
      },
    );
    req.on("error", (e) => {
      lane.err++;
      const key = `${e.code ?? "erreur"} ${path}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
      resolve();
    });
    req.end();
  });
}

/**
 * Worker = boucle de requêtes tant que le test tourne (1 unité de concurrence),
 * sur les routes données EN ROTATION — chaque worker part d'un rang différent.
 */
async function httpWorker(targets, lane, offset) {
  let i = offset;
  // oxlint-disable-next-line no-unmodified-loop-condition -- `running` est basculé en fin de campagne, depuis un autre contexte asynchrone : la règle ne suit pas cette écriture
  while (running) await httpOnce(targets[i++ % targets.length], lane);
}

/** Cible qui doit répondre 2xx, avec la session. */
const ok2xx = (path) => ({ path, expect: null, anonymous: false });
const HTTP_TARGETS = HTTP_PATHS.map(ok2xx);
const ORM_TARGETS = [ok2xx(ORM_PATH)];

/** Ouvre la session d'administration (data-plane ORM) ; lève si elle est refusée. */
function login() {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(
      JSON.stringify({ username: USER, password: PASSWORD }),
    );
    const req = https.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/nodefony/security/api/auth/login",
        method: "POST",
        agent,
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const set = res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
          if (res.statusCode !== 200 || !set)
            reject(
              new Error(
                `connexion ${USER} refusée (${res.statusCode}) — NF_BENCH_USER / NF_BENCH_PASSWORD`,
              ),
            );
          else resolve(set);
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Prouve chaque cible AVANT la mesure : rend celles qui ne répondent pas ce
 * qu'elles annoncent (2xx, ou le statut du refus attendu).
 */
async function proveTargets(targets) {
  const lane = { ok: 0, err: 0, latSum: 0 };
  const bad = [];
  for (const t of targets) {
    const before = lane.err;
    await httpOnce(t, lane);
    if (lane.err > before) bad.push(`${t.path} (attendu ${t.expect ?? "2xx"})`);
  }
  failures.clear();
  return bad;
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
  console.log(
    `  HTTP (${HTTP_PATHS.length} routes en rotation) ${HTTP_PATHS.join(" ")}`,
  );
  console.log(`  ORM ${ORM_PATH} · WS ${WS_PATH}`);
  if (REFUSAL_STEP > 0)
    console.log(
      `  REFUS ${REFUSAL_PATHS.map((t) => `${t.expect}${t.anonymous ? "~" : ""} ${t.path}`).join(" · ")}`,
    );
  cookie = await login();
  const bad = await proveTargets([
    ...HTTP_TARGETS,
    ...ORM_TARGETS,
    ...(REFUSAL_STEP > 0 ? REFUSAL_PATHS : []),
  ]);
  if (bad.length > 0) {
    console.error(
      `\n  ✗ cible(s) sans réponse 2xx AVANT la mesure : ${bad.join(", ")} — rien n'est mesuré`,
    );
    agent.destroy();
    process.exit(2);
  }
  console.log(
    `  ${STAGES} paliers × ${STAGE_MS / 1000}s — +${WS_STEP} WS, +${HTTP_STEP} http, +${ORM_STEP} orm /palier — rupture > ${(ERR_RUPTURE * 100).toFixed(0)}%\n`,
  );

  let httpWk = 0,
    ormWk = 0,
    refusalWk = 0;
  let last = { http: 0, orm: 0, refusal: 0, msg: 0 };
  // Reporter 1 s — débit (delta) + charge cumulée.
  const reporter = setInterval(() => {
    const httpN = C.http.ok + C.http.err;
    const ormN = C.orm.ok + C.orm.err;
    const httpRps = httpN - last.http;
    const ormRps = ormN - last.orm;
    const refusalN = C.refusal.ok + C.refusal.err;
    const refusalRps = refusalN - last.refusal;
    const msgRps = C.ws.msgIn - last.msg;
    last = { http: httpN, orm: ormN, refusal: refusalN, msg: C.ws.msgIn };
    process.stdout.write(
      `\r  WS ${String(C.ws.open).padStart(5)} | HTTP ${String(httpRps).padStart(5)} rps ⌀${avg(C.http)}ms ${(ratio(C.http) * 100).toFixed(0)}%err | ORM ${String(ormRps).padStart(4)} rps ⌀${avg(C.orm)}ms ${(ratio(C.orm) * 100).toFixed(0)}%err | REFUS ${String(refusalRps).padStart(4)} rps ${(ratio(C.refusal) * 100).toFixed(0)}%inattendu | msgIn ${String(msgRps).padStart(6)}/s   `,
    );
  }, 1000);

  let ruptured = false;
  // oxlint-disable-next-line no-unmodified-loop-condition -- `running` est basculé en fin de campagne, depuis un autre contexte asynchrone : la règle ne suit pas cette écriture
  for (let stage = 1; stage <= STAGES && running; stage++) {
    // Ajoute la charge du palier. Workers lâchés exprès (ils tournent jusqu'à
    // `running = false`) ; `httpOnce` résout aussi sur erreur, ils ne rejettent pas.
    for (let i = 0; i < HTTP_STEP; i++)
      void httpWorker(HTTP_TARGETS, C.http, httpWk + i);
    for (let i = 0; i < ORM_STEP; i++) void httpWorker(ORM_TARGETS, C.orm, 0);
    for (let i = 0; i < REFUSAL_STEP; i++)
      void httpWorker(REFUSAL_PATHS, C.refusal, refusalWk + i);
    httpWk += HTTP_STEP;
    ormWk += ORM_STEP;
    refusalWk += REFUSAL_STEP;
    await openWs(WS_STEP);
    console.log(
      `\n  ═══ PALIER ${stage}/${STAGES} — WS ${C.ws.open} · http×${httpWk} · orm×${ormWk} · refus×${refusalWk} ═══`,
    );

    // Mesure le palier : snapshot erreurs avant/après la tenue.
    const before = {
      he: C.http.err,
      hn: C.http.ok + C.http.err,
      oe: C.orm.err,
      on: C.orm.ok + C.orm.err,
      re: C.refusal.err,
      rn: C.refusal.ok + C.refusal.err,
    };
    await new Promise((r) => setTimeout(r, STAGE_MS));
    const hReq = C.http.ok + C.http.err - before.hn;
    const oReq = C.orm.ok + C.orm.err - before.on;
    const rReq = C.refusal.ok + C.refusal.err - before.rn;
    // Un refus au statut annoncé n'est PAS une erreur : seuls les statuts
    // inattendus des trois lanes font la rupture.
    const errRatio =
      (C.http.err -
        before.he +
        (C.orm.err - before.oe) +
        (C.refusal.err - before.re)) /
      Math.max(1, hReq + oReq + rReq);
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
    `\n  ── TOTAL ── HTTP ${C.http.ok}/${C.http.ok + C.http.err} ok (⌀${avg(C.http)}ms) · ORM ${C.orm.ok}/${C.orm.ok + C.orm.err} ok (⌀${avg(C.orm)}ms) · REFUS ${C.refusal.ok}/${C.refusal.ok + C.refusal.err} au statut annoncé (⌀${avg(C.refusal)}ms) · WS open ${C.ws.open} (échecs ${C.ws.failed}) · msgIn ${C.ws.msgIn}`,
  );
  if (failures.size > 0) {
    console.log("  Échecs par statut et route :");
    for (const [k, n] of [...failures].sort((a, b) => b[1] - a[1]).slice(0, 10))
      console.log(`    ${String(n).padStart(7)}  ${k}`);
  }
  const succeeded = C.http.ok + C.orm.ok + C.refusal.ok;
  console.log("  Cleanup…");
  for (const ws of sockets) {
    try {
      ws.terminate();
    } catch {
      /* noop */
    }
  }
  agent.destroy();
  // Rien n'a réussi : un banc muet ne doit pas ressembler à un banc réussi.
  setTimeout(() => process.exit(succeeded === 0 ? 1 : 0), 500);
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

main().catch((/** @type {unknown} */ e) => {
  console.error("\n  FATAL:", e?.message ?? e);
  process.exit(1);
});
