/**
 * Auto-contrôle du juge « protège une route » — chaque cause vue ROUGE une fois.
 *
 * Aucun agent, aucune application, aucun décor à monter : une application jouet
 * joue tour à tour chaque défaillance, et le juge doit rendre EXACTEMENT le code
 * annoncé par sa table. Quelques secondes, zéro jeton.
 *
 * Ce contrôle existe parce qu'un juge de sécurité est le pire endroit où mettre
 * un défaut : son rouge est crédible (« l'agent a mal protégé »), son vert
 * rassure, et personne ne relit un instrument qui confirme ce qu'on attend. Les
 * quatre causes de DÉCOR (`4`, `5`, `7`, `9`) sont ici au même titre que les
 * causes d'agent : ne pas les distinguer reviendrait à accuser un travail juste
 * chaque fois que le banc lui-même se casse.
 *
 * Usage : `node lib/gate-secure-route.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` est proscrit ici : le serveur jouet vit dans CE processus, et
 * un appel bloquant l'empêcherait de répondre — le juge sortirait en « aucune
 * réponse » pour tous les rôles, ce qui ressemble à un contrôle vert de loin.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-secure-route.mjs",
);

/** Port distinct de celui du banc (5371) et des autres selftests. */
const PORT = "5396";

const LOGIN = "/nodefony/security/api/auth/login";
const MOI = "/nodefony/security/api/auth/me";
const CIBLE = "/api/reports";

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

/** Lit le body d'une requête, JSON ou rien. */
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

const repondre = (res, status, objet) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(objet));
};

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * Écrire dix serveurs ferait diverger leur partie commune — et c'est justement
 * cette partie (le login, le rejeu du cookie) que toutes les causes partagent.
 *
 * @param {{cible?: Function, loginRefuse?: string[], meMuet?: boolean}} opts
 *   - `cible` décide de la réponse sur la route mesurée, selon qui frappe ;
 *   `loginRefuse` liste les identifiants dont la connexion échoue ; `meMuet`
 *   simule une session posée mais jamais rejouée.
 */
const app =
  ({ cible, loginRefuse = [], meMuet = false }) =>
  async (req, res) => {
    const url = (req.url ?? "").split("?")[0];

    if (url === LOGIN && req.method === "POST") {
      const { username } = await corpsDe(req);
      if (loginRefuse.includes(username)) {
        return repondre(res, 401, { error: "Invalid credentials" });
      }
      res.setHeader(
        "set-cookie",
        `nodefony=sess-${username}; Path=/; HttpOnly`,
      );
      return repondre(res, 200, { user: { username, roles: [] } });
    }

    if (url === MOI) {
      const qui = quiEst(req);
      if (qui === "anonyme") return repondre(res, 401, { error: "no session" });
      if (meMuet) return repondre(res, 200, { user: null });
      const username = qui === "admin" ? "admin" : "bench-temoin";
      return repondre(res, 200, { user: { username } });
    }

    if (url === CIBLE) {
      const { status, body } = cible(quiEst(req));
      res.writeHead(status, { "content-type": "application/json" });
      return res.end(typeof body === "string" ? body : JSON.stringify(body));
    }

    return repondre(res, 404, { error: "not found" });
  };

/** Une route correctement protégée : refus, refus, service. */
const cibleConforme = (qui) =>
  qui === "anonyme"
    ? { status: 401, body: { error: "Authentication required" } }
    : qui === "temoin"
      ? { status: 403, body: { error: "Access denied" } }
      : { status: 200, body: { report: "ok" } };

const ROLES = {
  // ── conformité, sous ses deux formes légitimes de refus ──────────────────
  conforme: [0, app({ cible: cibleConforme })],
  // Une zone qui liste l'authentificateur anonyme refuse en 403, pas en 401 :
  // exiger 401 recalerait un agent selon l'endroit où il a rangé sa route.
  conformeRefus403: [
    0,
    app({
      cible: (qui) =>
        qui === "admin"
          ? { status: 200, body: { report: "ok" } }
          : { status: 403, body: { error: "Access denied" } },
    }),
  ],

  // ── ce que l'AGENT a raté ────────────────────────────────────────────────
  routeOuverte: [
    1,
    app({ cible: () => ({ status: 200, body: { report: "ok" } }) }),
  ],
  roleNonDiscriminant: [
    2,
    app({
      cible: (qui) =>
        qui === "anonyme"
          ? { status: 401, body: { error: "Authentication required" } }
          : { status: 200, body: { report: "ok" } },
    }),
  ],
  adminRefuse: [
    3,
    app({ cible: () => ({ status: 403, body: { error: "Access denied" } }) }),
  ],
  routeAbsente: [6, app({ cible: () => ({ status: 404, body: {} }) })],
  corpsInattendu: [
    8,
    app({
      cible: (qui) =>
        qui === "admin"
          ? { status: 200, body: { data: [] } }
          : cibleConforme(qui),
    }),
  ],
  reponseInattendue: [
    10,
    app({ cible: () => ({ status: 500, body: { error: "boom" } }) }),
  ],
  reponseInattendueTemoin: [
    10,
    app({
      cible: (qui) =>
        qui === "temoin"
          ? { status: 500, body: { error: "boom" } }
          : cibleConforme(qui),
    }),
  ],

  // ── ce que le DÉCOR a raté — l'agent n'y est pour rien ───────────────────
  adminIndisponible: [7, app({ cible: cibleConforme, loginRefuse: ["admin"] })],
  temoinIndisponible: [
    9,
    app({ cible: cibleConforme, loginRefuse: ["bench-temoin"] }),
  ],
  // Session posée mais jamais rejouée : le 200 du login ne prouve rien seul.
  sessionNonRejouee: [7, app({ cible: cibleConforme, meMuet: true })],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(24)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 86)}`,
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
// Une garde qui refuse toujours arrêterait le banc au premier run ; une garde
// qui accepte toujours laisserait mesurer un serveur étranger.
{
  const srv = http.createServer(app({ cible: cibleConforme }));
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTaken", 5, res.status, (res.stderr || "").trim());
}
{
  const res = await run([JUGE, "--check-port-free"]);
  dire(res.status === 0, "portLibre", 0, res.status);
}
// Rien n'écoute : « l'app n'a pas démarré » (4) et « ce compte n'existe pas »
// (7) doivent rester deux causes distinctes — elles n'appellent pas le même
// geste, et les confondre envoie chercher un défaut de seed sur un serveur mort.
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
