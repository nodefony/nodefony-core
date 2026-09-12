import type { CliKernel, Kernel, OptionsCommandInterface } from "nodefony";
import type { SqlDialect } from "../config/config";
import { openMigrationDriver } from "../src/migrator/drivers/index";
import type { IMigrationDriver } from "../src/migrator/types";
import { MIGRATION_FORMAT_VERSION, action } from "../src/migrator/explain";
import { readHistory } from "../src/migrator/history";
import {
  identityTablesAmong,
  rowsWorthKeeping,
  type IIdentityTableFound,
} from "../src/migrator/identityTables";
import { readMigrationEnv, resetAllowed } from "../src/migrator/resolve";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";

const options: OptionsCommandInterface = {
  helpGroup: "BASE DE DONNÉES",
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Options propres à la remise à zéro d'une base de développement. */
interface IResetOptions extends IMigrateSharedOptions {
  yes?: boolean;
  dropAccounts?: boolean;
}

/**
 * Requête qui liste les tables du schéma COURANT de la connexion.
 *
 * Le schéma courant, et pas « toutes les bases du serveur » : c'est le
 * périmètre que la connexion adresse déjà, donc celui que l'utilisateur a
 * désigné en configurant son connecteur. Élargir serait détruire ce qu'il n'a
 * pas montré.
 */
const LIST_TABLES: Record<SqlDialect, string> = {
  sqlite:
    "SELECT name AS name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  postgres:
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()",
  mysql:
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
};

/** Échappe un identifiant venu du catalogue de la base. */
function quoteIdent(name: string, dialect: SqlDialect): string {
  return dialect === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/**
 * `nodefony orm:reset` — vide la base de DÉVELOPPEMENT et la laisse prête à
 * être recréée.
 *
 * ## Le geste qu'elle remplace
 *
 * Jusqu'ici, le générateur d'applications disait « supprime ta base de dev, ou
 * passe par une migration » : deux gestes manuels, aucun outil, et chacun s'en
 * tirait comme il pouvait. Une seule commande à retenir pour toute l'équipe,
 * au lieu d'un arbre de décision.
 *
 * ## Ce qu'elle fait exactement
 *
 * Elle supprime **toutes les tables du schéma courant** de la connexion —
 * l'historique des migrations compris. Elle ne supprime NI la base, NI le
 * fichier : supprimer une base demande des droits d'administration que le
 * compte de l'application n'a pas, et supprimer un fichier ouvert échoue sous
 * Windows. Le résultat est le même — une base vide — et il s'obtient partout de
 * la même façon.
 *
 * Ensuite : en mode `auto` (le défaut en développement), le prochain démarrage
 * recrée le schéma depuis le code. Dans les autres modes, la commande dit quoi
 * lancer.
 *
 * ## Le refus est une LISTE BLANCHE, pas une liste noire
 *
 * Elle n'accepte de travailler que si l'environnement est `development`. Pas
 * « refusée en production » : `staging`, `preprod`, `test` et tout
 * environnement inconnu refusent aussi. La différence n'est pas théorique — une
 * garde écrite « si production » laisse passer tout ce qu'on n'a pas pensé à
 * nommer, et c'est exactement là que l'accident arrive.
 *
 * `NF_MIGRATE_DATABASE_URL` n'est **pas** lue par cette commande. Cette
 * variable porte le compte qui a le droit de modifier le schéma en
 * production : lui laisser désigner la cible d'un effacement serait offrir la
 * seule combinaison qu'il ne faut jamais rendre possible.
 *
 * ## Ce que `--yes` ne suffit PAS à faire
 *
 * Une base qui porte des comptes, des passkeys ou des seconds facteurs n'est pas
 * une base jetable, et `--yes` ne l'efface pas : la commande refuse, nomme
 * chaque table avec son nombre de lignes, et demande `--drop-accounts` en plus.
 * Vécu : un agent a lu un refus de migration qui proposait `orm:migrate:repair`,
 * puis a tapé `orm:reset -y` — la seule voie qui détruit. Un refus bien rédigé
 * ne suffit pas : la prose informe, seule la commande contraint.
 *
 * Une base VIDE n'est pas gênée, et c'est voulu : une garde qui se lève sur le
 * cas normal s'apprend à être contournée avant le jour où elle a raison.
 *
 * @example
 * ```bash
 * nodefony orm:reset                     # demande confirmation en terminal
 * nodefony orm:reset --yes               # sans question (script)
 * nodefony orm:reset --yes --drop-accounts  # ... comptes et passkeys compris
 * ```
 */
class OrmReset extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:reset",
      "vide la base de développement d'un connecteur",
      cli,
      options,
    );
    this.addSharedOptions();
    this.addOption(
      "-y, --yes",
      "ne pose pas la question — pour un script ; hors terminal, l'option est obligatoire",
    );
    this.addOption(
      "--drop-accounts",
      "accepte d'effacer des comptes, des passkeys et des seconds facteurs — sans ce drapeau, `--yes` ne le fait pas",
    );
  }

  override async generate(opts: IResetOptions = {}): Promise<this> {
    // ⚠️ `allowMigrateUrl: false` — cf l'explication de classe : la variable de
    // privilège élevé ne désigne JAMAIS la cible d'un effacement.
    const resolved = this.resolveOrFail(opts, false);
    if (!resolved) {
      return this;
    }
    const { resolution } = resolved;
    const style = this.style;

    const env = readMigrationEnv(this.kernel as Kernel | null);
    if (!resetAllowed(env)) {
      const observed =
        env.nodeEnv ??
        process.env.NF_ENV ??
        process.env.APP_ENV ??
        "non déclaré";
      this.fail(
        resolution.connector,
        "NF_MIGRATE_NOT_DEVELOPMENT",
        `Cette commande efface des données : elle n'est acceptée qu'en développement. L'environnement constaté est « ${observed} ».`,
        "La règle est une liste blanche : seul `development` passe. Un environnement inconnu, un `staging`, un `test` sont refusés — c'est ce qui empêche un accident sur ce que personne n'avait pensé à nommer. Pour vider une base ailleurs, fais-le avec l'outil de ta base, en sachant ce que tu fais. Sur un poste de développement, c'est l'environnement de l'application qui doit dire `development` — pas une variable posée devant la commande.",
        // 🔴 AUCUN geste ne doit ouvrir cette garde. La version précédente
        // proposait `NODE_ENV=development nodefony orm:reset` : la liste
        // blanche lit `NODE_ENV` en premier, donc la ligne À COPIER effaçait
        // la base de production de qui la copiait — et le contrat dit qu'un
        // agent exécute `nextActions[0]` sans lire la prose. Le seul geste
        // offert ici est une LECTURE.
        [
          action(
            `nodefony orm:migrate:status --connector ${resolution.connector} --json`,
          ),
        ],
        opts.json,
      );
      return this;
    }

    const target =
      resolution.dialect === "sqlite"
        ? (resolution.target.filename ?? ":memory:")
        : redact(resolution.target.url ?? "");

    let driver: IMigrationDriver | null = null;
    try {
      driver = await openMigrationDriver(resolution.target);
      const rows = await driver.query<{ name: string }>(
        LIST_TABLES[resolution.dialect],
      );
      const tables = rows
        .map((r) => String(r.name))
        .filter((n) => n.length > 0)
        .sort();

      if (tables.length === 0) {
        this.respond(
          {
            formatVersion: MIGRATION_FORMAT_VERSION,
            connector: resolution.connector,
            exitCode: 0,
            dropped: [],
          },
          `${style.green("La base est déjà vide")} ${style.dim(`(${resolution.dialect} : ${target})`)} — rien à faire.\n`,
          0,
          opts.json,
        );
        return this;
      }

      // 🔴 CE QUI NE SE RECONSTITUE PAS SE CONSTATE — `--yes` n'y suffit plus.
      // Vécu : un agent a lu un refus de migration exemplaire, qui proposait
      // `orm:migrate:repair`, puis a tapé `orm:reset -y` — la seule voie qui
      // détruit, et celle que le refus ne nommait pas. Douze tables, dont les
      // comptes. Le geste n'était pas absurde : sur une base jetable il est
      // légitime, et rien ici ne distinguait une base jetable d'une base qui
      // porte des comptes. La prose informe, seule la commande contraint.
      const identity = identityTablesAmong(tables);
      if (identity.length > 0 && opts.dropAccounts !== true) {
        const counted: (IIdentityTableFound & { rows: number })[] = [];
        for (const entry of identity) {
          const countRows = await driver.query<{ n: unknown }>(
            `SELECT COUNT(*) AS n FROM ${quoteIdent(entry.table, resolution.dialect)}`,
          );
          counted.push({ ...entry, rows: Number(countRows[0]?.n ?? 0) });
        }
        // Le SEUIL, et non « au moins une ligne » : une application fraîche
        // porte toujours le compte d'administration que son semis repose à
        // chaque démarrage, donc il n'y a rien à perdre. Crier là rendrait la
        // garde inutile — on apprendrait à taper les deux drapeaux par réflexe,
        // avant le jour où elle a raison.
        const atRisk = counted.filter((c) => rowsWorthKeeping(c, c.rows));
        if (atRisk.length > 0) {
          // Un marqueur d'échec de migration change la réponse : c'est le SEUL
          // moment où l'on sait que la voie non destructrice s'applique, et
          // c'est précisément la situation qui a mené à l'accident.
          let repairable = false;
          try {
            repairable = (await readHistory(driver)).some(
              (row) => !row.success || row.finishedAt === null,
            );
          } catch {
            // Pas d'historique lisible (base d'avant les migrations) : le
            // refus reste valable, il n'a simplement rien à proposer de plus.
          }
          const connectorArg =
            resolution.connector === "default"
              ? ""
              : ` --connector ${resolution.connector}`;
          this.fail(
            resolution.connector,
            "NF_MIGRATE_RESET_HAS_ACCOUNTS",
            `Cette base porte des données qui ne se reconstituent pas : ` +
              `${atRisk.map((c) => `${c.table} (${c.rows})`).join(", ")}.`,
            `${atRisk.map((c) => `  · ${c.table} — ${c.holds}`).join("\n")}\n\n` +
              (repairable
                ? `Une migration a échoué et son marqueur est posé : c'est ` +
                  `probablement ce que tu cherches à débloquer. \`orm:migrate:repair\` ` +
                  `lève le marqueur SANS rien effacer, et écrire la migration ` +
                  `suivante vaut toujours mieux que défaire ce qui est appliqué.\n\n`
                : "") +
              `Si ces données ne comptent pour personne — base d'essai, ` +
              `exemplaire jetable —, relance avec \`--drop-accounts\` en plus de ` +
              `\`--yes\` : le drapeau dit que tu as vu la liste ci-dessus.`,
            // 🔴 `nextActions[0]` est exécuté par un agent SANS lire la prose
            // (contrat de cette famille de commandes) : le premier geste ne peut
            // donc JAMAIS être la destruction. Ici, une réparation ou une lecture.
            repairable
              ? [
                  action(`nodefony orm:migrate:repair${connectorArg}`),
                  action(`nodefony orm:migrate:status${connectorArg} --json`),
                ]
              : [action(`nodefony orm:migrate:status${connectorArg} --json`)],
            opts.json,
            // `actionRequired`, pas `error` : la commande a parfaitement
            // travaillé — elle a constaté, et elle attend une décision humaine.
            // Le 2 voudrait dire « je n'ai pas pu », et un script qui distingue
            // les deux conclurait à une panne de base.
            1,
          );
          return this;
        }
      }

      // 🔴 IDENTITÉ PROUVÉE, PÉRIMÈTRE BORNÉ — l'utilisateur voit la base visée
      // ET la liste exacte de ce qui va disparaître AVANT de décider. Un geste
      // destructeur qui ne montre pas sa cible est un geste qu'on regrette.
      // 🔴 `--json` est un flux PUR : un dialogue n'a pas sa place dedans, et
      // le terminal reste un terminal quand seule la SORTIE est redirigée
      // (`… --json | jq` garde stdin sur le TTY). Le préambule partait alors
      // sur la sortie standard et cassait le premier `jq` ; pire, un refus au
      // prompt sortait avec 0 et AUCUN objet — la garantie que cette famille
      // de commandes proclame, violée par l'une d'elles. Un lecteur machine
      // n'a pas de dialogue : il assume, ou il est refusé.
      if (opts.yes !== true) {
        if (opts.json === true || !process.stdin.isTTY) {
          this.fail(
            resolution.connector,
            "NF_MIGRATE_CONFIRM_REQUIRED",
            `Cette commande va supprimer ${tables.length} table(s) de « ${target} » (${resolution.dialect}) : ${tables.join(", ")}.`,
            "Hors terminal — ou en sortie machine, où un dialogue n'a pas sa place —, il n'y a personne pour répondre à une question, et un effacement ne se déduit pas d'un silence. Relance avec `--yes` si c'est bien ce que tu veux.",
            [
              action(
                `nodefony orm:reset --yes${resolution.connector === "default" ? "" : ` --connector ${resolution.connector}`}`,
              ),
            ],
            opts.json,
            1,
          );
          return this;
        }
        process.stdout.write(
          `${style.yellow(style.bold("Effacement de la base de développement"))}\n` +
            `  base    : ${style.bold(target)} ${style.dim(`(${resolution.dialect})`)}\n` +
            `  tables  : ${tables.join(", ")}\n\n`,
        );
        await this.loadPrompts();
        const ok = await this.prompts.confirm({
          message: `Supprimer ces ${tables.length} table(s) ?`,
          default: false,
        });
        if (!ok) {
          process.stdout.write(
            `${style.dim("Annulé — rien n'a été touché.")}\n`,
          );
          return this;
        }
      }

      await this.#dropAll(driver, tables, resolution.dialect);

      const suite =
        resolution.ddl === "auto"
          ? "Le prochain démarrage recrée le schéma depuis le code."
          : "Applique les migrations pour recréer le schéma.";
      const actions =
        resolution.ddl === "auto"
          ? [action("nodefony development")]
          : [
              action(
                `nodefony orm:migrate${resolution.connector === "default" ? "" : ` --connector ${resolution.connector}`}`,
              ),
            ];
      this.respond(
        {
          formatVersion: MIGRATION_FORMAT_VERSION,
          connector: resolution.connector,
          exitCode: 0,
          dropped: tables,
          nextActions: actions,
        },
        `${style.green(style.bold(`✓ ${tables.length} table(s) supprimée(s)`))} ${style.dim(`(${resolution.dialect} : ${target})`)}\n` +
          `${tables.map((t) => `  ${style.dim("−")} ${t}`).join("\n")}\n\n` +
          `${suite}\n\n${style.bold("À faire :")}\n${actions.map((a) => `  ${style.green(a.command)}`).join("\n")}\n`,
        0,
        opts.json,
      );
    } catch (e) {
      this.failFrom(e, resolution.connector, opts.json);
    } finally {
      await driver?.close().catch(() => undefined);
    }
    return this;
  }

  /**
   * Supprime les tables en désarmant les clés étrangères le temps de l'opération.
   *
   * Sans ce désarmement, l'ordre de suppression devrait être topologique — et il
   * est indécidable sur un cycle de références. Le désarmement porte sur la
   * connexion de la commande seulement, et elle se ferme juste après.
   */
  async #dropAll(
    driver: IMigrationDriver,
    tables: readonly string[],
    dialect: SqlDialect,
  ): Promise<void> {
    if (dialect === "sqlite") {
      await driver.exec("PRAGMA foreign_keys = OFF");
    } else if (dialect === "mysql") {
      await driver.exec("SET FOREIGN_KEY_CHECKS = 0");
    }
    try {
      for (const t of tables) {
        const ident = quoteIdent(t, dialect);
        await driver.exec(
          dialect === "postgres"
            ? `DROP TABLE IF EXISTS ${ident} CASCADE`
            : `DROP TABLE IF EXISTS ${ident}`,
        );
      }
    } finally {
      if (dialect === "sqlite") {
        await driver.exec("PRAGMA foreign_keys = ON").catch(() => undefined);
      } else if (dialect === "mysql") {
        await driver.exec("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
      }
    }
  }
}

/** Retire le secret d'une URL de connexion avant de l'afficher. */
function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) {
      u.password = "***";
    }
    return u.toString();
  } catch {
    return url.replace(/\/\/[^@]*@/, "//***@");
  }
}

export default OrmReset;
