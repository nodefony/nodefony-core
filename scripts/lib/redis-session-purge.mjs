/**
 * Purge les sessions qu'un serveur de test laisse dans SA base Redis — seule implémentation.
 *
 * Le serveur que lève `test:all` démarre une session à chaque requête anonyme :
 * une passe en laisse ~9 000 (`memory.test.ts`, `stream-load`), vivantes une
 * heure. La passe suivante pagine alors sur ce tas, et le listing des sessions
 * sort en délai sur un test innocent (#399). Vécu aussi : ce tas s'accumulait
 * dans la base 0, celle du développeur.
 *
 * Deux règles, tenues ici et nulle part ailleurs :
 *
 *  - jamais la base 0 : elle appartient au développeur, et peut porter autre
 *    chose que nos sessions — le décor de test a sa propre base (`REDIS_GATE`) ;
 *  - jamais `FLUSHDB` : seules les clés de session (`nf:…sess:*`) et leur index
 *    (`nf:…sess~*`) partent, le reste de la base est rendu tel quel.
 *
 * @usage import { purgeTestSessions } from "../lib/redis-session-purge.mjs"
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Lit l'index de base que nomme une URL Redis.
 *
 * @param {string} url - `redis[s]://[[user][:pass]@]host[:port][/db]`.
 * @returns {number} l'index, 0 quand l'URL n'en nomme aucun (défaut de Redis).
 * @throws si le chemin de l'URL n'est pas un entier positif.
 */
export function redisDatabase(url) {
  const raw = new URL(url).pathname.replace(/^\//, "");
  if (raw === "") return 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`index de base Redis illisible : « ${raw} »`);
  }
  return Number(raw);
}

/**
 * Motifs `SCAN` des clés de session et de leur index.
 *
 * @param {string} [namespace] - cloison `keyNamespace` ; `*` les vise toutes,
 *   y compris l'absence de cloison (`nf:sess:<id>`).
 * @returns {string[]} les motifs, sessions puis index.
 */
export function sessionPatterns(namespace = "*") {
  const base = namespace === "*" ? "nf:*sess" : `nf:${namespace}:sess`;
  return [`${base}:*`, `${base}~*`];
}

/**
 * Ouvre un client Redis avec le pilote que déclare `@nodefony/redis` — l'importer
 * depuis la racine ne marcherait que par le hissage de npm.
 *
 * @param {string} url - URL de la base.
 * @param {string} root - racine du dépôt.
 * @returns {Promise<import("redis").RedisClientType>} le client connecté ; à fermer par `close()`.
 */
export async function connectRedis(url, root) {
  const require = createRequire(
    join(root, "src", "packages", "@nodefony", "redis", "package.json"),
  );
  const { createClient } = await import(
    pathToFileURL(require.resolve("redis")).href
  );
  const client = createClient({ url });
  await client.connect();
  return client;
}

/**
 * Supprime les clés de session d'une base Redis de TEST.
 *
 * @param {string} url - URL de la base ; doit nommer un index autre que 0.
 * @param {string} root - racine du dépôt.
 * @param {string} [namespace] - restreint la purge à une cloison ; défaut : toutes.
 * @returns {Promise<number>} le nombre de clés supprimées.
 * @throws si l'URL vise la base 0, avant toute connexion.
 */
export async function purgeTestSessions(url, root, namespace = "*") {
  if (redisDatabase(url) === 0) {
    throw new Error(
      "purge refusée : l'URL vise la base 0, celle du développement",
    );
  }
  const client = await connectRedis(url, root);
  let removed = 0;
  try {
    for (const match of sessionPatterns(namespace)) {
      for await (const keys of client.scanIterator({
        MATCH: match,
        COUNT: 1000,
      })) {
        if (keys.length > 0) removed += await client.unlink(keys);
      }
    }
  } finally {
    await client.close();
  }
  return removed;
}
