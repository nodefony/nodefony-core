import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  DrizzleMigrator,
  HISTORY_TABLE,
  MigrationVerdictError,
  openMigrationDriver,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import {
  appendMigration,
  removeSource,
  writeMigration,
  writeSource,
} from "./migrator-fixtures";

/**
 * **Les RÉGLAGES des commandes de migration**, sur les trois dialectes.
 *
 * ## Pourquoi un banc à part
 *
 * Le banc voisin (`migrate-cli.e2e.test.ts`) prouve les CONTRATS de sortie sur
 * un boot réel : code de sortie, pureté du flux, dialecte servi. Il coûte
 * plusieurs secondes par cas, parce qu'il démarre un noyau complet.
 *
 * Ce que ce banc-ci prouve est d'une autre nature : **ce que chaque drapeau
 * change**. Un drapeau se mesure sur un couple — le refus SANS lui, le travail
 * AVEC lui — et il faut fabriquer l'état qui provoque le refus. Ces états
 * (fusion de branches, fichier disparu, marqueur d'échec, dérive d'empreinte)
 * se montent en écrivant des fichiers, pas en démarrant une application.
 *
 * ## Ce que ce banc a déjà trouvé
 *
 * Deux drapeaux n'étaient exercés par rien, et **les deux mentaient** :
 *
 * - `--up-to` sur un tag inconnu ne s'arrêtait nulle part et déclarait à niveau
 *   TOUT l'historique — une faute de frappe, et la base ne recevrait plus jamais
 *   les migrations qu'elle croit avoir ;
 * - `--source` sur un nom inconnu filtrait sur rien, ne touchait aucune ligne et
 *   rendait « rien à réparer », code 0.
 *
 * Les deux sont des faux positifs silencieux : l'exploitant croit avoir agi.
 *
 * ## Pourquoi les trois dialectes
 *
 * Un réglage est une règle de l'applicateur, donc théoriquement portable. Mais
 * ce qu'il pilote ne l'est pas : la table d'historique, le verrou, la casse des
 * identifiants et l'encodage du texte sont trois implémentations distinctes.
 * Un refus qui marche en sqlite et laisse passer en MySQL est un incident de
 * production, et il ne se voit nulle part ailleurs.
 *
 * GATE : sqlite toujours ; PostgreSQL sur `NF_PG_URL` ; MySQL sur `NF_MYSQL_URL`.
 */

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

/** Schéma PostgreSQL dédié — jamais `public`, où travaillent les autres suites. */
const SCHEMA_PG = "nf_migrate_reglages";

/** Tables que les fixtures de ce banc créent, à nettoyer entre deux cas. */
const TABLES = ["nf_widget", "nf_gadget", "nf_note"];

/** Table d'historique — lue à la SOURCE, jamais recopiée (elle a déjà changé). */
const HISTOIRE = HISTORY_TABLE;

/** Ce qu'une cible doit fournir pour être exercée. */
interface ICible {
  dialect: SqlDialect;
  label: string;
  actif: boolean;
  /** Ouvre une base VIERGE et rend de quoi la piloter puis la libérer. */
  neuve: () => Promise<{
    options: { url?: string; filename?: string };
    sql: (statements: string[]) => Promise<void>;
    lire: (query: string) => Promise<Record<string, unknown>[]>;
    liberer: () => Promise<void>;
  }>;
}

/**
 * Exécute des instructions sur une base, par le pilote de l'applicateur.
 *
 * @param dialect - dialecte visé.
 * @param cible - localisation de la base.
 * @param statements - instructions à exécuter, dans l'ordre.
 */
async function execSur(
  dialect: SqlDialect,
  cible: { url?: string; filename?: string },
  statements: string[],
): Promise<void> {
  const pilote = await openMigrationDriver({ dialect, ...cible });
  try {
    for (const statement of statements) {
      await pilote.exec(statement);
    }
  } finally {
    await pilote.close();
  }
}

