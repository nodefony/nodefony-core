/**
 * Auto-contrôle du juge « une route qui répond 404 ».
 *
 * Une application jouet par cause : la route rétablie (référence), encore en
 * 404, refaite par un autre controller, en erreur — puis le port tenu et
 * l'application absente. Chaque cas doit sortir sur SON code : un juge qui
 * confondrait « route remplacée » et « conforme » validerait le contournement
 * que la tâche existe pour refuser.
 *
 * Ce que ce contrôle ne prouve PAS : la forme exacte de la réponse du
 * controller généré. Elle est relevée sur une application générée réelle.
 *
 * Usage : `node lib/gate-route-retablie.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` proscrit : le serveur jouet vit dans CE processus.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";
import { CONTROLLER_EN_PANNE, ROUTE_EN_PANNE } from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-route-retablie.mjs",
);
const PORT = String(await portLibre());

/** Une application qui répond `statut` et `corps` sur la route en panne, 404 ailleurs. */
const app = (statut, corps) => (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  if (url.pathname !== ROUTE_EN_PANNE) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(statut, { "content-type": "application/json" });
  res.end(JSON.stringify(corps));
};

const CAS = {
  conforme: [0, app(200, { hello: CONTROLLER_EN_PANNE, who: "anonyme" })],
  // Le générateur peut rendre le nom en minuscules : même controller.
  conformeMinuscules: [
    0,
    app(200, { hello: CONTROLLER_EN_PANNE.toLowerCase() }),
  ],
  toujoursAbsente: [1, app(404, { error: "Not Found" })],
  remplacee: [2, app(200, { ok: true })],
  enErreur: [3, app(500, { error: "boom" })],
};

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
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

for (const [nom, [attendu, handler]] of Object.entries(CAS)) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE]);
  await new Promise((r) => srv.close(r));
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}
{
  const srv = http.createServer(CAS.conforme[1]);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTaken", 5, res.status, (res.stderr || "").trim());
}
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
