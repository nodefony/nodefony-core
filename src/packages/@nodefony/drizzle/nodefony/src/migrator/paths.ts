import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IMigrationSource } from "./types";

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
 * @param appDir - dossier de migrations de l'application, s'il y en a un.
 * @returns le registre, prêt pour l'applicateur.
 */
export async function defaultMigrationSources(
  appDir?: string,
): Promise<IMigrationSource[]> {
  const sources: IMigrationSource[] = [
    {
      name: FRAMEWORK_SOURCE,
      dir: await frameworkMigrationsDir(),
      rank: FRAMEWORK_RANK,
    },
  ];
  if (appDir) {
    sources.push({ name: APP_SOURCE, dir: appDir, rank: APP_RANK });
  }
  return sources;
}
