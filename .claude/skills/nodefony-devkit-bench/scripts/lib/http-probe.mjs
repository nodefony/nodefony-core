/**
 * Socle HTTP des juges du banc — UNE implémentation de la requête, du jar à
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
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

/**
 * Port de l'application témoin. Posé par le banc (`APP_ENV.NF_PORT = 5371`) ;
 * un selftest le surcharge pour tourner en même temps que le banc.
 */
export const PORT = process.env.NF_PORT ?? "5371";

/** Toujours la boucle locale : le décor du banc n'écoute jamais ailleurs. */
export const HOST = "127.0.0.1";

/**
 * L'application qui écoute est-elle bien CELLE-CI ?
 *
 * 🔴 **Un port qui répond ne prouve pas à qui il répond.** Vécu, et le banc s'y
 * est pris lui-même : un run interrompu a laissé son serveur vivant sur les
 * ports dédiés ; le run suivant n'a donc jamais démarré le sien, et l'agent
 * comme les juges ont interrogé l'application du run PRÉCÉDENT — même ports,
 * même nom (`bench-app`), donc rien pour s'en apercevoir. C'est la classe de
 * piège « une application qui n'est pas la sienne », version runtime.
 *
 * Le discriminant est LOCAL et gratuit : un serveur Nodefony publie son état
 * dans `node_modules/.cache/nodefony/runtime.json` — PID et ports EFFECTIFS —
 * et cet état vit dans l'application qui l'a démarré. Absent, ou ne portant pas
 * le port qu'on s'apprête à frapper : ce qui répond appartient à quelqu'un
 * d'autre.
 *
 * @param {string} [app] - racine de l'application sous test (défaut : le cwd).
 * @returns {{pid: number, ports: number[]}|null} son état publié, ou `null`.
 */
export function appRuntime(app = process.cwd()) {
  try {
    const brut = JSON.parse(
      fs.readFileSync(
        path.join(app, "node_modules", ".cache", "nodefony", "runtime.json"),
        "utf8",
      ),
    );
    const ports = Array.isArray(brut?.ports)
      ? brut.ports.filter((p) => Number.isInteger(p))
      : [];
    if (ports.length === 0) return null;
    return { pid: Number(brut.pid) || 0, ports };
  } catch {
    return null;
  }
}

/**
 * Le serveur qui tient `port` est-il celui de l'application sous test ?
 *
 * @param {string|number} [port] - le port qu'on s'apprête à interroger.
 * @param {string} [app] - racine de l'application sous test.
 * @returns {{sien: true}|{sien: false, motif: string}} verdict et sa raison —
 *   le motif est destiné à un rapport, il doit se lire sans le code.
 */
export function appPortUnderTest(port = PORT, app = process.cwd()) {
  const etat = appRuntime(app);
  if (etat === null) {
    return {
      sien: false,
      motif:
        "l'application sous test n'a publié aucun état de runtime " +
        "(node_modules/.cache/nodefony/runtime.json) — elle n'a pas démarré",
    };
  }
  if (!etat.ports.includes(Number(port))) {
    return {
      sien: false,
      motif:
        `l'application sous test écoute sur ${etat.ports.join(", ")}, ` +
        `pas sur ${port}`,
    };
  }
  return { sien: true };
}

/** Au-delà, la réponse ne viendra pas — et l'attendre ne dit rien de plus. */
const TIMEOUT_MS = 15_000;

/**
 * Le port répond-il déjà ?
 *
 * @param {string|number} [port] - port sondé.
 * @returns {Promise<boolean>} `true` si quelqu'un écoute.
 */
export const portTaken = (port = PORT) =>
  new Promise((resolve) => {
    const s = net.connect(Number(port), HOST);
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
export const exit = (code, message) => {
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
export const ensurePortFree = async (port = PORT) => {
  if (!process.argv.includes("--check-port-free")) return;
  if (await portTaken(port)) {
    exit(
      5,
      `CAUSE=port-deja-tenu — le port ${port} répond AVANT le boot du décor : ` +
        `le juge mesurerait un serveur étranger. Verdict non rendu.`,
    );
  }
  process.exit(0);
};

/**
 * Un jar à cookies minimal — `nom=valeur`, sans domaine ni expiration.
 *
 * Suffisant ici : tout tient sur `127.0.0.1`, en quelques secondes. Un jar
 * complet apporterait des règles (domaine, chemin, `Max-Age`) dont aucune ne
 * change le verdict, et chacune serait une occasion de bogue dans le JUGE —
 * lequel doit rester plus simple que ce qu'il mesure.
 *
 * Un bocal vierge matérialise « quelqu'un d'autre » : c'est ainsi qu'on
 * distingue un état de session d'un registre global, et une identité d'une
 * absence d'identité.
 */
export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(setCookie) {
    for (const ligne of setCookie ?? []) {
      const [paire] = ligne.split(";");
      const i = paire.indexOf("=");
      if (i > 0) this.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  /** Le jeton anti-rejeu, tel qu'un client web le relit (`csrf-token`). */
  csrfToken() {
    for (const [nom, valeur] of this.cookies) {
      if (nom.endsWith("csrf-token")) return decodeURIComponent(valeur);
    }
    return null;
  }
  /** Un cookie porte-t-il une valeur ? (une session posée, par exemple.) */
  hasCookie(predicate) {
    for (const [nom, valeur] of this.cookies) {
      if (predicate(nom, valeur)) return true;
    }
    return false;
  }
}

/**
 * Une requête, cookies absorbés dans le jar fourni.
 *
 * Ne rejette JAMAIS : une panne réseau devient `{ erreur }`, que le juge
 * traduit en cause. Un `throw` ici ferait sortir le juge sur une trace Node —
 * illisible dans l'`evidence` d'un rapport.
 *
 * @param {string} method - verbe HTTP.
 * @param {string} path - chemin de la route.
 * @param {CookieJar} jar - cookies envoyés puis mis à jour depuis la réponse.
 * @param {{body?: object, csrfToken?: string|null, headers?: object, port?: string|number}} [opts]
 *   - `body` sérialisé en JSON ; `csrfToken` posé en `x-csrf-token` ; `headers`
 *   fusionnés en dernier (ils gagnent) ; `port` pour sortir du décor par défaut.
 * @returns {Promise<{status?: number, body?: string, headers?: object, error?: string}>}
 */
export const request = (method, path, jar, opts = {}) =>
  new Promise((resolve) => {
    const payload = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {};
    const cookies = jar.header();
    if (cookies) headers.cookie = cookies;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (opts.csrfToken) headers["x-csrf-token"] = opts.csrfToken;
    Object.assign(headers, opts.headers ?? {});
    const r = http.request(
      {
        host: HOST,
        port: opts.port ?? PORT,
        path,
        method,
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          jar.absorb(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode,
            body,
            headers: res.headers,
          });
        });
      },
    );
    r.on("error", (e) => resolve({ error: e.message }));
    r.setTimeout(TIMEOUT_MS, () => {
      r.destroy();
      resolve({ error: `aucune réponse en ${TIMEOUT_MS / 1000} s` });
    });
    if (payload) r.write(payload);
    r.end();
  });
