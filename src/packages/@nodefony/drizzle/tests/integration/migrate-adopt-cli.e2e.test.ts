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
  ACTIF,
  ciblesPour,
  cli,
  citer,
  ROOT,
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
      const outDir = path.join(ROOT, "migrations", cible.dialect);

      /** Le dossier de sortie n'a JAMAIS le droit de survivre à un cas. */
      const netToyer = async (): Promise<void> => {
        await fs.rm(outDir, { recursive: true, force: true });
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
