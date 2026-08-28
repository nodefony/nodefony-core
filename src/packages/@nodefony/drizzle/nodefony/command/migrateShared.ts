import { Command, type CliKernel, type Kernel, type Module } from "nodefony";
import type { IDrizzleConfig } from "../interfaces/IDrizzleConfig";
import type { DrizzleMigrator } from "../src/migrator/DrizzleMigrator";
import { MigrationVerdictError } from "../src/migrator/types";
import type { IMigrationAction } from "../src/migrator/types";
import {
  EXIT,
  MIGRATION_FORMAT_VERSION,
  action,
  refusalInMode,
  renderRefusal,
  styleFor,
  type IMigrationReport,
  type IStyle,
} from "../src/migrator/explain";
import {
  buildMigrator,
  knownConnectors,
  readMigrationEnv,
  resolveConnector,
  MIGRATE_URL_ENV,
  type IConnectorResolution,
} from "../src/migrator/resolve";

/**
 * Socle commun des commandes `orm:*` — ce qui garantit qu'aucune d'elles ne
 * laisse l'utilisateur, humain ou agent, devant une sortie muette.
 *
 * ## Les quatre garanties, et pourquoi elles vivent ICI
 *
 * 1. **Toute sortie porte un geste.** Succès, attente, refus ou panne : la
 *    commande écrit le fait, ce qu'il signifie, et la ligne exacte à copier.
 *    Écrites dans chaque commande, ces trois parties finiraient par manquer
 *    dans celle qu'on écrit un jour de fatigue — c'est justement celle qu'on
 *    rencontre en incident.
 * 2. **`--json` est un flux PUR.** La sortie standard n'appartient qu'aux
 *    données : un objet, une ligne, rien d'autre. Y compris en échec — un agent
 *    qui a demandé du JSON doit pouvoir lire l'échec comme il lit le succès. Le
 *    journal du démarrage, lui, est déjà écarté vers la sortie d'erreur par le
 *    cœur, qui reconnaît `--json` dans les arguments avant même de brancher le
 *    journal.
 * 3. **Aucune exception ne remonte nue.** Une pile d'appels n'est pas un
 *    message : elle ne dit ni ce qui s'est passé, ni quoi faire. Tout est
 *    rattrapé et traduit.
 * 4. **La grille des codes de sortie est tenue en un seul endroit** — `0` à
 *    jour ou appliqué, `1` action requise, `2` la commande n'a pas pu faire son
 *    travail. Cette grille part chez l'utilisateur dans des passes
 *    d'intégration continue et des travaux de déploiement : la réaffecter plus
 *    tard casserait des contrôles qu'on ne voit pas.
 */

/** Nom du module qui porte la configuration des connecteurs SQL. */
const MODULE_NAME = "drizzle";

/** Codes d'arrêt propres à la ligne de commande (l'applicateur a les siens). */
export type CommandFailureCode =
  /** Aucun connecteur de ce nom, nulle part. */
  | "NF_MIGRATE_UNKNOWN_CONNECTOR"
  /** Le connecteur existe, mais sa base ne se migre pas par fichiers. */
  | "NF_MIGRATE_NO_MIGRATIONS"
  /** Connecteur SQL enregistré, mais absent de la configuration du module. */
  | "NF_MIGRATE_NOT_CONFIGURED"
  /** Geste réservé au développement, demandé ailleurs. */
  | "NF_MIGRATE_NOT_DEVELOPMENT"
  /** La commande n'a pas pu joindre la base, ou a échoué à l'exécution. */
  | "NF_MIGRATE_UNAVAILABLE"
  /** Confirmation requise et non donnée. */
  | "NF_MIGRATE_CONFIRM_REQUIRED"
  /** Des migrations en attente SUPPRIMENT des données, hors développement. */
  | "NF_MIGRATE_DESTRUCTIVE";

/** Ce qu'une commande écrit quand elle n'a PAS pu rendre un état. */
export interface ICommandFailure {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  connector: string;
  exitCode: 1 | 2;
  /**
   * Présent ⇔ la commande n'a pas pu faire son travail. C'est le discriminant :
   * une sortie qui porte `verdict` est un état lu, une sortie qui porte `error`
   * est un arrêt. Aucune n'a jamais les deux.
   */
  error: {
    code: CommandFailureCode | MigrationVerdictError["verdict"]["code"];
    summary: string;
    meaning: string;
    nextActions: IMigrationAction[];
  };
}

