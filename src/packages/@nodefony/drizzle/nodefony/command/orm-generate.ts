import fs from "node:fs/promises";
import path from "node:path";
import {
  listTargets,
  type CliKernel,
  type Kernel,
  type OptionsCommandInterface,
} from "nodefony";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  collectTables,
  entityFilesOf,
  writeCustomMigration,
  writeKitConfig,
  missingProviders,
  usurpedTables,
  writeSchemaModule,
  registeredTables,
  type IUnreadableEntityFile,
} from "../src/migrator/appSchema";
import {
  auditMigrationSql,
  runGenerate,
  stampFormatMarker,
  type IAuditRule,
} from "../src/migrator/kit";
import { checkMigrationName } from "../src/migrator/name";
import type { IDiscoveryFacts } from "../src/migrator/refusals";
import { gapAgainstDeclared } from "../src/migrator/divergence";
import { readJournal, tablesPresentIn } from "../src/migrator/adopt";
import { summarizeGap } from "../src/migrator/schemaDiff";
import { appMigrationsDir } from "../src/migrator/resolve";
import { APP_SOURCE, frameworkMigrationsDir } from "../src/migrator/paths";
import {
  createdTables,
  frameworkTables,
  loadSources,
} from "../src/migrator/sources";
import { HISTORY_TABLE, type IMigrationDriver } from "../src/migrator/types";
import {
  openMigrationDriver,
  type IMigrationTarget,
} from "../src/migrator/drivers/index";
import {
  EXIT,
  MIGRATION_FORMAT_VERSION,
  action,
} from "../src/migrator/explain";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";

/**
 * `kernelEvent: "onPostReady"` — la commande LIT l'état de l'application.
 *
 * Le registre des entités est peuplé au démarrage, module par module. Une
 * commande branchée plus tôt passerait avant lui : elle ne trouverait rien à
 * contrôler, et laisserait passer une migration amputée. Aucun serveur n'écoute
 * pour autant — le profil console est respecté.
 */
