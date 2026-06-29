// Banc e2e TERRAIN — debug runtime par-module à chaud — sans navigateur.
//
// Prouve, sur un VRAI serveur (session BFF + cookies + RBAC), l'endpoint
// `/nodefony/kernel/api/log/level` (cf core `Syslog.setDebugOverride` + Kernel `NF__DEBUG`) :
//   - fail-closed : un anonyme (sans session) → 401 ;
//   - GET état : `globalDebug` + `overrides` (module → seuil) ;
//   - PATCH set : niveau validé, override posé, TTL imposé + PLAFONNÉ (60 min) ;
//   - validation : niveau inconnu → 422, module manquant → 400 ;
//   - PATCH clear (`level:"off"`) → override retiré.
//
// L'effet VISIBLE (un module gaté repasse en DEBUG) est couvert par les tests
// unitaires du core (gate par-module sous seuil prod) — invisible en dev (pas de
// gate). Ici on prouve le CÂBLAGE HTTP + RBAC + validation + TTL bout-en-bout.
//
// Prérequis : serveur dev UP (https://localhost:5152), compte admin seedé (dev :
// admin/secret). Lancement (depuis n'importe où) :
//   node .claude/skills/nodefony-load-test/scripts/debug-runtime-e2e.mjs
import https from "node:https";

const BASE = "https://localhost:5152";
const A = "/nodefony/security/api/auth";
const K = "/nodefony/kernel/api/log/level";
const ADMIN = "admin";
const PW = "secret";

// HTTP avec jar de cookies par « agent » (= une session navigateur).
function req(agent, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { Accept: "application/json" };
    if (agent.cookie) headers.Cookie = agent.cookie;
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const r = https.request(
      BASE + path,
      { method, headers, rejectUnauthorized: false },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          const sc = res.headers["set-cookie"];
          if (sc) agent.cookie = sc.map((c) => c.split(";")[0]).join("; ");
          resolve({
            status: res.statusCode,
            body: buf && /^[[{]/.test(buf.trim()) ? JSON.parse(buf) : buf,
          });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}
const agent = () => ({ cookie: null });

let ok = 0;
let ko = 0;
const check = (name, cond, got) => {
  console.log(
    `${cond ? "✓" : "✗"} ${name}${cond ? "" : ` — got ${JSON.stringify(got)}`}`,
  );
  cond ? ok++ : ko++;
};

// 0. fail-closed : anonyme (sans session) → 401
const anon = agent();
let r = await req(anon, "GET", K);
check("anonyme GET log/level → 401 (fail-closed)", r.status === 401, r);

// 1. login admin → 200
const a = agent();
r = await req(a, "POST", `${A}/login`, { username: ADMIN, password: PW });
check("login admin → 200", r.status === 200, r);
if (r.status !== 200) {
  console.log(`\n❌ login admin KO (${r.status}) — abandon`, r.body);
  process.exit(1);
}

// 2. GET état initial → 200, overrides vide (dev sans NF__DEBUG)
r = await req(a, "GET", K);
check(
  "GET état → 200 + overrides {} (baseline)",
  r.status === 200 &&
    r.body &&
    typeof r.body.globalDebug === "boolean" &&
    Object.keys(r.body.overrides ?? { x: 1 }).length === 0,
  r,
);

// 3. PATCH set FIREWALL=DEBUG ttl 60s → 200, level 7, ttl 60000, override posé
r = await req(a, "PATCH", K, {
  module: "FIREWALL",
  level: "DEBUG",
  ttlMs: 60000,
});
check(
  "PATCH set FIREWALL:DEBUG ttl=60s → 200 + level 7 + override",
  r.status === 200 &&
    r.body?.ok === true &&
    r.body?.level === 7 &&
    r.body?.ttlMs === 60000 &&
    r.body?.overrides?.FIREWALL === 7,
  r,
);

// 4. GET reflète l'override
r = await req(a, "GET", K);
check(
  "GET reflète l'override FIREWALL=7",
  r.body?.overrides?.FIREWALL === 7,
  r,
);

// 5. TTL plafonné : ttl absurde (≈277h) → clampé à 3600000 (60 min)
r = await req(a, "PATCH", K, {
  module: "ROUTER",
  level: "DEBUG",
  ttlMs: 999999999,
});
check(
  "PATCH ttl absurde → plafonné à 3600000 (60 min)",
  r.body?.ttlMs === 3600000,
  r,
);

// 6. validation : niveau inconnu → 422
r = await req(a, "PATCH", K, { module: "X", level: "NOPE" });
check("PATCH level invalide → 422", r.status === 422, r);

// 7. validation : module manquant → 400
r = await req(a, "PATCH", K, { level: "DEBUG" });
check("PATCH sans module → 400", r.status === 400, r);

// 8. clear FIREWALL → cleared:true
r = await req(a, "PATCH", K, { module: "FIREWALL", level: "off" });
check(
  "PATCH clear FIREWALL → 200 + cleared:true",
  r.status === 200 && r.body?.cleared === true,
  r,
);

// 9. clear ROUTER puis GET → overrides vide
await req(a, "PATCH", K, { module: "ROUTER", level: "off" });
r = await req(a, "GET", K);
check(
  "GET final → overrides {} (tout nettoyé)",
  Object.keys(r.body?.overrides ?? { x: 1 }).length === 0,
  r,
);

console.log(`\n${ko === 0 ? "✅" : "❌"} ${ok}/${ok + ko} OK`);
process.exit(ko === 0 ? 0 : 1);
