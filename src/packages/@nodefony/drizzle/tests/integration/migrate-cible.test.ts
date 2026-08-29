import assert from "node:assert/strict";
import { describeTargetSafely } from "../../nodefony/src/safeTarget";
import { buildReport } from "../../nodefony/src/migrator/explain";
import type { IMigrationPlan } from "../../nodefony/src/migrator/types";

/**
 * DIRE quelle base une commande de migration vise — sans rien faire fuiter.
 *
 * Le défaut d'origine : `NF_MIGRATE_DATABASE_URL` remplace la connexion des
 * quatre commandes de migration, et RIEN ne l'annonçait. Une variable oubliée
 * dans un terminal détournait chaque commande suivante, qui rendait
 * « appliqué » et le code du SUCCÈS pendant que la vraie base ne recevait rien.
 * Le seul symptôme arrivait plus tard, au démarrage d'une application sur un
 * schéma qui n'avait pas bougé.
 *
 * Le refus `NF_MIGRATE_URL_MISMATCH` ne couvre que le dialecte : deux bases du
 * MÊME dialecte — le cas de l'essai, précisément — ne déclenchaient aucun mot.
 *
 * La contrepartie est aussi importante que le fait : cette variable porte les
 * identifiants du seul compte autorisé à modifier un schéma de production.
 * Publier la cible sans publier le compte est donc la moitié du travail.
 */

const MDP = "s3cr3t-de-production";

describe("désigner la base visée sans fuiter d'identifiant (#113)", () => {
  describe("base RÉSEAU — le danger est le COMPTE", () => {
    const url = `postgres://migrator:${MDP}@db.interne:5432/app`;

    it("rend l'hôte, le port et la base", () => {
      assert.equal(
        describeTargetSafely({ dialect: "postgres", url }),
        "db.interne:5432/app",
      );
    });

    it("🔴 ne rend NI l'identifiant NI le mot de passe", () => {
      const rendu = describeTargetSafely({ dialect: "postgres", url });
      assert.ok(!rendu.includes(MDP), `le mot de passe a fuité : ${rendu}`);
      assert.ok(
        !rendu.includes("migrator"),
        `l'identifiant a fuité : ${rendu}`,
      );
      assert.ok(!rendu.includes("@"), `la partie compte a fuité : ${rendu}`);
    });

    it("le port par défaut est celui du dialecte quand l'URL l'omet", () => {
      assert.equal(
        describeTargetSafely({
          dialect: "postgres",
          url: "postgres://u:p@h/app",
        }),
        "h:5432/app",
      );
      assert.equal(
        describeTargetSafely({ dialect: "mysql", url: "mysql://u:p@h/app" }),
        "h:3306/app",
      );
    });

    /*
     *   Une URL qu'on n'a pas su analyser ne se publie PAS telle quelle : elle
     *   pourrait porter un secret sous une forme qui nous a échappé. On ne
     *   masque pas, on RECONSTRUIT — donc en cas de doute on ne rend que le
     *   dialecte, qui n'apprend rien à personne.
     */
    it("une URL illisible ne fuite rien — on ne rend que le dialecte", () => {
      const rendu = describeTargetSafely({
        dialect: "postgres",
        url: `pas une url ${MDP}`,
      });
      assert.equal(rendu, "postgres");
      assert.ok(!rendu.includes(MDP));
    });
  });

  describe("base FICHIER — le danger est l'ARBORESCENCE du serveur", () => {
    it("un chemin dans le projet est rendu RELATIF", () => {
      assert.equal(
        describeTargetSafely(
          { dialect: "sqlite", filename: "/srv/app/var/db.sqlite" },
          "/srv/app",
        ),
        "var/db.sqlite",
      );
    });

    it("🔴 un chemin HORS du projet se réduit à son nom de fichier", () => {
      const rendu = describeTargetSafely(
        { dialect: "sqlite", filename: "/Users/quelquun/secret/db.sqlite" },
        "/srv/app",
      );
      assert.equal(rendu, "db.sqlite");
      assert.ok(
        !rendu.includes("quelquun"),
        `l'arborescence du serveur a fuité : ${rendu}`,
      );
    });

    it("une base en mémoire se nomme telle quelle", () => {
      assert.equal(
        describeTargetSafely({ dialect: "sqlite", filename: ":memory:" }),
        ":memory:",
      );
    });
  });

  /*
   *   L'autre moitié du critère : la vérification doit être MÉCANIQUE.
   *
   *   Le §2 du skill de migration dit « lis le verdict, jamais la phrase » —
   *   une garantie qui ne vit que dans un message lisible n'est vérifiable par
   *   personne. La cible entre donc dans la charge utile, à côté du dialecte,
   *   avec le fait qui l'explique : d'où elle vient.
   */
  describe("le rapport PORTE la cible, pour qu'un automate la lise", () => {
    const plan = (dialect: "sqlite" | "postgres"): IMigrationPlan =>
      ({
        connector: "default",
        dialect,
        applied: [],
        pending: [],
        drifted: [],
        missing: [],
        failed: [],
      }) as unknown as IMigrationPlan;

    it("la cible et sa provenance sont publiées", () => {
      const r = buildReport(plan("postgres"), {
        ddl: "none",
        target: "db.interne:5432/app",
        fromMigrateUrl: true,
      });
      assert.equal(r.driver.target, "db.interne:5432/app");
      assert.equal(r.driver.fromMigrateUrl, true);
    });

    /*
     *   Une clé publiée à `undefined` apprendrait à ses lecteurs à la tester
     *   non-vide plutôt que présente — même règle que `divergence`. Un
     *   appelant qui ne connaît pas la cible n'en invente donc pas une.
     */
    it("ce que l'appelant ignore n'est pas publié à vide", () => {
      const r = buildReport(plan("sqlite"), { ddl: "auto" });
      assert.ok(
        !Object.hasOwn(r.driver, "target"),
        "la clé ne doit pas exister, pas valoir `undefined`",
      );
      assert.ok(!Object.hasOwn(r.driver, "fromMigrateUrl"));
      // …et le reste du bloc n'a pas bougé : l'ajout est ADDITIF.
      assert.equal(r.driver.kind, "sql");
      assert.equal(r.driver.dialect, "sqlite");
    });
  });
});