/** Options communes à toutes les commandes de migration. */
export interface IMigrateSharedOptions {
  connector?: string;
  json?: boolean;
}

/**
 * Classe de base des commandes `orm:*`.
 *
 * Elle n'impose rien du verbe : chaque commande écrit son `generate`. Elle
 * impose la FORME de ce qui sort, parce que c'est cette forme qui fait la
 * différence entre un outil qu'on sait utiliser et un outil qu'on subit.
 */
export abstract class OrmMigrateCommand extends Command {
  /** La sortie standard part-elle vers un terminal ? (couleurs, sinon texte nu) */
  protected get tty(): boolean {
    return process.stdout.isTTY === true;
  }

  /** Mise en forme, neutralisée hors terminal. */
  protected get style(): IStyle {
    return styleFor(this.tty);
  }

  /**
   * Configuration validée du module qui porte les connecteurs SQL.
   *
   * @returns la configuration, ou `null` si le module n'est pas chargé.
   */
  protected drizzleConfig(): IDrizzleConfig | null {
    const modules = (this.kernel as Kernel | null)?.modules as
      Record<string, Module> | undefined;
    const mod = modules?.[MODULE_NAME];
    return mod ? (mod.config as unknown as IDrizzleConfig) : null;
  }

  /**
   * Écrit une charge utile sur la sortie standard et pose le code de sortie.
   *
   * `process.exitCode` et jamais `process.exit()` : couper le processus laisse
   * la sortie standard non vidée, et un `| jq` reçoit alors un objet tronqué —
   * un échec qui ressemble à un défaut de la commande.
   *
   * @param payload - l'objet, en mode machine.
   * @param human - le texte, en mode humain.
   * @param exitCode - `0`, `1` ou `2`.
   * @param json - la commande a-t-elle reçu `--json` ?
   */
  protected respond(
    payload: unknown,
    human: string,
    exitCode: number,
    json: boolean | undefined,
  ): void {
    if (json === true) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else {
      process.stdout.write(human.endsWith("\n") ? human : `${human}\n`);
    }
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  }

  /**
   * Arrête la commande en disant le fait, la cause et le geste.
   *
   * @param connector - connecteur concerné (ou le nom demandé).
   * @param code - code d'arrêt stable, lu par les machines.
   * @param summary - le fait, en français.
   * @param meaning - ce que ça veut dire.
   * @param actions - les commandes exactes à copier.
   * @param json - la commande a-t-elle reçu `--json` ?
   * @param exitCode - `2` par défaut : la commande n'a pas pu travailler.
   */
  protected fail(
    connector: string,
    code: CommandFailureCode | MigrationVerdictError["verdict"]["code"],
    summary: string,
    meaning: string,
    actions: IMigrationAction[],
    json: boolean | undefined,
    exitCode: 1 | 2 = EXIT.error,
  ): void {
    const style = this.style;
    const payload: ICommandFailure = {
      formatVersion: MIGRATION_FORMAT_VERSION,
      connector,
      exitCode,
      error: { code, summary, meaning, nextActions: actions },
    };
    let human = `${style.red(style.bold("Impossible"))} ${style.dim(`[${code}]`)}\n\n${summary}\n`;
    if (meaning) {
      human += `\n${style.dim(meaning)}\n`;
    }
    if (actions.length > 0) {
      human += `\n${style.bold("À faire :")}\n`;
      for (const a of actions) {
        human += `  ${style.green(a.command)}\n`;
      }
    }
    if (json === true) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else {
      process.stderr.write(human);
    }
    process.exitCode = exitCode;
  }

