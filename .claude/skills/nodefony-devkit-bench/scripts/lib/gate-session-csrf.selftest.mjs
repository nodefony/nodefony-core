#!/usr/bin/env node
/**
 * Preuve négative du juge `gate-session-csrf.mjs` — chaque cause, vue rouge.
 *
 * Ce juge distingue NEUF situations, dont trois se ressemblent beaucoup vues
 * d'une seule requête : une mutation acceptée sans jeton, une mutation refusée
 * pour une autre raison (corps invalide), et une mutation refusée MALGRÉ le
 * jeton. Elles accusent trois choses différentes — l'absence de protection, la
 * forme du corps, un jeton jamais semé — et les confondre envoie chercher au
 * mauvais endroit. Sans ce fichier, cette distinction n'est qu'une affirmation
 * dans un commentaire.
 *
 * Un serveur jouet joue chaque cause à tour de rôle sur le port du juge.
 *
 *   node lib/gate-session-csrf.selftest.mjs
 *
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ Les enfants se lancent en ASYNCHRONE, jamais `spawnSync` : celui-ci bloque
 * la boucle d'événements du parent, le serveur jouet ne répond plus, et le juge
 * rend « aucune réponse » pour TOUTES les causes — un rouge uniforme qui accuse
 * le juge alors que l'instrument d'épreuve est seul en cause.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-session-csrf.mjs",
);
/**
 * Le port, obtenu du SYSTÈME et non écrit en dur.
 *
 * Un port fixe est un état PARTAGÉ : trois selftests écoutaient sur 5394,
 * trois sur 5395, deux sur 5393, et deux exécutions consécutives du lot
 * rendaient deux verdicts différents — des rouges qui n'accusaient personne.
 */
const PORT = String(await portLibre());
const SKU = "ZX9-QUARTZ-77";

/**
 * Répertoire de travail du juge — il y trouve `.nf-routes.json`, comme dans une
 * application où le gate vient de le déposer. Hors du dépôt : le juge écrit son
 * décor, il n'a pas à salir celui qui l'éprouve.
 */
const DECOR = mkdtempSync(path.join(os.tmpdir(), "nf-gate-csrf-"));
writeFileSync(
  path.join(DECOR, ".nf-routes.json"),
  JSON.stringify([
    { path: "/api/cart", methods: ["GET"] },
    { path: "/api/cart/token", methods: ["GET"] },
    { path: "/api/cart/items", methods: ["POST"] },
  ]),
);

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      cwd: DECOR,
      env: { ...process.env, NF_PORT: PORT },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

const lireCorps = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const cookieDe = (req, nom) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${nom}=`))
    ?.slice(nom.length + 1) ?? null;

/**
 * Une application jouet paramétrable — chaque cause n'est qu'un réglage.
 *
 * Écrire cinq serveurs séparés aurait fait diverger leur partie commune, et
 * c'est justement la partie commune (semer le cookie, lire la session) qui rend
 * les cas comparables entre eux.
 */
function app({
  jetonExige = true,
  sessionOk = true,
  etatGlobal = false,
  refusTout = null,
  jetonSemeSurRouteDediee = false,
}) {
  const paniers = new Map();
  const global = [];
  return async (req, res) => {
    const url = req.url ?? "";
    const sid = cookieDe(req, "nodefony") ?? String(Math.abs(Date.now() % 1e9));
    const jetonAttendu = "jeton-de-test";
    // Le cas RÉEL produit par un agent : seule la mutation porte
    // `@CsrfProtect`, et une route sûre DÉDIÉE distribue le jeton. La lecture
    // ne sème alors rien — un juge qui ne frappe qu'elle recale à tort.
    const semeIci = !jetonSemeSurRouteDediee || url === "/api/cart/token";
    const headers = {
      "content-type": "application/json",
      "set-cookie": semeIci
        ? [`nodefony=${sid}; Path=/`, `csrf-token=${jetonAttendu}; Path=/`]
        : [`nodefony=${sid}; Path=/`],
    };
    if (url === "/api/cart/token" && req.method === "GET") {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ token: jetonAttendu }));
      return;
    }
    if (url === "/api/cart" && req.method === "GET") {
      const panier = etatGlobal
        ? global
        : sessionOk
          ? (paniers.get(sid) ?? [])
          : [];
      res.writeHead(200, headers);
      res.end(JSON.stringify({ items: panier }));
      return;
    }
    if (url === "/api/cart/items" && req.method === "POST") {
      const body = await lireCorps(req);
      if (refusTout) {
        res.writeHead(refusTout, headers);
        res.end(JSON.stringify({ error: "body refusé" }));
        return;
      }
      if (jetonExige && req.headers["x-csrf-token"] !== jetonAttendu) {
        res.writeHead(403, headers);
        res.end(JSON.stringify({ error: "csrf" }));
        return;
      }
      const { sku } = JSON.parse(body || "{}");
      if (etatGlobal) global.push(sku);
      else if (sessionOk) paniers.set(sid, [...(paniers.get(sid) ?? []), sku]);
      res.writeHead(201, headers);
      res.end(JSON.stringify({ added: sku }));
      return;
    }
    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: "not found" }));
  };
}

/** Un rôle par cause — le nom dit ce que l'application ferait mal. */
const ROLES = {
  conforme: [0, app({})],
  // ⭐ Le cas qui a fait tomber la première version du juge : un vrai agent a
  // protégé la seule mutation et exposé `GET /api/cart/token` pour distribuer
  // le jeton — réponse JUSTE, recalée. Le juge doit désormais demander ses
  // routes sûres à l'application et les essayer. Sans ce rôle, la correction
  // n'aurait fait que déplacer le trou.
  jetonSurRouteDediee: [0, app({ jetonSemeSurRouteDediee: true })],
  // Aucun jeton exigé : le contournement « je vérifie l'origine, ça suffit ».
  mutationSansJeton: [1, app({ jetonExige: false })],
  // Protection posée mais le jeton attendu ne correspond à rien de semé.
  jetonRejoueRefuse: [
    2,
    async (req, res) => {
      const base = app({});
      // Le cookie semé ne vaut PAS le jeton attendu → la mutation armée échoue.
      const originale = res.writeHead.bind(res);
      res.writeHead = (code, h) => {
        if (h?.["set-cookie"]) {
          h["set-cookie"] = h["set-cookie"].map((c) =>
            c.startsWith("csrf-token=") ? "csrf-token=autre-chose; Path=/" : c,
          );
        }
        return originale(code, h);
      };
      return base(req, res);
    },
  ],
  // Ni 403 ni succès : le corps est refusé. Le CSRF n'est pas en cause.
  mutationRefuseeAutrement: [8, app({ refusTout: 422 })],
  // Rien ne survit à la requête.
  etatNonPersiste: [6, app({ sessionOk: false })],
  // Un registre global tient lieu de session : passe tout, sauf le 2ᵉ visiteur.
  etatPartage: [7, app({ etatGlobal: true })],
  // La lecture ne répond pas 200.
  lectureNonServie: [
    3,
    (_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    },
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(26)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
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

// La garde d'instrument, dans les DEUX sens : elle doit mordre sur un port
// occupé, et laisser passer sur un port libre. Une garde qui refuse toujours
// arrêterait le banc au premier run.
{
  const srv = http.createServer((_q, s) => s.end("étranger"));
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

rmSync(DECOR, { recursive: true, force: true });

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées (référence ${SKU})`,
);
process.exit(echecs ? 1 : 0);
