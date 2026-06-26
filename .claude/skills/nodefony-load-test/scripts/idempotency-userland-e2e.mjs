// Banc e2e USERLAND @Idempotent contre un VRAI Redis (single-pod, P6.8) — sans navigateur.
//
// Prouve l'anti double-effet bout-en-bout en HTTP RÉEL sur la route de démo
// `/nodefony/test/secure/idempotent/bump` (zone test-secure, Basic RFC 7617),
// quand le store distribué Redis est branché (NF_IDEMPOTENCY_STORE=redis) :
//   - 1ʳᵉ POST (clé fraîche)            → exécute → {count, pid}
//   - rejeu MÊME clé + MÊME payload      → réponse MÉMORISÉE (count/pid figés, 0 ré-exécution)
//   - POST sans Idempotency-Key (strict) → 400
//   - même clé + payload DIFFÉRENT       → 422 (mismatch, RFC 9110 §15.5.21)
//   - nouvelle clé                       → ré-exécute (count incrémenté)
//
// Prérequis :
//   1. docker compose -f docker/docker-compose.yml up -d redis   (password "nodefony-dev")
//   2. serveur dev booté AVEC le store redis (dev fixtures user/secret seedés) :
//      NODEFONY_DEV_CHILD=1 NF_IDEMPOTENCY_STORE=redis REDIS_PASSWORD=nodefony-dev \
//        node node_modules/nodefony/bin/nodefony development
//      (vérifier le log : `Idempotency store → "redis" (distributed)`)
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/idempotency-userland-e2e.mjs
import https from "node:https";

const BASE = "https://localhost:5152";
const PATH = "/nodefony/test/secure/idempotent/bump";
const AUTH = "Basic " + Buffer.from("user:secret").toString("base64");

function req(method, path, { body, idemKey } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { Authorization: AUTH, Accept: "application/json" };
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    if (idemKey) headers["Idempotency-Key"] = idemKey;
    const r = https.request(
      BASE + path,
      { method, headers, rejectUnauthorized: false },
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

const K1 = "e2e-" + Date.now() + "-A";
const K2 = "e2e-" + Date.now() + "-B";

const r1 = await req("POST", PATH, { body: { label: "x" }, idemKey: K1 });
check(
  "1ʳᵉ POST clé K1 → 200 + {count,pid}",
  r1.status === 200 && typeof r1.body?.count === "number",
  r1,
);
const first = r1.body;

const r2 = await req("POST", PATH, { body: { label: "x" }, idemKey: K1 });
check(
  "rejeu K1 (même payload) → réponse mémorisée identique (count/pid figés)",
  r2.status === 200 &&
    r2.body?.count === first?.count &&
    r2.body?.pid === first?.pid,
  r2,
);

const r3 = await req("POST", PATH, { body: { label: "x" } });
check("POST sans Idempotency-Key → 400", r3.status === 400, r3);

const r4 = await req("POST", PATH, {
  body: { label: "DIFFERENT" },
  idemKey: K1,
});
check("K1 + payload différent → 422 (mismatch)", r4.status === 422, r4);

const r5 = await req("POST", PATH, { body: { label: "y" }, idemKey: K2 });
check(
  "nouvelle clé K2 → ré-exécute (count incrémenté)",
  r5.status === 200 && r5.body?.count === first?.count + 1,
  r5,
);

console.log(
  `\n${ok}/${ok + ko} OK — banc e2e userland @Idempotent contre VRAI Redis (single-pod)`,
);
process.exit(ko === 0 ? 0 : 1);
