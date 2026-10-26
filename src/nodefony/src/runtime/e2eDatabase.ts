/**
 * Les bases de TEST d'une application, dérivées de sa base applicative.
 *
 * Sur un moteur serveur, une suite de tests ne se fabrique pas une base —
 * `CREATE DATABASE` est un privilège d'administration —, elle utilise celles
 * que le décor fournit, sur le même serveur : `<base>_e2e` pour la suite e2e,
 * `<base>_e2e_scratch` pour la base vierge que la suite de migrations salit.
 *
 * Une seule règle de nommage, appelée par ceux qui la DÉCLARENT (`create app`,
 * qui écrit le compose et le `.env`) et par ceux qui la LISENT (le décor des
 * tests, à l'exécution) : deux copies auraient divergé au premier renommage,
 * et la suite aurait visé une base que personne n'a créée.
 *
 * @module
 */

/** Le rôle d'une base de test. */
export type TTestDatabaseRole = "e2e" | "scratch";

const SUFFIX: Readonly<Record<TTestDatabaseRole, string>> = {
  e2e: "_e2e",
  scratch: "_e2e_scratch",
};

/**
 * Le nom d'une base de test (`shop` → `shop_e2e`, `shop_e2e_scratch`).
 *
 * @param name - nom de la base applicative.
 * @param role - `e2e` ou `scratch`.
 * @returns le nom de la base de test.
 */
export function testDatabaseName(
  name: string,
  role: TTestDatabaseRole,
): string {
  return `${name}${SUFFIX[role]}`;
}

/**
 * L'URL d'une base de test, sur le même serveur et avec les mêmes accès que la
 * base applicative : seul le nom de la base change (`shop` → `shop_e2e`). La
 * requête (`?directConnection=true`…) est gardée.
 *
 * @param url - URL de la base applicative (`postgres://…/shop`).
 * @param role - `e2e` ou `scratch`.
 * @returns l'URL de la base de test.
 * @throws Si l'URL ne désigne aucune base (chemin vide).
 */
export function testDatabaseUrl(url: string, role: TTestDatabaseRole): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (name.length === 0) {
    throw new Error(
      `aucune base dans « ${parsed.protocol}//${parsed.host} » — impossible d'en dériver la base de test`,
    );
  }
  parsed.pathname = `/${encodeURIComponent(testDatabaseName(name, role))}`;
  return parsed.toString();
}

/** Une URL de base désigne-t-elle un fichier SQLite ? */
export function isSqliteUrl(url: string): boolean {
  return url.startsWith("sqlite:");
}
