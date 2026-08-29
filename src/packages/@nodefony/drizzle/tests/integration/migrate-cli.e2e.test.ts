import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ACTIF,
  ciblesPour,
  cli,
  citer,
  DECOR_MIGRATIONS,
  MIGRATIONS,
  assertDialecte,
  parse,
  surBaseNeuve,
} from "./migrate-cli-harness";

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
 * Le décor (lancement du CLI, base vierge par dialecte, garde de dialecte) vit
 * dans `migrate-cli-harness.ts` — il est partagé avec le banc des réglages.
 */

const suite = ACTIF ? describe : describe.skip;

/** Cibles de CE banc — son propre schéma PostgreSQL, jamais celui d'un voisin. */
const CIBLES = ciblesPour("nf_migrate_cli");

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

        // 🔴 Le verdict dit qu'il y a un écart ; la charge utile doit dire
        // LEQUEL. Sans cette clé, l'exploitant ouvre un client SQL et compare
        // table par table sur une base de production — pour une réponse que le
        // produit avait déjà calculée.
        const detail = doc.divergence as
          | {
              additive: { table: string; column: string }[];
              blocking: { table: string; column: string }[];
              missingTables: string[];
            }
          | undefined;
        assert.ok(detail, "`divergence` absente du verdict `divergent`");
        assert.ok(
          [...detail.additive, ...detail.blocking].some(
            (g) => g.table === "audit_event" && g.column === "metadata",
          ),
          `la colonne retirée n'est pas nommée : ${JSON.stringify(detail)}`,
        );
        assert.match(String(doc.summary), /audit_event\.metadata/);
        // Le détail est au premier niveau, dans le cœur NEUTRE : un second ORM
        // remplira la même structure, et un `jq` d'utilisateur ne doit pas
        // avoir gravé un chemin qui passe par le nom d'un pilote.
        assert.ok(
          !("divergence" in (doc.driver as Record<string, unknown>)),
          "le détail a fui sous `driver`",
        );
        // Hors développement, aucun geste ne peut être une commande qui refuse.
        const gestes = (doc.nextActions as { command: string }[]).map(
          (a) => a.command,
        );
        assert.ok(
          !gestes.some((c) => c.includes("orm:reset")),
          `« orm:reset » est refusée en production : ${gestes.join(" | ")}`,
        );
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
