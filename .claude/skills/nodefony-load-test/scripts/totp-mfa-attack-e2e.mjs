// Banc ADVERSARIAL 2FA TOTP (P6.17) — red team / blue team, VRAI serveur.
//
// On ATTAQUE le step-up ; chaque défense qui tient = un ✓ (blue team gagne).
// Vecteurs (du plus critique au moins) :
//   A1. ÉLÉVATION via session PENDING — le cookie post-202 (1ᵉʳ facteur OK, 2ᵉ
//       non validé) ne doit ouvrir AUCUNE ressource : me / totp.status /
//       totp.disable / data plane → 401 (Zero Trust : session.user vide).
//       → disable via PENDING = le trou fatal (désactiver le 2FA avec juste le
//         mot de passe court-circuiterait tout le 2FA). DOIT être 401.
//   A2. REJEU d'un code TOTP déjà consommé (même fenêtre) → 401 (RFC 6238 §5.2).
//   A3. login/totp SANS défi en cours (saut du 1ᵉʳ facteur) → 401.
//   A4. code de récupération REJOUÉ (usage unique) → 401.
// (Le brute-force throttlé est prouvé en unit : security/tests/unit/mfaStepUp.)
//
// Prérequis : serveur dev booté (2FA activé) sur https://localhost:5152.
// Lancement : node .claude/skills/nodefony-load-test/scripts/totp-mfa-attack-e2e.mjs
import https from "node:https";
import crypto from "node:crypto";

const BASE = "https://localhost:5152";
const A = "/nodefony/security/api/auth";
const T = "/nodefony/security/api/totp";
const USER = "user";
const PW = "secret";

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

// « App authenticator » indépendante (RFC 6238/4226).
function base32Decode(s) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let val = 0;
  const out = [];
  for (const ch of s.replace(/[\s=-]/g, "").toUpperCase()) {
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

let ok = 0;
let ko = 0;
// blue = la défense a tenu (l'attaque a été repoussée).
const blue = (name, repelled, got) => {
  console.log(
    `${repelled ? "🛡️ ✓" : "💥 ✗"} ${name}${repelled ? "" : ` — BRÈCHE, got ${JSON.stringify(got)}`}`,
  );
  repelled ? ok++ : ko++;
};

// ── Setup : activer le 2FA sur « user » ───────────────────────────────────────
const s = agent();
let r = await req(s, "POST", `${A}/login`, { username: USER, password: PW });
if (r.status !== 200) {
  console.error("setup login KO", r);
  process.exit(2);
}
r = await req(s, "POST", `${T}/enroll`);
const secret = r.body?.secretBase32;
r = await req(s, "POST", `${T}/confirm`, { code: totpAt(secret, Date.now()) });
const recovery = r.body?.recoveryCodes ?? [];
if (!secret || recovery.length < 2) {
  console.error("setup enroll/confirm KO", r);
  process.exit(2);
}
await req(s, "POST", `${A}/logout`);
console.log("· setup : 2FA activé sur « user »\n");

// ── A1. Élévation via session PENDING (le cookie post-202 doit être inerte) ───
const p = agent();
r = await req(p, "POST", `${A}/login`, { username: USER, password: PW });
blue(
  "A1.0 login → 202 (session PENDING, pas authentifiée)",
  r.status === 202,
  r,
);

r = await req(p, "GET", `${A}/me`);
blue("A1.1 PENDING → GET me → 401 (identité pas établie)", r.status === 401, r);

r = await req(p, "GET", `${T}/status`);
blue(
  "A1.2 PENDING → GET totp/status → 401 (data plane fermé)",
  r.status === 401,
  r,
);

r = await req(p, "POST", `${T}/disable`);
blue(
  "A1.3 PENDING → POST totp/disable → 401 (⚠ trou fatal fermé)",
  r.status === 401,
  r,
);

r = await req(p, "GET", "/nodefony/security/api/keys");
blue(
  "A1.4 PENDING → GET data plane (keys) → 401/404 inerte",
  r.status === 401 || r.status === 404,
  r,
);

// Le 2FA est TOUJOURS actif (aucune attaque n'a abouti) → login redonne 202.
r = await req(agent(), "POST", `${A}/login`, { username: USER, password: PW });
blue("A1.5 2FA intact après A1 (login → 202)", r.status === 202, r);

// ── A2. Rejeu d'un code TOTP déjà consommé (même fenêtre) ─────────────────────
const code = totpAt(secret, Date.now() + 30_000); // step+1 (anti-rejeu-safe vs confirm)
const v1 = agent();
await req(v1, "POST", `${A}/login`, { username: USER, password: PW });
r = await req(v1, "POST", `${A}/login/totp`, { code });
blue(
  "A2.0 1ᵉʳ usage du code TOTP → 200 (consommé)",
  r.status === 200 && r.body?.user?.username === USER,
  r,
);
await req(v1, "POST", `${A}/logout`);

const v2 = agent();
await req(v2, "POST", `${A}/login`, { username: USER, password: PW });
r = await req(v2, "POST", `${A}/login/totp`, { code }); // MÊME code
blue(
  "A2.1 REJEU du même code TOTP → 401 (anti-rejeu RFC 6238 §5.2)",
  r.status === 401,
  r,
);

// ── A3. login/totp sans défi en cours (saut du 1ᵉʳ facteur) ───────────────────
r = await req(agent(), "POST", `${A}/login/totp`, {
  code: totpAt(secret, Date.now()),
});
blue(
  "A3 login/totp sans défi MFA (saut du mot de passe) → 401",
  r.status === 401,
  r,
);

// ── A4. Code de récupération rejoué (usage unique) ────────────────────────────
const w1 = agent();
await req(w1, "POST", `${A}/login`, { username: USER, password: PW });
r = await req(w1, "POST", `${A}/login/totp`, { code: recovery[0] });
blue("A4.0 1ᵉʳ usage code de récupération → 200", r.status === 200, r);
await req(w1, "POST", `${A}/logout`);

const w2 = agent();
await req(w2, "POST", `${A}/login`, { username: USER, password: PW });
r = await req(w2, "POST", `${A}/login/totp`, { code: recovery[0] }); // rejoué
blue(
  "A4.1 REJEU code de récupération → 401 (usage unique)",
  r.status === 401,
  r,
);

// ── Cleanup : libère le user fixture (recovery frais) ─────────────────────────
const c = agent();
await req(c, "POST", `${A}/login`, { username: USER, password: PW });
await req(c, "POST", `${A}/login/totp`, { code: recovery[1] });
await req(c, "POST", `${T}/disable`);
console.log("\n· cleanup : 2FA désactivé");

console.log(
  `\n${ko === 0 ? "✅ blue team : toutes les attaques repoussées" : "❌ BRÈCHE détectée"} — ${ok}/${ok + ko}`,
);
process.exit(ko === 0 ? 0 : 1);
