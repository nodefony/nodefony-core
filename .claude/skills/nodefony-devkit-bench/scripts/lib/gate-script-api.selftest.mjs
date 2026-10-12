/**
 * Auto-contrôle du juge « un script appelle l'API protégée ».
 *
 * Deux moitiés jouent tour à tour leurs défaillances : une application jouet
 * (route, émission de clé, connexion d'administration) et le script de
 * l'agent, écrit dans un dossier temporaire où le juge s'exécute. Le juge doit
 * rendre EXACTEMENT le code de sa table.
 *
 * Le cas qui porte la raison d'être du juge est `scriptToujoursZero` : avec la
 * bonne clé il affiche la bonne réponse — tout a l'air de marcher — mais il
 * sort en succès quand on le refuse, et l'ordonnanceur ne saura jamais que le
 * relevé n'a pas eu lieu.
 *
 * Usage : `node lib/gate-script-api.selftest.mjs`
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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";
import {
  ADMIN,
  EMISSION_CLE,
  LOGIN,
  MOI,
  MOT_DE_PASSE_SONDE,
} from "./identites.mjs";
import {
  ROUTE_RAPPORT_MACHINE,
  SCRIPT_RAPPORT,
  VAR_CLE_RAPPORT,
  VAR_URL_RAPPORT,
} from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-script-api.mjs",
);
const PORT = String(await portLibre());
const CLE = "nf_cle_emise_par_le_jouet";
const APP = mkdtempSync(path.join(os.tmpdir(), "nf-bench-script-api-"));
writeFileSync(path.join(APP, "package.json"), '{ "type": "module" }\n');
mkdirSync(path.join(APP, "scripts"));

// ─── Les scripts de l'agent ─────────────────────────────────────────────────
const appel = `const url: string = process.env.${VAR_URL_RAPPORT} ?? "";
const key: string = process.env.${VAR_CLE_RAPPORT} ?? "";
const r = await fetch(\`\${url}${ROUTE_RAPPORT_MACHINE}\`, {
  headers: { authorization: \`Bearer \${key}\` },
});
console.log(JSON.stringify(await r.json()));`;
const SCRIPTS = {
  conforme: `${appel}\nprocess.exit(r.ok ? 0 : 1);\n`,
  // Avec la bonne clé, il affiche la bonne réponse : seul le refus le trahit.
  toujoursZero: `${appel}\nprocess.exit(0);\n`,
  // N'envoie aucune preuve : le refus est rendu, le script échoue.
  sansCle: `const r = await fetch(\`\${process.env.${VAR_URL_RAPPORT}}${ROUTE_RAPPORT_MACHINE}\`);
console.log(await r.text());
process.exit(r.ok ? 0 : 1);\n`,
  sansFin: `setInterval(() => {}, 1000);\n`,
};

// ─── L'application jouet ────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {number} [o.statutAnonyme] - ce que la route rend sans clé.
 * @param {boolean} [o.cleRefusee] - la route refuse même la bonne clé.
 * @param {boolean} [o.routeAbsente]
 * @param {number} [o.statutEmission]
 * @param {boolean} [o.adminRefuse]
 */
const app =
  ({
    statutAnonyme = 401,
    cleRefusee = false,
    routeAbsente = false,
    statutEmission = 201,
    adminRefuse = false,
  } = {}) =>
  (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const connecte = (req.headers.cookie ?? "").includes("nodefony=admin");
    const json = (statut, corps, entetes = {}) => {
      res.writeHead(statut, { "content-type": "application/json", ...entetes });
      res.end(JSON.stringify(corps));
    };
    if (url.pathname === LOGIN && req.method === "POST") {
      req.resume();
      if (adminRefuse) return json(401, { error: "Invalid credentials" });
      return json(
        200,
        { user: {} },
        { "set-cookie": "nodefony=admin; Path=/" },
      );
    }
    if (url.pathname === MOI) {
      return connecte
        ? json(200, { user: { username: ADMIN.username } })
        : json(401, {});
    }
    if (url.pathname === EMISSION_CLE && req.method === "POST") {
      req.resume();
      if (!connecte) return json(401, {});
      return statutEmission === 201
        ? json(201, { token: CLE })
        : json(statutEmission, { error: "API keys disabled" });
    }
    if (url.pathname === ROUTE_RAPPORT_MACHINE && !routeAbsente) {
      const porteur = req.headers.authorization ?? "";
      if (porteur === "") {
        return statutAnonyme === 200
          ? json(200, { ok: true })
          : json(statutAnonyme, { error: "Authentication required" });
      }
      if (porteur === `Bearer ${CLE}` && !cleRefusee) {
        return json(200, { ok: true });
      }
      return json(401, { error: "Invalid API key" });
    }
    return json(404, {});
  };

// ─── Les cas : [attendu, application, script] ───────────────────────────────
const CAS = {
  conforme: [0, app(), "conforme"],
  ouverteSansCle: [1, app({ statutAnonyme: 200 }), "conforme"],
  cleRefusee: [2, app({ cleRefusee: true }), "conforme"],
  scriptEchoue: [3, app(), "sansCle"],
  routeAbsente: [6, app({ routeAbsente: true }), "conforme"],
  scriptToujoursZero: [7, app(), "toujoursZero"],
  adminIndisponible: [8, app({ adminRefuse: true }), "conforme"],
  emissionImpossible: [9, app({ statutEmission: 503 }), "conforme"],
  reponseInattendue: [10, app({ statutAnonyme: 500 }), "conforme"],
  scriptAbsent: [11, app(), null],
  scriptSansFin: [12, app(), "sansFin"],
};

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      cwd: APP,
      env: {
        ...process.env,
        NF_PORT: PORT,
        NF_ADMIN_PASSWORD: MOT_DE_PASSE_SONDE,
        NF_BENCH_SCRIPT_TIMEOUT_MS: "1500",
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
    `${ok ? "✅" : "❌"} ${nom.padEnd(22)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 80)}`,
  );
};

const script = path.join(APP, SCRIPT_RAPPORT);
try {
  for (const [nom, [attendu, handler, variante]] of Object.entries(CAS)) {
    rmSync(script, { force: true });
    if (variante !== null) writeFileSync(script, SCRIPTS[variante]);
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
  rmSync(APP, { recursive: true, force: true });
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
