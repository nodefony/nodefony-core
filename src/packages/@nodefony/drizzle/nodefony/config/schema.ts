import { z } from "zod";

/**
 * Schéma Zod de la configuration de `@nodefony/drizzle`.
 *
 * **Source de vérité du module** : le type TS est dérivé via `z.infer<>`
 * ({@link IDrizzleConfig}), et la config est validée au boot du Module class
 * (hook `onKernelRegister`, via {@link defineDrizzleConfig}).
 *
 * Convention figée (cf `feedback_config_validation_zod` + audit config ORM
 * 2026-06), alignée sur `@nodefony/mongoose` (l'autre driver ORM) et le pattern
 * `@nodefony/redis`/`@nodefony/realtime`.
 *
 * ⚠️ Le schéma reste **PUR** : `filename` est **optionnel SANS défaut** — le chemin
 * SQLite par défaut dépend de `kernel.path` (indisponible à l'évaluation du schéma)
 * et est résolu au boot par `DrizzleService` (kernel présent). De même, aucune
 * lecture `process.env` ici (l'env est appliqué dans {@link defineDrizzleConfig}).
 */

/**
 * Dialectes SQL supportés par l'adapter Drizzle. `sqlite` (better-sqlite3) est le
 * défaut bootable ; `postgres` (pg) / `mysql` (mysql2) sont des drivers chargés en
 * LAZY (`optionalDependencies` + `await import` au connect) — un framework doit
 * porter ses entités sur les bases majeures (cf chantier portabilité multi-dialecte).
 */
export const SQL_DIALECTS = ["sqlite", "postgres", "mysql"] as const;

/** Dialecte SQL d'un connecteur Drizzle. */
export type SqlDialect = (typeof SQL_DIALECTS)[number];

const connectorSchema = z
  .object({
    dialect: z
      .enum(SQL_DIALECTS)
      .default("sqlite")
      .describe(
        "Dialecte SQL du connecteur : `sqlite` (défaut, driver better-sqlite3, " +
          "`filename`) · `postgres` (driver `pg`, `url`) · `mysql` (driver " +
          "`mysql2`, `url`). pg/mysql sont des `optionalDependencies` chargées en " +
          "lazy au connect — l'app installe le driver de son déploiement.",
      ),
    filename: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Fichier SQLite du connecteur (dialecte `sqlite`). OMIS → résolu au boot " +
          "vers `<app>/nodefony/databases/nodefony-<connecteur>.db` (kernel " +
          "présent). `:memory:` = base éphémère en mémoire (tests). Surchargé par " +
          "l'env `DRIZZLE_DB_FILE` pour le connecteur primaire.",
      ),
    url: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Chaîne de connexion des dialectes `postgres`/`mysql` " +
          "(`postgres://user:pass@host:port/db`, `mysql://…`). Requise pour ces " +
          "dialectes (ignorée en `sqlite`). Porte le secret → jamais loggée " +
          "(rédaction au describe).",
      ),
  })
  .describe(
    "Définition d'une connexion Drizzle (driver selon `dialect` : " +
      "better-sqlite3 / pg / mysql2).",
  );

export const drizzleConfigSchema = z
  .object({
    connectors: z
      .record(z.string(), connectorSchema)
      .default(() => ({ default: connectorSchema.parse({}) }))
      .describe(
        "Connexions indexées par nom (= clé dans le `ormRegistry`). Défaut : un " +
          "connecteur `default` (fichier SQLite résolu au boot). Le nom `default` " +
          "(≠ `nodefony` de Mongoose) isole l'entité `session` dans le " +
          "`entityRegistry` process-wide si les deux ORM cohabitent.",
      ),
  })
  .describe("Configuration de @nodefony/drizzle.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type DrizzleConfig = z.infer<typeof drizzleConfigSchema>;
