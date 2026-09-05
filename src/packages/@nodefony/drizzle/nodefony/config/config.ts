import { z } from "zod";

/**
 * @nodefony/drizzle — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineDrizzleConfig`) et les types
 * (`interfaces/IDrizzleConfig.ts`) importent le schéma D'ICI (nœud bas : ce fichier
 * n'importe que `zod` → pas de cycle).
 *
 * Convention figée (cf `feedback_config_validation_zod` + audit config ORM
 * 2026-06), alignée sur `@nodefony/mongoose`/`@nodefony/redis`/`@nodefony/realtime`.
 *
 * ⚠️ Le schéma reste **PUR** : `filename` est **optionnel SANS défaut** — le chemin
 * SQLite par défaut dépend de `kernel.path` (indisponible à l'évaluation du schéma)
 * et est résolu au boot par `DrizzleService`. Aucune lecture `process.env` ici
 * (l'env est appliqué dans `defineDrizzleConfig`).
 *
 * SURCHARGE (précédence croissante — cf ADR-0006) :
 *   • App (typé)         : `use("@nodefony/drizzle", { connectors: { … } })` ;
 *   • Par environnement  : infra database `NF_DATABASE_URL`/`DATABASE_URL`
 *     (dialecte déduit du scheme, appliqué dans `defineDrizzleConfig`) ;
 *   • Déploiement/Docker : `NF__DRIZZLE__<CHEMIN>=valeur` (override env générique).
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

/**
 * Stratégies de fabrication du schéma d'un connecteur.
 *
 * Trois valeurs, et pas une de plus : ce qui fait le schéma est soit le
 * démarrage à partir du code (`auto`), soit le démarrage à partir des fichiers
 * de migration (`migrate`), soit personne (`none`). Un quatrième mode serait un
 * mélange, donc un comportement que personne ne saurait décrire dans un
 * incident.
 */
export const DDL_MODES = ["auto", "migrate", "none"] as const;

/** Stratégie de fabrication du schéma d'un connecteur. */
export type DdlMode = (typeof DDL_MODES)[number];

/**
 * Conduites de la sonde de disponibilité quand le schéma est en retard.
 *
 * `fail` retient la mise en service (le processus ne reçoit pas de trafic),
 * `warn` journalise et sert quand même, `off` ne regarde pas.
 */
export const MIGRATION_CHECK_MODES = ["fail", "warn", "off"] as const;

/** Conduite de la sonde de disponibilité face à un schéma en retard. */
export type MigrationCheckMode = (typeof MIGRATION_CHECK_MODES)[number];

/**
 * Conduites face à une base qui ne correspond plus au code alors que
 * l'historique est complet.
 *
 * Le défaut est `report` — et il est structurel, pas prudent : une application
 * qui écrit des migrations libres (vues, déclencheurs, colonnes ajoutées à une
 * table d'entité) a une base légitimement différente du schéma déclaré, en
 * permanence. Faire tomber sa mise en service dessus rendrait le constat
 * inutilisable, donc mort. Superviser ne fait pas tomber un déploiement.
 */
export const DIVERGENCE_MODES = ["report", "fail", "off"] as const;

/** Conduite face à une base qui a divergé du schéma déclaré. */
export type DivergenceMode = (typeof DIVERGENCE_MODES)[number];

const connectorSchema = z
  .strictObject({
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
          "sous le répertoire de données de l'application : " +
          "`<app>/var/databases/nodefony-drizzle.db` pour le connecteur `default`, " +
          "`nodefony-<connecteur>.db` pour les autres. `:memory:` = base éphémère " +
          "en mémoire (tests). Surchargé par le infra database " +
          "`NF_DATABASE_URL=sqlite:…` pour le connecteur primaire.",
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
    ddl: z
      .enum(DDL_MODES)
      .optional()
      .describe(
        "Qui fabrique le schéma de ce connecteur, et quand. `auto` : le " +
          "démarrage crée les tables manquantes depuis le code ET ajoute les " +
          "colonnes qui manquent quand elles acceptent le vide (développement — " +
          "strictement additif, jamais destructeur). `migrate` : le démarrage " +
          "applique les migrations sous verrou (un seul exemplaire assumé — VPS, " +
          "docker compose, sqlite). `none` : personne ne touche au schéma au " +
          "démarrage, un travail externe lance `nodefony orm:migrate` avant le " +
          "déploiement (production orchestrée). OMIS → résolu par " +
          "environnement au boot : développement et test → `auto`, tout le " +
          "reste → `none`.",
      ),
  })
  .describe(
    "Définition d'une connexion Drizzle (driver selon `dialect` : " +
      "better-sqlite3 / pg / mysql2).",
  );

