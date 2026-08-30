import { randomUUID } from "node:crypto";
import os from "node:os";
import type { SqlDialect } from "../../config/config";
import { openMigrationDriver, type IMigrationTarget } from "./drivers/index";
import {
  deleteFailed,
  ensureHistorySchema,
  finishHistory,
  insertHistory,
  readHistory,
} from "./history";
import { createdTables, loadSources } from "./sources";
import {
  HISTORY_TABLE,
  MigrationVerdictError,
  type IAppliedMigration,
  type IMigrationApplied,
  type IMigrationDriver,
  type IMigrationDrift,
  type IMigrationFile,
  type IMigrationPlan,
  type IMigrationRun,
  type IMigrationSource,
  type IMigrationVerdict,
  type MigrationVerdictCode,
} from "./types";

/** Délai d'attente du verrou, par défaut. */
export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/** Longueur maximale d'un message d'erreur conservé en base. */
const ERROR_MAX_LENGTH = 2000;

/** Options de construction de l'applicateur. */
export interface IDrizzleMigratorOptions extends IMigrationTarget {
  /** Nom du connecteur — apparaît dans chaque verdict. */
  connector: string;
  /** Registre de sources, espace de noms OUVERT. */
  sources: readonly IMigrationSource[];
  /** Délai d'attente du verrou (ms). */
  lockTimeoutMs?: number;
  /** Qui applique — hôte du job par défaut. */
  appliedBy?: string;
  /** Horloge, injectable pour les tests. */
  now?: () => number;
}

/** Assouplissements explicites d'une passe d'application. */
export interface IMigrateOptions {
  /** Accepte qu'une migration appliquée n'ait plus de fichier. */
  ignoreMissing?: boolean;
  /** Accepte d'appliquer une migration antérieure à la dernière appliquée. */
  outOfOrder?: boolean;
  /** N'applique rien : rend le plan tel qu'il serait exécuté. */
  dryRun?: boolean;
}

/**
 * Applicateur de migrations de schéma — **le composant qui fait passer une base
 * d'une version à la suivante, et qui garde trace de son passage**.
 *
 * Cinq verbes : {@link DrizzleMigrator.status} (lecture seule),
 * {@link DrizzleMigrator.migrate}, {@link DrizzleMigrator.baseline} (adopter une
 * base déjà peuplée), {@link DrizzleMigrator.repair} (lever un marqueur d'échec
 * après inspection).
 *
 * **Pourquoi un applicateur maison** plutôt que celui de drizzle-orm : ce
 * dernier saute des migrations en silence, ne vérifie jamais les empreintes, ne
 * pose aucun verrou et ne rend aucun état — quatre manques dont chacun se paie
 * en production.
 *
 * **Application par IDENTITÉ, pas par horodatage** : la mise à jour du framework
 * insère des migrations « dans le passé » de l'application, par construction.
 * Un applicateur à repère haut sautrait ces migrations sans un mot ; ici, la
 * liste des restantes est un ENSEMBLE — `(source, tag)` absent de l'historique.
 *
 * @example
 * ```ts
 * const migrator = new DrizzleMigrator({
 *   connector: "default",
 *   dialect: "sqlite",
 *   filename: "var/databases/app.db",
 *   sources: [{ name: "framework", dir: frameworkMigrationsDir, rank: 0 }],
 * });
 * const plan = await migrator.status();
 * if (plan.pending.length) await migrator.migrate();
 * ```
 */
export class DrizzleMigrator {
  readonly #options: IDrizzleMigratorOptions;
  readonly #now: () => number;

