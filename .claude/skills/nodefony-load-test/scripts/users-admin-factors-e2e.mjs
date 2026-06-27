// Banc e2e — RESET ADMIN des facteurs forts d'un utilisateur (P6.15) — VRAI
// serveur, session BFF, sans navigateur. Prouve bout-en-bout :
//   NOMINAL (admin ROLE_NODEFONY_ADMIN) :
//     - GET  users/{id}/totp       → 200 (état 2FA)
//     - GET  users/{id}/passkeys   → 200 { credentials }
//     - POST users/{id}/totp/disable → 200 (reset réel)
//     - user inconnu               → 404
//   ATTACK (anti-IDOR inverse) :
//     - ROLE_USER → 403 sur les 4 endpoints (un user ne reset pas autrui)
//     - anonyme   → 401
//
// Prérequis : serveur dev UP (https://localhost:5152) + fixtures admin/user.
//   node .claude/skills/nodefony-load-test/scripts/users-admin-factors-e2e.mjs
import https from "node:https";

const BASE = "https://localhost:5152";
const A = "/nodefony/security/api/auth";
const ADMIN = { u: "admin", p: "secret" };
const USER = { u: "user", p: "secret" };

const totp = (id) =>
  `/nodefony/security/api/users/${encodeURIComponent(id)}/totp`;
const totpDisable = (id) => `${totp(id)}/disable`;
const passkeys = (id) =>
  `/nodefony/security/api/users/${encodeURIComponent(id)}/passkeys`;

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

let pass = 0;
let fail = 0;
function check(label, cond, r) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(
      `  ✗ ${label} — got ${r?.status} ${JSON.stringify(r?.body).slice(0, 140)}`,
    );
  }
}

const main = async () => {
  console.log("— NOMINAL (admin) —");
  const admin = agent();
  let r = await req(admin, "POST", `${A}/login`, {
    username: ADMIN.u,
    password: ADMIN.p,
  });
  check("login admin → 200", r.status === 200, r);

  r = await req(admin, "GET", "/nodefony/user/api/users");
  check("admin GET users → 200", r.status === 200, r);
  const items = r.body?.items ?? [];
  const target =
    items.find((u) => u.identifier === USER.u) ??
    items.find((u) => u.identifier !== ADMIN.u);
  check("cible trouvée (≠ admin)", !!target?.id, {
    body: items.map((i) => i.identifier),
  });
  const id = target?.id ?? "missing";

  r = await req(admin, "GET", totp(id));
  check(
    "admin GET users/{id}/totp → 200",
    r.status === 200 && typeof r.body?.enabled === "boolean",
    r,
  );
  r = await req(admin, "GET", passkeys(id));
  check(
    "admin GET users/{id}/passkeys → 200 { credentials }",
    r.status === 200 && Array.isArray(r.body?.credentials),
    r,
  );
  r = await req(admin, "POST", totpDisable(id));
  check(
    "admin POST users/{id}/totp/disable → 200 (reset réel)",
    r.status === 200 && r.body?.ok === true,
    r,
  );
  r = await req(admin, "GET", totp("ghost-zzz-404"));
  check("admin GET totp user inconnu → 404", r.status === 404, r);

  console.log("— ATTACK (anti-IDOR inverse) —");
  const user = agent();
  r = await req(user, "POST", `${A}/login`, {
    username: USER.u,
    password: USER.p,
  });
  check("login user (ROLE_USER) → 200", r.status === 200, r);
  const vectors = [
    ["GET", totp(id), "GET totp"],
    ["GET", passkeys(id), "GET passkeys"],
    ["POST", totpDisable(id), "POST totp/disable"],
    ["DELETE", `${passkeys(id)}/anycred`, "DELETE passkey"],
  ];
  for (const [m, p, label] of vectors) {
    r = await req(user, m, p);
    check(`ROLE_USER ${label} → 403`, r.status === 403, r);
  }

  const anon = agent();
  r = await req(anon, "GET", totp(id));
  check("anonyme GET totp → 401", r.status === 401, r);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
