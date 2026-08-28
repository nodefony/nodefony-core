import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  HISTORY_TABLE,
  openMigrationDriver,
} from "../../nodefony/src/migrator/index";

const run = promisify(execFile);

/**
 * Les commandes de migration, éprouvées sur un BOOT RÉEL, sur les TROIS dialectes.
 *
 * ## Pourquoi ce banc existe alors que tout est déjà testé unitairement
 *
 * Le corps d'un verbe ne casse jamais. Ce qui casse, c'est le MONTAGE : la
 * commande enregistrée ou non, la résolution du connecteur, la lecture de la
 * configuration, le code de sortie qui se perd entre le verbe et le processus,
 * le journal du démarrage qui se déverse dans un flux censé être pur. Rien de
 * tout cela n'est visible depuis un appel de fonction.
 *
 * Deux contrats partent chez l'utilisateur et ne se rattrapent pas :
 *
 * - **le code de sortie**, qui finit dans un `&&`, un travail de déploiement ou
 *   une passe d'intégration continue écrite par quelqu'un d'autre ;
 * - **la pureté du flux `--json`**, sans laquelle un `| jq` casse sur la
 *   première ligne de journal — et un agent conclut à une panne de la commande.
 *
 * ## Pourquoi les trois dialectes, et pas seulement sqlite
 *
 * Un banc sqlite prouve la RÈGLE, jamais le dialecte. Ce qui change d'un serveur
 * à l'autre sur ce chemin précis : la bascule de dialecte par l'infra déclarée
 * (`NF_DATABASE_URL`), le jeu de migrations livré qui n'est pas le même fichier,
 * le pilote chargé en différé, et le verrou d'applicateur — qui n'existe même pas
 * en sqlite. Une commande qui répond en sqlite et meurt sur PostgreSQL est un
 * incident de production complet, et il ne se voit nulle part ailleurs.
 *
 * 🔴 D'où l'assertion qui garde tout ce banc : **chaque cas vérifie que le
 * dialecte RÉELLEMENT servi est celui qu'il croit exercer** (`driver.dialect`).
 * Sans elle, un décor mal posé ferait retomber la commande sur sqlite et le banc
 * « PostgreSQL » serait vert sans avoir jamais parlé à PostgreSQL.
 *
 * ## Ce que ce banc coûte, et pourquoi il est fermé par défaut
 *
 * Chaque cas démarre un ou plusieurs kernels complets (quelques secondes
 * chacun). Il est donc derrière `NF_RUN_CLI_BOOT=1`, et le rapport de couverture
 * du dépôt le NOMME quand il n'a pas tourné — un saut silencieux ressemble trop
 * à un succès.
 *
 * ```bash
 * NF_RUN_CLI_BOOT=1 npx vitest run tests/integration/migrate-cli.e2e.test.ts
 * # avec les serveurs réels :
 * docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 * docker compose -f docker/docker-compose.yml --profile mariadb  up -d mariadb
 * NF_RUN_CLI_BOOT=1 \
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony \
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony \
 *   npx vitest run tests/integration/migrate-cli.e2e.test.ts
 * ```
 *
 * ⚠️ Exige un `npm run build` préalable : c'est le paquet BÂTI que le kernel
 * charge, pas les sources — mesurer les sources ici prouverait autre chose que
 * ce que l'utilisateur exécute.
 */

const ACTIF = process.env.NF_RUN_CLI_BOOT === "1";
const suite = ACTIF ? describe : describe.skip;

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

/**
 * Schéma PostgreSQL dédié à ce banc.
 *
 * Jamais `public` : les autres suites y travaillent, et un banc qui s'installe
 * dans un schéma partagé rend un verdict qui dépend de ses voisins. Ici c'est
 * plus fort encore — ce banc applique TOUT le jeu de migrations du framework,
 * donc il écraserait leurs tables.
 */
const SCHEMA_PG = "nf_migrate_cli";

/** Racine du dépôt — il est lui-même une application Nodefony. */
const ROOT = path.resolve(import.meta.dirname, "../../../../../..");

