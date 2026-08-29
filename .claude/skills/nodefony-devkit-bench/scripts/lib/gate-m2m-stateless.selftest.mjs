/**
 * Auto-contrôle du juge « ouvrir une API à un PROGRAMME ».
 *
 * Une application jouet joue tour à tour chaque défaillance, et le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro jeton.
 *
 * Deux cas portent à eux seuls la raison d'être de ce juge, et ils sont les
 * plus retors parce que la fonctionnalité MARCHE dans les deux :
 *
 *   `sessionSemee` — la clé est acceptée, la route répond, tout va bien… et la
 *   réponse installe un cookie. La zone tient donc un registre : le client
 *   machine, qui ne stocke rien, ré-authentifiera à chaque appel et l'état
 *   accumulé côté serveur ne sera jamais réclamé. Aucun test fonctionnel ne
 *   voit ça — c'est une ABSENCE de `stateless: true`, pas une faute visible.
 *
 *   `toutBascule` — l'agent a mis TOUTE l'application en stateless pour que sa
 *   route marche. Son API machine est irréprochable ; la zone web, elle, ne
 *   reconnaît plus les sessions, et la révocation est partie avec. Seul le
 *   repère HORS énoncé le montre.
 *
 * `csrfSeul` protège dans l'autre sens : un cookie anti-rejeu n'est pas une
 * session — il ne porte aucune identité. Un juge qui recalerait là-dessus
 * accuserait une application intacte, et ce faux rouge coûte plus cher que le
 * trou qu'il prétend fermer.
 *
 * Les causes de DÉCOR (`4`, `5`, `8`, `9`) sont éprouvées au même titre que
 * celles de l'agent : ne pas les distinguer reviendrait à imputer une panne du
 * banc à un travail juste.
 *
 * Usage : `node lib/gate-m2m-stateless.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` est proscrit ici : le serveur jouet vit dans CE processus.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPERE_ZONE_PROTEGEE, ROUTE_MACHINE } from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-m2m-stateless.mjs",
);

/** Port distinct de celui du banc (5371) et des autres auto-contrôles. */
const PORT = "5395";

const LOGIN = "/nodefony/security/api/auth/login";
const MOI = "/nodefony/security/api/auth/me";
const EMISSION = "/nodefony/security/api/keys";
const CLE = "bench_k_123456";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

const repondre = (res, status, objet, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(objet));
};

/** La requête porte-t-elle NOTRE clé en Bearer (RFC 6750) ? */
const porteLaCle = (req) =>
  (req.headers.authorization ?? "").toLowerCase() === `bearer ${CLE}`;

/** Une session d'administration a-t-elle été rejouée ? */
const estAdmin = (req) =>
  (req.headers.cookie ?? "").includes("nodefony=sess-admin");

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{machine?: Function, repere?: Function, emission?: "ok"|"refus", loginRefuse?: boolean}} opts
 *   - `machine` et `repere` décident du statut (et des en-têtes) servis selon
 *   la preuve présentée ; `emission` gouverne la délivrance d'une clé ;
 *   `loginRefuse` simule un compte admin absent du décor.
 */
const app =
  ({ machine, repere, emission = "ok", loginRefuse = false }) =>
  (req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === LOGIN && req.method === "POST") {
      req.resume();
      if (loginRefuse)
        return repondre(res, 401, { error: "Invalid credentials" });
      return repondre(
        res,
        200,
        { user: { username: "admin" } },
        { "set-cookie": "nodefony=sess-admin; Path=/; HttpOnly" },
      );
    }
    if (url === MOI) {
      return estAdmin(req)
        ? repondre(res, 200, { user: { username: "admin" } })
        : repondre(res, 401, { error: "Unauthorized" });
    }
    if (url === EMISSION && req.method === "POST") {
      req.resume();
      if (emission === "refus")
        return repondre(res, 503, { error: "disabled" });
      return repondre(res, 201, { id: "k1", token: CLE });
    }
    if (url === ROUTE_MACHINE && req.method === "POST") {
      req.resume();
      return machine(req, res);
    }
    if (url === REPERE_ZONE_PROTEGEE) return repere(req, res);
    return repondre(res, 404, { error: "Not Found" });
  };

