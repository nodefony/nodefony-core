/**
 * Auto-contrôle du juge « suppression du CRUD généré » — chaque cause vue ROUGE.
 *
 * Une application jouet joue tour à tour chaque défaillance ; le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro token.
 *
 * Deux cas valent d'être lus avant les autres, parce qu'ils protègent un agent
 * qui a fait JUSTE : `refusPar404` (masquer l'existence plutôt que d'avouer le
 * refus est une pratique de sécurité, pas un défaut) et `csrfExige` (un agent
 * qui protège aussi ses mutations contre le rejeu ne doit pas voir son
 * administrateur recalé).
 *
 * Usage : `node lib/gate-entity-delete.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` est proscrit : le serveur jouet vit dans CE processus.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-entity-delete.mjs",
);

/** Port distinct du banc (5371) et des autres selftests (5396/5398/5399). */
const PORT = "5395";

const LOGIN = "/nodefony/security/api/auth/login";
const MOI = "/nodefony/security/api/auth/me";
const COLLECTION = "/api/invoices";
const IDENTIFIANT = "0192f3aa-7c1d-7000-8000-000000000001";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      env: { ...process.env, NF_PORT: PORT, NF_ADMIN_PASSWORD: "" },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

const corpsDe = (req) =>
  new Promise((resolve) => {
    let brut = "";
    req.on("data", (c) => (brut += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(brut));
      } catch {
        resolve({});
      }
    });
  });

/** Qui frappe ? — déduit du cookie de session semé au login. */
const quiEst = (req) => {
  const cookie = req.headers.cookie ?? "";
  if (cookie.includes("nodefony=sess-admin")) return "admin";
  if (cookie.includes("nodefony=sess-bench-temoin")) return "temoin";
  return "anonyme";
};

const repondre = (res, statut, objet) => {
  res.writeHead(statut, { "content-type": "application/json" });
  res.end(objet === null ? "" : JSON.stringify(objet));
};

/**
 * UNE application jouet paramétrable — la partie commune (login, rejeu du
 * cookie, création) est celle que TOUTES les causes partagent.
 *
 * @param {{suppression?: Function, creation?: Function, csrfExige?: boolean, sansId?: boolean}} opts
 */
const app =
  ({ suppression, creation, csrfExige = false, sansId = false }) =>
  async (req, res) => {
    const url = (req.url ?? "").split("?")[0];

    if (url === LOGIN && req.method === "POST") {
      const { username } = await corpsDe(req);
      res.setHeader(
        "set-cookie",
        `nodefony=sess-${username}; Path=/; HttpOnly`,
      );
      return repondre(res, 200, { user: { username, roles: [] } });
    }

    if (url === MOI) {
      const qui = quiEst(req);
      if (qui === "anonyme") return repondre(res, 401, { error: "no session" });
      const username = qui === "admin" ? "admin" : "bench-temoin";
      return repondre(res, 200, { user: { username } });
    }

    // Lecture de la collection : c'est elle qui sème le jeton anti-rejeu quand
    // l'application en exige un.
    if (url === COLLECTION && req.method === "GET") {
      if (csrfExige) {
        res.setHeader("set-cookie", `csrf-token=jeton-de-test; Path=/`);
      }
      return repondre(res, 200, { data: [] });
    }

    if (url === COLLECTION && req.method === "POST") {
      if (creation) return creation(req, res);
      const { reference } = await corpsDe(req);
      res.setHeader("location", `${COLLECTION}/${IDENTIFIANT}`);
      return repondre(
        res,
        201,
        sansId ? { reference } : { id: IDENTIFIANT, reference },
      );
    }

    if (url === `${COLLECTION}/${IDENTIFIANT}` && req.method === "DELETE") {
      if (csrfExige && req.headers["x-csrf-token"] !== "jeton-de-test") {
        return repondre(res, 403, { error: "csrf" });
      }
      const { statut, corps } = suppression(quiEst(req));
      return repondre(res, statut, corps);
    }

    return repondre(res, 404, { error: "not found" });
  };