/** Dossier des migrations livrées par ce paquet. */
const MIGRATIONS = path.resolve(import.meta.dirname, "../../migrations");

/**
 * Le décor dans lequel les migrations veulent dire quelque chose.
 *
 * Deux variables, et chacune répare une confusion découverte en exécutant :
 *
 * - **`NODE_ENV=production`** donne le mode `none` : le démarrage ne fabrique
 *   plus le schéma. En développement (`auto`), c'est lui qui crée les tables,
 *   et `migrate` refuse alors à juste titre sur une base pourtant créée à
 *   l'instant — le refus est exact, mais il n'apprend rien sur les migrations.
 *   C'est aussi ce qui garantit que le rattrapage additif ne vient PAS reposer
 *   la colonne que le cas « divergent » retire à la main.
 * - **`NF_STORE=memory`** empêche l'application de démarrage de lire la base.
 *   Sans elle, l'application meurt au démarrage sur `no such table: User`
 *   AVANT que la commande ne s'exécute : sur une base pas encore migrée, le
 *   code applicatif qui provisionne l'annuaire tape une table qui n'existe pas
 *   encore. C'est un vrai trou de la chaîne — un exemplaire devrait attendre
 *   sa migration, pas mourir en boucle —, mais il vit dans le gabarit
 *   d'application (ticket #101), pas dans les commandes éprouvées ici.
 */
const DECOR_MIGRATIONS = {
  NODE_ENV: "production",
  NF_STORE: "memory",
} as const;

interface IRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Lance la ligne de commande et rend ce que le processus a VRAIMENT produit.
 *
 * Le code de sortie est lu sur le processus, jamais déduit d'une valeur de
 * retour : c'est précisément là que les codes se perdent.
 */
