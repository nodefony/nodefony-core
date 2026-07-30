/**
 * Juge de la tâche « une valeur portée par le chemin » — et il NOMME sa cause.
 *
 * En fichier, jamais en `node -e` : un juge inline ne peut pas être éprouvé
 * seul, et celui-ci doit distinguer deux échecs qu'une requête unique confond —
 * or ils accusent des choses opposées.
 *
 * | Sortie | Cause                       | Ce que ça dit                                        |
 * | -----: | --------------------------- | ---------------------------------------------------- |
 * |    `0` | conforme                    | chaque réponse porte SA valeur, et les deux diffèrent |
 * |    `1` | valeur non reflétée         | la route répond — la valeur du chemin n'arrive pas    |
 * |    `2` | réponse identique aux deux  | valeur figée : le segment n'est pas lu du tout        |
 * |    `3` | route absente (404 partout) | le chemin n'a PAS de segment variable déclaré        |
 * |    `4` | aucune réponse              | la réponse ne se termine jamais                      |
 * |    `5` | port déjà tenu AVANT boot   | on mesurerait un serveur ÉTRANGER                    |
 *
 * La séparation `3` / `1` est la raison d'être de ce fichier. Une route écrite
 * `"/api/authors/:handle"` — la syntaxe d'un autre framework — est montée comme
 * un LITTÉRAL : elle ne correspond à aucune URL réelle, et tout rend 404. C'est
 * un défaut de découvrabilité de la SYNTAXE (`{handle}`), pas de la lecture de
 * la valeur. Confondre les deux ferait chercher au mauvais endroit — la faute
 * exacte que le juge de la tâche 14 a coûté avant d'être réparée.
 *
 * La sortie `5` est une garde d'INSTRUMENT, pas un critère sur l'agent :
 * `--detach --wait` sonde des ports, et un serveur étranger qui répond fait
 * déclarer la readiness — le juge interrogerait alors une autre application.
 *
 * @module
 */
import http from "node:http";
import net from "node:net";

const PORT = process.env.NF_PORT ?? "5371";
const BASE = "/api/authors";

/**
 * Deux valeurs volontairement DISTINCTES et non devinables : ni l'une ni
 * l'autre n'apparaît dans l'énoncé de la tâche, donc aucune ne peut se trouver
 * en dur dans le code de l'agent par recopie. Elles ne contiennent que des
 * caractères sûrs dans un segment d'URL — un `/` en ferait deux segments et le
 * juge mesurerait alors la route, pas le paramètre.
 */
const VALEURS = ["ada-lovelace", "grace-hopper"];

/** Le port répond-il déjà ? (avant boot : quelqu'un d'autre l'occupe.) */
const portTenu = (port) =>
  new Promise((resolve) => {
    const s = net.connect(Number(port), "127.0.0.1");
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

/**
 * Une requête sur la fiche d'un pseudonyme.
 *
 * @param {string} handle - la valeur placée dans le chemin.
 * @returns {Promise<object>} statut et corps — ou `erreur`.
 */
const demander = (handle) =>
  new Promise((resolve) => {
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: `${BASE}/${handle}` },
      (res) => {
        let corps = "";
        res.on("data", (c) => (corps += c));
        res.on("end", () => resolve({ statut: res.statusCode, corps }));
      },
    );
    r.on("error", (e) => resolve({ erreur: e.message }));
    r.setTimeout(15_000, () => {
      r.destroy();
      resolve({ erreur: "aucune réponse en 15 s" });
    });
    r.end();
  });

// `--check-port-free` : appelé AVANT le boot, il ne fait que la garde.
if (process.argv.includes("--check-port-free")) {
  if (await portTenu(PORT)) {
    console.error(
      `CAUSE=port-deja-tenu — le port ${PORT} répond AVANT le boot du décor : ` +
        `le juge mesurerait un serveur étranger. Verdict non rendu.`,
    );
    process.exit(5);
  }
  process.exit(0);
}

const [a, b] = await Promise.all(VALEURS.map(demander));

// ─── 1. La réponse arrive-t-elle ? ──────────────────────────────────────────
for (const r of [a, b]) {
  if (r.erreur) {
    console.error(`CAUSE=aucune-reponse — ${r.erreur}`);
    process.exit(4);
  }
}

// ─── 2. La route existe-t-elle pour une valeur QUELCONQUE ? ─────────────────
// 404 sur les deux = le chemin déclaré ne comporte pas de segment variable
// (typiquement `:handle` laissé tel quel, monté comme un littéral).
if (a.statut === 404 && b.statut === 404) {
  console.error(
    `CAUSE=route-absente — GET ${BASE}/${VALEURS[0]} et ${BASE}/${VALEURS[1]} rendent 404 : ` +
      `aucune route ne correspond à une valeur quelconque dans ce segment. La lecture de la ` +
      `valeur n'est PAS en cause — c'est la déclaration du chemin variable.`,
  );
  process.exit(3);
}
for (const [i, r] of [a, b].entries()) {
  if (r.statut !== 200) {
    console.error(
      `CAUSE=reponse-non-200 — ${BASE}/${VALEURS[i]} rend ${r.statut} : la route existe pour ` +
        `l'autre valeur, donc le chemin est variable — mais celle-ci n'est pas servie.`,
    );
    process.exit(1);
  }
}

// ─── 3. LE JUGE — chaque réponse porte-t-elle SA valeur ? ───────────────────
// Le contraste est binaire et ne s'imite pas par accident : une valeur figée
// rend deux corps identiques, une valeur ignorée n'en fait apparaître aucune.
if (a.corps === b.corps) {
  console.error(
    `CAUSE=reponse-identique — les deux pseudonymes rendent le MÊME corps : la valeur du ` +
      `chemin n'est pas lue (figée dans le code). Corps : ${a.corps.slice(0, 160)}`,
  );
  process.exit(2);
}
for (const [i, r] of [a, b].entries()) {
  if (!r.corps.includes(VALEURS[i])) {
    console.error(
      `CAUSE=valeur-non-reflete — la réponse à ${BASE}/${VALEURS[i]} ne contient pas ` +
        `« ${VALEURS[i]} » : la route répond, mais la valeur du chemin n'arrive pas jusqu'à ` +
        `elle. Corps : ${r.corps.slice(0, 160)}`,
    );
    process.exit(1);
  }
}
console.log(`ok — ${VALEURS.join(" ≠ ")}, chaque réponse porte la sienne`);
process.exit(0);
