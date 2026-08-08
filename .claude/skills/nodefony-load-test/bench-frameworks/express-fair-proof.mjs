/**
 * Preuve d'équité express-fair — sur HEAD, décor du banc mono prod.
 *
 * Prouve que la cible de banc (`/nodefony/kernel/bench`) ne traverse RIEN de
 * dormant : session paresseuse jamais démarrée (0 Set-Cookie), audit nominal
 * coupé T1 (0 écriture en base — PRAGMA data_version d'une connexion readonly
 * ouverte pendant toute la fenêtre + counts des tables framework), profiler
 * non monté en production (404 sur son data plane).
 *
 * Usage (depuis la RACINE du repo — chemin DB relatif) :
 *   NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 nodefony production  # décor
 *   node .claude/skills/nodefony-load-test/bench-frameworks/express-fair-proof.mjs
 * Exit 0 = équité prouvée ; toute dérive (Set-Cookie, commit db, profiler monté)
 * fait échouer. L'instrument data_version se vérifie à part (écriture témoin →
 * la valeur doit bouger) avant de croire un « 0 ».
 */
import http from "node:http";
import Database from "better-sqlite3";

const BASE = "http://127.0.0.1:5151";
const TARGET = "/nodefony/kernel/bench";
const N = 1000;
const DB_PATH = "var/databases/nodefony-drizzle.db";
const TABLES = [
  "session",
  "audit_event",
  "idempotency_key",
  "access_token",
  "denied_jti",
  "webhook_endpoint",
];

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const dataVersion = () => db.pragma("data_version", { simple: true });
const counts = () =>
  Object.fromEntries(
    TABLES.map((t) => [
      t,
      db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c,
    ]),
  );

const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + path, { agent }, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers }),
      );
    });
    req.on("error", reject);
  });
}

// 0. Cible vivante + warmup hors fenêtre de preuve
const probe = await get(TARGET);
if (probe.status !== 200) {
  console.error(`ABORT: cible ${TARGET} → ${probe.status} (attendu 200)`);
  process.exit(1);
}
for (let i = 0; i < 20; i++) await get(TARGET);

// 1. Baseline post-warmup
const dvBefore = dataVersion();
const countsBefore = counts();

// 2. Fenêtre de preuve : N requêtes, comptage exhaustif des réponses
let ok200 = 0;
let setCookie = 0;
const otherStatuses = {};
for (let i = 0; i < N; i++) {
  const r = await get(TARGET);
  if (r.status === 200) ok200++;
  else otherStatuses[r.status] = (otherStatuses[r.status] ?? 0) + 1;
  if (r.headers["set-cookie"]) setCookie++;
}

// 3. Relevé post-fenêtre
const dvAfter = dataVersion();
const countsAfter = counts();

// 4. Fenêtre de repos témoin (10 s sans trafic) — un data_version qui bouge
//    ICI désignerait un écrivain périodique, pas la route.
await new Promise((r) => setTimeout(r, 10_000));
const dvIdle = dataVersion();

// 5. Profiler non monté en prod : son data plane doit être un 404 de routing.
const profiler = await get("/nodefony/profiler/api/deadbeef");

const deltas = Object.fromEntries(
  TABLES.map((t) => [t, countsAfter[t] - countsBefore[t]]),
);
const verdict = {
  target: TARGET,
  n: N,
  ok200,
  otherStatuses,
  setCookieCount: setCookie,
  dbWritesDuringWindow: dvAfter - dvBefore,
  dbWritesDuringIdle10s: dvIdle - dvAfter,
  tableDeltas: deltas,
  profilerDataPlaneStatus: profiler.status,
  pass:
    ok200 === N &&
    setCookie === 0 &&
    dvAfter - dvBefore === 0 &&
    Object.values(deltas).every((d) => d === 0) &&
    profiler.status === 404,
};
console.log(JSON.stringify(verdict, null, 2));
db.close();
process.exit(verdict.pass ? 0 : 1);
