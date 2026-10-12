/**
 * Auto-contrôle du juge « protéger une page et y ramener après connexion ».
 *
 * Un serveur jouet joue tour à tour l'application conforme puis chaque
 * défaillance, et le juge doit sortir EXACTEMENT le code de sa table. La page
 * de connexion jouette reprend la forme de celle du framework : `from` assaini
 * repris dans `data-from` et dans un champ caché.
 *
 * Usage : `node lib/gate-login-return.selftest.mjs`
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
import { LOGIN, MOI, TEMOIN } from "./identites.mjs";
import { ORIGINE_PIEGE, PAGE_COMPTE } from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-login-return.mjs",
);
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

/** L'assainissement du framework, en version jouet : un chemin local, sinon `/`. */
const assainir = (v) => (/^\/(?![/\\])/u.test(v ?? "") ? v : "/");

const pageConnexion = (from) => `<!doctype html><html><body>
  <main class="nf-stage" data-nf-login data-from="${from}">
    <form><input name="username" /><input name="password" type="password" />
    <input type="hidden" name="from" value="${from}" /></form>
  </main></body></html>`;

/**
 * UNE application jouet ; chaque option dégrade UN comportement.
 *
 * @param {object} o
 * @param {(navigation: boolean) => {status: number, location?: string, body?: string}} [o.anonyme]
 *   ce que rend la page à un anonyme, selon qu'il navigue ou appelle une API.
 * @param {string} [o.cheminConnexion] - où vit la page de connexion.
 * @param {(from: string|null) => string} [o.fromRendu] - ce que la page de connexion reprend.
 * @param {string} [o.corpsConnecte] - la page servie au connecté.
 * @param {boolean} [o.loginRefuse] - le compte témoin ne peut pas se connecter.
 */
const app =
  ({
    anonyme = (navigation) =>
      navigation
        ? {
            status: 302,
            location: `/login?from=${encodeURIComponent(PAGE_COMPTE)}`,
          }
        : { status: 401, body: '{"error":"Authentication required"}' },
    cheminConnexion = "/login",
    fromRendu = assainir,
    corpsConnecte = `<h1>Mon compte</h1><p>${TEMOIN.username}</p>`,
    loginRefuse = false,
  } = {}) =>
  (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const connecte = (req.headers.cookie ?? "").includes("nodefony=sess-ok");
    if (url.pathname === LOGIN && req.method === "POST") {
      if (loginRefuse) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end('{"error":"Invalid credentials"}');
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "nodefony=sess-ok; Path=/; HttpOnly",
      });
      return res.end(`{"user":{"username":"${TEMOIN.username}"}}`);
    }
    if (url.pathname === MOI) {
      res.writeHead(connecte ? 200 : 401, {
        "content-type": "application/json",
      });
      return res.end(
        connecte ? `{"user":{"username":"${TEMOIN.username}"}}` : "{}",
      );
    }
    if (url.pathname === PAGE_COMPTE) {
      if (connecte) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(corpsConnecte);
      }
      const navigation = req.headers["sec-fetch-mode"] === "navigate";
      const r = anonyme(navigation);
      res.writeHead(r.status, r.location ? { location: r.location } : {});
      return res.end(r.body ?? "");
    }
    if (url.pathname === cheminConnexion) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(pageConnexion(fromRendu(url.searchParams.get("from"))));
    }
    res.writeHead(404);
    return res.end();
  };

const CAS = {
  conforme: [0, app()],
  pageOuverte: [
    1,
    app({ anonyme: () => ({ status: 200, body: "<h1>Mon compte</h1>" }) }),
  ],
  pasDeRetour: [2, app({ anonyme: () => ({ status: 401, body: "{}" }) })],
  redirectionExterne: [
    3,
    app({
      anonyme: () => ({
        status: 302,
        location: `https://${ORIGINE_PIEGE}/login`,
      }),
    }),
  ],
  routeAbsente: [6, app({ anonyme: () => ({ status: 404 }) })],
  retourPerduDansLaConduite: [
    7,
    app({
      anonyme: (nav) =>
        nav ? { status: 302, location: "/login" } : { status: 401 },
    }),
  ],
  // La conduite porte `from`, mais la page de connexion l'ignore.
  retourPerduDansLaPage: [7, app({ fromRendu: () => "/" })],
  pageDeConnexionAbsente: [8, app({ cheminConnexion: "/autre" })],
  apiRedirigee: [
    9,
    app({
      anonyme: () => ({
        status: 302,
        location: `/login?from=${encodeURIComponent(PAGE_COMPTE)}`,
      }),
    }),
  ],
  corpsInattendu: [10, app({ corpsConnecte: "<h1>Mon compte</h1>" })],
  // La page de connexion reprend `from` tel quel : le piège ressort.
  redirectionOuverte: [11, app({ fromRendu: (from) => from ?? "/" })],
  temoinIndisponible: [12, app({ loginRefuse: true })],
  reponseInattendue: [
    13,
    app({ anonyme: () => ({ status: 500, body: "boom" }) }),
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(26)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 80)}`,
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
