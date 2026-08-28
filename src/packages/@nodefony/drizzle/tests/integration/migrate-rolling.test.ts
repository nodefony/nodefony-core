import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DrizzleMigrator,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import { buildReport, isAheadOnly } from "../../nodefony/src/migrator/explain";
import { writeSource } from "./migrator-fixtures";

/**
 * #108 — la mise à jour progressive, jouée POUR DE VRAI.
 *
 * La scène : le travail de migration a appliqué `0001_ajout` sur la base ; les
 * anciens exemplaires servent encore, bâtis sur une image qui ne porte que
 * `0000_init`. Leur historique référence donc une migration dont ils n'ont pas
 * le fichier.
 *
 * Le banc la PROVOQUE au lieu de la simuler : il applique les deux migrations,
 * puis réécrit la source avec la seule première — c'est exactement ce que voit
 * un exemplaire de la version précédente, journal compris.
 *
 * Ce que ce banc empêche de revenir : retenir ces exemplaires-là sortait TOUS
 * les anciens du répartiteur de charge dès la fin du travail de migration,
 * avant que le premier nouveau soit prêt. Coupure totale, sur un déploiement
 * nominal, avec une migration parfaitement additive.
 */
const ORM = "banc-rolling";

describe("Base en avance sur le code — mise à jour progressive (#108)", () => {
  let root: string;
  let dbFile: string;

  const migrateur = (sources: IMigrationSource[]): DrizzleMigrator =>
    new DrizzleMigrator({
      connector: ORM,
      dialect: "sqlite",
      filename: dbFile,
      sources,
    });

  /** La source telle que la voit la version `complete ? N : N-1` du code. */
  const source = async (complete: boolean): Promise<IMigrationSource[]> => {
    const migrations = [
      { tag: "0000_init", statements: ['CREATE TABLE "t" ("a" integer)'] },
      ...(complete
        ? [{ tag: "0001_ajout", statements: ['ALTER TABLE "t" ADD "b" text'] }]
        : []),
    ];
    const dir = await writeSource(
      "sqlite",
      migrations,
      await fs.mkdtemp(path.join(os.tmpdir(), "nf-rolling-")),
    );
    return [{ name: "app", dir, rank: 1_000_000 }];
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-rolling-db-"));
    dbFile = path.join(root, "banc.db");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("l'ancien exemplaire voit une base EN AVANCE — et rien d'autre ne cloche", async () => {
    // Le travail de migration, depuis la version N.
    await migrateur(await source(true)).migrate();

    // L'ancien exemplaire, version N-1 : il n'a pas le fichier `0001_ajout`.
    const etat = await migrateur(await source(false)).status();

    assert.equal(
      etat.missing.length,
      1,
      "l'historique porte une entrée sans fichier",
    );
    assert.equal(etat.missing[0]?.tag, "0001_ajout");
    assert.equal(etat.drifted.length, 0, "aucune empreinte n'a bougé");
    assert.equal(etat.pending.length, 0, "rien à appliquer");
    assert.equal(etat.failed.length, 0, "aucun échec");

    assert.equal(
      isAheadOnly(etat),
      true,
      "c'est une AVANCE, pas une dérive — la sonde ne doit pas retenir le trafic",
    );
  });

  it("le verdict reste `drift` — l'énumération est gelée, et le fait est juste", async () => {
    await migrateur(await source(true)).migrate();
    const etat = await migrateur(await source(false)).status();
    const report = buildReport(etat, { ddl: "none" });
    assert.equal(report.verdict, "drift");
    // Le code de sortie de la COMMANDE ne change pas : ce qui change est ce que
    // la sonde en déduit. Réaffecter cette grille casserait des passes
    // d'intégration continue écrites par des utilisateurs.
    assert.equal(report.exitCode, 1);
  });

  it("une fois le code à jour, il n'y a plus d'avance du tout", async () => {
    const complete = await source(true);
    await migrateur(complete).migrate();
    const etat = await migrateur(complete).status();
    assert.equal(etat.missing.length, 0);
    assert.equal(isAheadOnly(etat), false);
  });
});