  /**
   * Résout le connecteur demandé, ou ARRÊTE la commande en le disant.
   *
   * Les **trois** réponses sont un contrat public, et elles restent distinctes :
   * un connecteur inconnu, un connecteur porté par un ORM sans migrations, un
   * connecteur prêt. Le jour où un second ORM apporte ses propres migrations,
   * seule la deuxième cesse de sortir pour ses connecteurs — répondre « ne
   * porte pas de migrations » à un connecteur qui en porte serait un message
   * FAUX, et un message faux publié est appris par les scripts qui le lisent.
   *
   * @param opts - options de la commande (connecteur, mode machine).
   * @param allowMigrateUrl - la commande honore-t-elle {@link MIGRATE_URL_ENV} ?
   * @returns le connecteur prêt, ou `null` si la commande est déjà arrêtée.
   */
  protected resolveOrFail(
    opts: IMigrateSharedOptions,
    allowMigrateUrl: boolean,
  ): {
    resolution: Extract<IConnectorResolution, { kind: "ready" }>;
    config: IDrizzleConfig;
  } | null {
    const wanted = opts.connector ?? "default";
    const config = this.drizzleConfig();
    if (!config) {
      this.fail(
        wanted,
        "NF_MIGRATE_UNAVAILABLE",
        `Le module « @nodefony/${MODULE_NAME} » n'est pas chargé par cette application : il n'y a aucun connecteur SQL à migrer.`,
        "Les migrations sont portées par le module qui déclare les connecteurs. Sans lui, la commande n'a ni base, ni fichiers, ni historique à consulter.",
        [action("nodefony inspect modules")],
        opts.json,
      );
      return null;
    }
    const env = readMigrationEnv(this.kernel as Kernel | null);
    const resolution = resolveConnector(
      wanted,
      config,
      env,
      this.kernel as Kernel | null,
      { allowMigrateUrl },
    );
    if (resolution.kind === "unknown") {
      const liste =
        resolution.known.length > 0
          ? resolution.known.map((n) => `« ${n} »`).join(", ")
          : "aucun";
      this.fail(
        wanted,
        "NF_MIGRATE_UNKNOWN_CONNECTOR",
        `Aucun connecteur ne s'appelle « ${wanted} ». Ceux que cette application déclare : ${liste}.`,
        "Le nom attendu est celui d'une clé de `connectors` dans la configuration, pas un nom de base ni un dialecte. Sans `--connector`, la commande travaille sur « default ».",
        [
          action("nodefony orm:migrate:status"),
          action("nodefony inspect config --json"),
        ],
        opts.json,
      );
      return null;
    }
    if (resolution.kind === "unsupported") {
      // 🔴 DEUX causes, DEUX messages — les confondre publie une phrase FAUSSE.
      //
      // Vécu sur cette application même : un connecteur SQL créé en direct par
      // un banc (hors configuration du module) recevait « ne gère pas de
      // migrations de schéma ». C'est un connecteur SQLite : il en gère
      // parfaitement, il manque seulement ses coordonnées de connexion. La
      // conception l'interdit explicitement — un message faux, une fois publié,
      // est appris par les scripts qui le lisent.
      if (resolution.sqlLike) {
        this.fail(
          wanted,
          "NF_MIGRATE_NOT_CONFIGURED",
          `Le connecteur « ${wanted} » est bien une base SQL (${resolution.driver}), mais il n'est pas déclaré dans la configuration de « @nodefony/${MODULE_NAME} » : la commande n'a pas ses coordonnées de connexion.`,
          "Un connecteur créé directement dans du code (un banc de test, un module qui instancie son ORM lui-même) est enregistré au moment où il se connecte, mais la commande, elle, lit la configuration — c'est elle qui porte le fichier ou l'URL, et un secret ne se lit pas dans un objet déjà connecté. Déclare-le dans `connectors` pour pouvoir le migrer.",
          [
            action("nodefony inspect config --json"),
            action(
              `nodefony orm:migrate:status --connector ${knownConnectors(config)[0] ?? "default"}`,
            ),
          ],
          opts.json,
        );
        return null;
      }
      this.fail(
        wanted,
        "NF_MIGRATE_NO_MIGRATIONS",
        `Le connecteur « ${wanted} » est porté par ${resolution.owner}, dont la base ne se met pas à jour par des migrations de schéma.`,
        "Les migrations par fichiers versionnés sont une mécanique SQL. Les autres bases résorbent l'écart entre le code et le schéma autrement — la question est la même, la réponse n'est pas la même. Aucune commande ne peut migrer ce connecteur aujourd'hui.",
        [
          action(
            `nodefony orm:migrate:status --connector ${knownConnectors(config)[0] ?? "default"}`,
          ),
        ],
        opts.json,
      );
      return null;
    }
    if (resolution.fromMigrateUrl) {
      this.log(
        `${MIGRATE_URL_ENV} est posée : la connexion du connecteur « ${wanted} » est remplacée par celle du travail de migration.`,
        "INFO",
      );
    }
    return { resolution, config };
  }

