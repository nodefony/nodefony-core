/**
 * Auto-contrôle du juge « protéger un préfixe, pas des routes une par une ».
 *
 * Une application jouet joue tour à tour chaque défaillance, et le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro jeton.
 *
 * Le cas central est `decoreRouteParRoute` : les deux routes de l'énoncé
 * refusent correctement l'anonyme — un `@IsGranted` a bien été posé sur
 * chacune — et pourtant le repère, sous le même préfixe et jamais nommé, reste
 * ouvert. C'est le cas qui donne à ce juge sa raison d'exister : sans le repère,
 * il serait indistinguable d'un travail exemplaire.
 *
 * Le cas symétrique `prefixeElargi` compte autant : une protection qui déborde
 * sur toute l'application n'est pas « plus sûre », c'est une autre panne.
 *
 * Usage : `node lib/gate-prefix-firewall.selftest.mjs`
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
import {
  REPERE_PREFIXE_COMPTE,
  ROUTE_COMPTE_FACTURES,
  ROUTE_COMPTE_PROFIL,
  ROUTE_PUBLIQUE_HORS_PREFIXE,
} from "./enonces.mjs";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-prefix-firewall.mjs",
);

/**
 * Le port, obtenu du SYSTÈME et non écrit en dur.
 *
 * Un port fixe est un état PARTAGÉ : trois selftests écoutaient sur 5394,
 * trois sur 5395, deux sur 5393, et deux exécutions consécutives du lot
 * rendaient deux verdicts différents — des rouges qui n'accusaient personne.
 */
const PORT = String(await portLibre());

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
  return "anonyme";
};

const repondre = (res, status, objet) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(objet));
};

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{enonce?: Function, repere?: Function, publique?: Function,
 *   loginRefuse?: string[]}} opts - `enonce`, `repere` et `publique` décident du
 *   statut servi selon qui frappe ; `loginRefuse` liste les comptes dont la
 *   connexion échoue.
 */
const app =
  ({ enonce, repere, publique = () => 200, loginRefuse = [] }) =>
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
      const username = qui === "admin" ? "admin" : "bench-temoin";
      return repondre(res, 200, { user: { username } });
    }

    if (url === ROUTE_COMPTE_PROFIL || url === ROUTE_COMPTE_FACTURES) {
      return repondre(res, enonce(quiEst(req)), { profile: "ok" });
    }

    if (url === REPERE_PREFIXE_COMPTE) {
      return repondre(res, repere(quiEst(req)), { items: [] });
    }

    if (url === ROUTE_PUBLIQUE_HORS_PREFIXE) {
      return repondre(res, publique(quiEst(req)), { hello: "ok" });
    }

    return repondre(res, 404, { error: "not found" });
  };

/** Une zone qui exige une identité : sans session, 401 ; sinon, servi. */
const zoneFermee = (qui) => (qui === "anonyme" ? 401 : 200);

const CAS = {
  conforme: [0, app({ enonce: zoneFermee, repere: zoneFermee })],
  // Une zone qui liste l'authentificateur anonyme refuse en 403, pas en 401 :
  // exiger 401 recalerait un agent selon la façon dont il a déclaré sa zone.
  conformeRefus403: [
    0,
    app({
      enonce: (qui) => (qui === "anonyme" ? 403 : 200),
      repere: (qui) => (qui === "anonyme" ? 403 : 200),
    }),
  ],

  // ── ce que l'AGENT a mal fait ────────────────────────────────────────────
  prefixeOuvert: [1, app({ enonce: () => 200, repere: zoneFermee })],
  // 🔴 LE cas qui justifie le repère : les deux routes de l'énoncé sont gardées
  // (décorateur par décorateur), le repère du MÊME préfixe reste ouvert.
  decoreRouteParRoute: [2, app({ enonce: zoneFermee, repere: () => 200 })],
  // Plus strict que demandé sur les routes de l'énoncé : un rôle exigé là où
  // l'énoncé n'attend qu'une identité. Le service décrit n'est pas rendu.
  prefixeInaccessible: [
    3,
    app({
      enonce: (qui) => (qui === "admin" ? 200 : qui === "temoin" ? 403 : 401),
      repere: zoneFermee,
    }),
  ],
  routeAbsente: [6, app({ enonce: () => 404, repere: zoneFermee })],
  repereAbsent: [8, app({ enonce: zoneFermee, repere: () => 404 })],
  // Le symétrique : la zone a été posée sur `^/api` au lieu de `^/api/account`.
  prefixeElargi: [
    11,
    app({ enonce: zoneFermee, repere: zoneFermee, publique: () => 401 }),
  ],

  // ── réponses qui ne se rangent nulle part ────────────────────────────────
  enonceEnErreur: [
    10,
    app({
      enonce: (qui) => (qui === "anonyme" ? 500 : 200),
      repere: zoneFermee,
    }),
  ],
  repereEnErreur: [
    10,
    app({
      enonce: zoneFermee,
      repere: (qui) => (qui === "anonyme" ? 500 : 200),
    }),
  ],

  // ── ce que le DÉCOR a raté — l'agent n'y est pour rien ───────────────────
  adminIndisponible: [
    7,
    app({ enonce: zoneFermee, repere: zoneFermee, loginRefuse: ["admin"] }),
  ],
  temoinIndisponible: [
    9,
    app({
      enonce: zoneFermee,
      repere: zoneFermee,
      loginRefuse: ["bench-temoin"],
    }),
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(24)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
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
    app({ enonce: zoneFermee, repere: zoneFermee }),
  );
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
  const res = await run([JUGE, "--temoin-args"]);
  dire(
    res.status === 0 && res.stdout.includes("--password"),
    "temoinArgs",
    "0+args",
    `${res.status}:${res.stdout.trim().slice(0, 40)}`,
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
    : `\n━━ toutes les causes distinguées, zone et décorateurs recopiés séparés`,
);
process.exit(echecs ? 1 : 0);
