/**
 * Auto-contrôle du juge « le login résiste au bourrage ».
 *
 * Une application jouet joue tour à tour chaque défaillance, et le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro token.
 *
 * Le cas central est `jamaisFreine` : une application qui répond 401 à l'infini
 * — exactement ce qu'on obtient en éteignant `rateLimit`. Elle a l'air
 * parfaitement saine vue d'un test fonctionnel (les mauvais mots de passe SONT
 * refusés) ; seule la répétition révèle qu'aucun mur n'arrive jamais. C'est ce
 * cas qui donne au juge sa raison d'exister, donc le premier à exercer.
 *
 * Le cas `seuilReleve` protège dans l'autre sens : une application qui tolère
 * plus d'essais avant de freiner reste CONFORME — relever un seuil est un
 * réglage, pas un affaiblissement. Un juge qui exigerait le défaut du framework
 * recalerait un choix légitime, et ce faux rouge coûterait plus cher que le
 * trou qu'il prétend fermer.
 *
 * Les causes de DÉCOR (`4`, `5`, `6`) sont éprouvées au même titre que celles
 * de l'agent : ne pas les distinguer reviendrait à imputer une panne du banc à
 * un travail juste.
 *
 * Usage : `node lib/gate-login-throttle.selftest.mjs`
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

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-login-throttle.mjs",
);

/** Port distinct de celui du banc (5371) et des autres auto-contrôles. */
const PORT = "5394";

const LOGIN = "/nodefony/security/api/auth/login";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

const repondre = (res, statut, objet, entetes = {}) => {
  res.writeHead(statut, { "content-type": "application/json", ...entetes });
  res.end(JSON.stringify(objet));
};

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{apres?: number, retryAfter?: boolean, loginAbsent?: boolean}} opts
 *   - `apres` : nombre d'échecs tolérés avant le 429 (`Infinity` = jamais) ;
 *   `retryAfter` : le 429 porte-t-il l'en-tête RFC 6585 ; `loginAbsent` : la
 *   route de connexion n'existe pas (décor sans module de sécurité).
 */
const app = ({ apres = 3, retryAfter = true, loginAbsent = false }) => {
  let echecs = 0;
  return (req, res) => {
    if (req.url !== LOGIN || req.method !== "POST") {
      return repondre(res, 404, { error: "Not Found" });
    }
    if (loginAbsent) return repondre(res, 404, { error: "Not Found" });
    req.resume();
    echecs += 1;
    if (echecs > apres) {
      return repondre(
        res,
        429,
        { error: "Too many attempts" },
        retryAfter ? { "retry-after": "2" } : {},
      );
    }
    // Message uniforme : la réponse à un identifiant inconnu et à un mauvais
    // mot de passe est la même (anti-énumération), comme dans le framework.
    return repondre(res, 401, { error: "Invalid credentials" });
  };
};

/** `[code attendu, application jouet]` — la table des causes du juge. */
const CAS = {
  // Le cas qui justifie le juge : refus corrects à l'infini, aucun mur.
  jamaisFreine: [1, app({ apres: Number.POSITIVE_INFINITY })],
  // Défense debout, mais le 429 ne dit pas quand réessayer (RFC 6585 §4).
  pasDeRetryAfter: [2, app({ apres: 3, retryAfter: false })],
  // Décor sans route de connexion — ce n'est pas l'agent qui a mal travaillé.
  loginAbsent: [6, app({ loginAbsent: true })],
  // Conforme : freine au 4ᵉ essai, avec Retry-After.
  conforme: [0, app({ apres: 3 })],
  // Conforme AUSSI : seuil relevé bien au-delà du défaut, mais mur présent —
  // le juge tolère jusqu'à 12 tentatives, un réglage large reste un réglage.
  seuilReleve: [0, app({ apres: 9 })],
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
  const cause = (res.stdout || res.stderr).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── les drapeaux d'INSTRUMENT ──────────────────────────────────────────────
{
  const srv = http.createServer(app({ apres: 3 }));
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTenu", 5, res.status, (res.stdout || "").trim());
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
    : `\n━━ toutes les causes distinguées, seuil relevé et défense éteinte séparés`,
);
process.exit(echecs ? 1 : 0);