  /**
   * Construit l'applicateur d'un connecteur résolu.
   *
   * @param resolution - connecteur prêt.
   * @param config - configuration validée.
   * @returns l'applicateur, sources chargées.
   */
  protected async migrator(
    resolution: Extract<IConnectorResolution, { kind: "ready" }>,
    config: IDrizzleConfig,
  ): Promise<DrizzleMigrator> {
    return buildMigrator(resolution, config, this.kernel as Kernel | null);
  }

  /**
   * Traduit N'IMPORTE QUELLE erreur en arrêt lisible — c'est le filet.
   *
   * Deux familles, et elles ne se répondent pas pareil. Un refus de
   * l'applicateur porte déjà son verdict et ses gestes : on les rend tels
   * quels, et le code de sortie dit « action requise » — la base est intacte,
   * c'est l'humain qui doit trancher. Tout le reste — base injoignable, droits
   * manquants, verrou impossible à prendre — est une panne : code `2`, et on
   * dit quand même où regarder.
   *
   * @param e - ce qui a été levé.
   * @param connector - connecteur concerné.
   * @param json - la commande a-t-elle reçu `--json` ?
   * @param ddl - mode de schéma effectif, quand il change la cause du refus.
   */
  protected failFrom(
    e: unknown,
    connector: string,
    json: boolean | undefined,
    ddl?: string,
  ): void {
    if (e instanceof MigrationVerdictError) {
      const style = this.style;
      // Le mode de schéma change la CAUSE d'un refus, donc son explication et
      // ses gestes — cf `refusalInMode`. Sans lui, un utilisateur en
      // développement cherche une vieille base qui n'existe pas.
      const enMode = ddl ? refusalInMode(e.verdict.code, ddl, connector) : null;
      const payload: ICommandFailure = {
        formatVersion: MIGRATION_FORMAT_VERSION,
        connector,
        // Un verrou indisponible n'est pas une action humaine sur le schéma :
        // c'est la commande qui n'a pas pu travailler. Les autres refus, si.
        exitCode:
          e.verdict.code === "NF_MIGRATE_LOCK_TIMEOUT"
            ? EXIT.error
            : EXIT.actionRequired,
        error: {
          code: e.verdict.code,
          summary: e.message,
          meaning: enMode?.meaning ?? "",
          nextActions: enMode?.actions ?? [...e.verdict.nextActions],
        },
      };
      if (json === true) {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
      } else {
        process.stderr.write(renderRefusal(e.verdict, e.message, style, ddl));
      }
      process.exitCode = payload.exitCode;
      return;
    }
    const cause = e instanceof Error ? e.message : String(e);
    this.fail(
      connector,
      "NF_MIGRATE_UNAVAILABLE",
      `La commande n'a pas pu travailler sur le connecteur « ${connector} » : ${cause}`,
      "La base n'a pas répondu, ou le compte utilisé n'a pas les droits nécessaires. Rien n'a été modifié : l'applicateur valide tout avant d'écrire quoi que ce soit. Vérifie que la base est démarrée et joignable, puis regarde les droits du compte — celui qui migre a besoin de pouvoir créer et modifier des tables, ce que le compte qui sert le trafic n'a normalement pas.",
      [
        action("nodefony orm:migrate:status --json"),
        action("nodefony inspect config --json"),
      ],
      json,
    );
  }

  /**
   * Écrit un état lu et pose son code de sortie.
   *
   * @param report - charge utile complète.
   * @param human - rendu humain déjà composé.
   * @param json - la commande a-t-elle reçu `--json` ?
   */
  protected emitReport(
    report: IMigrationReport,
    human: string,
    json: boolean | undefined,
  ): void {
    this.respond(report, human, report.exitCode, json);
  }

  /** Déclare les deux options que toutes les commandes de migration portent. */
  protected addSharedOptions(): void {
    this.addOption(
      "-c, --connector <nom>",
      "connecteur SQL visé (défaut : default) — c'est une clé de `connectors` dans la configuration",
    );
    this.addOption(
      "-j, --json",
      "sortie machine : un objet sur la sortie standard, le journal sur la sortie d'erreur (`| jq` sûr)",
    );
  }

  /** Le CLI courant, typé — utilisé pour les réglages de boot silencieux. */
  protected get cliKernel(): CliKernel {
    return this.cli as CliKernel;
  }
}
