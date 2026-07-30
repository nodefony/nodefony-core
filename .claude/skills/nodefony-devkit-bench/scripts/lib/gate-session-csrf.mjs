/**
 * Juge de la tâche « un état par visiteur, et une mutation qui prouve son
 * intention » — et il NOMME sa cause.
 *
 * Deux garanties sont mesurées d'un même trajet, parce qu'elles se prouvent avec
 * les mêmes requêtes : l'état survit-il d'une requête à l'autre POUR CE
 * visiteur-là (session), et la mutation exige-t-elle le jeton anti-rejeu
 * (`@CsrfProtect`) ?
 *
 * | Sortie | Cause                          | Ce que ça dit                                          |
 * | -----: | ------------------------------ | ------------------------------------------------------ |
 * |    `0` | conforme                       | session isolée par visiteur + jeton exigé puis accepté  |
 * |    `1` | mutation acceptée SANS jeton   | seule la provenance est vérifiée — pas de `@CsrfProtect` |
 * |    `2` | mutation refusée AVEC le jeton | protection posée mais inutilisable (jeton non semé)     |
 * |    `3` | lecture non servie             | la route de lecture ne répond pas 200                   |
 * |    `4` | aucune réponse                 | la réponse ne se termine jamais                         |
 * |    `5` | port déjà tenu AVANT boot      | on mesurerait un serveur ÉTRANGER                       |
 * |    `6` | état non persisté              | rien ne survit à la requête — pas de session            |
 * |    `7` | état PARTAGÉ entre visiteurs   | un registre global tient lieu de session                |
 * |    `8` | mutation refusée autrement     | ni 403 ni succès (corps refusé, route absente) — le     |
 * |        |                                | CSRF n'est PAS en cause, et l'accuser égarerait         |
 *
 * La sortie `1` repose sur un fait documenté et vérifié au source
 * (`security/docs/csrf.md`, situation 2) : **`curl` sans en-tête de navigateur
 * PASSE la défense de provenance** (étape 1, toujours active) et n'est refusé
 * qu'à partir du moment où une route exige le jeton. Le contraste est donc
 * binaire sans avoir à forger le moindre en-tête `Origin` ou `Sec-Fetch-Site` —
 * et un agent qui n'aurait fait « que » de la vérification d'origine sort en
 * `1`, ce qui est exactement le contournement qu'on cherche à voir.
 *
 * La sortie `8` existe pour ne PAS accuser le CSRF d'un 422 : la forme du corps
 * est figée par l'énoncé, mais un agent peut l'avoir contrainte davantage.
 *
 * @module
 */
import http from "node:http";
import net from "node:net";

const PORT = process.env.NF_PORT ?? "5371";
const LECTURE = "/api/cart";
const MUTATION = "/api/cart/items";

/**
 * Référence absente de l'énoncé de la tâche — donc impossible à figer dans le
 * code par recopie. C'est elle qu'on cherche ensuite dans le panier relu.
 */
const SKU = "ZX9-QUARTZ-77";

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
 * Un bocal à cookies minimal — `nom=valeur`, sans domaine ni expiration.
 *
 * Suffisant ici : tout tient sur `127.0.0.1`, en quelques secondes. Un bocal
 * complet apporterait des règles (domaine, chemin, `Max-Age`) dont aucune ne
 * change le verdict, et chacune serait une occasion de bogue dans le JUGE —
 * lequel doit rester plus simple que ce qu'il mesure.
 */
class Bocal {
  constructor() {
    this.cookies = new Map();
  }
  absorber(setCookie) {
    for (const ligne of setCookie ?? []) {
      const [paire] = ligne.split(";");
      const i = paire.indexOf("=");
      if (i > 0) this.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1));
    }
  }
  entete() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  /** Le jeton anti-rejeu, tel qu'un client web le relit (`csrf-token`). */
  jeton() {
    for (const [nom, valeur] of this.cookies) {
      if (nom.endsWith("csrf-token")) return decodeURIComponent(valeur);
    }
    return null;
  }
}

/**
 * Une requête, cookies absorbés dans le bocal fourni.
 *
 * @param {string} methode - verbe HTTP.
 * @param {string} chemin - chemin de la route.
 * @param {Bocal} bocal - cookies envoyés puis mis à jour depuis la réponse.
 * @param {{corps?: object, jeton?: string|null}} [opts] - corps JSON, jeton à rejouer.
 * @returns {Promise<object>} statut et corps — ou `erreur`.
 */
const demander = (methode, chemin, bocal, opts = {}) =>
  new Promise((resolve) => {
    const payload = opts.corps ? JSON.stringify(opts.corps) : null;
    const headers = {};
    const cookies = bocal.entete();
    if (cookies) headers.cookie = cookies;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (opts.jeton) headers["x-csrf-token"] = opts.jeton;
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: chemin, method: methode, headers },
      (res) => {
        let corps = "";
        res.on("data", (c) => (corps += c));
        res.on("end", () => {
          bocal.absorber(res.headers["set-cookie"]);
          resolve({ statut: res.statusCode, corps });
        });
      },
    );
    r.on("error", (e) => resolve({ erreur: e.message }));
    r.setTimeout(15_000, () => {
      r.destroy();
      resolve({ erreur: "aucune réponse en 15 s" });
    });
    if (payload) r.write(payload);
    r.end();
  });

