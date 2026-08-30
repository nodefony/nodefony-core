import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SqlDialect } from "../../config/config";
import { openMigrationDriver, type IMigrationTarget } from "./drivers/index";
import {
  deleteFailed,
  ensureHistorySchema,
  finishHistory,
  forgetEntries,
  insertHistory,
  readHistory,
} from "./history";
import { APP_SOURCE } from "./paths";
import { createdTables, loadSources } from "./sources";
import {
  HISTORY_TABLE,
  MigrationLockTimeoutError,
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
    // 🔴 Un essai à blanc n'écrit RIEN, et « rien » comprend la table
    // d'historique et le verrou. Le contrat publié dit « sans rien écrire » ;
    // le code prenait le verrou puis créait la table avant de rendre le plan.
    // Deux conséquences, toutes deux constatées : un compte en lecture seule —
    // le réflexe même de l'essai à blanc — échouait sur un défaut de droits au
    // lieu de rendre son plan, et l'essai laissait derrière lui une table sur
    // une base jusque-là vierge, ce qui rend fausse la seule preuve simple
    // qu'on puisse en donner : que la base n'a pas bougé.
    const essaiBlanc = options.dryRun === true;
    try {
      if (!essaiBlanc) {
        await this.#prendreVerrou(driver);
        await ensureHistorySchema(driver);
      }
      const loaded = await loadSources(
        this.#options.sources,
        this.#options.dialect,
      );
      // Sans la table, il n'y a pas d'historique — et il n'y a pas à la créer
      // pour le constater.
      const history =
        essaiBlanc && !(await driver.tableExists(HISTORY_TABLE))
          ? []
          : await readHistory(driver);
      const plan = await this.#computePlan(
        driver,
        loaded.files,
        history,
        loaded.absent,
      );
      this.#assertApplicable(plan, loaded.files, options);
      if (essaiBlanc) {
        return { runId, applied: [] };
      }
      for (const file of plan.pending) {
        applied.push(await this.#apply(driver, file, runId));
      }
      return { runId, applied };
    } finally {
      await driver.unlock().catch(() => undefined);
      // Fermer est un nettoyage : une exception ici REMPLACERAIT l'erreur en
      // vol, et l'exploitant lirait un échec de fermeture au lieu de l'erreur
      // SQL qui a fait tomber sa migration — le diagnostic partirait du
      // mauvais côté.
      await driver.close().catch(() => undefined);
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
   * ⚠️ **Cette méthode ne vérifie PAS que la base porte l'état qu'elle
   * inscrit.** Le contrôle vit chez son appelant (la commande, qui compare la
   * base au schéma déclaré et refuse `NF_MIGRATE_BASELINE_AMBIGUOUS`). Elle
   * traverse pourtant la frontière du paquet : un consommateur qui l'appelle
   * directement DOIT constater l'écart d'abord (`gapAgainstDeclared`), sans
   * quoi il grave un historique complet devant une base qui ne suit pas — et
   * plus aucune commande n'offre alors de geste, sinon `repair --forget`.
   *
   * @param upTo - dernier tag inscrit (inclus) ; toutes les restantes si omis.
   * @returns les migrations inscrites.
   */
  /**
   * Prend le verrou d'applicateur, ou rend un VERDICT plutôt qu'une erreur nue.
   *
   * Un verrou tenu n'est pas une panne : c'est le déploiement d'à côté qui
   * travaille, et la seule bonne réponse est d'attendre puis de reprendre.
   * C'est précisément ce que le code `NF_MIGRATE_LOCK_TIMEOUT` dit à un
   * orchestrateur — un code publié dans le contrat, avec sa phrase et son
   * propre code de sortie, et que POURTANT personne n'émettait : les pilotes
   * levaient une erreur nue, qui tombait dans le fourre-tout des pannes. Les
   * branches qui attendaient ce code étaient donc inatteignables.
   *
   * @param driver - pilote ouvert sur la base.
   * @throws MigrationVerdictError si le verrou n'est pas obtenu à temps.
   */
  async #prendreVerrou(driver: IMigrationDriver): Promise<void> {
    const timeoutMs = this.#options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    try {
      await driver.lock(timeoutMs);
    } catch (e) {
      if (!(e instanceof MigrationLockTimeoutError)) {
        throw e;
      }
      throw this.#verdict(
        "NF_MIGRATE_LOCK_TIMEOUT",
        {
          facts: { timeoutMs: String(e.timeoutMs) },
          actions: [
            {
              command: `nodefony orm:migrate:status --connector ${this.connector} --json`,
              args: [
                "orm:migrate:status",
                "--connector",
                this.connector,
                "--json",
              ],
            },
            {
              command: `nodefony orm:migrate --connector ${this.connector}`,
              args: ["orm:migrate", "--connector", this.connector],
            },
          ],
        },
        e.message,
      );
    }
  }

  /**
   * Dossier des migrations de l'application, tel qu'on l'écrit dans un GESTE.
   *
   * Dérivé du registre de sources, jamais littéral : une application peut
   * ranger ses migrations ailleurs, et un geste qui nomme un dossier inexistant
   * est un geste qu'on ne peut pas suivre.
   *
   * Écrit avec des barres obliques, toujours : ce chemin VOYAGE — il part dans
   * une commande que quelqu'un copie, y compris sous Windows, où `git` les
   * accepte et où le séparateur natif serait une échappée.
   *
   * @returns le chemin à citer, terminé par une barre.
   */
  #migrationsPath(): string {
    const app = this.#options.sources.find((s) => s.name === APP_SOURCE);
    if (app === undefined) {
      return "migrations/";
    }
    return `${path.basename(app.dir).split(path.sep).join("/")}/`;
  }

  async baseline(upTo?: string): Promise<IMigrationApplied[]> {
    const driver = await openMigrationDriver(this.#options);
    const runId = randomUUID();
    const adopted: IMigrationApplied[] = [];
    try {
      await this.#prendreVerrou(driver);
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
      // Fermer est un nettoyage : une exception ici REMPLACERAIT l'erreur en
      // vol, et l'exploitant lirait un échec de fermeture au lieu de l'erreur
      // SQL qui a fait tomber sa migration — le diagnostic partirait du
      // mauvais côté.
      await driver.close().catch(() => undefined);
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
    options: {
      source?: string;
      updateHashes?: boolean;
      forget?: readonly { source: string; tag: string }[];
    } = {},
  ): Promise<{
    cleared: { source: string; tag: string }[];
    rehashed: { source: string; tag: string }[];
    forgotten: { source: string; tag: string }[];
  }> {
    if (options.source !== undefined) {
      this.#assertKnownSource(options.source);
    }
    for (const cible of options.forget ?? []) {
      this.#assertKnownSource(cible.source);
    }
    const driver = await openMigrationDriver(this.#options);
    try {
      await this.#prendreVerrou(driver);
      await ensureHistorySchema(driver);
      const forgotten =
        options.forget === undefined || options.forget.length === 0
          ? []
          : await forgetEntries(driver, options.forget);
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
      return { cleared, rehashed, forgotten };
    } finally {
      await driver.unlock().catch(() => undefined);
      // Fermer est un nettoyage : une exception ici REMPLACERAIT l'erreur en
      // vol, et l'exploitant lirait un échec de fermeture au lieu de l'erreur
      // SQL qui a fait tomber sa migration — le diagnostic partirait du
      // mauvais côté.
      await driver.close().catch(() => undefined);
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
          // 🔴 Le geste SÛR d'abord. Ce refus ne proposait que le ré-alignement
          // des empreintes — que la commande de réparation documente elle-même
          // comme « presque toujours faux ». Un agent exécute le premier geste
          // sans lire la prose : il déclarait alors conforme un fichier
          // trafiqué, les autres bases ne recevaient jamais la correction, et
          // la dérive devenait invisible pour toujours. Le même état, lu par
          // `orm:migrate:status`, proposait déjà la restauration en premier :
          // deux réponses à une seule question, et c'est la dangereuse qui
          // vivait dans le refus qui ARRÊTE le geste.
          actions: [
            {
              command: `git checkout -- ${this.#migrationsPath()}`,
              args: ["checkout", "--", this.#migrationsPath()],
            },
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
        throw this.#echecApplication(file, e as Error, false);
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
      // 🔴 On revérifie DANS la transaction. Le moteur sérialise les
      // transactions, pas le « lire puis agir » : le plan a été calculé avant
      // le `BEGIN`, et sqlite n'a pas de verrou d'applicateur — son verrou est
      // un geste vide, parce qu'il est à écrivain unique par nature. Deux
      // processus ordinaires — le rattrapage au démarrage et un `orm:migrate`
      // tapé dans un terminal — lisaient donc le même « à appliquer », et le
      // second rejouait ce que le premier venait de poser : « table already
      // exists », annulation, et une erreur SQL nue sur une base pourtant
      // saine. Trois lignes rendent au moteur ce que son propre commentaire
      // revendiquait.
      const dejaLa = await readHistory(driver);
      if (dejaLa.some((r) => r.source === file.source && r.tag === file.tag)) {
        return {
          source: file.source,
          tag: file.tag,
          executionMs: Math.round(performance.now() - began),
        };
      }
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
      throw this.#echecApplication(file, e as Error, true);
    }
  }

  /**
   * Habille l'échec d'une migration en VERDICT, plutôt qu'en exception nue.
   *
   * C'est le cas d'incident nominal du produit : un travail de déploiement
   * applique, et la quatrième migration bute sur une contrainte. Laissée nue,
   * l'erreur tombait dans le fourre-tout des pannes, qui affirme trois choses
   * fausses au pire moment — que la base n'a pas répondu (elle a très bien
   * répondu, c'est le SQL qui a échoué), que rien n'a été modifié (le marqueur
   * d'échec vient d'être posé, les migrations précédentes du même passage sont
   * appliquées, et sur un moteur sans DDL transactionnel la moitié de la
   * fautive peut être en place), et en rendant 2 — « la commande n'a pas pu
   * travailler » — là où la grille range un échec de migration en 1, celui qui
   * appelle un humain. Un orchestrateur qui réessaie sur 2 rejouait un échec
   * déterministe.
   *
   * @param file - migration qui a échoué.
   * @param cause - erreur rendue par le moteur.
   * @param transactionnel - le DDL de ce moteur est-il transactionnel ?
   * @returns le verdict à lever.
   */
  #echecApplication(
    file: IMigrationFile,
    cause: Error,
    transactionnel: boolean,
  ): MigrationVerdictError {
    const etat = transactionnel
      ? `Cette migration a été ANNULÉE — le schéma de ce moteur entre ou n'entre pas, jamais à moitié. Les migrations appliquées AVANT elle, dans ce même passage, restent en place.`
      : `Ce moteur n'annule pas le schéma : cette migration peut être appliquée À MOITIÉ. Inspecter la base avant toute reprise — c'est pour cela que la reprise n'est pas automatique.`;
    return this.#verdict(
      "NF_MIGRATE_FAILED_MARKER",
      {
        source: file.source,
        tag: file.tag,
        facts: { error: truncate(cause.message) },
        actions: [
          {
            command: `nodefony orm:migrate:status --connector ${this.connector} --json`,
            args: [
              "orm:migrate:status",
              "--connector",
              this.connector,
              "--json",
            ],
          },
          {
            command: `nodefony orm:migrate:repair --connector ${this.connector}`,
            args: ["orm:migrate:repair", "--connector", this.connector],
          },
        ],
      },
      `La migration « ${file.tag} » (source « ${file.source} ») a échoué : ` +
        `${truncate(cause.message)}\n\n${etat}\n\n` +
        `Son échec est INSCRIT : le prochain passage refusera de reprendre tant ` +
        `que le marqueur n'aura pas été levé, après inspection.`,
    );
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
