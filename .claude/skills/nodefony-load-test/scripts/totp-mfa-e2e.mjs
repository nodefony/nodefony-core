// Banc e2e 2FA TOTP step-up (P6.17) — VRAI serveur, sans navigateur.
//
// Prouve le second facteur bout-en-bout en HTTP RÉEL (session BFF + cookies) :
//   - enroll/confirm self-service active le 2FA (codes de récupération 1×)
//   - login mot de passe seul → 202 mfaRequired (identité PAS établie, Zero Trust)
//   - login/totp code TOTP valide → 200 (session ouverte)
//   - code de récupération = usage unique
//   - mauvais code / défi absent → 401
//
// Le code TOTP est calculé par une implémentation INDÉPENDANTE (RFC 6238/4226)
// dans ce fichier — c'est une « app authenticator » tierce, pas un appel au code
// serveur : le banc prouve donc l'INTEROP, pas que mon code se parle à lui-même.
//
// Prérequis : serveur dev booté (2FA activé par défaut) sur https://localhost:5152
//   /start-server start   (ou skill nodefony-start-server)
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/totp-mfa-e2e.mjs
import https from "node:https";
import crypto from "node:crypto";

const BASE = "https://localhost:5152";
const A = "/nodefony/security/api/auth";
const T = "/nodefony/security/api/totp";
const USER = "user";
const PW = "secret";

// ── HTTP avec jar de cookies par « agent » (= une session navigateur) ─────────
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

// ── « App authenticator » TOTP INDÉPENDANTE (RFC 6238 §4 + RFC 4226 §5.3) ────
function base32Decode(s) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let val = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`base32: ${ch}`);
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpAt(secretB32, atMs) {
  const counter = Math.floor(Math.floor(atMs / 1000) / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hs = crypto
    .createHmac("sha1", base32Decode(secretB32))
    .update(buf)
    .digest();
  const off = hs[hs.length - 1] & 0x0f;
  const bin =
    ((hs[off] & 0x7f) << 24) |
    ((hs[off + 1] & 0xff) << 16) |
    ((hs[off + 2] & 0xff) << 8) |
    (hs[off + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

// ── harness ───────────────────────────────────────────────────────────────────
let ok = 0;
let ko = 0;
const check = (name, cond, got) => {
  console.log(
    `${cond ? "✓" : "✗"} ${name}${cond ? "" : ` — got ${JSON.stringify(got)}`}`,
  );
  cond ? ok++ : ko++;
};

// 1. login mot de passe seul (pas encore de 2FA) → 200
const a = agent();
let r = await req(a, "POST", `${A}/login`, { username: USER, password: PW });
check(
  "login (pas encore de 2FA) → 200 + user",
  r.status === 200 && r.body?.user?.username === USER,
  r,
);

// 2. enroll → secret + URI otpauth (affichés 1×)
r = await req(a, "POST", `${T}/enroll`);
check(
  "enroll → 200 + secretBase32 + otpauthUri",
  r.status === 200 &&
    /^[A-Z2-7]+$/.test(r.body?.secretBase32 || "") &&
    (r.body?.otpauthUri || "").startsWith("otpauth://totp/"),
  r,
);
const secret = r.body?.secretBase32;

// 3. status → pending
r = await req(a, "GET", `${T}/status`);
check(
  "status → pending (enrôlement non confirmé)",
  r.status === 200 && r.body?.pending === true && r.body?.enabled === false,
  r,
);

// 4. confirm (1ᵉʳ code, step courant) → active + 10 codes de récupération
r = await req(a, "POST", `${T}/confirm`, { code: totpAt(secret, Date.now()) });
check(
  "confirm (code valide) → 200 + 10 codes de récupération",
  r.status === 200 &&
    Array.isArray(r.body?.recoveryCodes) &&
    r.body.recoveryCodes.length === 10,
  r,
);
const recovery = r.body?.recoveryCodes ?? [];

// 5. status → enabled
r = await req(a, "GET", `${T}/status`);
check(
  "status → enabled (2FA actif)",
  r.status === 200 &&
    r.body?.enabled === true &&
    r.body?.recoveryCodesRemaining === 10,
  r,
);
await req(a, "POST", `${A}/logout`);

// 6. login mot de passe seul → 202 mfaRequired (PAS authentifié)
const b = agent();
r = await req(b, "POST", `${A}/login`, { username: USER, password: PW });
check(
  "login (2FA actif) → 202 mfaRequired methods=[totp]",
  r.status === 202 &&
    r.body?.mfaRequired === true &&
    JSON.stringify(r.body?.methods) === '["totp"]',
  r,
);

// 7. me pendant le défi → 401 (identité PAS établie → Zero Trust)
r = await req(b, "GET", `${A}/me`);
check(
  "me pendant le défi MFA → 401 (identité pas établie)",
  r.status === 401,
  r,
);

// 8. login/totp mauvais code → 401
r = await req(b, "POST", `${A}/login/totp`, { code: "000000" });
check("login/totp mauvais code → 401", r.status === 401, r);

// 9. login/totp code TOTP valide (step+1, anti-rejeu-safe) → 200
r = await req(b, "POST", `${A}/login/totp`, {
  code: totpAt(secret, Date.now() + 30_000),
});
check(
  "login/totp code TOTP valide → 200 + user",
  r.status === 200 && r.body?.user?.username === USER,
  r,
);

// 10. me après 2ᵉ facteur → 200
r = await req(b, "GET", `${A}/me`);
check(
  "me après 2ᵉ facteur → 200 user",
  r.status === 200 && r.body?.user?.username === USER,
  r,
);
await req(b, "POST", `${A}/logout`);

// 11. login → 202, puis login/totp via CODE DE RÉCUPÉRATION → 200
const c = agent();
await req(c, "POST", `${A}/login`, { username: USER, password: PW });
r = await req(c, "POST", `${A}/login/totp`, { code: recovery[0] });
check(
  "login/totp via code de récupération → 200",
  r.status === 200 && r.body?.user?.username === USER,
  r,
);
await req(c, "POST", `${A}/logout`);

// 12. même code de récupération RÉUTILISÉ → 401 (usage unique)
const d = agent();
await req(d, "POST", `${A}/login`, { username: USER, password: PW });
r = await req(d, "POST", `${A}/login/totp`, { code: recovery[0] });
check(
  "code de récupération réutilisé → 401 (usage unique)",
  r.status === 401,
  r,
);

// 13. login/totp sans défi MFA en cours (session fraîche) → 401
const e = agent();
r = await req(e, "POST", `${A}/login/totp`, {
  code: totpAt(secret, Date.now()),
});
check("login/totp sans défi en cours → 401", r.status === 401, r);

// 14. cleanup : login + 2ᵉ facteur (recovery frais) → disable (libère le user fixture)
const f = agent();
await req(f, "POST", `${A}/login`, { username: USER, password: PW });
await req(f, "POST", `${A}/login/totp`, { code: recovery[1] });
r = await req(f, "POST", `${T}/disable`);
check("disable → 200 ok", r.status === 200 && r.body?.ok === true, r);
r = await req(f, "GET", `${T}/status`);
check(
  "status après disable → enabled=false",
  r.status === 200 && r.body?.enabled === false,
  r,
);

console.log(`\n${ko === 0 ? "✅" : "❌"} TOTP step-up e2e : ${ok}/${ok + ko}`);
process.exit(ko === 0 ? 0 : 1);