const sortir = (code, message) => {
  console.error(message);
  process.exit(code);
};

// `--check-port-free` : appelé AVANT le boot, il ne fait que la garde.
if (process.argv.includes("--check-port-free")) {
  if (await portTenu(PORT)) {
    sortir(
      5,
      `CAUSE=port-deja-tenu — le port ${PORT} répond AVANT le boot du décor : ` +
        `le juge mesurerait un serveur étranger. Verdict non rendu.`,
    );
  }
  process.exit(0);
}

const visiteur = new Bocal();
const inconnu = new Bocal();

// ─── 1. La lecture répond-elle, et sème-t-elle de quoi muter ? ───────────────
const lecture = await demander("GET", LECTURE, visiteur);
if (lecture.erreur) sortir(4, `CAUSE=aucune-reponse — ${lecture.erreur}`);
if (lecture.statut !== 200) {
  sortir(
    3,
    `CAUSE=lecture-non-servie — GET ${LECTURE} rend ${lecture.statut} : la route de lecture ` +
      `que l'énoncé nomme n'est pas servie. Ni la session ni le jeton ne sont en cause.`,
  );
}

// ─── 2. LE juge du jeton — la mutation NUE doit être refusée ────────────────
// `curl` sans en-tête de navigateur passe la défense de provenance : un 2xx ici
// prouve donc qu'aucun jeton n'est exigé.
const nue = await demander("POST", MUTATION, visiteur, { corps: { sku: SKU } });
if (nue.erreur) sortir(4, `CAUSE=aucune-reponse-sur-mutation — ${nue.erreur}`);
if (nue.statut >= 200 && nue.statut < 300) {
  sortir(
    1,
    `CAUSE=mutation-sans-jeton — POST ${MUTATION} SANS \`x-csrf-token\` rend ${nue.statut}. ` +
      `Un client non-navigateur passe la défense de provenance : la mutation n'exige donc ` +
      `aucune preuve d'intention. C'est le contournement — l'origine vérifiée, rien de plus.`,
  );
}
if (nue.statut !== 403) {
  sortir(
    8,
    `CAUSE=mutation-refusee-autrement — POST ${MUTATION} rend ${nue.statut}, ni 403 ni succès : ` +
      `route absente ou corps refusé. La défense CSRF n'est PAS en cause. Corps : ` +
      `${nue.corps.slice(0, 160)}`,
  );
}

// ─── 3. …puis ACCEPTÉE une fois le jeton rejoué ─────────────────────────────
const jeton = visiteur.jeton();
const armee = await demander("POST", MUTATION, visiteur, {
  corps: { sku: SKU },
  jeton,
});
if (armee.erreur)
  sortir(4, `CAUSE=aucune-reponse-sur-mutation-armee — ${armee.erreur}`);
if (!(armee.statut >= 200 && armee.statut < 300)) {
  sortir(
    2,
    `CAUSE=jeton-rejoue-refuse — la mutation refuse ${armee.statut} MÊME avec le jeton ` +
      `(${jeton ? "cookie lu" : "aucun cookie de jeton semé"}). La protection est posée mais ` +
      `inutilisable : une requête sûre doit semer le cookie que la mutation rejoue.`,
  );
}

// ─── 4. L'état survit-il à la requête, POUR CE visiteur ? ───────────────────
const relu = await demander("GET", LECTURE, visiteur);
if (relu.erreur)
  sortir(4, `CAUSE=aucune-reponse-sur-relecture — ${relu.erreur}`);
if (!relu.corps.includes(SKU)) {
  sortir(
    6,
    `CAUSE=etat-non-persiste — après un ajout accepté, GET ${LECTURE} ne contient pas ` +
      `« ${SKU} » : rien ne survit d'une requête à l'autre. Corps : ${relu.corps.slice(0, 160)}`,
  );
}

// ─── 5. …et RESTE le sien ───────────────────────────────────────────────────
// Bocal vierge = un autre visiteur. Un registre global au niveau du module
// passerait les quatre contrôles précédents et tomberait ici.
const autre = await demander("GET", LECTURE, inconnu);
if (autre.erreur)
  sortir(4, `CAUSE=aucune-reponse-second-visiteur — ${autre.erreur}`);
if (autre.corps.includes(SKU)) {
  sortir(
    7,
    `CAUSE=etat-partage — un visiteur SANS cookie voit « ${SKU} » : l'état est global au ` +
      `serveur, pas attaché à une session. Deux personnes partageraient le même panier.`,
  );
}

console.log(
  `ok — jeton exigé puis accepté, « ${SKU} » persiste pour son visiteur et pour lui seul`,
);
process.exit(0);
