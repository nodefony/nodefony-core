/**
 * Auto-contrôle du juge « connexion dans un front généré ».
 *
 * Le navigateur est remplacé par un DOUBLE de la sonde (`NF_BENCH_INSPECT`) :
 * il lit le parcours que le juge lui confie et répond comme `inspect.mjs` —
 * sortie 0 quand le parcours aboutit, 65 et « Action « … » impossible » sinon.
 * Le double VÉRIFIE ce qu'on lui donne (mot de passe, code TOTP du pas
 * attendu) : un juge qui calculerait mal le code ne passerait pas `conforme`.
 *
 * Ce que ce contrôle ne prouve PAS : que le vrai navigateur sait jouer ce
 * parcours sur un vrai front. Cette preuve-là a été faite sur une application
 * générée (front React, `useNodefonyLogin`) : 0 sur la référence, 2 sans champ
 * de code, 7 sur une page qui affiche la session sans le serveur.
 *
 * Usage : `node lib/gate-login-front.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` proscrit : le serveur jouet vit dans CE processus.
 *
 * @module
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";
import { LOGIN, MOI, TEMOIN_MFA } from "./identites.mjs";
import { PAGE_ESPACE, TEXTE_SESSION_OUVERTE } from "./enonces.mjs";
import { ROUTES_TOTP, codeTotp, pasCourant } from "./totp.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const JUGE = path.join(ICI, "gate-login-front.mjs");
const PORT = String(await portLibre());
const SECRET = "JBSWY3DPEHPK3PXP";
const DOSSIER = mkdtempSync(path.join(os.tmpdir(), "nf-bench-login-front-"));
const DOUBLE = path.join(DOSSIER, "inspect-double.mjs");

// ─── Le double de la sonde ──────────────────────────────────────────────────
writeFileSync(
  DOUBLE,
  `import { codeTotp, pasCourant } from ${JSON.stringify(path.join(ICI, "totp.mjs"))};
const scenario = process.env.NF_SELFTEST_SCENARIO ?? "conforme";
const actions = (process.env.NF_BROWSER_ACTIONS ?? "").split("|");
const impossible = (a) => { console.error("Action « " + a + " » impossible"); process.exit(65); };
const trouve = (prefixe) => actions.find((a) => a.startsWith(prefixe));
if (scenario === "plante") process.exit(1);
if (scenario === "simulee") process.exit(0);
if (scenario === "sansFormulaire") impossible(trouve("saisir:input[name=username]"));
const mdp = trouve("saisir:input[name=password]=")?.split("=").slice(2).join("=");
const code = trouve("saisir:input[name=code]=")?.split("=").slice(2).join("=");
const attendre = trouve("attendre:");
const juste = mdp === ${JSON.stringify(TEMOIN_MFA.password)} && code !== undefined &&
  [pasCourant() - 1, pasCourant(), pasCourant() + 1].some((p) => codeTotp(${JSON.stringify(SECRET)}, p) === code);
if (scenario === "negatifPlante" && !juste) process.exit(1);
if (scenario === "sansCode" && code !== undefined) impossible(trouve("saisir:input[name=code]"));
if (scenario === "jamaisAbouti") impossible(attendre);
if (!juste) impossible(attendre);
if (attendre !== "attendre:" + ${JSON.stringify(TEXTE_SESSION_OUVERTE + TEMOIN_MFA.username)}) impossible(attendre);
process.exit(0);
`,
);

// ─── L'application jouet ────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {number} [o.statutPage]
 * @param {boolean} [o.temoinRefuse]
 * @param {number} [o.statutEnrolement]
 * @param {boolean} [o.confirmationRefusee]
 */
const app =
  ({
    statutPage = 200,
    temoinRefuse = false,
    statutEnrolement = 200,
    confirmationRefusee = false,
  } = {}) =>
  (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const connecte = (req.headers.cookie ?? "").includes("nodefony=mfa");
    const json = (statut, corps, entetes = {}) => {
      res.writeHead(statut, { "content-type": "application/json", ...entetes });
      res.end(JSON.stringify(corps));
    };
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      if (url.pathname === PAGE_ESPACE) {
        res.writeHead(statutPage, { "content-type": "text/html" });
        return res.end("<!doctype html><div id=root></div>");
      }
      if (url.pathname === LOGIN && req.method === "POST") {
        if (temoinRefuse) return json(401, { error: "Invalid credentials" });
        return json(
          200,
          { user: {} },
          { "set-cookie": "nodefony=mfa; Path=/" },
        );
      }
      if (url.pathname === MOI) {
        return connecte
          ? json(200, { user: { identifier: TEMOIN_MFA.username } })
          : json(401, {});
      }
      if (url.pathname === `${ROUTES_TOTP}/enroll`) {
        if (statutEnrolement !== 200) return json(statutEnrolement, {});
        return json(200, { secretBase32: SECRET });
      }
      if (url.pathname === `${ROUTES_TOTP}/confirm`) {
        const { code } = JSON.parse(corps || "{}");
        if (confirmationRefusee || code !== codeTotp(SECRET, pasCourant())) {
          return json(400, { error: "Invalid or expired code" });
        }
        return json(200, { recoveryCodes: [] });
      }
      return json(404, {});
    });
  };

// ─── Les cas : [attendu, application, scénario du double] ───────────────────
const CAS = {
  conforme: [0, app(), "conforme"],
  formulaireAbsent: [1, app(), "sansFormulaire"],
  secondFacteurAbsent: [2, app(), "sansCode"],
  connexionNonAboutie: [3, app(), "jamaisAbouti"],
  pageAbsente: [6, app({ statutPage: 404 }), "conforme"],
  connexionSimulee: [7, app(), "simulee"],
  deuxFacteursIndisponibles: [8, app({ statutEnrolement: 503 }), "conforme"],
  temoinIndisponible: [9, app({ temoinRefuse: true }), "conforme"],
  navigateurIndisponible: [10, app(), "plante"],
  // Le bon parcours passe, les refus PLANTENT : aucun refus n'est prouvé.
  refusNonConstate: [10, app(), "negatifPlante"],
  secondFacteurInoperant: [11, app({ confirmationRefusee: true }), "conforme"],
};

const run = (args, scenario = "conforme") =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      env: {
        ...process.env,
        NF_PORT: PORT,
        NF_BENCH_INSPECT: DOUBLE,
        NF_SELFTEST_SCENARIO: scenario,
      },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(26)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 80)}`,
  );
};

try {
  for (const [nom, [attendu, handler, scenario]] of Object.entries(CAS)) {
    const srv = http.createServer(handler);
    await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
    const res = await run([JUGE], scenario);
    await new Promise((r) => srv.close(r));
    const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
    dire(res.status === attendu, nom, attendu, res.status, cause);
  }
  {
    const srv = http.createServer(app());
    await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
    const res = await run([JUGE, "--check-port-free"]);
    await new Promise((r) => srv.close(r));
    dire(
      res.status === 5,
      "portTaken",
      5,
      res.status,
      (res.stderr || "").trim(),
    );
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
} finally {
  rmSync(DOSSIER, { recursive: true, force: true });
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