/**
 * Lit des lignes sur une base, par le pilote de l'applicateur.
 *
 * @param dialect - dialecte visé.
 * @param cible - localisation de la base.
 * @param query - requête de lecture.
 * @returns les lignes rendues.
 */
async function lireSur(
  dialect: SqlDialect,
  cible: { url?: string; filename?: string },
  query: string,
): Promise<Record<string, unknown>[]> {
  const pilote = await openMigrationDriver({ dialect, ...cible });
  try {
    return await pilote.query<Record<string, unknown>>(query);
  } finally {
    await pilote.close();
  }
}

/**
 * URL PostgreSQL ancrée sur le schéma du banc.
 *
 * @param base - URL du serveur.
 * @returns l'URL, `options` compris.
 */
function urlSchema(base: string): string {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${SCHEMA_PG}`);
  return url.toString();
}

const CIBLES: ICible[] = [
  {
    dialect: "sqlite",
    label: "(sqlite)",
    actif: true,
    neuve: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-reglages-"));
      const options = { filename: path.join(dir, "banc.db") };
      return {
        options,
        sql: (s) => execSur("sqlite", options, s),
        lire: (q) => lireSur("sqlite", options, q),
        liberer: () => fs.rm(dir, { recursive: true, force: true }),
      };
    },
  },
  {
    dialect: "postgres",
    label: "(postgres)",
    actif: Boolean(PG_URL),
    neuve: async () => {
      const serveur = PG_URL as string;
      await execSur("postgres", { url: serveur }, [
        `DROP SCHEMA IF EXISTS ${SCHEMA_PG} CASCADE`,
        `CREATE SCHEMA ${SCHEMA_PG}`,
      ]);
      const options = { url: urlSchema(serveur) };
      return {
        options,
        sql: (s) => execSur("postgres", options, s),
        lire: (q) => lireSur("postgres", options, q),
        liberer: () =>
          execSur("postgres", { url: serveur }, [
            `DROP SCHEMA IF EXISTS ${SCHEMA_PG} CASCADE`,
          ]),
      };
    },
  },
  {
    dialect: "mysql",
    label: "(mysql)",
    actif: Boolean(MYSQL_URL),
    // Pas de schéma dédié : l'utilisateur du décor n'a pas le droit de créer
    // une base (`ERROR 1044`). L'isolation se fait par suppression des tables
    // que ce banc crée — la même règle, une autre implémentation, imposée par
    // ce que le serveur permet.
    neuve: async () => {
      const options = { url: MYSQL_URL as string };
      const vider = [
        "SET FOREIGN_KEY_CHECKS = 0",
        ...[...TABLES, HISTOIRE].map((t) => `DROP TABLE IF EXISTS \`${t}\``),
        "SET FOREIGN_KEY_CHECKS = 1",
      ];
      await execSur("mysql", options, vider);
      return {
        options,
        sql: (s) => execSur("mysql", options, s),
        lire: (q) => lireSur("mysql", options, q),
        liberer: () => execSur("mysql", options, vider),
      };
    },
  },
];

/**
 * Capture le verdict d'un appel qui doit être REFUSÉ.
 *
 * Un refus qui n'arrive pas est le pire résultat possible : le geste passe, et
 * personne ne le sait. On distingue donc « a jeté autre chose » de « n'a pas
 * jeté du tout ».
 *
 * @param corps - appel attendu en échec.
 * @returns le verdict structuré.
 */
async function refus(corps: () => Promise<unknown>): Promise<{
  code: string;
  message: string;
  facts: Record<string, unknown>;
  commande: string;
}> {
  let leve: unknown;
  try {
    await corps();
  } catch (e) {
    leve = e;
  }
  assert.ok(
    leve !== undefined,
    "l'appel a RÉUSSI alors qu'il devait être refusé",
  );
  assert.ok(
    leve instanceof MigrationVerdictError,
    `refus non structuré : ${String(leve)}`,
  );
  const verdict = leve.verdict;
  return {
    code: verdict.code,
    message: leve.message,
    facts: verdict.facts as Record<string, unknown>,
    commande: verdict.nextActions[0]?.command ?? "",
  };
}

