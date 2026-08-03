#!/usr/bin/env node
/**
 * Preuve négative du juge `gate-route-param.mjs` — chaque cause, vue rouge.
 *
 * Le juge annonce six sorties distinctes dans son en-tête. Sans ce fichier,
 * c'est une affirmation en commentaire : rien ne garantit qu'une route absente
 * ne sorte pas « valeur non reflétée », et la confusion enverrait chercher un
 * défaut de lecture là où c'est la SYNTAXE du chemin qui manque.
 *
 * Un serveur jouet joue chaque cause à tour de rôle sur le port du juge ; le
 * juge doit rendre exactement le code attendu. Aucun agent, aucun décor,
 * quelques secondes, zéro token.
 *
 *   node lib/gate-route-param.selftest.mjs
 *
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ Les enfants se lancent en ASYNCHRONE, jamais `spawnSync` : celui-ci bloque
 * la boucle d'événements du parent, donc le serveur jouet ne répond plus et le
 * juge rend « aucune réponse » pour TOUTES les causes — un rouge uniforme qui
 * accuse le juge alors que l'instrument d'épreuve est seul en cause. Vécu en
 * écrivant ce fichier.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-route-param.mjs",
);
/** Port distinct de celui du banc (5371) : les deux peuvent tourner ensemble. */
const PORT = "5399";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      env: { ...process.env, NF_PORT: PORT },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

/** Un rôle par cause — le nom dit ce que l'application ferait mal. */
const ROLES = {
  // Chaque réponse porte SA valeur : le seul cas conforme.
  conforme: [
    0,
    (req, res) => {
      const h = req.url.split("/").pop();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ handle: h, initials: h.slice(0, 2) }));
    },
  ],
  // Valeur figée dans le code : deux corps identiques.
  valeurFigee: [
    2,
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ handle: "toujours-le-meme" }));
    },
  ],
  // Chemin monté en LITTÉRAL (`:handle` non traduit) : 404 partout.
  routeAbsente: [
    3,
    (_req, res) => {
      res.writeHead(404);
      res.end("not found");
    },
  ],
  // Répond, corps DIFFÉRENTS, mais aucun ne porte la valeur demandée : le cas
  // que le contraste de corps seul laisserait passer.
  valeurNonReflete: [
    1,
    (() => {
      let n = 0;
      return (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ author: `inconnu-${n++}` }));
      };
    })(),
  ],
  // Une seule des deux valeurs servie : le chemin EST variable, la route non
  // totale — à distinguer d'une route absente.
  servieAMoitie: [
    1,
    (req, res) => {
      const h = req.url.split("/").pop();
      if (h === "grace-hopper") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ handle: h }));
    },
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(17)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 96)}`,
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
  dire(res.status === 5, "portTenu", 5, res.status, (res.stderr || "").trim());
}
{
  const res = await run([JUGE, "--check-port-free"]);
  dire(res.status === 0, "portLibre", 0, res.status);
}
// Personne n'écoute : la réponse ne vient jamais.
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : "\n━━ toutes les causes distinguées",
);
process.exit(echecs ? 1 : 0);
