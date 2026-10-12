/**
 * Auto-contrôle du juge « exiger deux facteurs et une connexion récente ».
 *
 * Deux preuves, et la première ne dépend pas de la seconde :
 *
 * 1. le calcul du code TOTP (`totp.mjs`) contre les vecteurs de la RFC 6238
 *    (annexe B, SHA1) — le serveur jouet ci-dessous emploie le MÊME calcul, il
 *    ne saurait donc pas voir une erreur partagée ;
 * 2. un serveur jouet joue l'application conforme puis chaque défaillance, et
 *    le juge doit sortir EXACTEMENT le code de sa table. Le jouet reprend le
 *    contrat du framework : défi `202` d'un compte enrôlé, fenêtre de ±1 pas,
 *    anti-rejeu d'un pas déjà consommé.
 *
 * L'âge maximal du jouet est d'une seconde, et le juge attend 1,5 s
 * (`NF_BENCH_STEPUP_WAIT_MS`) : l'énoncé en demande soixante.
 *
 * Usage : `node lib/gate-step-up.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` proscrit : le serveur jouet vit dans CE processus.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";
import { LOGIN, MOI, TEMOIN, TEMOIN_MFA } from "./identites.mjs";
import { ROUTE_VIREMENT } from "./enonces.mjs";
import { codeHotp, codeTotp, pasCourant } from "./totp.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-step-up.mjs",
);
const PORT = String(await portLibre());
const AGE_MAX_MS = 1000;
const ATTENTE_MS = "1500";

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(30)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 80)}`,
  );
};

// ─── 1. Le calcul, contre la RFC 6238 (annexe B, SHA1, 8 chiffres) ──────────
{
  const cle = Buffer.from("12345678901234567890");
  for (const [t, attendu] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [2000000000, "69279037"],
  ]) {
    const obtenu = codeHotp(cle, Math.floor(t / 30), 8);
    dire(obtenu === attendu, `rfc6238 T=${t}`, attendu, obtenu);
  }
  // Le même secret en base32 : le décodage passe par le chemin du juge.
  const b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const obtenu = codeTotp(b32, 1);
  dire(obtenu === "287082", "rfc6238 base32", "287082", obtenu);
}

// ─── 2. Le juge, contre une application jouet ───────────────────────────────
const SECRET = "JBSWY3DPEHPK3PXP";
const TOTP = "/nodefony/security/api/totp";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      env: {
        ...process.env,
        NF_PORT: PORT,
        NF_BENCH_STEPUP_WAIT_MS: ATTENTE_MS,
      },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

const lireCorps = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(b || "{}"));
      } catch {
        resolve({});
      }
    });
  });

/** La règle conforme : second facteur ET connexion récente. */
const exigeConforme = (s) =>
  s?.amr.includes("otp") === true && Date.now() - s.at <= AGE_MAX_MS;

/**
 * UNE application jouet ; chaque option dégrade UN comportement.
 *
 * @param {object} o
 * @param {(session: object|null) => boolean} [o.autorise] - la décision du virement.
 * @param {number} [o.statutAnonyme] - force la réponse faite à un anonyme.
 * @param {boolean} [o.routeAbsente]
 * @param {boolean} [o.temoinRefuse] - le témoin ne peut pas se connecter.
 * @param {number} [o.statutEnrolement]
 * @param {boolean} [o.confirmationRefusee]
 * @param {boolean} [o.defiOublie] - un compte enrôlé entre au mot de passe.
 * @param {boolean} [o.exigeJeton] - toute mutation exige `x-csrf-token`, jamais semé.
 */
