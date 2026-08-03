/**
 * Socle HTTP des juges du banc — UNE implémentation de la requête, du bocal à
 * cookies et de la garde de port.
 *
 * Motif : chaque juge frappait l'application avec sa propre copie de ces trois
 * briques. Une copie diverge en silence — chacune passe son propre selftest avec
 * sa propre idée du timeout, de l'absorption des cookies ou de ce que « le port
 * est libre » veut dire. Ce sont exactement les trois endroits où un juge se met
 * à MENTIR sans qu'aucun rouge n'apparaisse.
 *
 * Ce module ne décide de rien : il ne connaît ni route, ni verdict, ni cause.
 * Le SENS (quelle route, quel code attendu, quelle cause émise) reste dans
 * chaque juge — c'est ce qui se relit pour comprendre une mesure.
 *
 * @module
 */
import http from "node:http";
import net from "node:net";

/**
 * Port de l'application témoin. Posé par le banc (`APP_ENV.NF_PORT = 5371`) ;
 * un selftest le surcharge pour tourner en même temps que le banc.
 */
export const PORT = process.env.NF_PORT ?? "5371";

/** Toujours la boucle locale : le décor du banc n'écoute jamais ailleurs. */
export const HOTE = "127.0.0.1";

/** Au-delà, la réponse ne viendra pas — et l'attendre ne dit rien de plus. */
const TIMEOUT_MS = 15_000;

/**
 * Le port répond-il déjà ?
 *
 * @param {string|number} [port] - port sondé.
 * @returns {Promise<boolean>} `true` si quelqu'un écoute.
 */
export const portTenu = (port = PORT) =>
  new Promise((resolve) => {
    const s = net.connect(Number(port), HOTE);
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

/**
 * Termine le juge sur une cause nommée.
 *
 * Le format est un contrat : le banc relit la PREMIÈRE ligne commençant par
 * `CAUSE=` dans stderr puis stdout, et en fait l'`evidence` du rapport
 * (`bench-discoverability.mjs:1469`). Une ligne, jamais deux.
 *
 * @param {number} code - code de sortie, une cause par code.
 * @param {string} message - `CAUSE=<nom-en-kebab> — <phrase>`.
 * @returns {never}
 */
export const sortir = (code, message) => {
  console.error(message);
  process.exit(code);
};

/**
 * Garde d'INSTRUMENT — à appeler en tête de chaque juge.
 *
 * Sous `--check-port-free`, le juge ne mesure rien : il vérifie que le port est
 * libre AVANT le boot du décor et sort. Un serveur étranger resté d'un run
 * précédent répondrait à la place de l'application témoin, et le juge mesurerait
 * quelqu'un d'autre en le disant avec aplomb.
 *
 * Sortie `5` = garde d'instrument, jamais un critère sur l'agent.
 *
 * @param {string|number} [port] - port du décor.
 * @returns {Promise<void>} rend la main seulement si le flag est absent.
 */
export const garderPortLibre = async (port = PORT) => {
  if (!process.argv.includes("--check-port-free")) return;
  if (await portTenu(port)) {
    sortir(
      5,
      `CAUSE=port-deja-tenu — le port ${port} répond AVANT le boot du décor : ` +
        `le juge mesurerait un serveur étranger. Verdict non rendu.`,
    );
  }
  process.exit(0);
};

/**
 * Un bocal à cookies minimal — `nom=valeur`, sans domaine ni expiration.
 *
 * Suffisant ici : tout tient sur `127.0.0.1`, en quelques secondes. Un bocal
 * complet apporterait des règles (domaine, chemin, `Max-Age`) dont aucune ne
 * change le verdict, et chacune serait une occasion de bogue dans le JUGE —
 * lequel doit rester plus simple que ce qu'il mesure.
 *
 * Un bocal vierge matérialise « quelqu'un d'autre » : c'est ainsi qu'on
 * distingue un état de session d'un registre global, et une identité d'une
 * absence d'identité.
 */
export class Bocal {
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
  /** Un cookie porte-t-il une valeur ? (une session posée, par exemple.) */
  aCookie(predicat) {
    for (const [nom, valeur] of this.cookies) {
      if (predicat(nom, valeur)) return true;
    }
    return false;
  }
}

/**
 * Une requête, cookies absorbés dans le bocal fourni.
 *
 * Ne rejette JAMAIS : une panne réseau devient `{ erreur }`, que le juge
 * traduit en cause. Un `throw` ici ferait sortir le juge sur une trace Node —
 * illisible dans l'`evidence` d'un rapport.
 *
 * @param {string} methode - verbe HTTP.
 * @param {string} chemin - chemin de la route.
 * @param {Bocal} bocal - cookies envoyés puis mis à jour depuis la réponse.
 * @param {{corps?: object, jeton?: string|null, entetes?: object, port?: string|number}} [opts]
 *   - `corps` sérialisé en JSON ; `jeton` posé en `x-csrf-token` ; `entetes`
 *   fusionnés en dernier (ils gagnent) ; `port` pour sortir du décor par défaut.
 * @returns {Promise<{statut?: number, corps?: string, entetes?: object, erreur?: string}>}
 */
export const demander = (methode, chemin, bocal, opts = {}) =>
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
    Object.assign(headers, opts.entetes ?? {});
    const r = http.request(
      {
        host: HOTE,
        port: opts.port ?? PORT,
        path: chemin,
        method: methode,
        headers,
      },
      (res) => {
        let corps = "";
        res.on("data", (c) => (corps += c));
        res.on("end", () => {
          bocal.absorber(res.headers["set-cookie"]);
          resolve({
            statut: res.statusCode,
            corps,
            entetes: res.headers,
          });
        });
      },
    );
    r.on("error", (e) => resolve({ erreur: e.message }));
    r.setTimeout(TIMEOUT_MS, () => {
      r.destroy();
      resolve({ erreur: `aucune réponse en ${TIMEOUT_MS / 1000} s` });
    });
    if (payload) r.write(payload);
    r.end();
  });
