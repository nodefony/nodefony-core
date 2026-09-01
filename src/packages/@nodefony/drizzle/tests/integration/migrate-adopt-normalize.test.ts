import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeIntrospection } from "../../nodefony/src/migrator/adopt";

/**
 * Remettre en forme ce que l'introspection vient d'écrire.
 *
 * ## Pourquoi ce banc existe séparément de son voisin
 *
 * `migrate-adopt.test.ts` et `migrate-adopt-cli.e2e.test.ts` exercent
 * l'adoption ENTIÈRE, et les deux exigent un serveur — MySQL pour le cas qui
 * nous occupe ici. La remise en forme, elle, est une fonction PURE sur deux
 * fichiers : elle s'éprouve sans base, donc sur les trois plateformes et dans
 * n'importe quel job. Le défaut qu'elle répare a coûté trois passes de banc à
 * seule fin d'être VU ; le rejouer doit coûter une seconde.
 */
describe("normalizeIntrospection — la référence rendue utilisable", () => {
  /**
   * Écrit le décor d'une introspection : un instantané et son SQL.
   *
   * @param type - type que l'introspection a rendu pour la colonne booléenne.
   * @returns le dossier de sortie et le fichier SQL.
   */
  const decor = async (
    type: string,
  ): Promise<{ outDir: string; file: string }> => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-normalize-"));
    await fs.mkdir(path.join(outDir, "meta"), { recursive: true });
    await fs.writeFile(
      path.join(outDir, "meta", "0000_snapshot.json"),
      JSON.stringify({
        tables: {
          User: {
            columns: {
              id: { type: "varchar(512)" },
              enabled: { type },
              locked: { type },
            },
          },
        },
      }),
      "utf8",
    );
    const file = path.join(outDir, "0000_base_existante.sql");
    await fs.writeFile(
      file,
      "CREATE TABLE `User` (\n" +
        "\t`id` varchar(512) NOT NULL,\n" +
        `\t\`enabled\` ${type} NOT NULL,\n` +
        `\t\`locked\` ${type} NOT NULL\n` +
        ");\n",
      "utf8",
    );
    return { outDir, file };
  };

  /**
   * Relit le type d'une colonne dans l'instantané.
   *
   * @param outDir - dossier de la référence.
   * @param colonne - nom de la colonne.
   * @returns le type que l'instantané déclare.
   */
  const typeDe = async (outDir: string, colonne: string): Promise<string> => {
    const doc = JSON.parse(
      await fs.readFile(
        path.join(outDir, "meta", "0000_snapshot.json"),
        "utf8",
      ),
    ) as {
      tables: Record<string, { columns: Record<string, { type: string }> }>;
    };
    return doc.tables.User?.columns[colonne]?.type as string;
  };

  it("🔴 sur MySQL, le booléen lu en `tinyint(1)` est rendu à sa forme déclarée", async () => {
    const { outDir, file } = await decor("tinyint(1)");
    try {
      await normalizeIntrospection(outDir, file, {
        schema: null,
        excludedTables: [],
        dialect: "mysql",
      });
      // L'instantané sert à COMPARER : c'est lui qui décidait d'un
      // `MODIFY COLUMN` sur une colonne que personne n'avait touchée.
      assert.equal(await typeDe(outDir, "enabled"), "boolean");
      assert.equal(await typeDe(outDir, "locked"), "boolean");
      // Le fichier sert à REJOUER : les deux doivent dire la même chose, sans
      // quoi la référence rejouée sur un environnement neuf recrée l'écart.
      const sql = await fs.readFile(file, "utf8");
      assert.doesNotMatch(sql, /tinyint/iu, "le SQL garde la forme physique");
      assert.match(sql, /`enabled` boolean NOT NULL/u);
      // Et rien d'autre n'a bougé.
      assert.equal(await typeDe(outDir, "id"), "varchar(512)");
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });

  it("un `tinyint` sans largeur n'est PAS touché — c'est un entier, pas un booléen", async () => {
    const { outDir, file } = await decor("tinyint");
    try {
      await normalizeIntrospection(outDir, file, {
        schema: null,
        excludedTables: [],
        dialect: "mysql",
      });
      assert.equal(await typeDe(outDir, "enabled"), "tinyint");
      assert.match(await fs.readFile(file, "utf8"), /`enabled` tinyint NOT/u);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });

  it("hors MySQL, la forme lue est laissée telle quelle", async () => {
    const { outDir, file } = await decor("tinyint(1)");
    try {
      await normalizeIntrospection(outDir, file, {
        schema: null,
        excludedTables: [],
        dialect: "sqlite",
      });
      assert.equal(await typeDe(outDir, "enabled"), "tinyint(1)");
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });
});