export const drizzleConfigSchema = z
  .strictObject({
    connectors: z
      .record(z.string(), connectorSchema)
      .default(() => ({ default: connectorSchema.parse({}) }))
      .describe(
        "Connexions indexées par nom (= clé dans le `ormRegistry`). Défaut : un " +
          "connecteur `default` (fichier SQLite résolu au boot). Le nom `default` " +
          "(≠ `nodefony` de Mongoose) isole l'entité `session` dans le " +
          "`entityRegistry` process-wide si les deux ORM cohabitent.",
      ),
    migrations: z
      .strictObject({
        dir: z
          .string()
          .default("migrations")
          .describe(
            "Dossier des migrations de l'APPLICATION, relatif à la racine de " +
              "l'application — celle que le kernel connaît, jamais le " +
              "répertoire courant du processus (un espace de travail en a " +
              "plusieurs). Un sous-dossier par dialecte (`migrations/postgres`). " +
              "Le dossier du framework, lui, est livré dans le paquet et n'a " +
              "rien à déclarer ici.",
          ),
        check: z
          .enum(MIGRATION_CHECK_MODES)
          .optional()
          .describe(
            "Conduite de la sonde de disponibilité quand `ddl` n'est pas " +
              "`auto` et que le schéma est en retard. `fail` : la mise en " +
              "service est RETENUE (`/readyz` répond 503) jusqu'à ce que les " +
              "migrations soient appliquées — le processus redevient " +
              "disponible tout seul, sans redéploiement. `warn` : journalisé, " +
              "le trafic passe quand même. `off` : rien. OMIS → résolu par " +
              "environnement : production → `fail`, reste → `warn`.",
          ),
        lockTimeoutMs: z
          .number()
          .int()
          .positive()
          .default(30_000)
          .describe(
            "Délai maximal d'attente du verrou d'application des migrations " +
              "(ms). Passé ce délai la commande s'arrête sur le code 2 en " +
              "disant qui tient le verrou : un processus qui attend sans " +
              "limite derrière un travail mort n'annonce jamais sa panne.",
          ),
        divergence: z
          .enum(DIVERGENCE_MODES)
          .default("report")
          .describe(
            "Conduite quand l'historique est complet, rien n'est en attente, " +
              "ET que la base ne correspond pourtant pas au schéma déclaré " +
              "(modification faite à la main, correctif d'urgence non " +
              "reporté). `report` (défaut) : journalisé et affiché, la sonde " +
              "reste verte. `fail` : compte comme un écart et retient la mise " +
              "en service — à n'activer que si aucune migration libre ne " +
              "touche les tables d'entités. `off` : rien.",
          ),
      })
      .default(() => ({
        dir: "migrations",
        lockTimeoutMs: 30_000,
        divergence: "report" as const,
      }))
      .describe(
        "Réglages des migrations de schéma (dossier de l'application, sonde " +
          "de disponibilité, verrou, dérive). Les commandes sont " +
          "`nodefony orm:migrate`, `orm:migrate:status`, " +
          "`orm:migrate:baseline`, `orm:migrate:repair` et `orm:reset`.",
      ),
    frameworkEntities: z
      .boolean()
      .default(true)
      .describe(
        "Déclare le schéma framework sur le connecteur `default` (tokens, audit, " +
          "webauthn, webhooks, idempotence — tables créées au connect) et rend " +
          "les stores correspondants sélectionnables par nom (`drizzle`). " +
          "`false` = module data-only (aucune entité ni fabrique framework).",
      ),
  })
  .describe("Configuration de @nodefony/drizzle.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type DrizzleConfig = z.infer<typeof drizzleConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: DrizzleConfig = drizzleConfigSchema.parse({});

export default config;
