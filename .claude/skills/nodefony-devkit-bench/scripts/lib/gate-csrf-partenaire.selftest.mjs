/**
 * Auto-contrôle du juge « le partenaire poste, l'inconnu reste dehors ».
 *
 * Une application jouet applique tour à tour chaque politique de provenance, et
 * le juge doit rendre EXACTEMENT le code annoncé par sa table. Aucun agent,
 * aucun décor, quelques secondes, zéro jeton.
 *
 * Ce juge tranche entre deux résultats que la route mesurée ne distingue pas :
 * un partenaire débloqué en DÉCLARANT son origine, et un partenaire débloqué en
 * RETIRANT la défense. Les deux rendent 2xx au partenaire. Si le contrôle ne
 * jouait que lui, l'instrument serait vert dans les deux cas — et le mode
 * d'échec qu'on cherche resterait invisible, ce qui est précisément la raison
 * d'être de cette famille de tâches.
 *
 * Usage : `node lib/gate-csrf-partenaire.selftest.mjs`
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
import { ORIGINE_PARTENAIRE, ROUTE_COMMANDES } from "./enonces.mjs";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-csrf-partenaire.mjs",
);

/**
 * Le port, obtenu du SYSTÈME et non écrit en dur.
 *
 * Un port fixe est un état PARTAGÉ : trois selftests écoutaient sur 5394,
 * trois sur 5395, deux sur 5393, et deux exécutions consécutives du lot
 * rendaient deux verdicts différents — des rouges qui n'accusaient personne.
 */
const PORT = String(await portLibre());

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

const repondre = (res, status, objet) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(objet));
};

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{politique?: Function, status?: number}} opts
 *   - `politique` reçoit l'origine tamponnée et rend le statut servi ;
 *   `statut` force la réponse quelle que soit l'origine (route absente…).
 */
const app =
  ({ politique, status }) =>
  (req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== ROUTE_COMMANDES || req.method !== "POST") {
      return repondre(res, 404, { error: "not found" });
    }
    // Le corps est lu et jeté : ce juge mesure la PROVENANCE, jamais le contenu.
    req.resume();
    if (status !== undefined) return repondre(res, status, { forced: true });
    const origine = req.headers.origin ?? "";
    return repondre(res, politique(origine), { origine });
  };

/** L'application qui a DÉCLARÉ l'origine du partenaire — la bonne réponse. */
const declaree = (origine) => (origine === ORIGINE_PARTENAIRE ? 201 : 403);

const CAS = {
  conforme: [0, app({ politique: declaree })],

  // ── ce que l'AGENT a retiré — la route sert tout le monde ────────────────
  defenseDemontee: [1, app({ politique: () => 201 })],
  // Une exemption rendue en 200 plutôt qu'en 201 : même faute, autre code.
  defenseDemontee200: [1, app({ politique: () => 200 })],

  // ── ce que l'AGENT n'a pas livré ─────────────────────────────────────────
  partenaireToujoursRefuse: [2, app({ politique: () => 403 })],
  routeAbsente: [3, app({ status: 404 })],

  // ── réponses qui ne se rangent nulle part ────────────────────────────────
  partenaireEnErreur: [6, app({ status: 500 })],
  inconnuInattendu: [
    6,
    app({ politique: (o) => (o === ORIGINE_PARTENAIRE ? 201 : 500) }),
  ],
  // Un refus d'identité (401) pour l'inconnu n'est pas le 403 de provenance
  // attendu : la route est protégée, mais pas par la défense mesurée ici.
  inconnuRefuseAutrement: [
    6,
    app({ politique: (o) => (o === ORIGINE_PARTENAIRE ? 201 : 401) }),
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

// ── la garde d'INSTRUMENT, dans les DEUX sens ──────────────────────────────
{
  const srv = http.createServer(app({ politique: declaree }));
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

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, origine déclarée et défense retirée séparées`,
);
process.exit(echecs ? 1 : 0);
