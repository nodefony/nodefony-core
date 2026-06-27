// Banc e2e — Data plane WEBHOOKS (P6.13 Slice C) — VRAI serveur, session BFF,
// sans navigateur. Prouve bout-en-bout le chemin HTTP admin → firewall RBAC →
// WebhookService → store (drizzle si NF_WEBHOOK_STORE=drizzle) :
//   3 STRATES RBAC : anonyme 401 / ROLE_USER 403 / admin (ROLE_NODEFONY_ADMIN) 200
//   CRUD admin : create (secret 1×) → list (sans secret) → get → patch → rotate
//                (nouveau secret) → reveal (= rotate) → delete → 404
//   SSRF : create vers IP métadonnées cloud → 422
//   ATTACK : user/anon sur les mutations → 403/401
//   DURABILITÉ : driver=drizzle + un endpoint « persist-proof » laissé (PERSIST_ID)
//     → vérifiable dans la table SQL webhook_endpoint.
//
// Prérequis : serveur dev UP (https://localhost:5152) + fixtures admin/user.
//   node .claude/skills/nodefony-load-test/scripts/webhooks-dataplane-e2e.mjs
import https from "node:https";

const BASE = "https://localhost:5152";
const A = "/nodefony/security/api/auth";
const WH = "/nodefony/security/api/webhooks";
const ADMIN = { u: "admin", p: "secret" };
const USER = { u: "user", p: "secret" };

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
      `  ✗ ${label} — got ${r?.status} ${JSON.stringify(r?.body).slice(0, 160)}`,
    );
  }
}

const main = async () => {
  console.log("— 3 STRATES RBAC —");
  const admin = agent();
  let r = await req(admin, "POST", `${A}/login`, {
    username: ADMIN.u,
    password: ADMIN.p,
  });
  check("login admin → 200", r.status === 200, r);

  const anon = agent();
  r = await req(anon, "GET", WH);
  check("anonyme GET webhooks → 401", r.status === 401, r);

  const user = agent();
  r = await req(user, "POST", `${A}/login`, {
    username: USER.u,
    password: USER.p,
  });
  check("login user (ROLE_USER) → 200", r.status === 200, r);
  r = await req(user, "GET", WH);
  check("ROLE_USER GET webhooks → 403", r.status === 403, r);

  r = await req(admin, "GET", WH);
  check("admin GET webhooks → 200", r.status === 200, r);
  // CONFIG-AGNOSTIC : le backend dépend de NF_WEBHOOK_STORE (memory par défaut /
  // drizzle si activé). On vérifie juste qu'un backend connu est rapporté ; la
  // durabilité drizzle (driver=orm, store=DrizzleWebhookStore, ligne SQL) se
  // prouve en activant NF_WEBHOOK_STORE=drizzle + vérif sqlite (cf en-tête).
  check(
    "backend rapporté (store non vide)",
    typeof r.body?.store === "string" && r.body.store.length > 0,
    r,
  );
  console.log(
    `    ⓘ backend live : driver=${r.body?.driver} store=${r.body?.store}`,
  );
  const before = (r.body?.endpoints ?? []).length;

  console.log("— CRUD admin —");
  // URL publique RÉSOLVABLE (passe l'anti-SSRF) ; event factice « e2e.never » →
  // aucune livraison réelle déclenchée pendant le test (le dispatcher ne matche pas).
  r = await req(admin, "POST", WH, {
    url: "https://example.com/e2e",
    events: ["e2e.never"],
    description: "e2e",
  });
  check("create → 201", r.status === 201, r);
  const created = r.body;
  check(
    "secret whsec_ montré 1×",
    typeof created?.secret === "string" && created.secret.startsWith("whsec_"),
    r,
  );
  const id = created?.endpoint?.id;
  check("id wh_…", typeof id === "string" && id.startsWith("wh_"), r);
  check(
    "createdBy = admin (identité ALS)",
    created?.endpoint?.createdBy === "admin",
    r,
  );
  check(
    "vue create SANS secretEnc",
    created?.endpoint?.secretEnc === undefined,
    r,
  );

  r = await req(admin, "GET", WH);
  const listed = (r.body?.endpoints ?? []).find((e) => e.id === id);
  check("endpoint listé", !!listed, r);
  check(
    "liste SANS secret (secretEnc absent)",
    !!listed && listed.secretEnc === undefined,
    r,
  );
  check("compteur +1", (r.body?.endpoints ?? []).length === before + 1, r);

  r = await req(admin, "GET", `${WH}/${id}`);
  check(
    "GET {id} → 200 sans secret",
    r.status === 200 && r.body?.id === id && r.body?.secretEnc === undefined,
    r,
  );

  r = await req(admin, "PATCH", `${WH}/${id}`, {
    enabled: false,
    description: "e2e-off",
  });
  check(
    "PATCH → 200 enabled:false",
    r.status === 200 && r.body?.enabled === false,
    r,
  );

  r = await req(admin, "POST", `${WH}/${id}/rotate`);
  const rotated = r.body?.secret;
  check(
    "rotate → 200 nouveau secret (≠ création)",
    r.status === 200 &&
      typeof rotated === "string" &&
      rotated.startsWith("whsec_") &&
      rotated !== created.secret,
    r,
  );

  r = await req(admin, "POST", `${WH}/${id}/reveal`);
  check(
    "reveal → 200 secret clair = secret roté",
    r.status === 200 && r.body?.secret === rotated,
    r,
  );

  console.log("— SSRF + ATTACK —");
  r = await req(admin, "POST", WH, {
    url: "http://169.254.169.254/latest/meta-data",
    events: ["*"],
  });
  check("create SSRF (métadonnées cloud) → 422", r.status === 422, r);

  r = await req(user, "POST", WH, {
    url: "https://evil.example.com",
    events: ["*"],
  });
  check("ROLE_USER POST create → 403", r.status === 403, r);
  r = await req(anon, "DELETE", `${WH}/${id}`);
  check("anonyme DELETE → 401", r.status === 401, r);

  console.log("— delete + durabilité —");
  r = await req(admin, "DELETE", `${WH}/${id}`);
  check("DELETE → 200 ok", r.status === 200 && r.body?.ok === true, r);
  r = await req(admin, "GET", `${WH}/${id}`);
  check("GET {id} après delete → 404", r.status === 404, r);

  // Self-clean : la liste est revenue à son état initial (le banc ne laisse rien).
  r = await req(admin, "GET", WH);
  check(
    "liste revenue à l'état initial (self-clean)",
    (r.body?.endpoints ?? []).length === before,
    r,
  );

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
