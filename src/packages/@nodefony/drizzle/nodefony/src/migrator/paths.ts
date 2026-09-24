import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IMigrationSource } from "./types";
import { ownsSharedMigrations } from "../frameworkConnector";

/** Nom logique RÉSERVÉ de la source livrée par le framework. */
export const FRAMEWORK_SOURCE = "framework";

/** Nom logique RÉSERVÉ de la source livrée par l'application. */
export const APP_SOURCE = "app";

/** Rang de la source framework : première appliquée, toujours. */
export const FRAMEWORK_RANK = 0;

/**
 * Rang de la source application : dernière appliquée, toujours.
 *
 * Les entités d'une application peuvent référencer les tables du framework et
 * celles des modules ; l'inverse n'arrive jamais.
 */
export const APP_RANK = 1_000_000;

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
 * @param appDir - dossier de migrations de l'application (`appMigrationsDir`).
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

/** Dossier de migrations, mémoïsé — la remontée ne se fait qu'une fois. */
let cachedDir: string | null = null;

/**
 * Dossier des migrations livrées par ce paquet.
 *
 * **Trouvé en remontant jusqu'au `package.json` du paquet**, jamais par un
 * nombre de niveaux codé en dur : la profondeur diffère entre les sources
 * (`nodefony/src/migrator/`) et le paquet bâti (`dist/nodefony/src/migrator/`),
 * et un compte figé serait juste d'un côté, faux de l'autre — sans que rien ne
 * le signale avant l'exécution chez un utilisateur.
 *
 * @returns le chemin absolu du dossier `migrations` du paquet.
 * @throws Error si la racine du paquet est introuvable.
 */
export async function frameworkMigrationsDir(): Promise<string> {
  if (cachedDir !== null) {
    return cachedDir;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(dir, "package.json");
    try {
      const raw = await fs.readFile(manifest, "utf8");
      if ((JSON.parse(raw) as { name?: string }).name === "@nodefony/drizzle") {
        cachedDir = path.join(dir, "migrations");
        return cachedDir;
      }
    } catch {
      // Pas de manifeste ici, ou illisible : on continue de remonter.
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Migrations : racine du paquet `@nodefony/drizzle` introuvable — " +
          "le dossier `migrations` livré ne peut pas être résolu.",
      );
    }
    dir = parent;
  }
}

/**
 * Registre de sources standard : le framework, puis l'application.
 *
 * L'espace de noms reste OUVERT — un module tiers ajoute la sienne au même
 * registre, avec son propre rang. `framework` et `app` sont deux valeurs
 * réservées, pas une énumération.
 *
 * **Le framework ne fournit ses migrations que s'il déclare ses entités.** Un
 * module réglé `frameworkEntities: false` est data-only : il n'enregistre ni
 * entité ni fabrique, et le démarrage en mode dérivé ne crée donc aucune table
 * de session, de jeton, d'audit ni de webhook. Les inclure ici quand même
 * faisait fabriquer DEUX bases différentes à la même application selon qu'elle
 * démarrait en développement ou qu'on la migrait en production — et rien ne le
 * disait, le verdict de divergence ignorant par construction ce que la base a
 * en TROP.
 *
 * La règle vit ICI, à l'endroit unique où les sources se composent : ses deux
 * appelants (le service au démarrage, les commandes) la recopieraient sinon, et
 * deux copies divergent en silence.
 *
 * @param appDir - dossier de migrations de l'application, s'il y en a un.
 * @param options.framework - `false` quand le module est data-only.
 * @param options.connector - connecteur visé ; un connecteur secondaire ne
 *   reçoit que SES migrations ({@link connectorMigrationsDir}), jamais celles
 *   du framework. Omis : le registre complet (usage direct).
 * @returns le registre, prêt pour l'applicateur.
 */
export async function defaultMigrationSources(
  appDir?: string,
  options: { framework?: boolean; connector?: string } = {},
): Promise<IMigrationSource[]> {
  const sources: IMigrationSource[] = [];
  // Un connecteur SECONDAIRE ne reçoit ni les migrations du framework ni
  // celles de l'application : elles décrivent la base du framework, pas la
  // sienne (cf `ownsSharedMigrations`). Il ne reçoit que son propre dossier.
  if (
    options.connector !== undefined &&
    !ownsSharedMigrations(options.connector)
  ) {
    const own = connectorMigrationsDir(appDir, options.connector);
    if (own !== undefined) {
      sources.push({ name: APP_SOURCE, dir: own, rank: APP_RANK });
    }
    return sources;
  }
  if (options.framework !== false) {
    sources.push({
      name: FRAMEWORK_SOURCE,
      dir: await frameworkMigrationsDir(),
      rank: FRAMEWORK_RANK,
    });
  }
  if (appDir) {
    sources.push({ name: APP_SOURCE, dir: appDir, rank: APP_RANK });
  }
  return sources;
}
