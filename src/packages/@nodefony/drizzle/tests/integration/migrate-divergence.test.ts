import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DrizzleOrm } from "../../index";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  IDEMPOTENCY_ENTITY_NAME,
  registerIdempotencyEntities,
} from "../../nodefony/entity/idempotencyEntity";
import {
  DrizzleMigrator,
  describeDivergence,
  gapAgainstDeclared,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import { buildReport } from "../../nodefony/src/migrator/explain";
import { appendMigration, writeSource } from "./migrator-fixtures";

/**
 * Le verdict `divergent` — la TROISIÈME source.
 *
 * Un outil de migration croise deux choses : les fichiers et l'historique. Les
 * deux peuvent être parfaits — tout appliqué, rien en attente, aucune empreinte
 * modifiée — pendant que la base, elle, ne correspond plus au code. C'est le
 * cas de figure de cet incident-là : un `ALTER` passé à la main un soir
 * d'astreinte, un correctif d'urgence jamais reporté, deux environnements qui
 * ont divergé.
 *
 * Le banc le PROVOQUE au lieu de le simuler : la migration crée la table telle
 * qu'elle était, le code en déclare une de plus, et l'historique reste complet.
 */
const ORM = "banc-divergence";

/** La table telle que la migration l'a créée — sans la colonne `response`. */
const TABLE_D_EPOQUE =
  `CREATE TABLE "idempotency_key" (\n` +
  `  "key" text PRIMARY KEY NOT NULL,\n` +
  `  "fingerprint" text NOT NULL,\n` +
  `  "state" text NOT NULL,\n` +
  `  "expiresAt" integer NOT NULL\n` +
  `)`;

/**
 * La table CONFORME — celle que le code déclare aujourd'hui, `response`
 * comprise. Sert le contrôle négatif : sans elle, on ne saurait pas si la
 * brique répond « écart » à tout ce qu'on lui donne.
 */
const TABLE_ACTUELLE =
  `CREATE TABLE "idempotency_key" (\n` +
  `  "key" text PRIMARY KEY NOT NULL,\n` +
  `  "fingerprint" text NOT NULL,\n` +
  `  "state" text NOT NULL,\n` +
  `  "expiresAt" integer NOT NULL,\n` +
  `  "response" text\n` +
  `)`;

describe("Verdict divergent — l'historique est complet, la base est fausse", () => {
  let root: string;
  let dbFile: string;
  let sources: IMigrationSource[];
  let orm: DrizzleOrm | null = null;

  /**
   * Applique une source de migrations dont le SQL est donné, puis connecte un
   * ORM en lecture de schéma (jamais dérivé — c'est le mode d'exploitation).
   *
   * @param ddl - le `CREATE TABLE` que porte la migration.
   */
  const poser = async (ddl: string): Promise<void> => {
    const dir = await writeSource("sqlite", [
      { tag: "0000_init", statements: [ddl] },
    ]);
    sources = [{ name: "framework", dir, rank: 0 }];
    await new DrizzleMigrator({
      connector: ORM,
      dialect: "sqlite",
      filename: dbFile,
      sources,
    }).migrate();
    const instance = new DrizzleOrm(ORM, {
      filename: dbFile,
      deriveSchema: false,
    });
    registerIdempotencyEntities(ORM, "sqlite");
    await instance.connect();
    orm = instance;
  };

  /** Le plan de l'applicateur sur la base du banc. */
  const plan = (): Promise<Awaited<ReturnType<DrizzleMigrator["status"]>>> =>
    new DrizzleMigrator({
      connector: ORM,
      dialect: "sqlite",
      filename: dbFile,
      sources,
    }).status();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-divergence-"));
    dbFile = path.join(root, "banc.db");
  });

  afterEach(async () => {
    await orm?.disconnect();
    orm = null;
    entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
    ormRegistry.unregister(ORM);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("l'historique dit « à jour » — et la base a pourtant une colonne de moins", async () => {
    await poser(TABLE_D_EPOQUE);
    const etat = await plan();
    // Les deux premières sources sont formelles, et elles ont raison.
    assert.equal(etat.pending.length, 0, "rien n'est en attente");
    assert.equal(etat.drifted.length, 0, "aucune empreinte n'a bougé");
    assert.equal(etat.failed.length, 0, "aucun échec");

    const ecart = await describeDivergence(etat);
    assert.ok(
      ecart,
      "la troisième source doit voir ce que les deux autres ne peuvent pas voir",
    );
    const report = buildReport(etat, { ddl: "none", divergence: ecart });
    assert.equal(report.verdict, "divergent");
  });

  it("🔴 une TABLE d'entité ABSENTE retient, même en observation", async () => {
    // La graduation qui sépare deux situations que le verdict confondait.
    // Une colonne en écart peut venir d'une migration libre parfaitement
    // légitime ; une table d'entité absente, non — aucune main légitime ne la
    // fait disparaître. Elle veut dire que le schéma applicatif n'a jamais été
    // posé, et l'application rendra 500 sur chacune de ses routes.
    //
    // C'est le cas qui a ouvert le chantier : les tables du framework en place,
    // zéro table applicative, un pod qui se déclarait PRÊT.
    await poser(`CREATE TABLE "sans_rapport" ("id" text PRIMARY KEY NOT NULL)`);
    const etat = await plan();
    const ecart = await describeDivergence(etat);
    assert.ok(ecart, "la table déclarée est absente : il y a bien un écart");
    assert.deepEqual(
      ecart.missingTables,
      ["idempotency_key"],
      "l'écart doit NOMMER la table absente",
    );

    const observation = buildReport(etat, {
      ddl: "none",
      divergence: ecart,
      divergenceMode: "report",
    });
    assert.equal(
      observation.exitCode,
      1,
      "une table d'entité absente a laissé passer un déploiement",
    );
    // …et la phrase envoie chercher au bon endroit : la migration, pas un
    // collègue qui aurait touché à la base.
    assert.match(String(observation.summary), /jamais été générée/u);

    // …et le GESTE proposé est celui qui marche. Le générateur sait produire
    // une table que le code déclare ; envoyer écrire le SQL à la main
    // (`--custom`) ferait recopier ce que la commande d'à côté écrit seule.
    const gestes = observation.nextActions.map((a) => a.command);
    assert.ok(
      gestes.some((g) => /orm:generate(?!.*--custom)/u.test(g)),
      `le geste ne propose pas la génération : ${JSON.stringify(gestes)}`,
    );

    // `off` reste `off` : qui l'a écrit ne veut RIEN, pas « presque rien ».
    assert.equal(
      buildReport(etat, {
        ddl: "none",
        divergence: ecart,
        divergenceMode: "off",
      }).exitCode,
      0,
    );
  });

  it("superviser ne fait pas tomber un déploiement — le code de sortie reste 0", async () => {
    await poser(TABLE_D_EPOQUE);
    const etat = await plan();
    const ecart = await describeDivergence(etat);
    const observation = buildReport(etat, {
      ddl: "none",
      divergence: ecart,
      divergenceMode: "report",
    });
    assert.equal(
      observation.exitCode,
      0,
      "en observation (défaut), la divergence s'affiche et ne bloque rien : " +
        "une application qui écrit des migrations libres en a une en permanence",
    );
    const barriere = buildReport(etat, {
      ddl: "none",
      divergence: ecart,
      divergenceMode: "fail",
    });
    assert.equal(
      barriere.exitCode,
      1,
      'migrations.divergence: "fail" est le seul moyen d\'en faire une barrière',
    );
  });

  it("une base CONFORME ne déclenche rien — sinon le verdict serait du bruit", async () => {
    await poser(
      `CREATE TABLE "idempotency_key" (\n` +
        `  "key" text PRIMARY KEY NOT NULL,\n` +
        `  "fingerprint" text NOT NULL,\n` +
        `  "state" text NOT NULL,\n` +
        `  "response" text,\n` +
        `  "expiresAt" integer NOT NULL\n` +
        `)`,
    );
    const etat = await plan();
    assert.equal(await describeDivergence(etat), null);
    assert.equal(buildReport(etat, { ddl: "none" }).verdict, "up-to-date");
  });

  it("une colonne EN PLUS en base ne diverge pas — les migrations libres sont légitimes", async () => {
    await poser(
      `CREATE TABLE "idempotency_key" (\n` +
        `  "key" text PRIMARY KEY NOT NULL,\n` +
        `  "fingerprint" text NOT NULL,\n` +
        `  "state" text NOT NULL,\n` +
        `  "response" text,\n` +
        `  "expiresAt" integer NOT NULL,\n` +
        `  "colonne_d_une_migration_libre" text\n` +
        `)`,
    );
    assert.equal(await describeDivergence(await plan()), null);
  });

  it("le rapport NOMME ce qui manque — sinon il envoie ouvrir un client SQL", async () => {
    // Le verdict seul (« la base ne correspond pas au code ») fait comparer
    // table par table à la main, sur une base de production, au pire moment.
    // L'information EXISTE : elle était jetée à un pas de la sortie.
    await poser(TABLE_D_EPOQUE);
    const report = buildReport(await plan(), {
      ddl: "none",
      divergence: await describeDivergence(await plan()),
    });
    assert.equal(report.verdict, "divergent");
    assert.ok(report.divergence, "la clé du détail doit être publiée");
    assert.deepEqual(
      report.divergence.additive.map((g) => `${g.table}.${g.column}`),
      ["idempotency_key.response"],
      "la colonne manquante doit être nommée, et rangée comme rattrapable",
    );
    assert.deepEqual(report.divergence.blocking, []);
    assert.deepEqual(report.divergence.missingTables, []);
    // La phrase lisible en dit AU MOINS la première : un exploitant qui ne lit
    // pas de JSON doit savoir où regarder.
    assert.match(report.summary, /idempotency_key\.response/);
  });

  it("une TABLE entièrement absente est nommée comme telle", async () => {
    // Autre famille d'écart, autre rangement : ce n'est pas une colonne qui
    // manque, c'est la table. Les confondre ferait proposer un `ALTER` là où
    // il faut un `CREATE`.
    await poser(`CREATE TABLE "sans_rapport" ("x" text)`);
    const detail = await describeDivergence(await plan());
    assert.ok(detail);
    assert.deepEqual(detail.missingTables, ["idempotency_key"]);
    assert.deepEqual(detail.additive, []);
    const report = buildReport(await plan(), {
      ddl: "none",
      divergence: detail,
    });
    assert.match(report.summary, /table absente : « idempotency_key »/);
  });

  it("🔴 base CONFORME : la clé est ABSENTE, pas vide", async () => {
    // Le contrôle qui empêche ce banc de ne prouver que la présence d'un
    // champ. Publier un objet vide sur toute base saine apprendrait au
    // consommateur à le tester non-vide au lieu de le tester présent.
    await poser(
      `CREATE TABLE "idempotency_key" (\n` +
        `  "key" text PRIMARY KEY NOT NULL,\n` +
        `  "fingerprint" text NOT NULL,\n` +
        `  "state" text NOT NULL,\n` +
        `  "response" text,\n` +
        `  "expiresAt" integer NOT NULL\n` +
        `)`,
    );
    const report = buildReport(await plan(), {
      ddl: "none",
      divergence: await describeDivergence(await plan()),
    });
    assert.equal(report.verdict, "up-to-date");
    assert.equal(
      "divergence" in report,
      false,
      "sur une base à jour, il n'y a rien à nommer : la clé ne doit pas exister",
    );
  });

  it("🔴 le geste proposé ne peut pas être une commande que l'environnement REFUSE", async () => {
    // `orm:reset` efface, et n'est reçue qu'en développement (liste blanche).
    // La proposer ailleurs envoie taper une commande qui refuse — et détruit
    // la confiance dans toutes les autres actions rendues.
    await poser(TABLE_D_EPOQUE);
    const etat = await plan();
    const divergence = await describeDivergence(etat);

    const dehors = buildReport(etat, { ddl: "none", divergence });
    const dedans = buildReport(etat, {
      ddl: "none",
      divergence,
      canReset: true,
    });
    const cmds = (r: ReturnType<typeof buildReport>): string[] =>
      r.nextActions.map((a) => a.command);

    assert.ok(
      !cmds(dehors).some((c) => c.includes("orm:reset")),
      `hors développement, aucun geste ne doit être « orm:reset » : ${cmds(dehors).join(" | ")}`,
    );
    assert.ok(
      cmds(dehors).some((c) => c.includes("orm:generate")),
      "il faut dire ce qu'on fait À LA PLACE : écrire la migration correctrice",
    );
    assert.ok(
      cmds(dedans).some((c) => c.includes("orm:reset")),
      "en développement, repartir de zéro reste le geste le plus court",
    );
  });

  it("la divergence ne se calcule PAS quand une migration est en attente", async () => {
    await poser(TABLE_D_EPOQUE);
    // Une seconde migration jamais appliquée : le verdict est déjà décidé, et
    // interroger la base n'apprendrait rien tout en coûtant une requête par
    // table. Le calcul doit s'abstenir.
    const dir = await writeSource(
      "sqlite",
      [
        { tag: "0000_init", statements: [TABLE_D_EPOQUE] },
        {
          tag: "0001_suite",
          statements: [`CREATE TABLE "plus_tard" ("x" text)`],
        },
      ],
      path.join(root, "sources-2"),
    );
    sources = [{ name: "framework", dir, rank: 0 }];
    const etat = await plan();
    assert.equal(etat.pending.length, 1, "une migration attend");
    assert.equal(
      await describeDivergence(etat),
      null,
      "tant qu'un geste est déjà dû, la troisième source ne se paie pas",
    );
  });

  /*
   *   #114 — ce que l'ADOPTION doit refuser.
   *
   *   `orm:migrate:baseline` affirme « la base est à l'état que décrivent ces
   *   migrations ». L'affirmation n'était jamais vérifiée : la boucle inscrivait
   *   tout fichier absent de l'historique, y compris une migration écrite une
   *   minute plus tôt et jamais exécutée. L'historique disait alors « tout est
   *   appliqué » sur une base qui n'avait pas la colonne — et plus aucune
   *   commande n'offrait de geste. Mesuré au banc de découvrabilité : le seul
   *   chemin restant était de détruire la base.
   *
   *   La brique qui tranche doit répondre AVANT toute écriture. C'est ce qui la
   *   distingue de `describeDivergence`, qui refuse de parler tant que le plan
   *   n'est pas à jour — juste pour un rapport d'état, inutilisable pour
   *   décider d'agir.
   */
  describe("constater la base AVANT d'écrire dans l'historique (#114)", () => {
    it("l'écart est visible SANS que le plan soit à jour", async () => {
      await poser(TABLE_D_EPOQUE);

      // Une migration NEUVE, jamais appliquée : le plan n'est plus « à jour ».
      await appendMigration(sources[0]!.dir, "sqlite", {
        tag: "0001_jamais_appliquee",
        statements: ["SELECT 1"],
      });
      const etat = await plan();
      assert.equal(
        etat.pending.length,
        1,
        "le décor doit porter une migration en attente, sinon ce cas n'arme rien",
      );

      // La source du rapport se TAIT — c'est son contrat, et c'est le trou.
      assert.equal(
        await describeDivergence(etat),
        null,
        "le rapport d'état ne parle pas tant que le plan n'est pas à jour",
      );

      // Celle de l'adoption, elle, RÉPOND.
      const ecart = await gapAgainstDeclared(ORM);
      assert.ok(
        ecart,
        "l'adoption doit pouvoir constater la base avant d'écrire quoi que ce soit",
      );
      assert.ok(
        ecart.blocking.length + ecart.additive.length > 0,
        "l'écart doit NOMMER la colonne manquante, pas seulement exister",
      );
    });

    /*
     *   Le contrôle NÉGATIF, et il est indispensable : une garde qui mordrait
     *   sur une base conforme punirait qui n'a rien demandé — et l'adoption
     *   d'une base à jour est précisément l'usage nominal de la commande.
     */
    it("une base CONFORME ne déclenche rien", async () => {
      await poser(TABLE_ACTUELLE);
      assert.equal(
        await gapAgainstDeclared(ORM),
        null,
        "aucun écart : l'adoption doit passer sans un mot de plus",
      );
    });
  });
});
