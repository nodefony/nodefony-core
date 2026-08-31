import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  APP_SOURCE,
  HISTORY_TABLE,
  openMigrationDriver,
} from "../../nodefony/src/migrator/index";
import {
  ORPHAN_FIXTURE_ENTITY,
  ORPHAN_FIXTURE_TABLE,
} from "../../../../../modules/test/nodefony/entity/adoptFixture";
import {
  ACTIF,
  ciblesPour,
  cli,
  citer,
  dossierMigrations,
  assertDialecte,
  parse,
  surBaseNeuve,
} from "./migrate-cli-harness";

/**
 * Adopter une base déjà en place, par la LIGNE DE COMMANDE, sur un démarrage réel.
 *
 * ## Ce que ce banc ajoute à son voisin unitaire
 *
 * `migrate-adopt.test.ts` éprouve les briques — la lecture du schéma, la
 * décision de refus, le décommentage — en les appelant directement. Ce qu'il ne
 * peut pas voir, c'est le MONTAGE : la commande enregistrée, le connecteur
 * résolu, le registre des entités peuplé au démarrage, le dossier de sortie
 * résolu depuis la racine de l'application, le code de sortie rendu au
 * processus, et l'enchaînement des deux commandes qui se prescrivent l'une
 * l'autre. C'est exactement là qu'a vécu le défaut de #118 : deux commandes
 * exactes prises séparément, une impasse une fois mises bout à bout.
 *
 * ## Le décor, et pourquoi il a fallu l'inventer
 *
 * L'adoption ne lit QUE les tables de l'application : celles du framework ont
 * leurs propres migrations et sont exclues. Or le dépôt ne déclarait aucune
 * entité applicative — l'adoption n'avait donc rien à adopter, et la commande
 * ne pouvait pas être exercée sur un démarrage réel. Le module `test` fournit
 * cette table manquante, sous l'interrupteur `NF_ADOPT_FIXTURE` : elle
 * n'existe que le temps de ce banc, et n'apparaît dans aucune génération
 * lancée par ailleurs (cf `src/modules/test/nodefony/entity/adoptFixture.ts`).
 *
 * ## Le scénario, qui est celui d'une application vraie
 *
 * Une application a longtemps laissé le démarrage fabriquer son schéma. Elle
 * passe en production : le démarrage ne fabrique plus rien, la base porte ses
 * tables ET ses données, et le dossier des migrations est vide. Elle veut
 * ajouter un champ.
 *
 * ```bash
 * NF_RUN_CLI_BOOT=1 npx vitest run tests/integration/migrate-adopt-cli.e2e.test.ts
 * ```
 *
 * ⚠️ Exige un `npm run build` préalable : c'est le paquet BÂTI que le kernel
 * charge, et le module `test` doit porter la table du décor.
 */

/** Un nom propre à ce banc — les bases de serveur sont partagées. */
/** Nom de la table du framework que la variante « usurpe » prend. */
const USURPED_FRAMEWORK_TABLE = "idempotency_key";

const TABLE = "adopt_cli_article";

/** La ligne qu'aucune adoption n'a le droit de perdre. */
const TEMOIN = "article-cli-a-ne-pas-perdre";

const suite = ACTIF ? describe : describe.skip;

/** Cibles de CE banc — son propre schéma PostgreSQL, jamais celui d'un voisin. */
const CIBLES = ciblesPour("nf_adopt_cli");