/**
 * Contrat commun à TOUT refus de l'applicateur.
 *
 * Deux exigences, et elles se tiennent : une phrase qui dit le fait en
 * français, et une commande prête à copier. Un refus qui n'a que la première
 * laisse l'utilisateur deviner ; un refus qui n'a que la seconde le fait obéir
 * sans comprendre.
 *
 * @param verdict - verdict capturé.
 */
function assertRefusUtilisable(verdict: {
  message: string;
  commande: string;
}): void {
  assert.ok(
    verdict.message.length > 40,
    `refus trop laconique : « ${verdict.message} »`,
  );
  assert.doesNotMatch(
    verdict.message,
    /\b(error|failed|invalid|unknown|missing)\b/i,
    `refus non traduit : « ${verdict.message} »`,
  );
  assert.match(
    verdict.commande,
    /^nodefony /,
    `le geste proposé n'est pas une commande nodefony : « ${verdict.commande} »`,
  );
}

for (const cible of CIBLES) {
  const suite = cible.actif ? describe : describe.skip;

  suite(`Réglages des commandes de migration ${cible.label}`, () => {
    const { dialect } = cible;
    let base: Awaited<ReturnType<ICible["neuve"]>>;
    let racine: string;
    let sources: IMigrationSource[];

    /** Colonne texte du dialecte, pour les fixtures. */
    const TEXTE = dialect === "mysql" ? "varchar(191)" : "text";

    /**
     * Construit un applicateur sur la base du cas courant.
     *
     * @returns l'applicateur.
     */
    const migrator = (): DrizzleMigrator =>
      new DrizzleMigrator({
        connector: "banc",
        dialect,
        ...base.options,
        sources,
        lockTimeoutMs: 15_000,
      });

    /**
     * Retire une migration du DÉPÔT : son fichier ET son entrée de journal.
     *
     * C'est le geste réel derrière « le fichier a disparu » — on supprime une
     * migration du dépôt, journal compris, alors qu'une base l'a déjà reçue.
     * Retirer le seul `.sql` laisserait la source incohérente avec elle-même,
     * ce qui est un AUTRE cas (et un autre refus).
     *
     * @param source - source concernée.
     * @param tag - migration à retirer.
     */
    const retirerDuDepot = async (
      source: string,
      tag: string,
    ): Promise<void> => {
      const dir = path.join(racine, source, dialect);
      await fs.rm(path.join(dir, `${tag}.sql`));
      const journalPath = path.join(dir, "meta", "_journal.json");
      const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
        entries: { tag: string }[];
      };
      journal.entries = journal.entries.filter((e) => e.tag !== tag);
      await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
    };

    /**
     * Espace les rangs du journal d'une source, pour laisser un trou.
     *
     * Une fusion de branches insère une migration ENTRE deux rangs existants.
     * Les fixtures numérotent à la suite (0, 1, 2…) : sans trou, il n'y a
     * aucune place où intercaler, et le cas « hors séquence » ne peut pas être
     * fabriqué du tout.
     *
     * @param source - source dont le journal est renuméroté.
     */
    const espacerJournal = async (source: string): Promise<void> => {
      const journalPath = path.join(
        racine,
        source,
        dialect,
        "meta",
        "_journal.json",
      );
      const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
        entries: { idx: number }[];
      };
      journal.entries = journal.entries.map((entry, rang) => ({
        ...entry,
        idx: rang * 10,
      }));
      await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
    };

    beforeEach(async () => {
      base = await cible.neuve();
      racine = await fs.mkdtemp(path.join(os.tmpdir(), "nf-reglages-src-"));
      const framework = await writeSource(
        dialect,
        [
          {
            tag: "0000_init",
            statements: [
              `CREATE TABLE nf_widget (id ${TEXTE} PRIMARY KEY, label ${TEXTE})`,
            ],
          },
          {
            tag: "0002_gadget",
            statements: [`CREATE TABLE nf_gadget (id ${TEXTE} PRIMARY KEY)`],
          },
        ],
        path.join(racine, "framework"),
      );
      const app = await writeSource(
        dialect,
        [
          {
            tag: "0000_app_note",
            statements: [
              `CREATE TABLE nf_note (id ${TEXTE} PRIMARY KEY, corps ${TEXTE})`,
            ],
          },
        ],
        path.join(racine, "app"),
      );
      sources = [
        { name: "framework", dir: framework, rank: 0 },
        { name: "app", dir: app, rank: 100 },
      ];
    });

    afterEach(async () => {
      await base.liberer();
      await removeSource(racine);
    });

    describe("`--up-to` — le point d'arrêt de l'adoption", () => {
      it("s'arrête EXACTEMENT au tag demandé, et laisse le reste en attente", async () => {
        const adoptees = await migrator().baseline("0000_init");
        assert.deepEqual(
          adoptees.map((a) => a.tag),
          ["0000_init"],
        );
        const plan = await migrator().status();
        assert.deepEqual(
          plan.pending.map((f) => f.tag),
          ["0002_gadget", "0000_app_note"],
        );
      });

      it("omis, adopte TOUT — c'est le comportement documenté", async () => {
        const adoptees = await migrator().baseline();
        assert.equal(adoptees.length, 3);
        assert.equal((await migrator().status()).pending.length, 0);
      });

      it("🔴 un tag INCONNU est refusé — sans quoi l'adoption prend tout", async () => {
        // Le défaut que ce cas ferme : la boucle ne rencontrait jamais sa
        // condition d'arrêt et inscrivait l'historique entier. Déclarer à
        // niveau une migration jamais appliquée, c'est garantir qu'elle ne le
        // sera jamais — la base est cassée en silence, pour toujours.
        const verdict = await refus(() =>
          migrator().baseline("0009_ce_tag_nexiste_pas"),
        );
        assert.equal(verdict.code, "NF_MIGRATE_UNKNOWN_TAG");
        assertRefusUtilisable(verdict);
        assert.deepEqual(verdict.facts.known, [
          "0000_init",
          "0002_gadget",
          "0000_app_note",
        ]);

        // La preuve qui compte : RIEN n'a été inscrit.
        const plan = await migrator().status();
        assert.equal(plan.applied.length, 0);
        assert.equal(plan.pending.length, 3);
      });

      it("🔴 une CASSE qui diffère est refusée, et le refus le DIT", async () => {
        // Un tag se recopie depuis un tableau, un journal, une complétion de
        // terminal. La casse est la première chose qui se perd — et elle
        // produit exactement le même désastre qu'une faute de frappe.
        const verdict = await refus(() => migrator().baseline("0000_INIT"));
        assert.equal(verdict.code, "NF_MIGRATE_UNKNOWN_TAG");
        assert.equal(verdict.facts.caseMismatch, "0000_init");
        assert.match(verdict.message, /casse/i);
        assert.match(verdict.commande, /--up-to 0000_init$/);
        assert.equal((await migrator().status()).applied.length, 0);
      });

      it("rejouer l'adoption n'inscrit que ce qui manque", async () => {
        await migrator().baseline("0000_init");
        const seconde = await migrator().baseline();
        assert.deepEqual(
          seconde.map((a) => a.tag),
          ["0002_gadget", "0000_app_note"],
        );
      });
    });

    describe("`--source` — le filtre de la réparation", () => {
      /** Pose un marqueur d'échec sur une migration de chaque source. */
      const marquerEnEchec = async (): Promise<void> => {
        await migrator().baseline();
        const now = Date.now();
        for (const [source, tag] of [
          ["framework", "0000_init"],
          ["app", "0000_app_note"],
        ] as const) {
          await base.sql([
            `UPDATE ${HISTOIRE} SET success = ${dialect === "postgres" ? "false" : "0"} ` +
              `WHERE source = '${source}' AND tag = '${tag}'`,
          ]);
        }
        void now;
      };

      it("🔴 une source INCONNUE est refusée — sans quoi « rien à réparer » ment", async () => {
        // Le défaut que ce cas ferme : le filtre partait en SQL sur un nom
        // inexistant. Zéro ligne touchée, code 0, « rien à réparer » — et le
        // marqueur d'échec toujours en place.
        const verdict = await refus(() =>
          migrator().repair({ source: "modules" }),
        );
        assert.equal(verdict.code, "NF_MIGRATE_UNKNOWN_SOURCE");
        assertRefusUtilisable(verdict);
        assert.deepEqual(verdict.facts.known, ["framework", "app"]);
      });

      it("🔴 une CASSE qui diffère est refusée, et le refus le DIT", async () => {
        const verdict = await refus(() =>
          migrator().repair({ source: "Framework" }),
        );
        assert.equal(verdict.code, "NF_MIGRATE_UNKNOWN_SOURCE");
        assert.equal(verdict.facts.caseMismatch, "framework");
        assert.match(verdict.message, /casse/i);
        assert.match(verdict.commande, /--source framework$/);
      });

      it("une source valide ne lève QUE ses propres marqueurs", async () => {
        await marquerEnEchec();
        assert.equal((await migrator().status()).failed.length, 2);

        const fait = await migrator().repair({ source: "app" });
        assert.deepEqual(
          fait.cleared.map((c) => `${c.source}/${c.tag}`),
          ["app/0000_app_note"],
        );
        const restants = (await migrator().status()).failed;
        assert.deepEqual(
          restants.map((f) => f.source),
          ["framework"],
        );
      });

      it("omise, la réparation lève les marqueurs de TOUTES les sources", async () => {
        await marquerEnEchec();
        const fait = await migrator().repair();
        assert.equal(fait.cleared.length, 2);
        assert.equal((await migrator().status()).failed.length, 0);
      });
    });

    describe("`--out-of-order` — la trace d'une fusion de branches", () => {
      it("refuse par défaut, en nommant le geste qui assume", async () => {
        await espacerJournal("framework");
        await migrator().migrate();
        // Une branche fusionnée insère une migration ANTÉRIEURE à la dernière
        // appliquée de sa source : c'est le cas réel, et il est ambigu.
        await appendMigration(
          path.join(racine, "framework"),
          dialect,
          {
            tag: "0001_intercalee",
            statements: [`ALTER TABLE nf_widget ADD COLUMN note ${TEXTE}`],
          },
          5,
        );

        const verdict = await refus(() => migrator().migrate());
        assert.equal(verdict.code, "NF_MIGRATE_OUT_OF_ORDER");
        assertRefusUtilisable(verdict);
        assert.match(verdict.commande, /--out-of-order/);
        assert.equal(verdict.facts.lastApplied, "0002_gadget");
      });

      it("le drapeau posé, la migration s'applique VRAIMENT", async () => {
        await espacerJournal("framework");
        await migrator().migrate();
        await appendMigration(
          path.join(racine, "framework"),
          dialect,
          {
            tag: "0001_intercalee",
            statements: [`ALTER TABLE nf_widget ADD COLUMN note ${TEXTE}`],
          },
          5,
        );

        const run = await migrator().migrate({ outOfOrder: true });
        assert.deepEqual(
          run.applied.map((a) => a.tag),
          ["0001_intercalee"],
        );
        // La colonne existe : le drapeau n'a pas seulement fait taire le refus.
        await base.sql([
          `INSERT INTO nf_widget (id, label, note) VALUES ('a', 'b', 'c')`,
        ]);
      });
    });

    describe("`--ignore-missing` — un fichier qui a disparu", () => {
      it("refuse par défaut, en nommant le geste qui assume", async () => {
        await migrator().migrate();
        await retirerDuDepot("framework", "0002_gadget");

        const verdict = await refus(() => migrator().migrate());
        assert.equal(verdict.code, "NF_MIGRATE_MISSING_FILE");
        assertRefusUtilisable(verdict);
        assert.match(verdict.commande, /--ignore-missing/);
      });

      it("le drapeau posé, la passe reprend et applique la suite", async () => {
        await migrator().migrate();
        await retirerDuDepot("framework", "0002_gadget");
        await appendMigration(path.join(racine, "app"), dialect, {
          tag: "0001_app_suite",
          statements: [`ALTER TABLE nf_note ADD COLUMN vu ${TEXTE}`],
        });

        const run = await migrator().migrate({ ignoreMissing: true });
        assert.deepEqual(
          run.applied.map((a) => a.tag),
          ["0001_app_suite"],
        );
      });
    });

    describe("une source incohérente avec elle-même", () => {
      it("🔴 un fichier annoncé par le journal mais absent rend un VERDICT", async () => {
        // Cas réel : copie incomplète, fichier ignoré par le gestionnaire de
        // versions, paquet publié sans ses migrations. Sans ce refus, l'erreur
        // qui remonte est un `ENOENT` nu — sans connecteur, sans source, sans
        // geste — au beau milieu d'un déploiement.
        await fs.rm(path.join(racine, "framework", dialect, "0002_gadget.sql"));

        const verdict = await refus(() => migrator().status());
        assert.equal(verdict.code, "NF_MIGRATE_JOURNAL_MISMATCH");
        assert.match(verdict.message, /0002_gadget/);
        assert.match(verdict.message, /introuvable/i);
        assert.ok(
          verdict.commande.length > 0,
          "un refus doit toujours proposer un geste",
        );
      });

      it("rien n'a été appliqué quand une source est incohérente", async () => {
        await fs.rm(path.join(racine, "framework", dialect, "0002_gadget.sql"));
        await refus(() => migrator().migrate());
        // La table de la PREMIÈRE migration ne doit pas exister non plus :
        // l'applicateur valide la source ENTIÈRE avant d'écrire quoi que ce
        // soit. Appliquer « ce qu'on a pu lire » laisserait une base à moitié
        // migrée dont l'historique ne dit rien.
        await assert.rejects(async () => base.lire(`SELECT id FROM nf_widget`));
      });
    });

    describe("`--update-hashes` — assumer un fichier modifié après coup", () => {
      /** Modifie le SQL d'une migration DÉJÀ appliquée. */
      const deriver = async (): Promise<void> => {
        await migrator().migrate();
        await writeMigration(path.join(racine, "framework", dialect), {
          tag: "0000_init",
          statements: [
            `CREATE TABLE nf_widget (id ${TEXTE} PRIMARY KEY, label ${TEXTE})`,
            "SELECT 1",
          ],
        });
      };

      it("sans le drapeau, la dérive PERSISTE — réparer ne la couvre pas", async () => {
        await deriver();
        assert.equal((await migrator().status()).drifted.length, 1);

        const fait = await migrator().repair();
        assert.equal(fait.rehashed.length, 0);
        assert.equal(
          (await migrator().status()).drifted.length,
          1,
          "une réparation ordinaire ne doit JAMAIS effacer une dérive",
        );
      });

      it("le drapeau posé, l'empreinte est ré-alignée et la dérive s'éteint", async () => {
        await deriver();
        const fait = await migrator().repair({ updateHashes: true });
        assert.deepEqual(
          fait.rehashed.map((r) => `${r.source}/${r.tag}`),
          ["framework/0000_init"],
        );
        assert.equal((await migrator().status()).drifted.length, 0);
      });

      it("la dérive est refusée à l'application, avec le geste exact", async () => {
        await deriver();
        await appendMigration(path.join(racine, "app"), dialect, {
          tag: "0001_app_suite",
          statements: [`ALTER TABLE nf_note ADD COLUMN vu ${TEXTE}`],
        });

        const verdict = await refus(() => migrator().migrate());
        assert.equal(verdict.code, "NF_MIGRATE_HASH_MISMATCH");
        assertRefusUtilisable(verdict);
        assert.match(verdict.commande, /--update-hashes/);
      });
    });

    describe("`--dry-run` — voir sans écrire", () => {
      it("ne rend AUCUNE migration appliquée, et ne touche ni base ni historique", async () => {
        // Le contrat est explicite : un essai à blanc n'applique rien, donc
        // `applied` est vide. Le détail de ce qui SERAIT fait se lit dans le
        // plan (`status`), pas dans le retour — un seul producteur d'état.
        const run = await migrator().migrate({ dryRun: true });
        assert.deepEqual(run.applied, []);
        const plan = await migrator().status();
        assert.equal(
          plan.applied.length,
          0,
          "un essai à blanc ne doit rien inscrire",
        );
        assert.equal(plan.pending.length, 3);
      });
    });

    describe("ce que le texte devient en traversant la chaîne", () => {
      it("🔴 accents, idéogrammes et emoji ressortent IDENTIQUES", async () => {
        // Le texte traverse : fichier UTF-8 → lecture → découpe → pilote →
        // encodage de la connexion → colonne. Un seul maillon en latin-1 ou en
        // `utf8` trois octets (MySQL) et l'emoji revient tronqué, ou l'insertion
        // échoue. C'est la vérification qu'aucun test de chaîne ASCII ne fait.
        const texte = "héros · 日本語 · Ω · 🚀";
        await appendMigration(path.join(racine, "app"), dialect, {
          tag: "0001_app_texte",
          statements: [
            `INSERT INTO nf_note (id, corps) VALUES ('utf8', '${texte}')`,
          ],
        });
        await migrator().migrate();

        const lignes = await base.lire(
          `SELECT corps FROM nf_note WHERE id = 'utf8'`,
        );
        assert.equal(lignes[0]?.corps, texte);
      });

      it("🔴 une ligne à deux tirets DANS une chaîne reste de la donnée", async () => {
        // Le découpage retire les lignes de commentaire. Une donnée multi-ligne
        // qui en porte une ne doit pas être amputée en silence — c'est le seul
        // défaut de cette famille qui ne lève aucune erreur.
        const corps = "premiere\n-- pas un commentaire\nderniere";
        await appendMigration(path.join(racine, "app"), dialect, {
          tag: "0001_app_tirets",
          statements: [
            `INSERT INTO nf_note (id, corps) VALUES ('tirets', '${corps}')`,
          ],
        });
        await migrator().migrate();

        const lignes = await base.lire(
          `SELECT corps FROM nf_note WHERE id = 'tirets'`,
        );
        assert.equal(lignes[0]?.corps, corps);
      });

      it("un fichier écrit en CRLF s'applique et garde son empreinte", async () => {
        // Windows est un impératif produit : un checkout sous `core.autocrlf`
        // réécrit les `.sql`. L'empreinte doit survivre au voyage, sinon toute
        // l'équipe s'arrête sur une dérive que personne n'a provoquée.
        await appendMigration(path.join(racine, "app"), dialect, {
          tag: "0001_app_crlf",
          statements: [`ALTER TABLE nf_note ADD COLUMN vu ${TEXTE}`],
          crlf: true,
        });
        await migrator().migrate();
        assert.equal((await migrator().status()).drifted.length, 0);
      });
    });

    describe("le connecteur nommé dans les gestes proposés", () => {
      it("chaque refus propose une commande qui vise CE connecteur", async () => {
        // Un geste qui omet le connecteur envoie l'exploitant travailler sur le
        // connecteur par défaut — donc sur une autre base que celle qui refuse.
        await migrator().migrate();
        await retirerDuDepot("framework", "0002_gadget");
        const verdict = await refus(() => migrator().migrate());
        assert.match(verdict.commande, /--connector banc\b/);
      });
    });
  });
}
