/**
 * Auto-contrôle du juge « ouvrir une route à un tiers sans ouvrir la zone ».
 *
 * Une application jouet joue tour à tour chaque défaillance, et le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro jeton.
 *
 * Le cas central est `zoneOuverte` : la route de l'énoncé refuse correctement
 * l'anonyme, et pourtant la zone a cédé — un `@IsGranted` posé sur la nouvelle
 * action masque l'ouverture. Sans le repère, ce cas serait indistinguable d'un
 * travail exemplaire ; c'est lui qui donne à ce juge sa raison d'exister, et
 * c'est donc le premier qu'un auto-contrôle doit exercer.
 *
 * Les quatre causes de DÉCOR (`4`, `5`, `7`, `9`) sont éprouvées au même titre
 * que celles de l'agent : ne pas les distinguer reviendrait à imputer une panne
 * du banc à un travail juste.
 *
 * Usage : `node lib/gate-zone-firewall.selftest.mjs`
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
import { REPERE_ZONE_PROTEGEE, ROUTE_IMPORT } from "./enonces.mjs";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-zone-firewall.mjs",
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
 * @param {{import?: Function, repere?: Function, loginRefuse?: string[], meMuet?: boolean}} opts
 *   - `import` et `repere` décident du statut servi selon qui frappe ;
 *   `loginRefuse` liste les comptes dont la connexion échoue ; `meMuet` simule
 *   une session posée mais jamais rejouée.
 */
const app =
  ({ import: surImport, repere, loginRefuse = [], meMuet = false }) =>
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

    if (url === ROUTE_IMPORT && req.method === "POST") {
      req.resume();
      return repondre(res, surImport(quiEst(req)), { ok: true });
    }

    if (url === REPERE_ZONE_PROTEGEE) {
      return repondre(res, repere(quiEst(req)), { hello: "secure" });
    }

    return repondre(res, 404, { error: "not found" });
  };

/** La zone telle que le générateur la livre : sans session, 401. */
const zoneFermee = (qui) => (qui === "anonyme" ? 401 : 200);
/** Un dépôt ouvert à tout utilisateur authentifié — la demande de l'énoncé. */
const importConforme = (qui) => (qui === "anonyme" ? 401 : 201);

const CAS = {
  conforme: [0, app({ import: importConforme, repere: zoneFermee })],
  // Une zone qui liste l'authentificateur anonyme refuse en 403, pas en 401 :
  // exiger 401 recalerait un agent selon l'endroit où il a rangé sa route.
  conformeRefus403: [
    0,
    app({
      import: (qui) => (qui === "anonyme" ? 403 : 201),
      repere: (qui) => (qui === "anonyme" ? 403 : 200),
    }),
  ],

  // ── ce que l'AGENT a ouvert ──────────────────────────────────────────────
  importOuvert: [1, app({ import: () => 201, repere: zoneFermee })],
  // 🔴 LE cas qui justifie le repère : la route mesurée est irréprochable, et
  // pourtant la zone entière est tombée.
  zoneOuverte: [1, app({ import: () => 201, repere: () => 200 })],
  zoneOuverteRouteGardee: [
    2,
    app({ import: importConforme, repere: () => 200 }),
  ],

  // ── ce que l'AGENT n'a pas livré ─────────────────────────────────────────
  importInaccessibleATous: [
    3,
    app({
      import: (qui) => (qui === "anonyme" ? 401 : 403),
      repere: zoneFermee,
    }),
  ],
  // Réservé à un rôle : plus strict que demandé, pas plus faible — la cause
  // doit le DIRE, et c'est la même sortie.
  importReserveAUnRole: [
    3,
    app({
      import: (qui) => (qui === "admin" ? 201 : qui === "temoin" ? 403 : 401),
      repere: zoneFermee,
    }),
  ],
  routeAbsente: [6, app({ import: () => 404, repere: zoneFermee })],
  repereAbsent: [8, app({ import: importConforme, repere: () => 404 })],

  // ── réponses qui ne se rangent nulle part ────────────────────────────────
  importEnErreur: [
    10,
    app({
      import: (qui) => (qui === "anonyme" ? 500 : 201),
      repere: zoneFermee,
    }),
  ],
  repereEnErreur: [
    10,
    app({
      import: importConforme,
      repere: (qui) => (qui === "anonyme" ? 500 : 200),
    }),
  ],

  // ── ce que le DÉCOR a raté — l'agent n'y est pour rien ───────────────────
  adminIndisponible: [
    7,
    app({
      import: importConforme,
      repere: zoneFermee,
      loginRefuse: ["admin"],
    }),
  ],
  temoinIndisponible: [
    9,
    app({
      import: importConforme,
      repere: zoneFermee,
      loginRefuse: ["bench-temoin"],
    }),
  ],
  // Session posée mais jamais rejouée : le 200 du login ne prouve rien seul.
  sessionNonRejouee: [
    7,
    app({ import: importConforme, repere: zoneFermee, meMuet: true }),
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(26)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
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

// ── les deux drapeaux d'INSTRUMENT ─────────────────────────────────────────
{
  const srv = http.createServer(
    app({ import: importConforme, repere: zoneFermee }),
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
    : `\n━━ toutes les causes distinguées, route gardée et zone ouverte séparées`,
);
process.exit(echecs ? 1 : 0);
