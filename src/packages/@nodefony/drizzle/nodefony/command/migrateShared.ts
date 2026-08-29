import {
  Command,
  resolveColorEnabled,
  type CliKernel,
  type Kernel,
  type Module,
} from "nodefony";
import type { IDrizzleConfig } from "../interfaces/IDrizzleConfig";
import type { DrizzleMigrator } from "../src/migrator/DrizzleMigrator";
import { MigrationVerdictError } from "../src/migrator/types";
import { MigrationToolError } from "../src/migrator/refusals";
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
import type { IMigrationPlan } from "../src/migrator/types";
import {
  buildMigrator,
  readMigrationEnv,
  resolveConnector,
  type IConnectorResolution,
} from "../src/migrator/resolve";
import { composeReport } from "../src/migrator/status";
import {
  describeResolutionRefusal,
  moduleAbsent,
  type CommandFailureCode,
  type ICommandFailure,
} from "../src/migrator/refusals";

export type { ICommandFailure } from "../src/migrator/refusals";

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
  /**
   * Faut-il colorer la sortie ?
   *
   * 🔴 La question n'est PAS « est-ce un terminal ? », et la confondre avec ça
   * a deux conséquences que personne ne signale :
   *
   * - **`NO_COLOR` est ignoré.** C'est une convention publique
   *   (no-color.org) qu'un utilisateur pose une fois pour toutes ses commandes ;
   *   la manquer rend une sortie illisible sur un terminal à palette
   *   inhabituelle, et le framework passe pour cassé.
   * - **`FORCE_COLOR` est ignoré.** Sans lui, aucune sortie colorée n'est
   *   CAPTURABLE : ni dans un fichier, ni dans une passe d'intégration continue
   *   qui sait rendre les couleurs, ni dans un rapport de validation. On ne peut
   *   alors pas relire ce que l'exploitant voit vraiment.
   *
   * La règle vit au CŒUR (`resolveColorEnabled`), qui sert déjà les journaux :
   * la réécrire ici en ferait une SECONDE implémentation, et les deux
   * divergeraient — le journal obéirait à `NO_COLOR`, la commande non.
   */
  protected get tty(): boolean {
    return resolveColorEnabled(process.stdout.isTTY === true);
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
      const refus = moduleAbsent();
      this.fail(
        wanted,
        refus.code,
        refus.summary,
        refus.meaning,
        refus.nextActions,
        opts.json,
        refus.exitCode,
      );
      return null;
    }
    const resolution = resolveConnector(
      wanted,
      config,
      readMigrationEnv(this.kernel as Kernel | null),
      this.kernel as Kernel | null,
      { allowMigrateUrl },
    );
    if (resolution.kind !== "ready") {
      // La prose de chaque refus vit dans `refusals.ts` — l'écran de la console
      // d'administration la rend telle quelle. Écrire ici « connecteur
      // inconnu » et là-bas autre chose donnerait deux réponses à la même
      // question, chacune vraie dans son test.
      const refus = describeResolutionRefusal(wanted, resolution, config);
      this.fail(
        wanted,
        refus.code,
        refus.summary,
        refus.meaning,
        refus.nextActions,
        opts.json,
        refus.exitCode,
      );
      return null;
    }
    // La substitution est ANNONCÉE par le rapport lui-même (son en-tête nomme
    // la base détournée) et publiée dans sa charge utile — jamais par un
    // journal : émis ici en `INFO` puis en `WARNING`, le message n'est JAMAIS
    // sorti, le boot silencieux des commandes avalant les deux. Un
    // avertissement qui n'atteint personne est pire qu'aucun : on le croit posé.
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
   * Compose la charge utile d'un état.
   *
   * L'assemblage lui-même vit dans `migrator/status.ts` : le plan
   * d'administration publie le MÊME objet, et deux assemblages divergeaient
   * d'un champ à l'autre sans qu'aucun test ne le voie.
   *
   * @param plan - plan calculé par l'applicateur, en lecture seule.
   * @param resolution - connecteur prêt (porte le mode de schéma effectif).
   * @param config - configuration validée du module.
   * @returns la charge utile, prête pour `--json` comme pour l'écran.
   */
  protected async report(
    plan: IMigrationPlan,
    resolution: Extract<IConnectorResolution, { kind: "ready" }>,
    config: IDrizzleConfig,
  ): Promise<IMigrationReport> {
    return composeReport(
      plan,
      resolution,
      config,
      this.kernel as Kernel | null,
    );
  }

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
    // Une cause qui porte DÉJÀ son remède se rend telle quelle : le fourre-tout
    // ci-dessous explique tout par une base injoignable, ce qui est faux — et
    // trompeur — dès que l'arrêt vient d'ailleurs.
    if (e instanceof MigrationToolError) {
      const { code, summary, meaning, nextActions, exitCode } = e.refusal;
      this.fail(connector, code, summary, meaning, nextActions, json, exitCode);
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