/** Suppression correctement gardée : refus, refus, 204. */
const gardeConforme = (qui) =>
  qui === "admin"
    ? { statut: 204, corps: null }
    : { statut: 403, corps: { error: "Access denied" } };

const ROLES = {
  conforme: [0, app({ suppression: gardeConforme })],
  // Masquer l'existence plutôt qu'avouer le refus : une pratique de sécurité,
  // pas un défaut. Recaler dessus punirait la prudence.
  refusPar404: [
    0,
    app({
      suppression: (qui) =>
        qui === "admin"
          ? { statut: 204, corps: null }
          : { statut: 404, corps: { error: "not found" } },
    }),
  ],
  // Un agent qui protège AUSSI la mutation contre le rejeu ne doit pas voir son
  // administrateur refusé : le juge sème le jeton et le rejoue.
  csrfExige: [0, app({ suppression: gardeConforme, csrfExige: true })],

  // ── ce que l'AGENT a raté ────────────────────────────────────────────────
  suppressionOuverte: [
    1,
    app({ suppression: () => ({ statut: 204, corps: null }) }),
  ],
  roleNonDiscriminant: [
    2,
    app({
      suppression: (qui) =>
        qui === "anonyme"
          ? { statut: 401, corps: { error: "Authentication required" } }
          : { statut: 204, corps: null },
    }),
  ],
  adminRefuse: [
    3,
    app({ suppression: () => ({ statut: 403, corps: { error: "denied" } }) }),
  ],
  // La route de suppression n'existe pas : 404 partout. L'anonyme et le témoin
  // comptent cela comme un refus légitime — c'est l'administrateur qui tranche.
  suppressionAbsente: [
    3,
    app({
      suppression: () => ({ statut: 404, corps: { error: "not found" } }),
    }),
  ],
  reponseInattendue: [
    10,
    app({
      suppression: (qui) =>
        qui === "anonyme"
          ? { statut: 500, corps: { error: "boom" } }
          : gardeConforme(qui),
    }),
  ],
  reponseInattendueTemoin: [
    10,
    app({
      suppression: (qui) =>
        qui === "temoin"
          ? { statut: 500, corps: { error: "boom" } }
          : gardeConforme(qui),
    }),
  ],

  // ── le décor de la mesure, pas la protection ─────────────────────────────
  collectionAbsente: [
    6,
    app({
      suppression: gardeConforme,
      creation: (_req, res) => repondre(res, 404, { error: "not found" }),
    }),
  ],
  creationRefusee: [
    8,
    app({
      suppression: gardeConforme,
      creation: (_req, res) => repondre(res, 422, { error: "invalid" }),
    }),
  ],
  // 201 rendu, mais rien d'exploitable : ni « id » dans le corps, ni Location.
  identifiantIllisible: [
    8,
    app({
      suppression: gardeConforme,
      creation: (_req, res) => repondre(res, 201, { reference: "X" }),
    }),
  ],
  // Pas d'« id » dans le corps, mais un Location : le juge doit s'y rabattre.
  identifiantDansLocation: [
    0,
    app({ suppression: gardeConforme, sansId: true }),
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(25)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
  );
};

for (const [nom, [attendu, handler]] of Object.entries(ROLES)) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE]);
  await new Promise((r) => srv.close(r));
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── la garde d'INSTRUMENT, dans les DEUX sens ──────────────────────────────
{
  const srv = http.createServer(app({ suppression: gardeConforme }));
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTenu", 5, res.status, (res.stderr || "").trim());
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
// Les arguments du compte témoin : une seule source, celle du juge. Le gate les
// lui demande — s'ils cessaient d'être imprimés, le compte ne serait pas créé
// et TOUTES les mesures sortiraient en « identité témoin indisponible ».
{
  const res = await run([JUGE, "--temoin-args"]);
  const ok =
    res.status === 0 && /^\S+ --password \S+$/u.test(res.stdout.trim());
  dire(ok, "temoinArgs", "0 + 2 mots", `${res.status} ${res.stdout.trim()}`);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