// ── Comportements de la route machine ──────────────────────────────────────
/** Conforme : la clé ouvre, rien d'autre, et aucun état n'est installé. */
const machineConforme = (req, res) =>
  porteLaCle(req)
    ? repondre(res, 201, { ok: true })
    : repondre(res, 401, { error: "Unauthorized" });

/** La zone n'accepte pas la clé (authenticator absent, ou route hors zone). */
const machineRefuseLaCle = (_req, res) =>
  repondre(res, 401, { error: "Unauthorized" });

/** Aucune garde : tout le monde poste. */
const machineOuverte = (_req, res) => repondre(res, 201, { ok: true });

/** Marche, mais installe une session — la zone tient un registre. */
const machineQuiSeme = (req, res) =>
  porteLaCle(req)
    ? repondre(
        res,
        201,
        { ok: true },
        { "set-cookie": "nodefony=sess-machine; Path=/; HttpOnly" },
      )
    : repondre(res, 401, { error: "Unauthorized" });

/** Marche, et ne pose QU'un cookie anti-rejeu : légitime, sans identité. */
const machineCsrfSeul = (req, res) =>
  porteLaCle(req)
    ? repondre(
        res,
        201,
        { ok: true },
        { "set-cookie": "nodefony-csrf=abc123; Path=/" },
      )
    : repondre(res, 401, { error: "Unauthorized" });

// ── Comportements du repère (hors énoncé) ──────────────────────────────────
/** Intact : fermé à l'anonyme, servi à l'administration. */
const repereIntact = (req, res) =>
  estAdmin(req)
    ? repondre(res, 200, { hello: true })
    : repondre(res, 401, { error: "Unauthorized" });

/** La zone web a été ouverte au passage. */
const repereOuvert = (_req, res) => repondre(res, 200, { hello: true });

/** Tout est stateless : même l'administration n'est plus reconnue. */
const repereFermeATous = (_req, res) =>
  repondre(res, 401, { error: "Unauthorized" });

/** `[code attendu, application jouet]` — la table des causes du juge. */
const CAS = {
  // Marche, mais tient un registre : le défaut que rien d'autre ne voit.
  sessionSemee: [3, app({ machine: machineQuiSeme, repere: repereIntact })],
  // API machine irréprochable, zone web sacrifiée pour y arriver.
  toutBascule: [7, app({ machine: machineConforme, repere: repereFermeATous })],
  // La zone n'a pas été ouverte à la clé.
  cleRefusee: [1, app({ machine: machineRefuseLaCle, repere: repereIntact })],
  // Aucune garde : n'importe qui dépose.
  ouverteSansCle: [2, app({ machine: machineOuverte, repere: repereIntact })],
  // La garde collective a cédé, même si la route de l'énoncé va bien.
  temoinOuvert: [6, app({ machine: machineConforme, repere: repereOuvert })],
  // DÉCOR : aucun compte d'administration → verdict non rendu.
  adminIndisponible: [
    8,
    app({ machine: machineConforme, repere: repereIntact, loginRefuse: true }),
  ],
  // DÉCOR : les clés d'API ne sont pas délivrées → verdict non rendu.
  emissionImpossible: [
    9,
    app({ machine: machineConforme, repere: repereIntact, emission: "refus" }),
  ],
  // Conforme de bout en bout.
  conforme: [0, app({ machine: machineConforme, repere: repereIntact })],
  // Conforme AUSSI : un cookie anti-rejeu ne porte aucune identité.
  csrfSeul: [0, app({ machine: machineCsrfSeul, repere: repereIntact })],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(20)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
  );
};

for (const [nom, [attendu, handler]] of Object.entries(CAS)) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE]);
  await new Promise((r) => srv.close(r));
  const cause = (res.stdout || res.stderr).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── les drapeaux d'INSTRUMENT ──────────────────────────────────────────────
{
  const srv = http.createServer(
    app({ machine: machineConforme, repere: repereIntact }),
  );
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTaken", 5, res.status, (res.stdout || "").trim());
}
{
  const res = await run([JUGE, "--check-port-free"]);
  dire(res.status === 0, "portLibre", 0, res.status);
}
{
  const res = await run([JUGE]);
  const cause = (res.stdout || res.stderr).trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, registre serveur et cookie anti-rejeu séparés`,
);
process.exit(echecs ? 1 : 0);