const options: OptionsCommandInterface = {
  helpGroup: "BASE DE DONNÉES",
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Ce que la commande écrit quand elle a fait son travail. */
interface IGenerateReport {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  connector: string;
  /** Une migration a-t-elle été écrite ? `false` = le schéma n'a pas bougé. */
  generated: boolean;
  /** Tag attribué, `null` si rien n'a été écrit. */
  tag: string | null;
  /** Fichiers écrits, relatifs à la racine de l'application. */
  files: string[];
  /** Ce que la migration fait de VERROUILLANT en production (jamais bloquant). */
  warnings: IAuditRule[];
  /**
   * Fichiers d'entités qui n'ont pas pu être lus, et qui n'ont privé AUCUNE
   * entité enregistrée de son fournisseur. Dit, jamais tu — mais pas un arrêt :
   * un fichier dont rien ne dépend ne doit pas retenir une migration juste.
   */
  unreadable: IUnreadableEntityFile[];
  /**
   * Tables écrites pour un AUTRE moteur, donc hors de cette migration.
   *
   * L'outil les ignore sans un mot ; les taire aussi ferait annoncer un nombre
   * de tables supérieur à ce qui est réellement écrit.
   */
  otherDialect: Array<{ table: string; dialect: string; file: string }>;
  driver: {
    kind: "sql";
    dialect: SqlDialect;
    /** Dossier des migrations de l'application, relatif à sa racine. */
    dir: string;
  };
}

/** Options propres à `orm:generate`. */
interface IGenerateOptions extends IMigrateSharedOptions {
  name?: string;
  custom?: boolean;
  allowDestructive?: boolean;
}

/**
 * `nodefony orm:generate` — écrit la migration qui fera passer la base au
 * schéma que décrivent les entités de l'application.
 *
 * ## Ce que l'utilisateur n'a pas à connaître
 *
 * Rien de `drizzle-kit`. Ni son installation, ni sa configuration par dialecte,
 * ni la notion de « schéma matérialisé », ni son dossier de sortie, ni le format
 * de son journal. Il tape un verbe et un nom. La commande découvre les fichiers
 * d'entités par la convention du générateur, écrit ce qu'il faut dans un dossier
 * de travail qu'elle efface ensuite, et pilote l'outil — dont elle EXIGE la
 * preuve qu'il a travaillé, parce qu'il rend 0 même quand il échoue.
 *
 * ## Ce qu'elle refuse, et pourquoi elle le refuse plutôt que de continuer
 *
 * Une migration est **immuable une fois appliquée**. Une migration amputée n'est
 * pas un désagrément qu'on rattrape à la génération suivante : elle grave dans
 * l'historique une table qui n'existera jamais, et toute base qui l'a reçue
 * restera incomplète. Trois situations valent donc un arrêt qui NOMME :
 *
 * - un fichier d'entité qui ne s'importe pas (le schéma serait incomplet) ;
 * - une entité enregistrée qu'aucun fichier ne fournit (idem, et c'est le
 *   contrôle que le registre est le seul à pouvoir faire) ;
 * - un fichier de l'application qui fournit une table du FRAMEWORK — la
 *   migration porterait un second `CREATE TABLE` de cette table, qui échoue sur
 *   toute base déjà migrée, c'est-à-dire en production et nulle part ailleurs.
 *
 * @example Le cas courant
 * ```bash
 * nodefony orm:generate --name ajout_du_titre
 * nodefony orm:migrate        # ou : le travail de déploiement
 * ```
 *
 * @example Ce que le modèle déclaratif ne peut pas déduire
 * ```bash
 * nodefony orm:generate --custom --name vue_des_ventes
 * # → un fichier SQL vide, déjà inscrit au journal : à écrire à la main.
 * ```
 */
class OrmGenerate extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:generate",
      "écrit la migration qui aligne la base sur les entités",
      cli,
      options,
    );
    this.addSharedOptions();
    this.addOption(
      "-n, --name <nom>",
      "nom de la migration, en minuscules et « _ » — il entre dans le tag, qui est immuable une fois publié",
    );
    this.addOption(
      "--custom",
      "écrit un fichier SQL VIDE et son entrée de journal, sans rien déduire : vues, déclencheurs, clés étrangères, remplissages",
    );
    this.addOption(
      "--allow-destructive",
      "accepte une migration qui SUPPRIME des données — à ne poser qu'après avoir relu le fichier produit",
    );
  }

  /**
   * Racine de l'application — c'est depuis là que l'outil est lancé.
   *
   * @returns le chemin absolu de la racine.
   */
  #projectRoot(): string {
    return (this.kernel as Kernel).path;
  }

  /**
   * Vérifie le nom, ou arrête la commande en disant pourquoi.
   *
   * @param opts - options reçues.
   * @returns le nom validé, ou `null` si la commande est déjà arrêtée.
   */
  #nameOrFail(opts: IGenerateOptions, connector: string): string | null {
    const verdict = checkMigrationName(opts.name);
    if (verdict.ok) {
      return verdict.name;
    }
    this.fail(
      connector,
      "NF_GENERATE_NAME",
      verdict.reason,
      "Le nom entre dans le tag du fichier, et un tag ne se renomme plus une fois la migration appliquée quelque part : c'est lui qui dit à chaque base ce qu'elle a déjà reçu. Il devient aussi un nom de fichier sur trois systèmes — un espace, un accent ou une majuscule produisent un fichier qui ne se retrouve pas d'une machine à l'autre. Choisis-le pour qu'il se lise dans six mois : ce qui change, pas quand.",
      [
        action(
          `nodefony orm:generate --name ${verdict.suggestion ?? "ajout_du_titre"}`,
        ),
      ],
      opts.json,
      EXIT.actionRequired,
    );
    return null;
  }

  override async generate(opts: IGenerateOptions = {}): Promise<this> {
    // `allowMigrateUrl: false` — la génération ne touche AUCUNE base : le diff
    // se calcule entre les instantanés du dossier et les entités. Honorer une
    // URL de travail ici laisserait croire le contraire.
    const resolved = this.resolveOrFail(opts, false);
    if (!resolved) {
      return this;
    }
    const { resolution, config } = resolved;
    const connector = resolution.connector;
    const name = this.#nameOrFail(opts, connector);
    if (name === null) {
      return this;
    }
    const root = this.#projectRoot();
    const migrationsDir = appMigrationsDir(
      this.kernel as Kernel,
      config.migrations.dir,
    );
    if (migrationsDir === undefined) {
      // Inatteignable en pratique — la commande tourne DANS un kernel. Le dire
      // quand même : un `as string` ici deviendrait un plantage nu le jour où
      // quelqu'un appellerait ce verbe autrement.
      this.fail(
        connector,
        "NF_MIGRATE_UNAVAILABLE",
        "La racine de l'application n'a pas pu être résolue : impossible de savoir où écrire les migrations.",
        "Le dossier des migrations se résout depuis la racine de l'application, jamais depuis le répertoire courant — sans quoi la commande serait juste ou fausse selon l'endroit d'où on la tape.",
        [action("nodefony inspect config --json")],
        opts.json,
      );
      return this;
    }
    const outDir = path.join(migrationsDir, resolution.dialect);
    const relative = (p: string): string =>
      path.relative(root, p).split(path.sep).join("/");

    try {
      if (opts.custom === true) {
        const { tag, file } = await writeCustomMigration({
          outDir,
          dialect: resolution.dialect,
          name,
        });
        return this.#emit(
          {
            formatVersion: MIGRATION_FORMAT_VERSION,
            connector,
            generated: true,
            tag,
            files: [relative(file)],
            warnings: [],
            unreadable: [],
            otherDialect: [],
            driver: {
              kind: "sql",
              dialect: resolution.dialect,
              dir: relative(outDir),
            },
          },
          opts,
          `Migration LIBRE ${tag} — le fichier est VIDE, et déjà inscrit au journal.`,
        );
      }
      return await this.#generateFromEntities(
        opts,
        connector,
        resolution.target,
        root,
        outDir,
        name,
        relative,
      );
    } catch (e) {
      this.failFrom(e, connector, opts.json, resolution.ddl);
      return this;
    }
  }

  /**
   * Le chemin nominal : découvrir, contrôler, générer, prouver.
   *
   * @returns `this`, la commande ayant déjà écrit sa sortie.
   */
  async #generateFromEntities(
    opts: IGenerateOptions,
    connector: string,
    // La BASE, pas seulement le dialecte : la garde d'adoption l'interroge, et
    // une base ne se déduit pas d'un nom de moteur.
    database: IMigrationTarget,
    root: string,
    outDir: string,
    name: string,
    relative: (p: string) => string,
  ): Promise<this> {
    const dialect = database.dialect;
    // 1. Les FICHIERS fournissent — ceux de l'APPLICATION, pas ceux du paquet
    //    qui livre déjà ses propres migrations. La distinction se CONSTATE (le
    //    fichier est-il sous la racine de ce paquet ?) au lieu de se deviner à
    //    un préfixe de nom : dans le dépôt du framework, ses paquets sont des
    //    espaces de travail, donc des cibles de scaffold comme les autres.
    const files: string[] = [];
    for (const target of listTargets(root)) {
      files.push(...(await entityFilesOf(target.dir)));
    }
    const { tables: found, unreadable: rawUnreadable } =
      await collectTables(files);
    // Les chemins du rapport sont relatifs à la racine de l'application, tous
    // sans exception : un chemin absolu au milieu d'une liste de chemins courts
    // se lit comme un autre genre de chose.
    const unreadable: IUnreadableEntityFile[] = rawUnreadable.map((u) => ({
      file: relative(u.file),
      cause: u.cause,
    }));
    const frameworkRoot = path.dirname(await frameworkMigrationsDir());
    const belongsToFramework = (file: string): boolean =>
      !path.relative(frameworkRoot, file).startsWith("..");
    const mine = found.filter((t) => !belongsToFramework(t.file));
    // Une entité écrite pour un AUTRE moteur n'entre pas dans cette migration :
    // l'outil l'ignorerait de toute façon, et annoncer son nombre de tables
    // sans elle est la seule façon de ne pas mentir sur ce qui a été écrit.
    const tables = mine.filter((t) => t.dialect === dialect);
    const otherDialect = mine
      .filter((t) => t.dialect !== dialect)
      .map((t) => ({
        table: t.tableName,
        dialect: t.dialect ?? "inconnu",
        file: relative(t.file),
      }));
    // Ce que la découverte a vu, tenu ICI pour les refus qui viennent après :
    // une table absente de ce relevé est, pour l'outil de diff, une table
    // SUPPRIMÉE. Sans ces nombres, un refus destructif accuse la base d'un
    // « drop table » dont la cause est dans le dossier d'entités.
    const discovery: IDiscoveryFacts = {
      filesScanned: files.length,
      tables: tables.map((t) => t.tableName),
      otherDialect,
      unreadable,
    };

    // 2. Ce qui appartient au FRAMEWORK n'appartient pas à l'application.
    const framework = new Set(await frameworkTables(dialect));
    const usurped = usurpedTables(tables, framework);
    if (usurped.length > 0) {
      const liste = usurped
        .map(
          (t) =>
            `  • « ${t.tableName} », exportée par ${relative(t.file)} (${t.exportName})`,
        )
        .join("\n");
      this.fail(
        connector,
        "NF_GENERATE_FRAMEWORK_TABLE",
        `L'application fournit ${usurped.length} table(s) qui appartiennent au framework :\n${liste}`,
        "Rien n'a été écrit. Ces tables sont créées par les migrations du framework, appliquées AVANT celles de l'application. Les décrire ici produirait un second « CREATE TABLE » pour la même table : la migration passerait sur une base vierge et échouerait sur toute base déjà migrée — c'est-à-dire en production, et nulle part ailleurs. Pour pointer vers une table du framework, garder la référence dans le code de l'entité sans la RÉ-EXPORTER ; pour une vraie clé étrangère SQL, écrire une migration libre (--custom).",
        [action(`nodefony orm:generate --custom --name lien_${name}`)],
        opts.json,
        EXIT.actionRequired,
      );
      return this;
    }

    // 3. Le REGISTRE valide — c'est le seul à savoir ce qui MANQUE.
    //
    //    Et c'est ici, pas plus tôt, que l'illisibilité d'un fichier devient
    //    grave : elle ne compte que si elle prive une entité enregistrée de son
    //    fournisseur. Un fichier qu'on n'a pas su lire et dont rien ne dépend
    //    — l'entité d'un AUTRE ORM, un fichier en cours d'écriture — n'a aucune
    //    raison de retenir une migration par ailleurs complète.
    const provided = new Set(tables.map((t) => t.tableName));
    const orphans = missingProviders(
      registeredTables(connector),
      provided,
      framework,
    );
    const missing = orphans.map(
      ({ entity, table }) => `  • entité « ${entity} » → table « ${table} »`,
    );
    if (missing.length > 0) {
      const cause =
        unreadable.length > 0
          ? `\n\nCe sont peut-être ces fichiers, qui n'ont pas pu être lus :\n${unreadable
              .map((u) => `  • ${u.file} — ${u.cause}`)
              .join("\n")}`
          : "";
      this.fail(
        connector,
        "NF_GENERATE_MISSING_ENTITY",
        `${missing.length} entité(s) enregistrée(s) ne sont fournies par aucun fichier lisible :\n${missing.join("\n")}${cause}`,
        "Rien n'a été écrit. Les migrations se produisent à partir des FICHIERS — l'outil qui les écrit est un process séparé, il ne voit pas les objets d'une application démarrée — et ces fichiers sont cherchés sous « nodefony/entity/ » dans l'application et dans chacun de ses modules. Une entité déclarée ailleurs, ou portée par un fichier qui ne s'importe pas seul, est invisible pour la génération : la migration serait écrite SANS sa table, et une migration ne se corrige pas — elle se remplace par une suivante, sur toutes les bases qui ont déjà reçu la première.",
        [action("nodefony inspect entities --json")],
        opts.json,
        EXIT.actionRequired,
      );
      return this;
    }

    // 4. Écrire ce que l'outil doit lire — dans un dossier de travail à nous.
    const work = path.join(
      root,
      "node_modules",
      ".cache",
      "nodefony",
      "orm-generate",
    );
    const schemaFile = path.join(work, `schema.${dialect}.ts`);
    const configFile = path.join(work, `drizzle.${dialect}.config.ts`);
    const before = await this.#tags(outDir);

    // 🔴 Le schéma INITIAL ne s'écrit pas sur une base qui porte déjà ces tables.
    //
    // Le générateur compare le code au journal des FICHIERS, jamais à la base.
    // Journal vide, il croit partir de rien et émet un `CREATE TABLE` complet —
    // d'une table qui existe, avec ses données. C'est l'état d'une application
    // passée du mode dérivé, où le démarrage fabrique le schéma, au mode de
    // production, où il ne le fabrique plus.
    //
    // Le fichier serait inapplicable, et il empoisonnerait la suite : l'adoption
    // l'inscrirait comme appliqué, l'historique affirmerait un schéma que la
    // base n'a pas, et plus aucune commande n'offrirait de geste. Mesuré au banc
    // de découvrabilité : le seul chemin restant était de détruire la base.
    //
    // Le contrôle ne coûte qu'une requête par table, et il ne se déclenche que
    // tant qu'AUCUNE migration existante ne décrit ces tables. Une base muette
    // ne déclenche rien : on ne refuse pas sans preuve.
    //
    // 🔴 Le critère porte sur ce que les migrations DÉCRIVENT, pas sur un
    // journal vide. Écrit « journal vide », il suffisait d'une migration LIBRE
    // — une vue, un déclencheur, l'usage même de `--custom` — pour désarmer la
    // garde définitivement : la génération suivante repartait de rien et
    // émettait le `CREATE TABLE` de tables existantes, l'application échouait
    // sur « table already exists », et l'adoption était désormais refusée
    // puisque le dossier n'était plus vide. La garde qui ferme ce trou ne
    // devait pas tenir à un fil qu'un usage documenté coupe.
    const decrites = new Set(
      createdTables(
        (
          await loadSources(
            // `loadSources` ajoute lui-même le sous-dossier du dialecte : on
            // lui donne le dossier PARENT, celui de l'application.
            [{ name: APP_SOURCE, dir: path.dirname(outDir), rank: 1 }],
            dialect,
          )
        ).files,
      ),
    );
    if (!tables.some((t) => decrites.has(t.tableName))) {
      const refus = await this.#alreadyInDatabase(
        opts,
        connector,
        name,
        tables,
        database,
      );
      if (refus !== null) {
        return refus;
      }
    }

    try {
      await writeSchemaModule(schemaFile, tables);
      await writeKitConfig({
        file: configFile,
        projectRoot: root,
        schemaFile,
        outDir,
        dialect,
        // La table d'historique n'appartient à AUCUN schéma déclaré : c'est
        // l'applicateur qui la crée. Sans cette exclusion, le premier diff
        // proposerait de la supprimer — et emporterait la trace de tout ce qui
        // a déjà été appliqué.
        excludedTables: [...framework, HISTORY_TABLE],
      });
      runGenerate({
        cwd: root,
        configRel: relative(configFile),
        name,
        label: `le connecteur « ${connector} » (${dialect})`,
        regenerateCommand: `nodefony orm:generate --name ${name}`,
      });
    } finally {
      // Le dossier de travail ne survit à RIEN : ni au succès, ni à l'échec.
      // Un module temporaire laissé derrière serait relu par le prochain outil
      // qui balaie les sources, et personne ne saurait d'où il sort.
      await fs.rm(work, { recursive: true, force: true });
    }

    // 5. La PREUVE est dans le journal, jamais dans un message de l'outil.
    const after = await this.#tags(outDir);
    const added = after.filter((t) => !before.includes(t));
    if (added.length === 0) {
      // 🔴 « Rien à écrire » n'est pas « rien à faire ».
      //
      // Le générateur compare les entités aux FICHIERS de migration, jamais à
      // la base. Quand l'historique ment — une migration déclarée appliquée
      // dont le SQL n'a pas tourné —, cette phrase est FAUSSE et, pire, elle
      // ferme la dernière porte : `orm:migrate` n'a rien en attente,
      // `orm:migrate:status` rend 0, et le générateur affirme qu'il n'y a rien
      // à faire. Celui qui lit ces trois réponses conclut que l'outil ne peut
      // plus rien pour lui — et va chercher ailleurs, c'est-à-dire dans la
      // destruction de la base. Mesuré au banc de découvrabilité, tâche 33.
      //
      // Le produit SAIT pourtant voir cet écart : la même brique que le verdict
      // `divergent`, qui NOMME les tables et colonnes manquantes.
      const ecart = await gapAgainstDeclared(connector);
      if (ecart !== null) {
        this.fail(
          connector,
          "NF_GENERATE_DATABASE_BEHIND",
          `Rien à écrire, et pourtant la base ne porte pas le schéma déclaré : ${summarizeGap(ecart)}.`,
          "Les fichiers de migration décrivent déjà ce que le code déclare — il n'y a donc rien de " +
            "neuf à générer. Mais la base, elle, ne l'a pas reçu : son historique affirme des " +
            "migrations qu'elle n'a pas exécutées. C'est l'HISTORIQUE qu'il faut reprendre, pas le " +
            "schéma — et surtout pas la base, qu'il ne sert à rien de refaire. Le premier geste " +
            "MONTRE : le statut dit, source par source, ce que l'historique prétend appliqué. " +
            "Repère la ou les migrations qui décrivent ce qui manque ci-dessus, puis désinscris-les " +
            "NOMMÉMENT : elles seront rejouées au passage suivant. La base n'est pas touchée par " +
            "cette désinscription ; si une migration avait bien été appliquée, son rejeu échouera, " +
            "et c'est ce qu'on veut.",
          [
            action(
              `nodefony orm:migrate:status --connector ${connector} --json`,
            ),
            // 🔴 Le geste NOMME l'option qui sort de cet état. Il proposait
            // auparavant une réparation nue, qui ne sait lever que des
            // marqueurs d'ÉCHEC : sur un historique qui ment avec un succès,
            // elle répondait « rien à réparer », et l'on revenait au statut.
            // Trois messages vrais, aucun geste — la forme même de l'impasse
            // qui fait détruire une base.
            action(
              `nodefony orm:migrate:repair --connector ${connector} --forget app/<tag>`,
            ),
            action(`nodefony orm:migrate --connector ${connector}`),
          ],
          opts.json,
          EXIT.actionRequired,
        );
        return this;
      }
      return this.#emit(
        {
          formatVersion: MIGRATION_FORMAT_VERSION,
          connector,
          generated: false,
          tag: null,
          files: [],
          warnings: [],
          unreadable,
          otherDialect,
          driver: { kind: "sql", dialect, dir: relative(outDir) },
        },
        opts,
        "Le schéma n'a pas bougé : il n'y avait rien à écrire.",
      );
    }
    stampFormatMarker(outDir);

    // 6. Relire ce qui vient d'être écrit — un générateur de diff ne distingue
    //    pas une intention d'une différence.
    const destructive: IAuditRule[] = [];
    const warnings: IAuditRule[] = [];
    const written: string[] = [];
    for (const tag of added) {
      const file = path.join(outDir, `${tag}.sql`);
      written.push(relative(file));
      const audit = auditMigrationSql(await fs.readFile(file, "utf8"), dialect);
      destructive.push(...audit.destructive);
      warnings.push(...audit.blocking);
    }
    if (destructive.length > 0 && opts.allowDestructive !== true) {
      const liste = destructive
        .map((r) => `  • ${r.id} : ${r.what}\n    → ${r.todo}`)
        .join("\n");
      this.fail(
        connector,
        "NF_GENERATE_DESTRUCTIVE",
        `Cette migration DÉTRUIT des données :\n${liste}\n\nLes fichiers ont été écrits — les RELIRE avant toute décision :\n${written.map((f) => `  ${f}`).join("\n")}`,
        "Ils ne sont pas effacés : ce sont eux qu'il faut lire pour décider, et les supprimer priverait de la seule chose à regarder. C'est leur mise en service qui est refusée. S'il s'agit d'un renommage mal interprété, annuler ces fichiers avec l'outil de gestion de versions puis regénérer dans un terminal interactif, et répondre « renamed » : l'outil produit alors un RENAME, et les données suivent. Si la perte est ASSUMÉE, il n'y a rien à regénérer — les fichiers sont là : c'est l'application qui décide, et elle a sa propre garde.",
        // 🔴 Les gestes décrivent les DEUX issues réelles, et aucune ne
        // consiste à rejouer cette commande : les fichiers sont déjà écrits ET
        // inscrits au journal, donc une relance — même avec l'aveu — ne diffe
        // plus rien et répond « le schéma n'a pas bougé ». Le drapeau de cette
        // commande n'autorise que le run qui ÉCRIT ; c'est celui de
        // l'application qui met en service.
        [
          action(`git checkout -- ${relative(outDir)}`),
          action(`nodefony orm:migrate --connector ${connector} --dry-run`),
          action(`nodefony orm:migrate --connector ${connector}`),
        ],
        opts.json,
        EXIT.actionRequired,
        discovery,
      );
      return this;
    }
    return this.#emit(
      {
        formatVersion: MIGRATION_FORMAT_VERSION,
        connector,
        generated: true,
        tag: added[added.length - 1] as string,
        files: written,
        warnings,
        unreadable,
        otherDialect,
        driver: { kind: "sql", dialect, dir: relative(outDir) },
      },
      opts,
      `Migration ${added.join(", ")} écrite depuis ${tables.length} table(s).`,
    );
  }

  /**
   * Demande à la BASE lesquelles de ces tables elle porte déjà.
   *
   * Ouvre un pilote le temps du contrôle, et le referme quoi qu'il arrive : la
   * commande vit dans un processus court, mais une connexion laissée ouverte
   * retient un descripteur et, sur un serveur, une place dans le réservoir.
   *
   * Une base injoignable rend une liste VIDE, jamais une erreur : ce contrôle
   * existe pour éviter un refus infondé, il ne doit pas en créer un. Qui
   * travaille hors connexion garde le droit d'écrire sa migration.
   *
   * @param target - coordonnées de la base visée.
   * @param tables - tables que la migration créerait.
   * @returns celles que la base porte déjà, éventuellement aucune.
   */
  async #presentInDatabase(
    target: IMigrationTarget,
    tables: readonly string[],
  ): Promise<string[]> {
    let driver: IMigrationDriver | null = null;
    try {
      driver = await openMigrationDriver(target);
      return await tablesPresentIn(driver, tables);
    } catch {
      return [];
    } finally {
      if (driver !== null) {
        try {
          await driver.close();
        } catch {
          // Fermer est un geste de politesse : échouer ici ne change rien au
          // verdict, et le faire remonter masquerait la vraie réponse.
        }
      }
    }
  }

  /**
   * Refuse d'écrire le schéma initial sur une base qui porte déjà ces tables.
   *
   * @param opts - options reçues (porte le choix du format de sortie).
   * @param connector - connecteur visé.
   * @param name - nom demandé, cité dans le geste à rejouer après adoption.
   * @param tables - tables que l'application fournit pour ce dialecte.
   * @returns `this` si la commande a refusé, `null` s'il n'y a rien à redire.
   */
  async #alreadyInDatabase(
    opts: IGenerateOptions,
    connector: string,
    name: string,
    tables: readonly { tableName: string }[],
    target: IMigrationTarget,
  ): Promise<this | null> {
    // La base est INTERROGÉE, jamais déduite : c'est la seule source qui
    // connaisse les tables d'un module désactivé ou d'une entité absente du
    // registre — celles-là mêmes que la migration créerait. Une base muette ne
    // déclenche rien : on ne refuse pas sans preuve.
    const presentes = await this.#presentInDatabase(
      target,
      tables.map((t) => t.tableName),
    );
    if (presentes.length === 0) {
      return null;
    }
    // 🔴 Le second geste ne se propose que s'il PRODUIT quelque chose.
    //
    // La base porte-t-elle TOUTES les tables déclarées ? C'est un fait qu'on
    // constate — deux nombres déjà en main —, pas une origine qu'on devine.
    // La déduction « historique vide + tables conformes ⇒ le mode de
    // développement les a faites » serait fausse pour une production À JOUR,
    // c'est-à-dire pour l'utilisateur même que l'adoption existe pour servir.
    //
    // Quand la couverture est TOTALE, le code n'a pas bougé depuis que la base
    // a été faite : la génération d'après ne trouverait aucun écart et rendrait
    // « il n'y avait rien à écrire ». En réponse à « donne-moi ma première
    // migration », cette phrase ressemble à un échec — alors que la migration
    // existe, écrite par l'adoption. On ne nomme donc qu'elle.
    const adopter = action(
      `nodefony orm:migrate:baseline --from-database --connector ${connector}`,
    );
    const complet = presentes.length === tables.length;
    this.fail(
      connector,
      "NF_GENERATE_DATABASE_NOT_ADOPTED",
      complet
        ? `Rien n'a été écrit : aucune migration n'existe encore, et la base ` +
            `porte déjà TOUTES les tables déclarées (${presentes.join(", ")}).`
        : `Rien n'a été écrit : aucune migration n'existe encore, et la base porte ` +
            `déjà ${presentes.length} des ${tables.length} tables à créer (${presentes.join(", ")}).`,
      complet
        ? "Une première migration décrit la création du schéma. Écrite ici, " +
            "elle porterait un « CREATE TABLE » de tables qui existent, avec " +
            "leurs données : elle ne s'appliquerait jamais. Et comme la base " +
            "porte déjà tout ce que le code déclare, il n'y a AUCUN écart à " +
            "écrire. La commande ci-dessous lit le schéma SUR la base et en " +
            "fait votre première migration — rien n'est exécuté dessus, et " +
            "elle s'applique telle quelle sur une base vierge. Inutile de " +
            "regénérer ensuite : il n'y aurait rien de plus à écrire. La suite " +
            "redevient ordinaire — le champ que vous ajouterez produira un " +
            "« ALTER TABLE »."
        : "Une première migration décrit la création du schéma. Écrite ici, elle " +
            "porterait un « CREATE TABLE » de tables qui existent, avec leurs " +
            "données : elle ne s'appliquerait jamais, et l'adopter graverait dans " +
            "l'historique un schéma que la base n'a pas. Cette base doit d'abord " +
            "être ADOPTÉE — sa migration de référence se lit sur elle, pas sur le " +
            "code, et rien n'est exécuté dessus. La suite redevient ordinaire : le " +
            "champ ajouté produit alors un « ALTER TABLE ».",
      complet
        ? [adopter]
        : [
            adopter,
            action(
              `nodefony orm:generate --name ${name} --connector ${connector}`,
            ),
          ],
      opts.json,
      EXIT.actionRequired,
    );
    return this;
  }

  /**
   * Tags actuellement inscrits au journal d'un dossier de sortie.
   *
   * @param outDir - dossier `<migrations>/<dialecte>`.
   * @returns les tags, ou `[]` si rien n'a encore été généré.
   */
  async #tags(outDir: string): Promise<string[]> {
    const journal = await readJournal(outDir);
    return (journal?.entries ?? []).map((e) => e.tag);
  }

  /**
   * Écrit le rapport, en machine ou pour un humain.
   *
   * @returns `this`.
   */
  #emit(
    report: IGenerateReport,
    opts: IGenerateOptions,
    headline: string,
  ): this {
    const style = this.style;
    let human = `${style.green("✓")} ${headline}\n`;
    if (report.files.length > 0) {
      human += `\n${report.files.map((f) => `  + ${f}`).join("\n")}\n`;
    }
    if (report.otherDialect.length > 0) {
      human +=
        `\n${style.dim(`Écrites pour un autre moteur, donc hors de cette migration :`)}\n` +
        report.otherDialect
          .map((o) => `  • ${o.table} (${o.dialect}) — ${o.file}`)
          .join("\n") +
        "\n";
    }
    if (report.unreadable.length > 0) {
      human +=
        `\n${style.dim("Fichiers d'entités non lus (aucune entité enregistrée n'en dépend) :")}\n` +
        report.unreadable.map((u) => `  • ${u.file} — ${u.cause}`).join("\n") +
        "\n";
    }
    if (report.warnings.length > 0) {
      human +=
        `\n${style.bold("⚠️  À REGARDER avant d'appliquer")} ` +
        `(rien n'est détruit — mais l'application peut cesser de répondre le ` +
        `temps de l'opération, ou la migration ÉCHOUER si la table porte ` +
        `déjà des lignes) :\n` +
        report.warnings
          .map((r) => `  • ${r.id} : ${r.what}\n    → ${r.todo}`)
          .join("\n") +
        "\n";
    }
    if (report.generated) {
      human +=
        `\n${style.bold("À faire :")}\n` +
        `  ${style.dim("relire le fichier, puis")} ${style.green("nodefony orm:migrate")}\n`;
    }
    this.respond(report, human, EXIT.ok, opts.json);
    return this;
  }
}

export default OrmGenerate;