suite("orm:migrate:baseline --from-database — boot réel", () => {
  for (const cible of CIBLES) {
    const casDialecte = cible.actif ? describe : describe.skip;

    casDialecte(`adopter une base en place ${cible.label}`, () => {
      /**
       * Dossier des migrations de l'APPLICATION pour ce dialecte.
       *
       * Le dépôt n'en a pas : c'est la commande qui le crée, et ce banc qui le
       * retire. Composé avec `path.join`, jamais écrit en littéral — une
       * assertion de chemin qui accepte « l'un ou l'autre séparateur » ne
       * prouve rien sous Windows.
       */
      const outDir = dossierMigrations(cible.dialect);

      /**
       * Le dossier de sortie n'a JAMAIS le droit de survivre à un cas.
       *
       * Son PARENT non plus quand il devient vide : « migrations/ » est créé
       * par la commande à la racine du dépôt, et n'en retirer que le
       * sous-dossier du dialecte y laissait une coquille vide après chaque
       * passage. Un décor de banc ne se dépose pas dans le dépôt, même vide —
       * il finit par se faire commiter, ou par faire douter de ce qu'on voit.
       * « rmdir » refuse un dossier non vide : c'est la garde, pas un « rm -r ».
       */
      const netToyer = async (): Promise<void> => {
        await fs.rm(outDir, { recursive: true, force: true });
        await fs.rmdir(path.dirname(outDir)).catch(() => undefined);
      };

      beforeEach(netToyer);
      afterEach(netToyer);

      /**
       * Ce serveur est-il MariaDB ?
       *
       * CONSTATÉ sur le serveur, jamais déduit du port : les deux moteurs
       * MySQL du dépôt partagent la même variable et se jouent en deux passes.
       * MariaDB écrit le type JSON en `longtext` assorti d'une contrainte que
       * l'outil de lecture de schéma ne sait pas lire — l'adoption y est
       * impossible, et le produit le NOMME. Le chemin nominal ne peut donc pas
       * être exercé ici ; il l'est sur MySQL Community, dans la passe dédiée.
       */
      let mariadb = false;

      beforeAll(async () => {
        if (cible.dialect !== "mysql") {
          return;
        }
        const base = await cible.neuve();
        try {
          const pilote = await openMigrationDriver({
            dialect: "mysql",
            url: base.url,
          });
          try {
            const lignes = await pilote.query<{ v: string }>(
              "SELECT VERSION() AS v",
            );
            mariadb = /mariadb/i.test(lignes[0]?.v ?? "");
          } finally {
            await pilote.close();
          }
        } finally {
          await base.liberer();
        }
      });

      /**
       * Tables que les migrations écrites par ce cas créeraient.
       *
       * DÉRIVÉE des fichiers, jamais écrite à la main : le dépôt déclare des
       * entités de démonstration dont la liste changera, et une liste figée
       * laisserait derrière elle des tables qui fausseraient le voisin — sans
       * que rien ne le signale. MySQL en a besoin : son décor n'a pas de
       * schéma à détruire, l'isolation s'y fait table par table.
       */
      const tablesEcrites = async (): Promise<string[]> => {
        const noms = new Set<string>();
        let fichiers: string[] = [];
        try {
          fichiers = (await fs.readdir(outDir)).filter((f) =>
            f.endsWith(".sql"),
          );
        } catch {
          return [];
        }
        for (const fichier of fichiers) {
          const sql = await fs.readFile(path.join(outDir, fichier), "utf8");
          for (const m of sql.matchAll(
            /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi,
          )) {
            noms.add(m[1] as string);
          }
        }
        return [...noms];
      };

      it("🔴 la base en place s'adopte, puis le champ ajouté produit un ALTER", async (ctx) => {
        if (mariadb) {
          // 🔴 `ctx.skip()`, JAMAIS un `return` : un cas qui se retourne au
          // milieu compte PASSÉ, et le rapporteur de couverture le prend pour
          // la preuve que le dialecte a été exercé. Le vert muet est
          // exactement ce qu'on cherche à ne plus produire.
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          // Le décor du banc porte la table de l'application : les DEUX
          // processus doivent la voir — celui qui démarre l'application, et
          // celui que l'outil de génération lance.
          const avecTable = { ...env, NF_ADOPT_FIXTURE: cible.dialect };
          const avecSlug = {
            ...env,
            NF_ADOPT_FIXTURE: `${cible.dialect}+slug`,
          };

          try {
            // ── 1. Le framework est migré, comme sur n'importe quel exemplaire.
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));
            assert.equal(parse(migre.stdout).verdict, "up-to-date");

            // Le décor part d'une base sans la table du banc. MySQL n'a pas de
            // schéma jetable : un cas interrompu la laisse derrière lui, et le
            // suivant refuserait — pour une raison JUSTE, sur un décor FAUX.
            await base.sql([
              `DROP TABLE IF EXISTS ${citer(cible.dialect, TABLE)}`,
            ]);

            // ── 2. On amène la base dans l'état d'une application qui a
            //       longtemps laissé le démarrage fabriquer son schéma. Le DDL
            //       est posé par le PRODUIT, jamais écrit à la main : une table
            //       transcrite à la main ne serait pas celle que le générateur
            //       compare ensuite, et le banc mesurerait sa propre
            //       transcription.
            const initiale = await cli(
              ["orm:generate", "--json", "--name", "heritage"],
              avecTable,
            );
            assert.equal(initiale.code, 0, diagnostic(initiale));
            const pose = await cli(["orm:migrate", "--json"], avecTable);
            assert.equal(pose.code, 0, diagnostic(pose));
            await base.sql([
              `INSERT INTO ${citer(cible.dialect, TABLE)} ` +
                `(${citer(cible.dialect, "id")}, ${citer(cible.dialect, "title")}) ` +
                `VALUES ('1', '${TEMOIN}')`,
            ]);

            // ── 3. L'HISTOIRE disparaît, les tables restent. C'est exactement
            //       l'état d'une base héritée : personne n'a jamais migré, et
            //       pourtant tout est là.
            await fs.rm(outDir, { recursive: true, force: true });
            await base.sql([
              `DELETE FROM ${citer(cible.dialect, HISTORY_TABLE)} ` +
                `WHERE ${citer(cible.dialect, "source")} = '${APP_SOURCE}'`,
            ]);

            // ── 4. Le trou de #118 : écrire le schéma initial ici produirait
            //       un « CREATE TABLE » inapplicable. La commande doit REFUSER,
            //       et son refus doit laisser un geste — c'est ce qui manquait.
            const refus = await cli(
              ["orm:generate", "--json", "--name", "initial"],
              avecTable,
            );
            const docRefus = parse(refus.stdout);
            const erreur = docRefus.error as
              | {
                  code: string;
                  summary: string;
                  nextActions: { command: string }[];
                }
              | undefined;
            assert.equal(
              erreur?.code,
              "NF_GENERATE_DATABASE_NOT_ADOPTED",
              `refus attendu : ${diagnostic(refus)}`,
            );
            assert.notEqual(
              refus.code,
              0,
              "un refus qui rend 0 se perd dans un `&&` de déploiement",
            );
            assert.equal(refus.code, docRefus.exitCode);
            assert.match(
              String(erreur?.summary),
              new RegExp(TABLE),
              "le refus doit NOMMER la table qui bloque",
            );
            // 🔴 Le geste proposé doit être ACCEPTÉ par la commande visée dans
            // l'état où l'on se trouve : c'est la vérification qui manquait le
            // jour où deux commandes se sont prescrites l'une l'autre en se
            // refusant.
            const gestes = (erreur?.nextActions ?? []).map((a) => a.command);
            assert.ok(
              gestes.some((c) => c.includes("orm:migrate:baseline")),
              `aucun geste vers l'adoption : ${gestes.join(" | ")}`,
            );
            assert.equal(
              await fs
                .readdir(outDir)
                .then((f) => f.length)
                .catch(() => 0),
              0,
              "un refus n'écrit RIEN",
            );

            // ── 5. L'adoption : la référence est LUE sur la base, et aucune
            //       instruction n'est exécutée dessus.
            const adopt = await cli(
              ["orm:migrate:baseline", "--from-database", "--json"],
              avecTable,
            );
            assert.equal(adopt.code, 0, diagnostic(adopt));
            const docAdopt = parse(adopt.stdout);
            assertDialecte(docAdopt, cible.dialect);

            const reference = path.join(outDir, "0000_base_existante.sql");
            const ecrit = await fs.readFile(reference, "utf8");
            assert.match(
              ecrit,
              new RegExp(`CREATE TABLE[\\s\\S]*${TABLE}`, "i"),
              "la référence doit décrire la table que la base porte",
            );
            assert.doesNotMatch(
              ecrit,
              /\/\*/,
              "un corps commenté ne recréerait rien sur un environnement neuf",
            );
            assert.equal(
              await fs
                .access(path.join(outDir, "schema.ts"))
                .then(() => true)
                .catch(() => false),
              false,
              "les modules TypeScript déposés par l'outil décrivent un schéma que personne ne maintiendrait",
            );

            // ── 6. Adopter ne touche pas aux données. Relu EN BASE, jamais
            //       déduit d'une valeur de retour.
            assert.deepEqual(
              await lireTemoin(base, cible.dialect),
              [TEMOIN],
              "l'adoption a perdu, dupliqué ou réécrit la donnée",
            );

            // ── 7. L'état redevient ordinaire : plus rien en attente.
            const apres = await cli(
              ["orm:migrate:status", "--json"],
              avecTable,
            );
            const docApres = parse(apres.stdout);
            assertDialecte(docApres, cible.dialect);
            assert.equal(
              docApres.verdict,
              "up-to-date",
              `après adoption l'état doit être à jour : ${diagnostic(apres)}`,
            );
            assert.equal(apres.code, 0);

            // ── 8. Adopter une seconde fois est REFUSÉ : deux références
            //       tirées de la base seraient deux récits du même schéma.
            const encore = await cli(
              ["orm:migrate:baseline", "--from-database", "--json"],
              avecTable,
            );
            const docEncore = parse(encore.stdout);
            assert.equal(
              (docEncore.error as { code?: string } | undefined)?.code,
              "NF_MIGRATE_BASELINE_NOT_EMPTY",
              `seconde adoption : ${diagnostic(encore)}`,
            );
            assert.notEqual(encore.code, 0);
            assert.equal(
              (await fs.readdir(outDir)).filter((f) => f.endsWith(".sql"))
                .length,
              1,
              "un refus n'écrit RIEN",
            );

            // ── 9. Le champ ajouté produit un ALTER — c'est LE critère de #118.
            const suivant = await cli(
              ["orm:generate", "--json", "--name", "add_slug"],
              avecSlug,
            );
            assert.equal(suivant.code, 0, diagnostic(suivant));
            const genere = await fs.readFile(
              path.join(outDir, "0001_add_slug.sql"),
              "utf8",
            );
            assert.match(
              genere,
              /ALTER TABLE[\s\S]*slug/i,
              "après adoption, le diff part de la BASE : le champ ajouté est un ALTER",
            );
            assert.doesNotMatch(
              genere,
              /CREATE TABLE/i,
              "c'est le trou de #118 : sans référence lue sur la base, le générateur repart de rien",
            );

            // ── 10. Et cette migration s'applique VRAIMENT sur la base en
            //        place — une migration qui ne s'applique pas est le défaut
            //        d'origine.
            const applique = await cli(["orm:migrate", "--json"], avecSlug);
            assert.equal(applique.code, 0, diagnostic(applique));
            assert.equal(parse(applique.stdout).verdict, "up-to-date");
            assert.deepEqual(
              await lireTemoin(base, cible.dialect),
              [TEMOIN],
              "la migration a perdu la donnée qu'elle devait préserver",
            );

            // ── 11. Et la sortie DIT comment vérifier que les données ont
            //        suivi. C'est l'instant exact où un agent du banc de
            //        découvrabilité a écrit « montrons-le en réinitialisant la
            //        base » : il venait de réussir, on lui demandait de
            //        prouver, et le produit ne lui offrait aucun moyen. En
            //        « --json » le conseil part sur la sortie d'ERREUR, libre
            //        par contrat — la sortie standard reste un flux pur.
            assert.match(
              applique.stderr,
              /ne repars pas d'une base\s+vide/,
              `la sortie de succès n'offre aucun moyen de vérifier : ${applique.stderr.slice(-600)}`,
            );
            assert.match(applique.stderr, /NF_MIGRATE_DATABASE_URL/);
            assert.doesNotMatch(
              applique.stderr,
              /orm:reset/,
              "un conseil de vérification ne nomme jamais le geste qui détruit",
            );
            // Le flux machine reste PUR : le conseil n'y entre pas.
            parse(applique.stdout);
          } finally {
            // MySQL n'a pas de schéma jetable : les tables applicatives que ce
            // cas vient de créer resteraient derrière lui, et le voisin
            // trouverait une base qu'il croit vierge. Le nettoyage a lieu même
            // quand le cas échoue — sinon un premier échec en contamine dix.
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      /**
       * Amène la base à l'état « héritée » : la table existe et porte le
       * témoin, un fichier de migration la décrit, et l'historique de
       * l'application est vide.
       *
       * Extrait parce que DEUX cas en ont besoin — la garde et son exemption —
       * et qu'un décor recopié diverge de son jumeau sans que rien ne le dise.
       *
       * @param base - la base neuve du dialecte courant.
       * @param avecTable - environnement déclarant la table SANS le champ ajouté.
       * @returns le tag de l'unique migration applicative écrite.
       */
      const baseHeritee = async (
        base: { sql: (q: string[]) => Promise<unknown> },
        avecTable: Record<string, string>,
      ): Promise<string> => {
        const migre = await cli(["orm:migrate", "--json"], avecTable);
        assert.equal(migre.code, 0, diagnostic(migre));
        await base.sql([`DROP TABLE IF EXISTS ${citer(cible.dialect, TABLE)}`]);
        const initiale = await cli(
          ["orm:generate", "--json", "--name", "heritage"],
          avecTable,
        );
        assert.equal(initiale.code, 0, diagnostic(initiale));
        const pose = await cli(["orm:migrate", "--json"], avecTable);
        assert.equal(pose.code, 0, diagnostic(pose));
        await base.sql([
          `INSERT INTO ${citer(cible.dialect, TABLE)} ` +
            `(${citer(cible.dialect, "id")}, ${citer(cible.dialect, "title")}) ` +
            `VALUES ('1', '${TEMOIN}')`,
        ]);
        // L'HISTOIRE disparaît, les tables restent : l'état d'une base héritée.
        await base.sql([
          `DELETE FROM ${citer(cible.dialect, HISTORY_TABLE)} ` +
            `WHERE ${citer(cible.dialect, "source")} = '${APP_SOURCE}'`,
        ]);
        const fichiers = (await fs.readdir(outDir)).filter((n) =>
          n.endsWith(".sql"),
        );
        assert.equal(fichiers.length, 1, `décor : ${fichiers.join(", ")}`);
        return (fichiers[0] as string).replace(/\.sql$/, "");
      };

      /**
       * Table du FRAMEWORK, retirée de la base pour fabriquer un écart réel.
       *
       * 🔴 Pourquoi pas la table du décor applicatif : elle est déclarée par le
       * module « test », qui porte `policy: "dev"`. Le décor de ce banc impose
       * `NODE_ENV=production` — le module n'est donc pas chargé, sa table
       * n'entre jamais au registre, et la comparaison au schéma déclaré ne peut
       * pas la voir. Mesuré : le statut rend `up-to-date` sur une base à qui
       * il manque une colonne. La garde était inexerçable par cette voie, et
       * l'écart devait venir d'une entité qu'un module OBLIGATOIRE déclare.
       *
       * Celle-ci ne sert qu'aux routes idempotentes : la retirer ne gêne aucun
       * démarrage.
       */
      const TABLE_FRAMEWORK = "idempotency_key";

      it("🔴 adopter une base qui NE SUIT PAS le schéma déclaré est REFUSÉ", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          try {
            // 1. La base reçoit tout ce que le framework déclare.
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));

            // 2. L'écart : une table déclarée que la base n'a plus. C'est
            //    exactement l'état d'une base qu'on croit à niveau et qui ne
            //    l'est pas — celui que l'adoption ne doit JAMAIS graver.
            await base.sql([
              `DROP TABLE IF EXISTS ${citer(cible.dialect, TABLE_FRAMEWORK)}`,
            ]);

            // 3. L'historique disparaît : il y a de nouveau quelque chose à
            //    adopter, et c'est là que la garde doit parler.
            await base.sql([
              `DELETE FROM ${citer(cible.dialect, HISTORY_TABLE)}`,
            ]);

            const refus = await cli(["orm:migrate:baseline", "--json"], env);
            const erreur = (parse(refus.stdout).error ?? {}) as {
              code?: string;
              nextActions?: { command: string }[];
            };
            assert.equal(
              erreur.code,
              "NF_MIGRATE_BASELINE_AMBIGUOUS",
              `le MONTAGE de la garde n'a pas mordu : ${diagnostic(refus)}`,
            );
            assert.notEqual(refus.code, 0, "un refus ne rend jamais 0");
            // Un refus laisse un GESTE, et celui-là est l'exemption même.
            assert.ok(
              (erreur.nextActions ?? []).some((a) =>
                a.command.includes("--up-to"),
              ),
              `aucun geste vers l'exemption : ${JSON.stringify(erreur.nextActions)}`,
            );
            // Et il n'a RIEN inscrit : c'est l'autre moitié du contrat.
            assert.equal(
              await lireHistoire(base, cible.dialect),
              0,
              "un refus d'adoption a tout de même écrit dans l'historique",
            );
          } finally {
            if (cible.dialect === "mysql") {
              await base
                .sql([
                  `DROP TABLE IF EXISTS ${citer("mysql", TABLE_FRAMEWORK)}`,
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("🔴 « --up-to » EXEMPTE de la garde — c'est un contrat, pas un trou", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          const avecTable = { ...env, NF_ADOPT_FIXTURE: cible.dialect };
          const avecSlug = {
            ...env,
            NF_ADOPT_FIXTURE: `${cible.dialect}+slug`,
          };
          try {
            const tag = await baseHeritee(base, avecTable);

            // MÊME décor divergent que le cas précédent — seule l'option
            // change. Borner l'adoption, c'est dire soi-même jusqu'où la base
            // suit : la garde se tait, et l'adoption a lieu.
            const adopte = await cli(
              ["orm:migrate:baseline", "--up-to", tag, "--json"],
              avecSlug,
            );
            assert.equal(adopte.code, 0, diagnostic(adopte));
            const doc = parse(adopte.stdout);
            assert.notEqual(
              (doc.error as { code?: string } | undefined)?.code,
              "NF_MIGRATE_BASELINE_AMBIGUOUS",
              "l'exemption ne tient plus : la garde mord malgré --up-to",
            );
            assert.deepEqual(
              (doc.adopted as { tag: string }[]).map((a) => a.tag),
              [tag],
              "l'adoption bornée n'a pas inscrit la migration nommée",
            );
            // Le témoin n'a pas bougé : adopter n'exécute aucun SQL.
            assert.deepEqual(await lireTemoin(base, cible.dialect), [TEMOIN]);
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("🔴 décrire une table du FRAMEWORK est refusé à la génération", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          // La découverte lit les FICHIERS, pas le registre : le décor est donc
          // visible même si son module n'est pas chargé — c'est ce qui rend ce
          // refus exerçable là où celui de l'adoption ne l'était pas.
          const usurpe = {
            ...env,
            NF_ADOPT_FIXTURE: `${cible.dialect}+usurpe`,
          };
          try {
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));

            const refus = await cli(
              ["orm:generate", "--json", "--name", "usurpation"],
              usurpe,
            );
            const erreur = (parse(refus.stdout).error ?? {}) as {
              code?: string;
              summary?: string;
            };
            assert.equal(
              erreur.code,
              "NF_GENERATE_FRAMEWORK_TABLE",
              `le MONTAGE du refus n'a pas mordu : ${diagnostic(refus)}`,
            );
            assert.notEqual(refus.code, 0, "un refus ne rend jamais 0");
            // Le refus NOMME la table et le fichier : sans eux, l'utilisateur
            // sait qu'il a tort et pas où.
            assert.match(
              String(erreur.summary),
              new RegExp(USURPED_FRAMEWORK_TABLE, "u"),
            );
            // Et il n'a RIEN écrit — un refus qui laisse un fichier derrière
            // lui fait appliquer le lendemain ce qu'il refusait la veille.
            const ecrits = await fs
              .readdir(outDir)
              .then((n) => n.filter((x) => x.endsWith(".sql")))
              .catch(() => [] as string[]);
            assert.deepEqual(ecrits, [], "un refus a tout de même écrit");
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("🔴 un refus destructif DIT ce que la découverte a vu", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          // Le décor reproduit DÉLIBÉRÉMENT l'accident : une migration décrit
          // la table de l'application, puis la découverte suivante ne la trouve
          // plus. L'outil de diff ne distingue pas « absente de la découverte »
          // de « supprimée du schéma » : il écrit un « drop table », et le refus
          // qui suit nomme la base — qui n'y est pour rien. Sans le relevé de la
          // découverte, la correction naturelle détruit des données pour un
          // défaut qui est dans le dossier d'entités.
          const avecTable = { ...env, NF_ADOPT_FIXTURE: cible.dialect };
          try {
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));

            const initiale = await cli(
              ["orm:generate", "--json", "--name", "heritage"],
              avecTable,
            );
            assert.equal(initiale.code, 0, diagnostic(initiale));

            // La MÊME commande, sans la consigne : le fichier d'entité
            // s'importe toujours, il n'exporte plus rien.
            const refus = await cli(
              ["orm:generate", "--json", "--name", "disparition"],
              env,
            );
            const erreur = (parse(refus.stdout).error ?? {}) as {
              code?: string;
              discovery?: {
                filesScanned?: number;
                tables?: string[];
                otherDialect?: unknown[];
                unreadable?: unknown[];
              };
            };
            assert.equal(
              erreur.code,
              "NF_GENERATE_DESTRUCTIVE",
              `le MONTAGE du décor n'a pas produit de destruction : ${diagnostic(refus)}`,
            );
            assert.notEqual(refus.code, 0, "un refus ne rend jamais 0");

            // 🔴 Le refus porte le relevé — c'est LUI qui désigne la vraie
            // cause. Un « drop table » sans ce bloc envoie chercher du côté de
            // la base.
            const vu = erreur.discovery;
            assert.ok(
              vu,
              `le refus destructif ne dit pas ce que la découverte a vu : ${diagnostic(refus)}`,
            );
            assert.ok(
              (vu.filesScanned ?? 0) > 0,
              "la découverte n'annonce aucun fichier examiné",
            );
            // Le relevé montre l'ABSENCE de la table que la migration décrit :
            // c'est exactement l'écart que l'outil de diff a pris pour une
            // suppression. Les autres entités de l'application y sont, et
            // c'est ce qui rend l'absence lisible.
            assert.ok(
              Array.isArray(vu.tables) && !vu.tables.includes(TABLE),
              `le relevé doit montrer que « ${TABLE} » a quitté la découverte : ${JSON.stringify(vu.tables)}`,
            );
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("🔴 une entité DÉCLARÉE que nul fichier ne fournit est refusée", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          // L'écart INVERSE de celui du cas précédent : là le fichier fournit
          // une table que le registre ignore, ici le registre déclare une
          // entité que nul fichier ne fournit. Il ne peut donc PAS venir de la
          // découverte — qui lit le disque, module chargé ou non : il faut que
          // l'application ait DÉMARRÉ avec le module qui l'inscrit. En
          // production ce module est écarté par sa politique, d'où la
          // dérogation du produit (`NF_WITH_DEV_MODULES`) — et non un module de
          // décor de plus, chargé pour toujours au démarrage du dépôt.
          const orphelin = {
            ...env,
            NF_ADOPT_FIXTURE: `${cible.dialect}+orphelin`,
            NF_WITH_DEV_MODULES: "1",
          };
          try {
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));

            const refus = await cli(
              ["orm:generate", "--json", "--name", "orpheline"],
              orphelin,
            );
            const erreur = (parse(refus.stdout).error ?? {}) as {
              code?: string;
              summary?: string;
            };
            assert.equal(
              erreur.code,
              "NF_GENERATE_MISSING_ENTITY",
              `le MONTAGE du refus n'a pas mordu : ${diagnostic(refus)}`,
            );
            assert.notEqual(refus.code, 0, "un refus ne rend jamais 0");
            // Le refus NOMME l'entité ET sa table : sans elles, on sait qu'il
            // manque un fichier, et pas lequel écrire.
            assert.match(
              String(erreur.summary),
              new RegExp(ORPHAN_FIXTURE_ENTITY, "u"),
              "le refus doit NOMMER l'entité sans fournisseur",
            );
            assert.match(
              String(erreur.summary),
              new RegExp(ORPHAN_FIXTURE_TABLE, "u"),
              "le refus doit NOMMER la table attendue",
            );
            // Et il n'a RIEN écrit : une migration amputée d'une table ne se
            // corrige pas, elle se remplace sur toutes les bases déjà servies.
            const ecrits = await fs
              .readdir(outDir)
              .then((n) => n.filter((x) => x.endsWith(".sql")))
              .catch(() => [] as string[]);
            assert.deepEqual(ecrits, [], "un refus a tout de même écrit");
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("le décor du registre reste INERTE sans sa variable", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          // Le module du décor est CHARGÉ — la dérogation seule, sans la
          // consigne qui dit quoi inscrire. C'est l'état dans lequel se trouve
          // quiconque lance une génération depuis ce dépôt, et il ne doit RIEN
          // en coûter : un décor qui s'inscrirait par défaut ferait refuser
          // toutes les générations, ou pire, entrerait dans l'une d'elles.
          const sansConsigne = { ...env, NF_WITH_DEV_MODULES: "1" };
          try {
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));

            const gen = await cli(
              ["orm:generate", "--json", "--name", "inerte"],
              sansConsigne,
            );
            const erreur = (parse(gen.stdout).error ?? {}) as {
              code?: string;
            };
            assert.notEqual(
              erreur.code,
              "NF_GENERATE_MISSING_ENTITY",
              `le décor s'est inscrit sans qu'on le lui demande : ${diagnostic(gen)}`,
            );
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("🔴 couverture TOTALE : le refus ne nomme QU'UN geste", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          const avecTable = { ...env, NF_ADOPT_FIXTURE: cible.dialect };
          try {
            // Le décor d'une application qui a laissé le démarrage fabriquer
            // son schéma : la base porte ses tables, et aucune migration
            // d'application n'existe. C'est l'état de quiconque a lancé une
            // seule commande en développement.
            await baseHeritee(base, avecTable);
            await fs.rm(outDir, { recursive: true, force: true });

            const refus = await cli(
              ["orm:generate", "--json", "--name", "premiere"],
              avecTable,
            );
            const erreur = (parse(refus.stdout).error ?? {}) as {
              code?: string;
              summary?: string;
              nextActions?: { command: string }[];
            };
            assert.equal(
              erreur.code,
              "NF_GENERATE_DATABASE_NOT_ADOPTED",
              `le refus attendu n'est pas venu : ${diagnostic(refus)}`,
            );
            assert.notEqual(refus.code, 0, "un refus ne rend jamais 0");
            // 🔴 LE point du ticket : un seul geste. Le second — regénérer —
            // ne produirait rien, et « il n'y avait rien à écrire » ressemble
            // à un échec quand on demandait sa première migration.
            assert.equal(
              erreur.nextActions?.length,
              1,
              `un seul geste attendu, reçu : ${JSON.stringify(erreur.nextActions)}`,
            );
            assert.match(
              String(erreur.nextActions?.[0]?.command),
              /orm:migrate:baseline/u,
              "le geste nommé doit être l'adoption",
            );

            // Et ce geste, à lui seul, DONNE la première migration.
            const adopte = await cli(
              ["orm:migrate:baseline", "--from-database", "--json"],
              avecTable,
            );
            assert.equal(adopte.code, 0, diagnostic(adopte));
            const ecrits = (await fs.readdir(outDir)).filter((n) =>
              n.endsWith(".sql"),
            );
            assert.equal(
              ecrits.length,
              1,
              `l'adoption devait écrire UNE migration : ${ecrits.join(", ")}`,
            );
            const sql = await fs.readFile(
              path.join(outDir, ecrits[0] as string),
              "utf8",
            );
            assert.match(
              sql,
              new RegExp(TABLE, "u"),
              "la migration de référence doit décrire la table de l'application",
            );

            // La preuve que le second geste n'avait rien à donner : joué
            // maintenant, il ne produit aucun fichier de plus.
            const apres = await cli(
              ["orm:generate", "--json", "--name", "premiere"],
              avecTable,
            );
            assert.equal(apres.code, 0, diagnostic(apres));
            assert.deepEqual(
              (await fs.readdir(outDir)).filter((n) => n.endsWith(".sql")),
              ecrits,
              "regénérer après l'adoption a écrit quelque chose — le second geste aurait donc eu un sens",
            );
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  `DROP TABLE IF EXISTS ${citer("mysql", TABLE)}`,
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("couverture PARTIELLE : le refus en propose toujours DEUX", async (ctx) => {
        if (mariadb) {
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          const avecTable = { ...env, NF_ADOPT_FIXTURE: cible.dialect };
          // Le cas SYMÉTRIQUE, et c'est lui qui rend le précédent probant :
          // une seconde table déclarée que la base ne porte pas. Il reste donc
          // un écart à écrire, et regénérer a un sens.
          const avecPaire = {
            ...env,
            NF_ADOPT_FIXTURE: `${cible.dialect}+paire`,
          };
          try {
            await baseHeritee(base, avecTable);
            await fs.rm(outDir, { recursive: true, force: true });

            const refus = await cli(
              ["orm:generate", "--json", "--name", "premiere"],
              avecPaire,
            );
            const erreur = (parse(refus.stdout).error ?? {}) as {
              code?: string;
              nextActions?: { command: string }[];
            };
            assert.equal(
              erreur.code,
              "NF_GENERATE_DATABASE_NOT_ADOPTED",
              `le refus attendu n'est pas venu : ${diagnostic(refus)}`,
            );
            assert.equal(
              erreur.nextActions?.length,
              2,
              `deux gestes attendus, reçu : ${JSON.stringify(erreur.nextActions)}`,
            );
          } finally {
            if (cible.dialect === "mysql") {
              const noms = await tablesEcrites();
              await base
                .sql([
                  "SET FOREIGN_KEY_CHECKS = 0",
                  ...noms.map(
                    (n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`,
                  ),
                  `DROP TABLE IF EXISTS ${citer("mysql", TABLE)}`,
                  "SET FOREIGN_KEY_CHECKS = 1",
                ])
                .catch(() => undefined);
            }
          }
        });
      }, 600_000);

      it("🔴 sur MariaDB, l'adoption est IMPOSSIBLE — et le refus le dit", async (ctx) => {
        if (cible.dialect !== "mysql" || !mariadb) {
          // L'inverse du cas précédent : ici, c'est AILLEURS qu'il n'y a rien
          // à prouver. Le dire en skip plutôt qu'en vert.
          ctx.skip();
          return;
        }
        await surBaseNeuve(cible, async (base, env) => {
          const avecTable = { ...env, NF_ADOPT_FIXTURE: cible.dialect };
          try {
            await base.sql([
              `DROP TABLE IF EXISTS ${citer(cible.dialect, TABLE)}`,
            ]);
            const migre = await cli(["orm:migrate", "--json"], env);
            assert.equal(migre.code, 0, diagnostic(migre));
            const initiale = await cli(
              ["orm:generate", "--json", "--name", "heritage"],
              avecTable,
            );
            assert.equal(initiale.code, 0, diagnostic(initiale));
            const pose = await cli(["orm:migrate", "--json"], avecTable);
            assert.equal(pose.code, 0, diagnostic(pose));
            await fs.rm(outDir, { recursive: true, force: true });
            await base.sql([
              `DELETE FROM ${citer(cible.dialect, HISTORY_TABLE)} ` +
                `WHERE ${citer(cible.dialect, "source")} = '${APP_SOURCE}'`,
            ]);

            const adopt = await cli(
              ["orm:migrate:baseline", "--from-database", "--json"],
              avecTable,
            );
            assert.notEqual(
              adopt.code,
              0,
              "une adoption impossible ne doit pas rendre le code du succès",
            );
            const erreur = (
              parse(adopt.stdout) as {
                error?: { summary?: string };
              }
            ).error;
            // 🔴 Le refus doit NOMMER la cause ET le repli. Une mort muette —
            // code non nul, sortie d'erreur vide, ce que l'outil produit seul —
            // enverrait chercher du côté des identifiants, là où il n'y a rien.
            assert.match(
              String(erreur?.summary),
              /MariaDB/u,
              "le refus doit nommer le SERVEUR constaté",
            );
            assert.match(
              String(erreur?.summary),
              /json_valid/u,
              "le refus doit nommer la cause technique, pas seulement échouer",
            );
            assert.match(
              String(erreur?.summary),
              /--custom/u,
              "un refus sans repli est une impasse : c'est ce qu'on interdit",
            );
            assert.equal(
              await fs
                .readdir(outDir)
                .then((f) => f.length)
                .catch(() => 0),
              0,
              "un refus n'écrit RIEN",
            );
          } finally {
            const noms = await tablesEcrites();
            await base
              .sql([
                "SET FOREIGN_KEY_CHECKS = 0",
                ...noms.map((n) => `DROP TABLE IF EXISTS ${citer("mysql", n)}`),
                `DROP TABLE IF EXISTS ${citer("mysql", TABLE)}`,
                "SET FOREIGN_KEY_CHECKS = 1",
              ])
              .catch(() => undefined);
          }
        });
      }, 600_000);
    });
  }
});

/**
 * Rend ce qu'une commande a VRAIMENT produit, sur ses deux flux.
 *
 * En `--json`, un refus part sur la sortie standard : ne montrer que la sortie
 * d'erreur laisse un message d'échec vide, et fait chercher la panne du mauvais
 * côté — c'est ce qui vient d'arriver.
 *
 * @param run - ce que le processus a rendu.
 * @returns un extrait des deux flux, prêt à entrer dans un message d'échec.
 */
function diagnostic(run: {
  code: number;
  stdout: string;
  stderr: string;
}): string {
  return (
    `code=${run.code}\n` +
    `stdout: ${run.stdout.slice(-1500)}\n` +
    `stderr: ${run.stderr.slice(-800)}`
  );
}

/**
 * Relit le témoin EN BASE.
 *
 * Un banc qui se contente de la valeur rendue par la commande prouve que la
 * commande est d'accord avec elle-même.
 *
 * @param base - la base du cas.
 * @param dialect - moteur exercé.
 * @returns les titres présents.
 */
/**
 * Combien d'entrées l'historique porte-t-il ?
 *
 * Un refus doit n'avoir RIEN inscrit, et c'est la moitié de son contrat :
 * l'autre moitié — le code rendu — se lit dans la charge utile. Une garde qui
 * refuserait APRÈS avoir écrit laisserait exactement l'état qu'elle existe pour
 * empêcher, et le code de sortie ne le dirait pas.
 *
 * @param base - la base à interroger.
 * @param dialect - son dialecte, pour citer les identifiants.
 * @returns le nombre de lignes inscrites, toutes sources confondues.
 */
async function lireHistoire(
  base: { url: string },
  dialect: SqlDialect,
): Promise<number> {
  const cible =
    dialect === "sqlite"
      ? { dialect, filename: base.url.replace(/^sqlite:/u, "") }
      : { dialect, url: base.url };
  const pilote = await openMigrationDriver(cible);
  try {
    const lignes = await pilote.query<{ tag: string }>(
      `SELECT ${citer(dialect, "tag")} FROM ${citer(dialect, HISTORY_TABLE)}`,
    );
    return lignes.length;
  } finally {
    await pilote.close();
  }
}

async function lireTemoin(
  base: { url: string },
  dialect: SqlDialect,
): Promise<string[]> {
  const cible =
    dialect === "sqlite"
      ? { dialect, filename: base.url.replace(/^sqlite:/u, "") }
      : { dialect, url: base.url };
  const pilote = await openMigrationDriver(cible);
  try {
    const lignes = await pilote.query<{ title: string }>(
      `SELECT ${citer(dialect, "title")} FROM ${citer(dialect, TABLE)}`,
    );
    return lignes.map((l) => l.title);
  } finally {
    await pilote.close();
  }
}
