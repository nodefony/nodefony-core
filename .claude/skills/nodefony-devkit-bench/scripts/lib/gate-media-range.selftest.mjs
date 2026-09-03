/**
 * Auto-contrôle du juge « servir un gros média ».
 *
 * Ce fichier existe parce que son absence a coûté un juge MORT pendant cinq
 * jours : un refactor de nommage (`6f2c2c53`) a renommé la définition de la
 * requête sans renommer ses deux appels, et `gate-media-range.mjs` levait un
 * `ReferenceError` à sa première ligne utile. Il était le SEUL juge du banc
 * sans auto-contrôle — c'est très exactement pour cela qu'il est le seul à
 * s'être cassé sans que rien ne le dise.
 *
 * Ce que sa mort produisait est pire qu'une panne : un juge qui plante sort en
 * erreur SANS ligne `CAUSE=`, et le banc rend alors un rouge OPPOSABLE À
 * L'AGENT. La tâche 14 serait tombée en FAIL 3/3 « stable », donnant une chute
 * à instruire et trois agents payés pour une faute de frappe.
 *
 * La leçon, déjà graduée dans ce dépôt et reproduite quand même : un selftest
 * qui n'éprouve que la fonction de jugement ne voit pas un défaut de COLLECTE.
 * Celui-ci lance donc le juge en SOUS-PROCESSUS, contre une application jouet —
 * la seule forme qui aurait attrapé le `ReferenceError`.
 *
 * Usage : `node lib/gate-media-range.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` est proscrit : le serveur jouet vit dans CE processus, et un
 * appel bloquant l'empêcherait de répondre — le juge sortirait en « aucune
 * réponse » partout, ce qui ressemble de loin à un contrôle vert.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-media-range.mjs",
);

/** Le chemin que le juge interroge — il est écrit en dur dans le juge. */
const CHEMIN = "/api/media/gate-sample.mp4";

/** L'échantillon servi : assez gros pour qu'un morceau de 100 octets ait un sens. */
const MEDIA = Buffer.alloc(4096, "n");

const run = (args, port) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      env: { ...process.env, NF_PORT: String(port) },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{ statut?: number, honoreRange?: boolean, contentRange?: boolean,
 *   octetsRendus?: number }} opts - `honoreRange` fait répondre 206 ;
 *   `contentRange` pose (ou non) l'en-tête ; `octetsRendus` permet de rendre un
 *   morceau de la mauvaise taille tout en annonçant 206.
 */
const app =
  ({
    statut = 200,
    honoreRange = true,
    contentRange = true,
    octetsRendus = 100,
  }) =>
  (req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== CHEMIN) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    if (statut !== 200) {
      res.writeHead(statut, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "media" }));
    }
    const range = req.headers.range;
    if (!range || !honoreRange) {
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": String(MEDIA.length),
      });
      return res.end(MEDIA);
    }
    const entetes = { "content-type": "video/mp4" };
    if (contentRange) {
      entetes["content-range"] = `bytes 0-${octetsRendus - 1}/${MEDIA.length}`;
    }
    res.writeHead(206, entetes);
    res.end(MEDIA.subarray(0, octetsRendus));
  };

/**
 * Les cas, un par sortie que le juge ANNONCE dans sa table d'en-tête.
 *
 * `plagesIgnorees` est le cas qui porte la valeur du banc : le fichier EST
 * servi, seule la façade ne traite pas `Range`. Le confondre avec
 * `echantillon-non-servi` fait accuser la découvrabilité quand l'agent a trouvé
 * le bon dossier.
 */
const CAS = {
  conforme: [0, app({})],
  plagesIgnorees: [1, app({ honoreRange: false })],
  plageSansContentRange: [1, app({ contentRange: false })],
  plageTronquee: [1, app({ octetsRendus: 50 })],
  echantillonAbsent: [3, app({ statut: 404 })],
  mediaEnErreur: [3, app({ statut: 500 })],
};

let echecs = 0;

/**
 * Un code de sortie juste ne suffit PAS : le rouge doit NOMMER sa cause.
 *
 * Sans cette seconde exigence, ce fichier aurait validé un juge mort. Mesuré
 * en l'écrivant : le juge levait un `ReferenceError`, Node sortait en `1`, et
 * les trois cas qui attendent `1` passaient au vert — pour un plantage, pas
 * pour un jugement. C'est le même mécanisme qui rend un juge cassé opposable à
 * l'agent : le banc n'impute correctement que ce qui porte une ligne `CAUSE=`.
 *
 * @param {boolean} ok - le code de sortie est-il celui annoncé ?
 * @param {string} nom - nom du cas.
 * @param {number} attendu - code annoncé par la table du juge.
 * @param {number} obtenu - code rendu.
 * @param {string} [cause] - première ligne de la sortie du juge.
 */
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  const nomme = attendu === 0 || cause.startsWith("CAUSE=");
  if (!ok || !nomme) echecs++;
  const marque = !ok ? "❌" : nomme ? "✅" : "❌";
  const note =
    ok && !nomme ? "  ⚠️ sortie SANS `CAUSE=` — plantage, pas jugement" : "";
  console.log(
    `${marque} ${nom.padEnd(24)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}${note}`,
  );
};

for (const [nom, [attendu, handler]] of Object.entries(CAS)) {
  const port = await portLibre();
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  const res = await run([JUGE], port);
  await new Promise((r) => srv.close(r));
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── personne ne répond : le juge s'en aperçoit au lieu de conclure ──────────
{
  const port = await portLibre();
  const res = await run([JUGE], port);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

// ── la garde d'INSTRUMENT, dans les DEUX sens ──────────────────────────────
{
  const port = await portLibre();
  const srv = http.createServer(app({}));
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"], port);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTenu", 5, res.status, (res.stderr || "").trim());
}
{
  const port = await portLibre();
  const res = await run([JUGE, "--check-port-free"], port);
  dire(res.status === 0, "portLibre", 0, res.status);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, échantillon et plage séparés`,
);
process.exit(echecs ? 1 : 0);