  /**
   * @param options - connecteur, cible de connexion et registre de sources.
   */
  constructor(options: IDrizzleMigratorOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** Connecteur servi par cet applicateur. */
  get connector(): string {
    return this.#options.connector;
  }

  /** Dialecte servi par cet applicateur. */
  get dialect(): SqlDialect {
    return this.#options.dialect;
  }

  /**
   * État complet de la migration — **lecture seule, sans verrou ni écriture**.
   *
   * Sert la ligne de commande, le plan d'administration, la porte d'agent et la
   * sonde de disponibilité : un seul producteur pour quatre consommateurs. Elle
   * ne crée pas la table d'historique : une sonde qui écrit dans la base n'est
   * plus une sonde.
   *
   * @returns le plan : appliquées, restantes, dérives, échecs, adoption requise.
   */
  async status(): Promise<IMigrationPlan> {
    const driver = await openMigrationDriver(this.#options);
    try {
      const history = (await driver.tableExists(HISTORY_TABLE))
        ? await readHistory(driver)
        : [];
      const loaded = await loadSources(
        this.#options.sources,
        this.#options.dialect,
      );
      return await this.#computePlan(
        driver,
        loaded.files,
        history,
        loaded.absent,
      );
    } finally {
      await driver.close();
    }
  }

  /**
   * Applique les migrations restantes, sous verrou.
   *
   * L'ordre : verrou, amorçage de la table d'historique, chargement des
   * sources, VALIDATION complète, puis application une par une. La validation
   * précède toute écriture — un refus laisse la base intacte.
   *
   * @param options - assouplissements explicites, tous à `false` par défaut.
   * @returns les migrations effectivement appliquées.
   * @throws MigrationVerdictError si la validation refuse d'aller plus loin.
   */
  async migrate(options: IMigrateOptions = {}): Promise<IMigrationRun> {
    const driver = await openMigrationDriver(this.#options);
    const runId = randomUUID();
    const applied: IMigrationApplied[] = [];
    try {
      await driver.lock(this.#options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
      await ensureHistorySchema(driver);
      const loaded = await loadSources(
        this.#options.sources,
        this.#options.dialect,
      );
      const history = await readHistory(driver);
      const plan = await this.#computePlan(
        driver,
        loaded.files,
        history,
        loaded.absent,
      );
      this.#assertApplicable(plan, loaded.files, options);
      if (options.dryRun === true) {
        return { runId, applied: [] };
      }
      for (const file of plan.pending) {
        applied.push(await this.#apply(driver, file, runId));
      }
      return { runId, applied };
    } finally {
      await driver.unlock().catch(() => undefined);
      await driver.close();
    }
  }

  /**
   * Adopte une base existante : inscrit des migrations **sans exécuter leur SQL**.
   *
   * Toujours **explicite**, jamais automatique : une adoption qui se
   * déclencherait toute seule retirerait le filet qui protège de la pire des
   * erreurs — se tromper de base. Rejouer l'adoption n'inscrit que ce qui
   * manque.
   *
   * @param upTo - dernier tag inscrit (inclus) ; toutes les restantes si omis.
   * @returns les migrations inscrites.
   */
  async baseline(upTo?: string): Promise<IMigrationApplied[]> {
    const driver = await openMigrationDriver(this.#options);
    const runId = randomUUID();
    const adopted: IMigrationApplied[] = [];
    try {
      await driver.lock(this.#options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
      await ensureHistorySchema(driver);
      const loaded = await loadSources(
        this.#options.sources,
        this.#options.dialect,
      );
      if (upTo !== undefined) {
        this.#assertKnownTag(upTo, loaded.files);
      }
      const history = await readHistory(driver);
      const known = new Set(history.map((row) => identity(row)));
      for (const file of loaded.files) {
        // 🔴 La BORNE se lit sur le fichier, jamais après avoir décidé de
        // l'inscrire. Écrite dans l'autre ordre, elle sautait avec le
        // `continue` : si la migration qui borne était DÉJÀ inscrite — une
        // adoption relancée après une coupure, ce que la doctrine annonce
        // comme sûr, ou une borne posée sur une migration appliquée jadis —
        // la boucle poursuivait et gravait `success: true` sur tout ce qui
        // suit, sans que rien ne l'ait exécuté. C'est exactement l'état que la
        // garde d'ambiguïté existe pour empêcher : un historique complet, une
        // base qui ne porte pas les tables, et plus aucun geste offert.
        const borne = upTo !== undefined && file.tag === upTo;
        if (!known.has(identity(file))) {
          const at = this.#now();
          await insertHistory(driver, {
            source: file.source,
            tag: file.tag,
            hash: file.hash,
            runId,
            startedAt: at,
            finishedAt: at,
            executionMs: 0,
            success: true,
            error: null,
            appliedBy: this.#appliedBy(),
          });
          adopted.push({ source: file.source, tag: file.tag, executionMs: 0 });
        }
        if (borne) {
          break;
        }
      }
      return adopted;
    } finally {
      await driver.unlock().catch(() => undefined);
      await driver.close();
    }
  }

  /**
   * Lève les marqueurs d'échec, **après inspection humaine**.
   *
   * Ce n'est pas une reprise : MySQL n'a pas de DDL transactionnel, donc une
   * migration interrompue y laisse un état partiel que seul un humain peut
   * qualifier. Réparer dit « j'ai regardé, la base est dans l'état que je
   * crois » — ensuite seulement la migration se rejoue.
   *
   * @param options - source à réparer, et ré-alignement d'empreintes assumé.
   * @returns ce qui a été levé et ré-aligné.
   */
  async repair(
    options: { source?: string; updateHashes?: boolean } = {},
  ): Promise<{
    cleared: { source: string; tag: string }[];
    rehashed: { source: string; tag: string }[];
  }> {
    if (options.source !== undefined) {
      this.#assertKnownSource(options.source);
    }
    const driver = await openMigrationDriver(this.#options);
    try {
      await driver.lock(this.#options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
      await ensureHistorySchema(driver);
      const cleared = await deleteFailed(driver, options.source);
      const rehashed: { source: string; tag: string }[] = [];
      if (options.updateHashes === true) {
        const loaded = await loadSources(
          this.#options.sources,
          this.#options.dialect,
        );
        const byIdentity = new Map(
          loaded.files.map((file) => [identity(file), file]),
        );
        for (const row of await readHistory(driver)) {
          const file = byIdentity.get(identity(row));
          if (!file || file.hash === row.hash) {
            continue;
          }
          await finishHistory(driver, { ...row, hash: file.hash });
          rehashed.push({ source: row.source, tag: row.tag });
        }
      }
      return { cleared, rehashed };
    } finally {
      await driver.unlock().catch(() => undefined);
      await driver.close();
    }
  }

  /**
   * Croise fichiers et historique — le calcul commun à `status` et `migrate`.
   *
   * @param driver - pilote ouvert (introspection de la garde d'adoption).
   * @param files - fichiers de toutes les sources présentes.
   * @param history - lignes de la table d'historique.
   * @param absent - sources déclarées dont le dossier n'existe pas.
   * @returns le plan, sans jamais lever : un refus est un CHAMP du plan.
   */
  async #computePlan(
    driver: IMigrationDriver,
    files: readonly IMigrationFile[],
    history: readonly IAppliedMigration[],
    absent: readonly string[],
  ): Promise<IMigrationPlan> {
    const byIdentity = new Map(files.map((file) => [identity(file), file]));
    const declared = new Set(this.#options.sources.map((s) => s.name));
    const present = new Set(
      this.#options.sources
        .filter((s) => !absent.includes(s.name))
        .map((s) => s.name),
    );

    const succeeded = new Set<string>();
    const failed: IAppliedMigration[] = [];
    const drifted: IMigrationDrift[] = [];
    const missing: { source: string; tag: string }[] = [];
    const ignoredSources = new Set<string>();

    for (const row of history) {
      // Une source vue en base mais absente du REGISTRE (module désinstallé)
      // est ignorée en la nommant — jamais un arrêt global, sinon désinstaller
      // un module bloquerait toute migration ultérieure, pour toujours.
      if (!declared.has(row.source)) {
        ignoredSources.add(row.source);
        continue;
      }
      if (!row.success || row.finishedAt === null) {
        failed.push(row);
        continue;
      }
      succeeded.add(identity(row));
      const file = byIdentity.get(identity(row));
      if (!file) {
        // Source déclarée mais pas installée : rien à comparer, rien à refuser.
        if (present.has(row.source)) {
          missing.push({ source: row.source, tag: row.tag });
        }
        continue;
      }
      if (file.hash !== row.hash) {
        drifted.push({
          source: row.source,
          tag: row.tag,
          expected: row.hash,
          actual: file.hash,
        });
      }
    }

    const pending = files.filter((file) => !succeeded.has(identity(file)));
    return {
      connector: this.#options.connector,
      dialect: this.#options.dialect,
      applied: history.filter((row) => row.success && row.finishedAt !== null),
      pending,
      drifted,
      failed,
      missing,
      ignoredSources: [...ignoredSources],
      baselineRequired:
        history.length === 0 &&
        (await hasAnyTable(driver, createdTables(pending))),
    };
  }

  /**
   * Refuse d'appliquer un plan qui ne le permet pas — **fail-loud, avant toute
   * écriture**.
   *
   * @param plan - plan calculé.
   * @param files - fichiers chargés, qui portent l'index de journal.
   * @param options - assouplissements explicitement demandés.
   * @throws MigrationVerdictError portant le verdict structuré.
   */
  #assertApplicable(
    plan: IMigrationPlan,
    files: readonly IMigrationFile[],
    options: IMigrateOptions,
  ): void {
    const first = plan.failed[0];
    if (first) {
      throw this.#verdict(
        "NF_MIGRATE_FAILED_MARKER",
        {
          source: first.source,
          tag: first.tag,
          facts: {
            failed: plan.failed.map((row) => `${row.source}/${row.tag}`),
            error: first.error ?? "interrompue avant la fin",
          },
          actions: [
            {
              command: `nodefony orm:migrate:repair --connector ${this.connector}`,
              args: ["orm:migrate:repair", "--connector", this.connector],
            },
          ],
        },
        `La migration « ${first.tag} » (source « ${first.source} ») a échoué ou ` +
          `n'a jamais fini. Inspecter la base, puis réparer avant de reprendre — ` +
          `une reprise aveugle n'est jamais sûre.`,
      );
    }

    const drift = plan.drifted[0];
    if (drift) {
      throw this.#verdict(
        "NF_MIGRATE_HASH_MISMATCH",
        {
          source: drift.source,
          tag: drift.tag,
          facts: { expected: drift.expected, actual: drift.actual },
          actions: [
            {
              command: `nodefony orm:migrate:repair --update-hashes --connector ${this.connector}`,
              args: [
                "orm:migrate:repair",
                "--update-hashes",
                "--connector",
                this.connector,
              ],
            },
          ],
        },
        `Le fichier de la migration « ${drift.tag} » (source « ${drift.source} ») ` +
          `a changé depuis son application. Une migration déjà jouée est immuable : ` +
          `écrire une NOUVELLE migration, ou assumer le ré-alignement.`,
      );
    }

    const gone = plan.missing[0];
    if (gone && options.ignoreMissing !== true) {
      throw this.#verdict(
        "NF_MIGRATE_MISSING_FILE",
        {
          source: gone.source,
          tag: gone.tag,
          facts: { missing: plan.missing.map((m) => `${m.source}/${m.tag}`) },
          actions: [
            {
              command: `nodefony orm:migrate --ignore-missing --connector ${this.connector}`,
              args: [
                "orm:migrate",
                "--ignore-missing",
                "--connector",
                this.connector,
              ],
            },
          ],
        },
        `La migration « ${gone.tag} » est enregistrée en base mais son fichier ` +
          `a disparu de la source « ${gone.source} », qui est pourtant installée.`,
      );
    }

    if (options.outOfOrder !== true) {
      const outOfOrder = this.#findOutOfOrder(plan, files);
      if (outOfOrder) {
        throw this.#verdict(
          "NF_MIGRATE_OUT_OF_ORDER",
          {
            source: outOfOrder.source,
            tag: outOfOrder.tag,
            facts: { idx: outOfOrder.idx, lastApplied: outOfOrder.lastApplied },
            actions: [
              {
                command: `nodefony orm:migrate --out-of-order --connector ${this.connector}`,
                args: [
                  "orm:migrate",
                  "--out-of-order",
                  "--connector",
                  this.connector,
                ],
              },
            ],
          },
          `La migration « ${outOfOrder.tag} » se range AVANT « ${outOfOrder.lastApplied} », ` +
            `déjà appliquée dans la source « ${outOfOrder.source} ». L'appliquer ` +
            `maintenant produirait une base dont l'histoire n'est pas celle des autres.`,
        );
      }
    }

    if (plan.baselineRequired) {
      throw this.#verdict(
        "NF_MIGRATE_BASELINE_REQUIRED",
        {
          facts: { pending: plan.pending.map((file) => file.tag) },
          actions: [
            {
              command: `nodefony orm:migrate:baseline --connector ${this.connector}`,
              args: ["orm:migrate:baseline", "--connector", this.connector],
            },
          ],
        },
        `Cette base porte déjà les tables du schéma mais n'a aucun historique de ` +
          `migration : elle est antérieure aux migrations. L'adopter explicitement ` +
          `(baseline) avant d'appliquer quoi que ce soit.`,
      );
    }
  }

  /**
   * Cherche une migration restante antérieure à la dernière appliquée de SA source.
   *
   * Le contrôle est **par source** : la mise à jour du framework insère
   * légitimement des migrations dans le passé de l'application — c'est
   * l'intérieur d'une même source qui doit rester ordonné. L'index vient du
   * JOURNAL, jamais d'une lecture du tag : un tag est une identité, pas un
   * nombre, et rien n'oblige un module tiers à le préfixer de chiffres.
   *
   * @param plan - plan calculé.
   * @param files - fichiers chargés, qui portent l'index de journal.
   * @returns la première migration hors ordre, ou `undefined`.
   */
  #findOutOfOrder(
    plan: IMigrationPlan,
    files: readonly IMigrationFile[],
  ):
    | { source: string; tag: string; idx: number; lastApplied: string }
    | undefined {
    const appliedIdentities = new Set(plan.applied.map((row) => identity(row)));
    const highest = new Map<string, { tag: string; idx: number }>();
    for (const file of files) {
      if (!appliedIdentities.has(identity(file))) {
        continue;
      }
      const current = highest.get(file.source);
      if (!current || file.idx > current.idx) {
        highest.set(file.source, { tag: file.tag, idx: file.idx });
      }
    }
    for (const file of plan.pending) {
      const high = highest.get(file.source);
      if (high && file.idx < high.idx) {
        return {
          source: file.source,
          tag: file.tag,
          idx: file.idx,
          lastApplied: high.tag,
        };
      }
    }
    return undefined;
  }

