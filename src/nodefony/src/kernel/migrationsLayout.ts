import fs from "node:fs";
import path from "node:path";

/**
 * Où vivent les migrations SQL d'une application, et quand elles font foi —
 * la règle que lisent DEUX côtés qui ne peuvent pas s'importer l'un l'autre :
 * le module Drizzle, qui décide au démarrage si le schéma est dérivé ou migré,
 * et le générateur du cœur (`create entity`), qui annonce ce que ce démarrage
 * fera de la table. Recopiée de chaque côté, elle avait divergé : le générateur
 * promettait « créée au prochain boot » à une application qui versionne ses
 * migrations, où le démarrage n'en crée aucune.
 */

/**
 * Connecteur SQL conventionnel qui héberge le schéma du framework et des
 * entités de l'application (`"default"` pour Drizzle ; Mongoose a le sien).
 */
export const FRAMEWORK_SQL_CONNECTOR = "default";

/**
 * Ce connecteur possède-t-il les migrations du framework et de l'application ?
 *
 * **Seul le connecteur du framework les possède.** Le dossier des migrations de
 * l'application (`migrations/<dialect>`) ne porte aucune notion de connecteur :
 * il décrit UNE base, celle où vivent les briques du framework et les entités
 * de l'application. Les attribuer à tout connecteur faisait qu'une base
 * secondaire (analyse, base d'un module) en mode `migrate` y créait des tables
 * qui ne lui appartiennent pas, et qu'en mode `auto` elle annonçait à chaque
 * démarrage des migrations qui ne la concernent pas.
 *
 * @param connector - nom du connecteur (clé de `connectors`).
 * @returns `true` pour le connecteur du framework, `false` pour tout autre.
 */
export function ownsSharedMigrations(connector: string): boolean {
  return connector === FRAMEWORK_SQL_CONNECTOR;
}

/**
 * Noms qui ne peuvent PAS désigner le dossier d'un connecteur secondaire : ce
 * sont ceux des dossiers de dialecte (et du journal) que le connecteur du
 * framework range déjà sous `migrations/`. Un connecteur `postgres` y lirait les
 * migrations de `default` comme les siennes.
 */
export const RESERVED_MIGRATION_DIRS: readonly string[] = [
  "sqlite",
  "postgres",
  "mysql",
  "meta",
];

/**
 * Le nom de ce connecteur collisionne-t-il avec un dossier de dialecte ?
 *
 * @param connector - nom du connecteur (clé de `connectors`).
 * @returns `true` pour un connecteur SECONDAIRE nommé comme un dossier réservé.
 */
export function isReservedConnectorName(connector: string): boolean {
  return (
    !ownsSharedMigrations(connector) &&
    RESERVED_MIGRATION_DIRS.includes(connector)
  );
}

/**
 * Dossier des migrations PROPRES à un connecteur — la seule règle qui dit où
 * elles vivent.
 *
 * Le connecteur du framework garde la racine (`migrations/<dialecte>`) : ses
 * migrations décrivent la base du framework et des entités de l'application.
 * Un connecteur secondaire reçoit son sous-dossier (`migrations/<connecteur>/
 * <dialecte>`) : sa base ne reçoit que ce qui y est écrit, et celle du
 * framework n'en voit rien — le dossier de dialecte qu'elle lit n'est pas le
 * même.
 *
 * @param appDir - dossier de migrations de l'application, absolu.
 * @param connector - nom du connecteur.
 * @returns le dossier parent des sous-dossiers de dialecte, ou `undefined` sans
 *   racine d'application, ou pour un nom réservé ({@link isReservedConnectorName}).
 */
export function connectorMigrationsDir(
  appDir: string | undefined,
  connector: string,
): string | undefined {
  if (appDir === undefined || isReservedConnectorName(connector)) {
    return undefined;
  }
  return ownsSharedMigrations(connector)
    ? appDir
    : path.join(appDir, connector);
}

/** Une entrée de dossier, telle que la rend {@link IListMigrationsDir}. */
export interface IMigrationsDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/**
 * Lit les entrées d'un dossier — injectable : le démarrage lit le disque, le
 * générateur lit sa transaction (fichiers en attente compris).
 *
 * @throws quand le dossier est absent ou illisible.
 */
export type IListMigrationsDir = (
  dir: string,
) => readonly IMigrationsDirEntry[];

/** Lecture du disque, synchrone : un `readdirSync` par dossier, au démarrage. */
function listDisk(dir: string): readonly IMigrationsDirEntry[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
}

/**
 * Ce dossier versionne-t-il au moins une migration ?
 *
 * Lecture SYNCHRONE et bornée à un `readdirSync` par niveau — hors de tout
 * chemin de requête. Elle doit l'être : le mode de schéma se décide avant la
 * connexion, et le rendre asynchrone propagerait un `await` dans toute la
 * chaîne de résolution pour une réponse qui ne change jamais pendant la vie du
 * processus.
 *
 * Un dossier absent, illisible ou vide répond `false` — l'application n'a alors
 * rien à appliquer, et `auto` reste le bon défaut de démarrage rapide.
 *
 * @param dir - dossier de migrations (celui d'un connecteur : {@link connectorMigrationsDir}).
 * @param list - lecture des entrées ; le disque par défaut.
 * @returns `true` si au moins un fichier `.sql` y est versionné, à un niveau
 *   ou sous un sous-dossier de dialecte (`migrations/postgres/0001_x.sql`).
 */
export function versionsMigrations(
  dir: string | undefined,
  list: IListMigrationsDir = listDisk,
): boolean {
  if (!dir) {
    return false;
  }
  try {
    for (const entry of list(dir)) {
      if (!entry.isDirectory && entry.name.endsWith(".sql")) {
        return true;
      }
      if (entry.isDirectory && entry.name !== "meta") {
        const nested = list(path.join(dir, entry.name));
        if (nested.some((child) => child.name.endsWith(".sql"))) {
          return true;
        }
      }
    }
  } catch {
    // Dossier absent ou illisible : l'application ne versionne rien.
    return false;
  }
  return false;
}

/**
 * Des migrations versionnées CONCERNENT-elles ce connecteur ?
 *
 * C'est la question que pose la bascule `auto` → `migrate`, et elle n'est pas
 * « l'application versionne-t-elle des migrations ? » : celles de la racine
 * décrivent la base du framework. Posée telle quelle, elle faisait basculer en
 * `migrate` un connecteur secondaire qui n'en recevra jamais une — sa base
 * restait alors sans schéma, ni dérivé ni migré. On regarde donc le dossier
 * DU connecteur ({@link connectorMigrationsDir}).
 *
 * @param connector - nom du connecteur.
 * @param appDir - dossier de migrations de l'application, absolu.
 * @param list - lecture des entrées ; le disque par défaut.
 * @returns `true` si le dossier propre au connecteur porte au moins un `.sql`.
 */
export function connectorVersionsMigrations(
  connector: string,
  appDir: string | undefined,
  list: IListMigrationsDir = listDisk,
): boolean {
  return versionsMigrations(connectorMigrationsDir(appDir, connector), list);
}
