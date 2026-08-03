/**
 * Auto-contrôle du juge « un rôle en implique un autre ».
 *
 * Une application jouet joue tour à tour chaque défaillance, et le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro token.
 *
 * Le cas central est `listeDeRolesSansHierarchie` : la route de l'énoncé se
 * comporte comme une réponse irréprochable — anonyme refusé, témoin refusé,
 * porteur servi, administrateur servi — et pourtant le repère, qui porte le
 * MÊME rôle et que l'agent n'a jamais touché, refuse l'administrateur. Rien sur
 * la route mesurée ne distingue ce cas d'une hiérarchie correctement déclarée ;
 * c'est lui qui donne à ce juge sa raison d'exister, et c'est donc le premier
 * qu'un auto-contrôle doit exercer.
 *
 * Les causes de DÉCOR (`4`, `5`, `7`, `9`, `11`) sont éprouvées au même titre
 * que celles de l'agent : ne pas les distinguer reviendrait à imputer une panne
 * du banc à un travail juste.
 *
 * Usage : `node lib/gate-role-hierarchy.selftest.mjs`
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
import { REPERE_FACTURATION, ROUTE_FACTURATION } from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-role-hierarchy.mjs",
);

/** Port distinct de celui du banc (5371) et des autres selftests. */
const PORT = "5394";

const LOGIN = "/nodefony/security/api/auth/login";
const MOI = "/nodefony/security/api/auth/me";

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

/** Lit le corps d'une requête, JSON ou rien. */
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
  if (cookie.includes("nodefony=sess-bench-porteur-facturation")) {
    return "porteur";
  }
  return "anonyme";
};

/** Le nom de compte attendu par `ouvrirSession` pour chaque profil. */
const NOMS = {
  admin: "admin",
  temoin: "bench-temoin",
  porteur: "bench-porteur-facturation",
};

const repondre = (res, statut, objet) => {
  res.writeHead(statut, { "content-type": "application/json" });
  res.end(JSON.stringify(objet));
};

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{route?: Function, repere?: Function, loginRefuse?: string[]}} opts
 *   - `route` et `repere` décident du statut servi selon qui frappe ;
 *   `loginRefuse` liste les comptes dont la connexion échoue.
 */
const app =
  ({ route, repere, loginRefuse = [] }) =>
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
      return repondre(res, 200, { user: { username: NOMS[qui] } });
    }

    if (url === ROUTE_FACTURATION) {
      return repondre(res, route(quiEst(req)), { summary: "ok" });
    }

    if (url === REPERE_FACTURATION) {
      return repondre(res, repere(quiEst(req)), { repere: "facturation" });
    }

    return repondre(res, 404, { error: "not found" });
  };

/**
 * La bonne réponse : le rôle discrimine, et l'administration le couvre.
 *
 * C'est aussi le comportement du REPÈRE quand une hiérarchie est déclarée —
 * une seule fonction pour les deux, puisque c'est précisément ce que « global »
 * veut dire.
 */
const gardeeParRole = (qui) =>
  qui === "anonyme" ? 401 : qui === "temoin" ? 403 : 200;

const CAS = {
  conforme: [0, app({ route: gardeeParRole, repere: gardeeParRole })],
  // Une zone qui liste l'authentificateur anonyme refuse en 403, pas en 401 :
  // exiger 401 recalerait un agent selon l'endroit où il a rangé sa route.
  conformeRefus403: [
    0,
    app({
      route: (qui) => (qui === "anonyme" ? 403 : gardeeParRole(qui)),
      repere: (qui) => (qui === "anonyme" ? 403 : gardeeParRole(qui)),
    }),
  ],

  // ── ce que l'AGENT a mal fait ────────────────────────────────────────────
  routeOuverte: [1, app({ route: () => 200, repere: gardeeParRole })],
  roleNonDiscriminant: [
    2,
    app({
      route: (qui) => (qui === "anonyme" ? 401 : 200),
      repere: gardeeParRole,
    }),
  ],
  porteurRefuse: [
    3,
    app({
      route: (qui) => (qui === "porteur" ? 403 : gardeeParRole(qui)),
      repere: gardeeParRole,
    }),
  ],
  adminRefuse: [
    12,
    app({
      route: (qui) => (qui === "admin" ? 403 : gardeeParRole(qui)),
      repere: gardeeParRole,
    }),
  ],
  repereOuvert: [13, app({ route: gardeeParRole, repere: () => 200 })],
  // 🔴 LE cas qui justifie le repère : la route mesurée est irréprochable, et
  // pourtant la couverture de l'administration ne vaut que pour elle. Une liste
  // de rôles posée sur l'action rend exactement ceci.
  listeDeRolesSansHierarchie: [
    14,
    app({
      route: gardeeParRole,
      repere: (qui) => (qui === "admin" ? 403 : gardeeParRole(qui)),
    }),
  ],
  routeAbsente: [6, app({ route: () => 404, repere: gardeeParRole })],
  repereAbsent: [8, app({ route: gardeeParRole, repere: () => 404 })],

  // ── réponses qui ne se rangent nulle part ────────────────────────────────
  routeEnErreur: [
    10,
    app({
      route: (qui) => (qui === "anonyme" ? 500 : gardeeParRole(qui)),
      repere: gardeeParRole,
    }),
  ],
  temoinEnErreur: [
    10,
    app({
      route: (qui) => (qui === "temoin" ? 500 : gardeeParRole(qui)),
      repere: gardeeParRole,
    }),
  ],
  repereEnErreur: [
    10,
    app({
      route: gardeeParRole,
      repere: (qui) => (qui === "anonyme" ? 500 : gardeeParRole(qui)),
    }),
  ],

  // ── ce que le DÉCOR a raté — l'agent n'y est pour rien ───────────────────
  adminIndisponible: [
    7,
    app({
      route: gardeeParRole,
      repere: gardeeParRole,
      loginRefuse: ["admin"],
    }),
  ],
  temoinIndisponible: [
    9,
    app({
      route: gardeeParRole,
      repere: gardeeParRole,
      loginRefuse: ["bench-temoin"],
    }),
  ],
  // Le porteur est semé par le gate lui-même : son absence ne dit rien de
  // l'agent, et surtout elle rendrait indécidable un refus de l'administrateur.
  porteurIndisponible: [
    11,
    app({
      route: gardeeParRole,
      repere: gardeeParRole,
      loginRefuse: ["bench-porteur-facturation"],
    }),
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(28)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
  );
};

for (const [nom, [attendu, handler]] of Object.entries(CAS)) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE]);
  await new Promise((r) => srv.close(r));
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── les drapeaux d'INSTRUMENT ──────────────────────────────────────────────
{
  const srv = http.createServer(
    app({ route: gardeeParRole, repere: gardeeParRole }),
  );
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
  const res = await run([JUGE, "--temoin-args"]);
  dire(
    res.status === 0 && res.stdout.includes("--password"),
    "temoinArgs",
    "0+args",
    `${res.status}:${res.stdout.trim().slice(0, 40)}`,
  );
}
{
  // Le porteur ne se crée pas comme le témoin : sans `--roles`, le compte
  // existerait sans le rôle qu'on mesure, et le juge sortirait `porteur-refuse`
  // sur un travail juste.
  const res = await run([JUGE, "--porteur-args"]);
  dire(
    res.status === 0 && res.stdout.includes("--roles ROLE_BILLING"),
    "porteurArgs",
    "0+roles",
    `${res.status}:${res.stdout.trim().slice(0, 60)}`,
  );
}
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, liste de rôles et hiérarchie séparées`,
);
process.exit(echecs ? 1 : 0);
