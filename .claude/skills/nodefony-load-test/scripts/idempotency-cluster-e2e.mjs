// Banc CROSS-WORKER de l'idempotence distribuée Redis (cluster multi-process, P6.8) — sans navigateur.
//
// LA preuve qui justifie l'axe 3 (store distribué) : sur un cluster `nodefony cluster -w 2`
// (2 process workers, 1 Redis partagé), une MÊME Idempotency-Key déduplique CROSS-WORKER —
// ce que le store `memory` per-pod ne peut PAS faire (chaque worker exécuterait la clé une fois).
//
//   1. 40 GET /count             → ≥2 pids servants distincts (le cluster DISTRIBUE les requêtes)
//   2. POST clé K                → exécutée sur UN worker p0 → {count, pid: p0}
//   3. 50 POST CONCURRENTS clé K → répartis sur les 2 workers, MAIS tous rejouent la réponse de p0
//                                  → 1 SEULE réponse mémorisée {count, p0} (dédup cross-worker via SET NX)
//   4. payload différent sur K   → 422 partout (mismatch cross-worker)
//
// Différentiel : avec `memory` (per-pod), l'étape 3 montrerait ≥2 réponses distinctes (chaque worker
// touché par K l'exécute). Avec `redis` → exactement 1. C'est la dédup cross-pod façon Stripe.
//
// Prérequis :
//   1. docker compose -f docker/docker-compose.yml up -d redis   (mot de passe "nodefony-dev")
//   2. un CLUSTER de 2 workers — pas le serveur de développement, qui est mono-process :
//      l'étape 1 exige ≥ 2 pids servants et échoue sinon en disant « 1 worker(s) servent ».
//      Il tourne en `production` (front prod, pas de Vite), donc le module `test` — qui porte
//      les routes de démo et vit en `policy: "dev"` — n'y est pas chargé : c'est la dérogation
//      `NF_WITH_DEV_MODULES` qui le rend disponible, et elle est MINUTÉE (30 min par défaut,
//      plafond 4 h). L'admin est semé par NF_ADMIN_PASSWORD.
//
//      NF_IDEMPOTENCY_STORE=redis NF_REDIS_URL='redis://:nodefony-dev@127.0.0.1:6379' \
//        NF_ADMIN_PASSWORD=secret NF_USER_STORE=memory \
//        NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=60 \
//        node node_modules/nodefony/bin/nodefony cluster --workers 2 --detach --wait 120
//      (vérifier le log : 2× `Idempotency store → "redis" (distributed)`)
//
//      🔴 C'est bien `NF_REDIS_URL` qu'il faut, PAS `NF_REDIS_PASSWORD` : le module Redis est
//      chargé sous condition `when: () => !!ctx.infra.cache` (`nodefony.config.ts`), et cette
//      capacité se résout depuis l'URL. Avec le seul mot de passe, le module n'est pas chargé,
//      le cœur refuse un store distribué absent, et le cluster part en BOUCLE de redémarrage
//      sur « idempotency.store="redis" failed to initialize: the @nodefony/redis module is not
//      loaded ». Le message est juste ; c'est la ligne de commande qui était périmée.
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/idempotency-cluster-e2e.mjs
import https from "node:https";

const BASE = "https://localhost:5152";
const BUMP = "/nodefony/test/secure/idempotent/bump";
const COUNT = "/nodefony/test/secure/idempotent/count";
const AUTH = "Basic " + Buffer.from("admin:secret").toString("base64");

function req(method, path, { body, idemKey } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {
      Authorization: AUTH,
      Accept: "application/json",
      Connection: "close",
    };
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    if (idemKey) headers["Idempotency-Key"] = idemKey;
    const r = https.request(
      BASE + path,
      { method, headers, rejectUnauthorized: false, agent: false },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: buf && /^[[{]/.test(buf.trim()) ? JSON.parse(buf) : buf,
          }),
        );
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

let ok = 0,
  ko = 0;
const check = (name, cond, got) => {
  console.log(
    `${cond ? "✓" : "✗"} ${name}${cond ? "" : ` — got ${JSON.stringify(got)}`}`,
  );
  cond ? ok++ : ko++;
};

const gets = await Promise.all(
  Array.from({ length: 40 }, () => req("GET", COUNT)),
);
const servingPids = new Set(
  gets.filter((g) => g.body?.pid).map((g) => g.body.pid),
);
check(
  `cluster distribue : ${servingPids.size} worker(s) servent (≥2 attendu)`,
  servingPids.size >= 2,
  [...servingPids],
);

const K = "xworker-" + Date.now();
const r0 = await req("POST", BUMP, { body: { label: "K" }, idemKey: K });
check(
  "1ʳᵉ POST clé K → 200 {count,pid}",
  r0.status === 200 && typeof r0.body?.pid === "number",
  r0,
);
const p0 = r0.body?.pid,
  c0 = r0.body?.count;

const reps = await Promise.all(
  Array.from({ length: 50 }, () =>
    req("POST", BUMP, { body: { label: "K" }, idemKey: K }),
  ),
);
const distinct = new Set(
  [r0, ...reps].map((r) => `${r.body?.count}|${r.body?.pid}`),
);
const allReplayP0 = reps.every(
  (r) => r.status === 200 && r.body?.pid === p0 && r.body?.count === c0,
);
check(
  `même clé sur cluster réparti → 1 SEULE réponse mémorisée (count=${c0},pid=${p0}) pour les 51`,
  distinct.size === 1 && allReplayP0,
  { distinct: [...distinct] },
);

const mism = await Promise.all(
  Array.from({ length: 20 }, () =>
    req("POST", BUMP, { body: { label: "OTHER" }, idemKey: K }),
  ),
);
check(
  "payload différent sur K (cross-worker) → 422 partout",
  mism.every((m) => m.status === 422),
  mism.map((m) => m.status).slice(0, 5),
);

console.log(
  `\n${ok}/${ok + ko} OK — banc CROSS-WORKER cluster (2 workers, 1 Redis)`,
);
console.log(
  `  → cluster sert via ${servingPids.size} pids, mais la clé K déduplique vers le SEUL pid ${p0} : dédup cross-worker via Redis SET NX.`,
);
process.exit(ko === 0 ? 0 : 1);