  /**
   * Applique UNE migration, selon ce que le dialecte garantit.
   *
   * PostgreSQL et SQLite ont un DDL transactionnel : le schéma et sa trace
   * entrent ensemble ou pas du tout, et le marqueur d'échec est écrit HORS de
   * la transaction annulée — sinon il disparaîtrait avec elle. MySQL n'a pas ce
   * luxe : la trace de début est posée AVANT, et un process tué en plein vol
   * laisse une ligne sans fin, que la validation refusera au prochain passage.
   *
   * @param driver - pilote sous verrou.
   * @param file - migration à appliquer.
   * @param runId - identifiant du run.
   * @returns ce qui a été appliqué, et en combien de temps.
   */
  async #apply(
    driver: IMigrationDriver,
    file: IMigrationFile,
    runId: string,
  ): Promise<IMigrationApplied> {
    const startedAt = this.#now();
    const began = performance.now();
    const row: IAppliedMigration = {
      source: file.source,
      tag: file.tag,
      hash: file.hash,
      runId,
      startedAt,
      finishedAt: null,
      executionMs: null,
      success: false,
      error: null,
      appliedBy: this.#appliedBy(),
    };

    if (!driver.transactionalDdl) {
      await insertHistory(driver, row);
      try {
        for (const statement of file.statements) {
          await driver.exec(statement);
        }
      } catch (e) {
        await finishHistory(driver, {
          ...row,
          finishedAt: this.#now(),
          executionMs: Math.round(performance.now() - began),
          success: false,
          error: truncate((e as Error).message),
        });
        throw e;
      }
      const executionMs = Math.round(performance.now() - began);
      await finishHistory(driver, {
        ...row,
        finishedAt: this.#now(),
        executionMs,
        success: true,
      });
      return { source: file.source, tag: file.tag, executionMs };
    }

    await driver.begin();
    try {
      for (const statement of file.statements) {
        await driver.exec(statement);
      }
      const executionMs = Math.round(performance.now() - began);
      await insertHistory(driver, {
        ...row,
        finishedAt: this.#now(),
        executionMs,
        success: true,
      });
      await driver.commit();
      return { source: file.source, tag: file.tag, executionMs };
    } catch (e) {
      await driver.rollback().catch(() => undefined);
      // HORS transaction : écrite dedans, la trace de l'échec serait annulée
      // avec lui, et le prochain passage ne saurait rien de ce qui s'est passé.
      await insertHistory(driver, {
        ...row,
        finishedAt: this.#now(),
        executionMs: Math.round(performance.now() - began),
        success: false,
        error: truncate((e as Error).message),
      }).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Fabrique une erreur portant son verdict structuré.
   *
   * @param code - code stable du refus.
   * @param detail - source, tag, faits et actions.
   * @param message - phrase française pour un humain.
   * @returns l'erreur, prête à être levée.
   */
  #verdict(
    code: MigrationVerdictCode,
    detail: {
      source?: string;
      tag?: string;
      facts: IMigrationVerdict["facts"];
      actions: IMigrationVerdict["nextActions"];
    },
    message: string,
  ): MigrationVerdictError {
    return new MigrationVerdictError(
      {
        code,
        connector: this.connector,
        source: detail.source,
        tag: detail.tag,
        facts: detail.facts,
        nextActions: detail.actions,
      },
      message,
    );
  }

  /**
   * Refuse un `--up-to` qui ne désigne aucune migration connue.
   *
   * Sans ce contrôle, la boucle d'adoption ne rencontre jamais sa condition
   * d'arrêt et inscrit **tout** l'historique : une faute de frappe déclare à
   * niveau des migrations que la base n'a jamais reçues, et elle ne les
   * recevra plus jamais. Le geste le plus destructeur de la chaîne est aussi
   * celui qui se tapait sans filet.
   *
   * @param upTo - tag demandé.
   * @param files - fichiers connus, toutes sources confondues.
   * @throws MigrationVerdictError quand le tag est inconnu.
   */
  #assertKnownTag(upTo: string, files: readonly IMigrationFile[]): void {
    if (files.some((file) => file.tag === upTo)) {
      return;
    }
    const tags = files.map((file) => file.tag);
    // La casse d'abord : un tag recopié depuis un tableau, un journal en
    // majuscules ou une complétion de terminal ne diffère souvent que par là.
    const casse = tags.find((tag) => tag.toLowerCase() === upTo.toLowerCase());
    const action = casse ?? tags[tags.length - 1];
    throw this.#verdict(
      "NF_MIGRATE_UNKNOWN_TAG",
      {
        tag: upTo,
        facts: { known: tags, ...(casse ? { caseMismatch: casse } : {}) },
        actions: action
          ? [
              {
                command: `nodefony orm:migrate:baseline --connector ${this.connector} --up-to ${action}`,
                args: [
                  "orm:migrate:baseline",
                  "--connector",
                  this.connector,
                  "--up-to",
                  action,
                ],
              },
            ]
          : [
              {
                command: `nodefony orm:migrate:status --connector ${this.connector}`,
                args: ["orm:migrate:status", "--connector", this.connector],
              },
            ],
      },
      casse
        ? `Le tag « ${upTo} » n'existe pas, mais « ${casse} » oui : un tag de ` +
            `migration est SENSIBLE à la casse. Sans ce refus, l'adoption ne ` +
            `se serait arrêtée nulle part et aurait déclaré à niveau TOUTES ` +
            `les migrations connues.`
        : `Le tag « ${upTo} » ne désigne aucune migration connue. L'adoption ` +
            `s'arrête ici plutôt que de déclarer à niveau TOUT l'historique : ` +
            `une base ne reçoit jamais une migration qu'elle croit déjà avoir.`,
    );
  }

  /**
   * Refuse un `--source` que cette application ne déclare pas.
   *
   * Le filtre part sinon en SQL sur un nom qui n'existe pas : zéro ligne
   * touchée, code 0, « Rien à réparer ». L'exploitant croit avoir réparé et
   * relance une migration qui échouera pour la même raison qu'avant.
   *
   * @param source - nom demandé.
   * @throws MigrationVerdictError quand la source n'est pas déclarée.
   */
  #assertKnownSource(source: string): void {
    const noms = this.#options.sources.map((s) => s.name);
    if (noms.includes(source)) {
      return;
    }
    const casse = noms.find(
      (nom) => nom.toLowerCase() === source.toLowerCase(),
    );
    throw this.#verdict(
      "NF_MIGRATE_UNKNOWN_SOURCE",
      {
        source,
        facts: { known: noms, ...(casse ? { caseMismatch: casse } : {}) },
        actions: [
          {
            command: casse
              ? `nodefony orm:migrate:repair --connector ${this.connector} --source ${casse}`
              : `nodefony orm:migrate:repair --connector ${this.connector}`,
            args: casse
              ? [
                  "orm:migrate:repair",
                  "--connector",
                  this.connector,
                  "--source",
                  casse,
                ]
              : ["orm:migrate:repair", "--connector", this.connector],
          },
        ],
      },
      casse
        ? `La source « ${source} » n'est pas déclarée, mais « ${casse} » oui : ` +
            `un nom de source est SENSIBLE à la casse. Réparer sur un nom ` +
            `inconnu ne touche rien et rend pourtant « rien à réparer ».`
        : `La source « ${source} » n'est pas déclarée par cette application. ` +
            `Réparer sur un nom inconnu ne touche rien et rend pourtant ` +
            `« rien à réparer » — le marqueur d'échec resterait en place.`,
    );
  }

  /** Qui a appliqué — l'hôte du job, sauf indication contraire. */
  #appliedBy(): string {
    return this.#options.appliedBy ?? os.hostname();
  }
}

/** Identité d'une migration : `(source, tag)`, jamais un horodatage. */
function identity(row: { source: string; tag: string }): string {
  return `${row.source}\0${row.tag}`;
}

/**
 * Au moins une de ces tables existe-t-elle déjà ?
 *
 * @param driver - pilote ouvert.
 * @param tables - tables que les migrations restantes créeraient.
 * @returns `true` dès la première trouvée.
 */
async function hasAnyTable(
  driver: IMigrationDriver,
  tables: readonly string[],
): Promise<boolean> {
  for (const table of tables) {
    if (await driver.tableExists(table)) {
      return true;
    }
  }
  return false;
}

/**
 * Borne un message d'erreur avant de l'écrire en base.
 *
 * @param message - message brut.
 * @returns le message, tronqué si nécessaire.
 */
function truncate(message: string): string {
  return message.length > ERROR_MAX_LENGTH
    ? `${message.slice(0, ERROR_MAX_LENGTH)}…`
    : message;
}