async function cli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<IRun> {
  try {
    const { stdout, stderr } = await run("npx", ["nodefony", ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : -1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/**
 * Extrait l'objet JSON d'une sortie standard.
 *
 * ⚠️ On ne « cherche pas la ligne qui ressemble à du JSON » : ce serait
 * accepter la pollution qu'on prétend interdire. La sortie standard entière
 * doit se parser — c'est ça, un flux pur.
 */
function parse(stdout: string): Record<string, unknown> {
  const brut = stdout.trim();
  // `npx` écrit ses propres avis quand il lance un binaire du projet ; ils
  // partent avant que le processus n'existe. On les retire par la GAUCHE, en
  // exigeant que tout ce qui suit la première accolade se parse d'un bloc.
  const debut = brut.indexOf("{");
  assert.notEqual(debut, -1, `aucun objet JSON dans la sortie :\n${brut}`);
  const objet = brut.slice(debut);
  return JSON.parse(objet) as Record<string, unknown>;
}

/**
 * Cite un identifiant SQL dans la grammaire du dialecte.
 *
 * @param dialect - dialecte cible.
 * @param nom - identifiant à citer.
 * @returns l'identifiant cité.
 */
function citer(dialect: SqlDialect, nom: string): string {
  return dialect === "mysql" ? `\`${nom}\`` : `"${nom}"`;
}

/**
 * Tables créées par les migrations livrées pour ce dialecte.
 *
 * **Dérivée de la SOURCE, jamais écrite à la main** : une liste figée serait
 * juste le jour où on l'écrit, puis muette à la migration suivante — et le banc
 * laisserait derrière lui des tables qui fausseraient son voisin, sans que rien
 * ne le signale.
 *
 * @param dialect - dialecte dont on lit le jeu de migrations.
 * @returns les noms de tables, sans doublon.
 */
async function tablesLivrees(dialect: SqlDialect): Promise<string[]> {
  const dir = path.join(MIGRATIONS, dialect);
  const fichiers = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql"));
  const noms = new Set<string>();
  for (const fichier of fichiers) {
    const sql = await fs.readFile(path.join(dir, fichier), "utf8");
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi,
    )) {
      noms.add(m[1] as string);
    }
  }
  return [...noms];
}

/** Une base vierge, prête à recevoir les migrations d'un cas. */
interface IBase {
  /** URL à poser dans `NF_DATABASE_URL`. */
  url: string;
  /** Exécute du DDL d'administration SUR cette base (l'`ALTER` fait à la main). */
  sql(statements: string[]): Promise<void>;
  /** Rend la base à son état d'avant — appelé quoi qu'il arrive. */
  liberer(): Promise<void>;
}

/** Un dialecte à exercer, et la façon de lui fournir une base vierge. */
interface ICible {
  dialect: SqlDialect;
  /**
   * Suffixe du `describe`.
   *
   * Parenthésé (`(postgres)`) parce que c'est la forme que le rapporteur de
   * gates du dépôt cherche pour prouver qu'un dialecte a bien été exercé.
   */
  label: string;
  actif: boolean;
  neuve(): Promise<IBase>;
}

/**
 * Ouvre un pilote d'administration sur une cible et y joue du DDL.
 *
 * @param cible - dialecte et coordonnées de connexion.
 * @param statements - DDL à exécuter dans l'ordre.
 */
async function execSur(
  cible: { dialect: SqlDialect; url?: string; filename?: string },
  statements: string[],
): Promise<void> {
  const pilote = await openMigrationDriver(cible);
  try {
    for (const statement of statements) {
      await pilote.exec(statement);
    }
  } finally {
    await pilote.close();
  }
}

/**
 * URL PostgreSQL ancrée sur le schéma du banc.
 *
 * @param base - URL du serveur.
 * @param schema - schéma à poser en `search_path`.
 * @returns l'URL, `options` compris.
 */
function urlSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

const CIBLES: ICible[] = [
  {
    dialect: "sqlite",
    label: "(sqlite)",
    actif: true,
    neuve: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrate-cli-"));
      const filename = path.join(dir, "banc.db");
      return {
        url: `sqlite:${filename}`,
        sql: (statements) =>
          execSur({ dialect: "sqlite", filename }, statements),
        liberer: () => fs.rm(dir, { recursive: true, force: true }),
      };
    },
  },
  {
    dialect: "postgres",
    label: "(postgres)",
    actif: Boolean(PG_URL),
    // Un schéma dédié, détruit et recréé : c'est une base parfaitement vierge
    // sans toucher à `public`, où travaillent les autres suites.
    neuve: async () => {
      const serveur = PG_URL as string;
      const recreer = [
        `DROP SCHEMA IF EXISTS ${SCHEMA_PG} CASCADE`,
        `CREATE SCHEMA ${SCHEMA_PG}`,
      ];
      await execSur({ dialect: "postgres", url: serveur }, recreer);
      const url = urlSchema(serveur, SCHEMA_PG);
      return {
        url,
        sql: (statements) => execSur({ dialect: "postgres", url }, statements),
        liberer: () =>
          execSur({ dialect: "postgres", url: serveur }, [
            `DROP SCHEMA IF EXISTS ${SCHEMA_PG} CASCADE`,
          ]),
      };
    },
  },
  {
    dialect: "mysql",
    label: "(mysql)",
    actif: Boolean(MYSQL_URL),
    // 🔴 Pas de schéma dédié ici, et ce n'est PAS un choix : l'utilisateur
    // applicatif du décor n'a pas le droit de créer une base (`ERROR 1044`,
    // constaté). L'isolation se fait donc par SUPPRESSION des tables que les
    // migrations livrées créent — la même règle, une autre implémentation,
    // imposée par ce que le serveur permet.
    neuve: async () => {
      const url = MYSQL_URL as string;
      const tables = [...(await tablesLivrees("mysql")), HISTORY_TABLE];
      const vider = [
        "SET FOREIGN_KEY_CHECKS = 0",
        ...tables.map((t) => `DROP TABLE IF EXISTS \`${t}\``),
        "SET FOREIGN_KEY_CHECKS = 1",
      ];
      await execSur({ dialect: "mysql", url }, vider);
      return {
        url,
        sql: (statements) => execSur({ dialect: "mysql", url }, statements),
        liberer: () => execSur({ dialect: "mysql", url }, vider),
      };
    },
  },
];

/**
 * Déroule un cas sur une base vierge, et la libère quoi qu'il arrive.
 *
 * @param cible - dialecte exercé.
 * @param corps - le cas, qui reçoit la base et l'environnement à passer au CLI.
 */
async function surBaseNeuve(
  cible: ICible,
  corps: (base: IBase, env: NodeJS.ProcessEnv) => Promise<void>,
): Promise<void> {
  const base = await cible.neuve();
  try {
    await corps(base, { ...DECOR_MIGRATIONS, NF_DATABASE_URL: base.url });
  } finally {
    await base.liberer();
  }
}

/**
 * Vérifie qu'une sortie décrit bien le dialecte que le cas croit exercer.
 *
 * 🔴 C'est la garde de tout ce banc : un décor mal posé fait retomber la
 * commande sur la base par défaut, et le cas « PostgreSQL » passerait sans avoir
 * jamais parlé à PostgreSQL.
 *
 * @param doc - charge utile `--json` d'une commande.
 * @param dialect - dialecte attendu.
 */
function assertDialecte(doc: Record<string, unknown>, dialect: SqlDialect) {
  const driver = doc.driver as Record<string, unknown> | undefined;
  assert.equal(
    driver?.dialect,
    dialect,
    `la commande a servi « ${String(driver?.dialect)} » au lieu de « ${dialect} » — décor non appliqué`,
  );
}

for (const cible of CIBLES) {
  const casDialecte = ACTIF && cible.actif ? describe : describe.skip;

  casDialecte(`orm:migrate* — boot réel ${cible.label}`, () => {
    it("`orm:migrate:status --json` : flux PUR, contrat de sortie, dialecte servi", async () => {
      await surBaseNeuve(cible, async (_base, env) => {
        const r = await cli(["orm:migrate:status", "--json"], env);

        // Le cas qui casse un `| jq` : une seule ligne de journal sur la sortie
        // standard suffit. Elle doit partir sur la sortie d'erreur, où elle
        // reste lisible sans polluer les données.
        const lignes = r.stdout
          .split("\n")
          .filter((l) => l.trim().length > 0 && !l.startsWith("npm "));
        assert.equal(
          lignes.length,
          1,
          `la sortie standard porte ${lignes.length} lignes au lieu d'une :\n${r.stdout}`,
        );

        const doc = parse(r.stdout);
        assert.equal(doc.formatVersion, 1);
        assert.equal(doc.connector, "default");
        assert.ok(
          [
            "up-to-date",
            "pending",
            "drift",
            "failed",
            "adopt",
            "divergent",
          ].includes(String(doc.verdict)),
          `verdict hors énumération gelée : ${String(doc.verdict)}`,
        );
        assert.ok([0, 1, 2].includes(r.code), `code hors grille : ${r.code}`);
        // Le code du processus est celui que la charge utile annonce : sans quoi
        // une passe d'intégration continue et un tableau de bord se
        // contrediraient.
        assert.equal(
          r.code,
          doc.exitCode,
          "le processus ne rend pas son propre verdict",
        );
        // Le spécifique du pilote reste sous `driver`.
        assert.ok(!("dialect" in doc), "`dialect` a fui au premier niveau");
        const driver = doc.driver as Record<string, unknown>;
        assert.equal(driver.kind, "sql");
        assertDialecte(doc, cible.dialect);
      });
    }, 180_000);

    it("sur une base NEUVE, migrate applique puis rend 0 et devient à jour", async () => {
      await surBaseNeuve(cible, async (_base, env) => {
        const avant = await cli(["orm:migrate:status", "--json"], env);
        const etatAvant = parse(avant.stdout);
        assertDialecte(etatAvant, cible.dialect);
        assert.equal(etatAvant.verdict, "pending");
        assert.equal(avant.code, 1, "une base en retard doit rendre 1");

        const applique = await cli(["orm:migrate", "--json"], env);
        assert.equal(applique.code, 0, applique.stderr.slice(-800));
        assert.equal(parse(applique.stdout).verdict, "up-to-date");

        // Idempotence : rejouer ne change rien et reste à 0.
        const rejoue = await cli(["orm:migrate", "--json"], env);
        assert.equal(rejoue.code, 0);
        assert.equal(parse(rejoue.stdout).verdict, "up-to-date");

        const apres = await cli(["orm:migrate:status", "--json"], env);
        assert.equal(apres.code, 0, "une base à jour doit rendre 0");
        const doc = parse(apres.stdout);
        const sources = doc.sources as { name: string; applied: number }[];
        const framework = sources.find((s) => s.name === "framework");
        assert.ok(
          framework && framework.applied > 0,
          "aucune migration du framework enregistrée",
        );
      });
    }, 300_000);

    it("`orm:migrate --dry-run` valide comme la vraie et n'écrit RIEN", async () => {
      await surBaseNeuve(cible, async (_base, env) => {
        const r = await cli(["orm:migrate", "--dry-run", "--json"], env);
        const doc = parse(r.stdout);
        assertDialecte(doc, cible.dialect);
        assert.equal(doc.dryRun, true);
        const statements = doc.statements as { sql: string[] }[];
        assert.ok(statements.length > 0, "aucun SQL montré par l'essai");
        assert.ok(
          statements.some((s) => s.sql.some((q) => /CREATE TABLE/i.test(q))),
          "l'essai n'affiche pas le SQL qui serait exécuté",
        );
        // 🔴 LA garantie : après un essai, la base n'a rien reçu.
        const apres = await cli(["orm:migrate:status", "--json"], env);
        const etat = parse(apres.stdout);
        assert.equal(
          etat.verdict,
          "pending",
          "l'essai a modifié la base — ce n'est plus un essai",
        );
        const sources = etat.sources as { applied: number }[];
        assert.ok(
          sources.every((s) => s.applied === 0),
          "des migrations ont été enregistrées par un essai",
        );
      });
    }, 240_000);
  });

  // ── Ce qui n'a de sens que face à un vrai serveur ────────────────────────
  const casServeur =
    ACTIF && cible.actif && cible.dialect !== "sqlite"
      ? describe
      : describe.skip;

  casServeur(`orm:migrate* — serveur réel ${cible.label}`, () => {
    it("🔴 verdict `divergent` : historique complet, rien en attente, et pourtant", async () => {
      // Le cas que la conception nomme comme la TROISIÈME source de vérité, et
      // qu'aucun outil de migration de l'écosystème ne rend en continu. On le
      // provoque comme il se produit en vrai : par un `ALTER` fait à la main sur
      // la base, hors de tout fichier de migration.
      await surBaseNeuve(cible, async (base, env) => {
        const applique = await cli(["orm:migrate", "--json"], env);
        assert.equal(applique.code, 0, applique.stderr.slice(-800));
        assert.equal(parse(applique.stdout).verdict, "up-to-date");

        await base.sql([
          `ALTER TABLE ${citer(cible.dialect, "audit_event")} ` +
            `DROP COLUMN ${citer(cible.dialect, "metadata")}`,
        ]);

        const apres = await cli(["orm:migrate:status", "--json"], env);
        const doc = parse(apres.stdout);
        assertDialecte(doc, cible.dialect);
        assert.equal(
          doc.verdict,
          "divergent",
          "une colonne retirée sous le code n'est pas vue comme une divergence",
        );
        // En observation (défaut), superviser ne fait pas tomber un déploiement.
        assert.equal(
          apres.code,
          0,
          "le mode d'observation ne doit pas changer le code de sortie",
        );
        assert.equal(apres.code, doc.exitCode);
      });
    }, 300_000);

    it("🔴 `NF_MIGRATE_DATABASE_URL` prime pour `orm:migrate` — et pour personne d'autre", async () => {
      // Le véhicule du moindre privilège : le compte qui migre n'est pas celui
      // qui sert le trafic. La preuve tient en une asymétrie — on pointe la
      // variable vers un serveur qui n'existe pas :
      //
      //  • si la commande la lit, elle échoue là où elle réussissait ;
      //  • si le DÉMARRAGE la lisait, l'application ne démarrerait pas du tout —
      //    or elle démarre, puisqu'on récupère un verdict structuré, puis un
      //    succès complet dès qu'on retire la variable.
      await surBaseNeuve(cible, async (_base, env) => {
        const impasse =
          cible.dialect === "postgres"
            ? "postgres://nodefony:nodefony-dev@127.0.0.1:1/nodefony"
            : "mysql://nodefony:nodefony-dev@127.0.0.1:1/nodefony";

        const detourne = await cli(["orm:migrate", "--json"], {
          ...env,
          NF_MIGRATE_DATABASE_URL: impasse,
        });
        assert.equal(
          detourne.code,
          2,
          `la variable n'a pas été suivie :\n${detourne.stdout}\n${detourne.stderr.slice(-600)}`,
        );
        const doc = parse(detourne.stdout);
        const error = (doc.error ?? {}) as Record<string, unknown>;
        assert.ok(
          typeof error.code === "string" && error.code.length > 0,
          "un échec de connexion doit rester un verdict structuré, pas un crash",
        );

        // Retirée, la même commande travaille : c'est bien ELLE qui détournait,
        // et le décor de l'application était intact pendant tout ce temps.
        const normal = await cli(["orm:migrate", "--json"], env);
        assert.equal(normal.code, 0, normal.stderr.slice(-800));
        assert.equal(parse(normal.stdout).verdict, "up-to-date");
      });
    }, 300_000);
  });
}

/**
 * Les contrats de commande qui ne dépendent d'aucun dialecte.
 *
 * Ils se jouent sur sqlite parce qu'ils portent sur le REFUS — la résolution du
 * connecteur, la garde d'environnement, la garde destructive — et qu'un refus
 * survient avant toute connexion. Les rejouer sur trois serveurs coûterait trois
 * boots pour la même assertion.
 */
suite("orm:migrate* — contrats de commande (sqlite)", () => {
  it("🔴 migre une base VIERGE en production — sans béquille, comme un exploitant", async () => {
    // LE contrat de la mise en production, et il était rompu : `orm:migrate`
    // boote un kernel complet ; sur une base pas encore migrée, le cycle
    // applicatif tape `User`, l'échec était FATAL en production, et la commande
    // mourait avant de s'exécuter. Pour migrer, il aurait fallu avoir migré.
    //
    // Les autres cas de ce fichier posent `NF_STORE=memory` pour contourner ce
    // trou (cf DECOR_MIGRATIONS) : celui-ci ne le pose PAS — c'est tout son
    // objet. Un exemplaire dont la mise en service est retenue reste vivant, ne
    // reçoit aucun trafic, et peut recevoir le geste qui lève la rétention.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-vierge-"));
    const base = path.join(dir, "vierge.db");
    const env = {
      NODE_ENV: "production",
      NF_DATABASE_URL: `sqlite:${base}`,
    };
    try {
      const applique = await cli(["orm:migrate", "--json"], env);
      assert.equal(
        applique.code,
        0,
        `la commande de migration est inatteignable sur une base vierge :\n${applique.stderr.slice(-1200)}`,
      );
      assert.equal(parse(applique.stdout).verdict, "up-to-date");

      // Et le geste suivant d'un exploitant passe : la rétention est LEVÉE, pas
      // seulement contournée.
      const compte = await cli(
        ["security:user:add", "banc", "--password", "secret"],
        env,
      );
      assert.equal(compte.code, 0, compte.stderr.slice(-800));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it("un connecteur inconnu s'arrête sur 2, en nommant ceux qui existent", async () => {
    const r = await cli([
      "orm:migrate:status",
      "--connector",
      "nawak",
      "--json",
    ]);
    assert.equal(r.code, 2);
    const doc = parse(r.stdout);
    const error = doc.error as Record<string, unknown>;
    assert.equal(error.code, "NF_MIGRATE_UNKNOWN_CONNECTOR");
    assert.match(String(error.summary), /nawak/);
    // Le geste suivant est toujours donné, y compris sur un arrêt.
    const actions = error.nextActions as { command: string }[];
    assert.ok(
      actions.length > 0,
      "un arrêt sans geste laisse l'utilisateur seul",
    );
  }, 120_000);

  it("🔴 `orm:reset` refuse hors développement — liste BLANCHE, pas liste noire", async () => {
    // `staging` n'est pas `production` : une garde écrite « si production »
    // laisserait passer celui-ci, et c'est exactement là que l'accident arrive.
    for (const env of ["production", "staging"]) {
      const r = await cli(["orm:reset", "--yes", "--json"], { NODE_ENV: env });
      assert.equal(
        r.code,
        2,
        `environnement « ${env} » : la garde n'a pas mordu`,
      );
      const error = (parse(r.stdout).error ?? {}) as Record<string, unknown>;
      assert.equal(error.code, "NF_MIGRATE_NOT_DEVELOPMENT", env);
    }
  }, 180_000);

  it("🔴 une migration qui SUPPRIME des données est refusée — et dit pourquoi", async () => {
    // Le garde qu'aucun applicateur de l'écosystème Node ne propose. Il ne
    // sauvegarde pas la base — aucun outil ne le fait, et le faire donnerait
    // une assurance qui n'existe pas — il empêche d'appliquer SANS SAVOIR.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-destr-"));
    const migrations = path.join(dir, "migrations");
    const base = path.join(dir, "d.db");
    await fs.mkdir(path.join(migrations, "sqlite", "meta"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(migrations, "sqlite", "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 0,
            version: "6",
            when: 1_700_000_000_000,
            tag: "0000_nettoyage",
            breakpoints: true,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(migrations, "sqlite", "0000_nettoyage.sql"),
      "-- nodefony:migration format=1\nALTER TABLE `User` DROP COLUMN `metadata`;\n",
    );
    const env = {
      ...DECOR_MIGRATIONS,
      NF_DATABASE_URL: `sqlite:${base}`,
      NF__DRIZZLE__MIGRATIONS__DIR: migrations,
    };
    try {
      const refus = await cli(["orm:migrate", "--json"], env);
      assert.equal(
        refus.code,
        1,
        "un refus destructif demande une décision humaine",
      );
      const error = (parse(refus.stdout).error ?? {}) as Record<
        string,
        unknown
      >;
      assert.equal(error.code, "NF_MIGRATE_DESTRUCTIVE");
      assert.match(String(error.summary), /SUPPRIMENT des données/);
      // Le geste exact est donné, jamais une allusion à une option à deviner.
      const actions = error.nextActions as { command: string }[];
      assert.ok(
        actions.some((a) => a.command.includes("--allow-destructive")),
        "le refus ne donne pas la commande qui l'assume",
      );
      assert.ok(
        actions.some((a) => a.command.includes("--dry-run")),
        "le refus ne propose pas de VOIR le SQL d'abord",
      );
      // 🔴 Et la base n'a rien reçu : ni la migration destructive, ni celles
      // qui la précèdent. Un refus qui aurait appliqué la moitié du lot serait
      // pire que pas de garde du tout.
      const apres = await cli(["orm:migrate:status", "--json"], env);
      const sources = parse(apres.stdout).sources as { applied: number }[];
      assert.ok(
        sources.every((s) => s.applied === 0),
        "des migrations ont été appliquées malgré le refus",
      );

      // Assumée explicitement, elle passe — le garde informe, il n'interdit pas.
      const assume = await cli(
        ["orm:migrate", "--allow-destructive", "--json"],
        env,
      );
      assert.equal(assume.code, 0, assume.stderr.slice(-600));
      // 🔴 Et le verdict n'est PAS « à jour » : la migration vient de retirer
      // une colonne que le code déclare toujours, donc la base s'écarte
      // vraiment de lui. Le code de sortie reste 0 : en observation (défaut),
      // superviser ne fait pas tomber un déploiement.
      assert.equal(parse(assume.stdout).verdict, "divergent");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
