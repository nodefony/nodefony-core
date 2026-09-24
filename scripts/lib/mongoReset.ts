/**
 * Remise à zéro de la base d'un banc MongoDB — le décor repart VIERGE.
 *
 * Pourquoi : une base de banc qui survit à sa passe fabrique des rouges qui
 * n'appartiennent à personne. Vécu sur `nodefony_boot` : des comptes laissés par
 * une passe antérieure (mot de passe modifié, sessions révoquées) ont fait
 * tomber 117 tests d'authentification — identiques avec ou sans le diff qu'on
 * voulait éprouver. Les fixtures ne réécrivent pas un compte qui existe déjà :
 * seul un décor vierge rend le verdict au code.
 *
 * Le pilote se résout depuis `@nodefony/mongoose`, qui le DÉCLARE : l'importer
 * depuis la racine ne marcherait que par le hissage de npm.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface IMongooseLike {
  createConnection(
    url: string,
    options: Record<string, unknown>,
  ): {
    asPromise(): Promise<{
      dropDatabase(): Promise<unknown>;
      close(): Promise<unknown>;
    }>;
  };
}

/**
 * Supprime la base désignée par `url` (nom pris dans le chemin de l'URL).
 *
 * @param url - URL `mongodb://…/<base>` du banc — jamais celle du développement
 * @param root - racine du dépôt (où vit `src/packages/@nodefony/mongoose`)
 * @returns le nom de la base supprimée
 * @throws si l'URL ne nomme aucune base, ou si le serveur refuse
 */
export async function resetMongoDatabase(
  url: string,
  root: string,
): Promise<string> {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name.length === 0) {
    throw new Error(`l'URL ne nomme aucune base : ${url}`);
  }
  const require = createRequire(
    join(root, "src", "packages", "@nodefony", "mongoose", "package.json"),
  );
  const mod = (await import(
    pathToFileURL(require.resolve("mongoose")).href
  )) as {
    default: IMongooseLike;
  };
  const conn = await mod.default
    .createConnection(url, { serverSelectionTimeoutMS: 5_000 })
    .asPromise();
  try {
    await conn.dropDatabase();
  } finally {
    await conn.close();
  }
  return name;
}