const app = ({
  autorise = exigeConforme,
  statutAnonyme,
  routeAbsente = false,
  temoinRefuse = false,
  statutEnrolement = 200,
  confirmationRefusee = false,
  defiOublie = false,
  exigeJeton = false,
} = {}) => {
  const sessions = new Map();
  let suivant = 0;
  let enrole = false;
  let dernierPas = -1;
  const ouvrir = (res, statut, session, corps) => {
    const id = `s${++suivant}`;
    sessions.set(id, session);
    res.writeHead(statut, {
      "content-type": "application/json",
      "set-cookie": `nodefony=${id}; Path=/; HttpOnly`,
    });
    res.end(JSON.stringify(corps));
  };
  const codeValide = (code) => {
    const pas = pasCourant();
    for (const p of [pas - 1, pas, pas + 1]) {
      if (p > dernierPas && codeTotp(SECRET, p) === code) {
        dernierPas = p;
        return true;
      }
    }
    return false;
  };
  const traiter = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const id = /nodefony=(s\d+)/u.exec(req.headers.cookie ?? "")?.[1];
    const session = id ? sessions.get(id) : undefined;
    const json = (statut, corps) => {
      res.writeHead(statut, { "content-type": "application/json" });
      res.end(JSON.stringify(corps));
    };
    const corps = req.method === "POST" ? await lireCorps(req) : {};

    if (url.pathname === LOGIN && req.method === "POST") {
      if (corps.username === TEMOIN.username && !temoinRefuse) {
        return ouvrir(
          res,
          200,
          { user: TEMOIN.username, amr: ["pwd"], at: Date.now() },
          { user: {} },
        );
      }
      if (corps.username === TEMOIN_MFA.username) {
        if (enrole && !defiOublie) {
          return ouvrir(
            res,
            202,
            { pending: TEMOIN_MFA.username },
            { mfaRequired: true, methods: ["totp"] },
          );
        }
        return ouvrir(
          res,
          200,
          { user: TEMOIN_MFA.username, amr: ["pwd"], at: Date.now() },
          { user: {} },
        );
      }
      return json(401, { error: "Invalid credentials" });
    }
    if (url.pathname === `${LOGIN}/totp` && req.method === "POST") {
      if (!session?.pending || !codeValide(corps.code))
        return json(401, { error: "Invalid code" });
      return ouvrir(
        res,
        200,
        { user: session.pending, amr: ["pwd", "otp"], at: Date.now() },
        { user: {} },
      );
    }
    if (url.pathname === MOI) {
      return session?.user
        ? json(200, { user: { username: session.user } })
        : json(401, {});
    }
    if (url.pathname === `${TOTP}/enroll` && req.method === "POST") {
      if (!session?.user) return json(401, {});
      if (statutEnrolement !== 200)
        return json(statutEnrolement, { error: "2FA unavailable" });
      return json(200, {
        secretBase32: SECRET,
        otpauthUri: "otpauth://totp/x",
      });
    }
    if (url.pathname === `${TOTP}/confirm` && req.method === "POST") {
      if (!session?.user) return json(401, {});
      if (confirmationRefusee || !codeValide(corps.code))
        return json(400, { error: "Invalid or expired code" });
      enrole = true;
      return json(200, { recoveryCodes: [] });
    }
    if (url.pathname === ROUTE_VIREMENT && !routeAbsente) {
      if (req.method !== "POST") return json(405, {});
      if (exigeJeton && !req.headers["x-csrf-token"])
        return json(403, { error: "CSRF" });
      const s = session?.user ? session : null;
      if (s === null && statutAnonyme !== undefined)
        return json(statutAnonyme, { error: "boom" });
      if (autorise(s)) return json(201, corps);
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Session error="insufficient_user_authentication"',
      });
      return res.end('{"error":"Authentication required"}');
    }
    return json(404, {});
  };
  // Le serveur n'attend pas la promesse : un rejet remonte en
  // `unhandledRejection` et fait tomber l'auto-contrôle, il ne se tait pas.
  return (req, res) => {
    void traiter(req, res);
  };
};

const CAS = {
  conforme: [0, app()],
  ouvertATous: [1, app({ autorise: () => true })],
  motDePasseSuffit: [
    2,
    app({ autorise: (s) => s !== null && Date.now() - s.at <= AGE_MAX_MS }),
  ],
  connexionAncienneAcceptee: [
    3,
    app({ autorise: (s) => s?.amr.includes("otp") ?? false }),
  ],
  routeAbsente: [6, app({ routeAbsente: true })],
  // L'exigence mal nommée : refuse aussi la connexion conforme.
  deuxFacteursRefuses: [
    7,
    app({ autorise: (s) => s?.amr.includes("mfa") ?? false }),
  ],
  deuxFacteursIndisponibles: [8, app({ statutEnrolement: 503 })],
  temoinIndisponible: [9, app({ temoinRefuse: true })],
  reponseInattendue: [10, app({ statutAnonyme: 500 })],
  secondFacteurInoperant: [11, app({ confirmationRefusee: true })],
  secondFacteurNonExige: [12, app({ defiOublie: true })],
  jetonCsrfAbsent: [13, app({ exigeJeton: true })],
};

for (const [nom, [attendu, handler]] of Object.entries(CAS)) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE]);
  await new Promise((r) => srv.close(r));
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

{
  const srv = http.createServer(app());
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTaken", 5, res.status, (res.stderr || "").trim());
}
{
  const res = await run([JUGE, "--check-port-free"]);
  dire(res.status === 0, "portLibre", 0, res.status);
}
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}
for (const drapeau of ["--temoin-args", "--temoin-mfa-args"]) {
  const res = await run([JUGE, drapeau]);
  const compte = drapeau === "--temoin-args" ? TEMOIN : TEMOIN_MFA;
  const ok =
    res.status === 0 &&
    res.stdout.trim() === `${compte.username} --password ${compte.password}`;
  dire(ok, drapeau, 0, res.status, res.stdout.trim());
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
