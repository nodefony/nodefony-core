/**
 * Auto-contrôle du juge « habiller la page de connexion » — chaque cause vue ROUGE.
 *
 * Aucun agent, aucune application : un serveur jouet rend tour à tour une page
 * conforme puis chaque défaillance, et le juge doit sortir EXACTEMENT le code
 * annoncé par sa table. Quelques secondes, zéro jeton.
 *
 * La page jouette reprend la forme de celle du framework (`<link
 * rel="stylesheet" href>`, `<img class="nf-logo" src>`, champ `type="password"`) :
 * un juge éprouvé sur un balisage qu'il ne rencontrera jamais ne prouverait rien.
 *
 * Usage : `node lib/gate-login-branding.selftest.mjs`
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
import {
  COULEUR_CONNEXION,
  LOGO_CONNEXION,
  MARQUE_CONNEXION,
  PAGE_CONNEXION,
} from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-login-branding.mjs",
);
const PORT = String(await portLibre());
const NOM_LOGO = LOGO_CONNEXION.split("/").pop();

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

/** La page, au balisage du framework ; chaque option dégrade UN point. */
const pageHtml = ({
  marque = MARQUE_CONNEXION,
  logo = `/branding/${NOM_LOGO}`,
  feuille = "/branding/login-theme.css",
  motDePasse = true,
} = {}) => `<!doctype html>
<html lang="fr"><head>
    <title>Se connecter — ${marque}</title>
    <link rel="icon" href="/nodefony/assets/nodefony-logo.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/nodefony/assets/login.css" />
    <link rel="stylesheet" href="${feuille}" />
</head><body>
  <div class="nf-brand"><img class="nf-logo" src="${logo}" alt="" />${marque}</div>
  <form><input name="username" type="text" />${motDePasse ? '<input name="password" type="password" />' : ""}</form>
</body></html>`;

/**
 * UNE application jouet paramétrable.
 *
 * @param {{page?: string, statutPage?: number, logoServi?: boolean, css?: string}} opts
 */
const app =
  ({
    page = pageHtml(),
    statutPage = 200,
    logoServi = true,
    css = `:root { --nf-login-brand: ${COULEUR_CONNEXION.toUpperCase()}; }`,
  } = {}) =>
  (req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === PAGE_CONNEXION) {
      res.writeHead(statutPage, { "content-type": "text/html" });
      return res.end(page);
    }
    if (url === "/nodefony/assets/login.css") {
      res.writeHead(200, { "content-type": "text/css" });
      return res.end(".nf-card { color: #111; }");
    }
    if (url === "/branding/login-theme.css") {
      res.writeHead(200, { "content-type": "text/css" });
      return res.end(css);
    }
    if (url === `/branding/${NOM_LOGO}` && logoServi) {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
    res.writeHead(404);
    return res.end();
  };

const CAS = {
  conforme: [0, app()],
  marqueAbsente: [1, app({ page: pageHtml({ marque: "Nodefony" }) })],
  logoAbsent: [
    2,
    app({ page: pageHtml({ logo: "/nodefony/assets/nodefony-logo.svg" }) }),
  ],
  // Cité mais jamais servi : l'image cassée que seul un navigateur montre.
  logoCiteNonServi: [3, app({ logoServi: false })],
  logoAutreOrigine: [
    3,
    app({ page: pageHtml({ logo: `https://cdn.example/${NOM_LOGO}` }) }),
  ],
  pageAbsente: [6, app({ statutPage: 404 })],
  formulairePerdu: [7, app({ page: pageHtml({ motDePasse: false }) })],
  feuilleEtrangere: [
    8,
    app({ page: pageHtml({ feuille: "https://cdn.example/theme.css" }) }),
  ],
  couleurAbsente: [9, app({ css: ":root { --nf-login-brand: #ff0000; }" })],
  reponseInattendue: [10, app({ statutPage: 500 })],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(20)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 86)}`,
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

// ── la garde d'INSTRUMENT, dans les deux sens, et le serveur absent ─────────
{
  const srv = http.createServer(app());
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
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
