import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, type SQL } from "drizzle-orm";
import { ERP_LITE, ERP_LITE_SPECS } from "./erp-lite";
import {
  runSchemaContract,
  type ISchemaRunOptions,
  type ISchemaSuiteContext,
  type Row,
} from "./schema-contract";

/**
 * Banc du corpus `erp-lite` : un schéma écrit dans le style d'un vrai
 * progiciel né sur MySQL — clé composite, table sans clé, références vers une
 * clé entière, une clé chaîne et soi-même, montants `decimal(24,8)`, horodatage
 * recalculé, nom de table assez long pour que les contraintes qui en dérivent
 * dépassent 63 caractères.
 *
 * Le contrat commun (création par les deux chemins, lignes témoins, défauts)
 * vit dans `schema-contract.ts` ; ce fichier ajoute ce que SES tables
 * permettent d'éprouver : référence refusée, unicité qui remplace une clé
 * composite, horodatage recalculé, et les requêtes métier lourdes.
 *
 * Le corpus réel complet (421 tables) se rejoue hors CI : skill
 * `nodefony-devkit-bench`, § « Banc de schéma réel ».
 */

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export type IErpLiteRunOptions = ISchemaRunOptions;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

const CORPUS = {
  name: "erplite",
  specs: ERP_LITE_SPECS,
  tables: ERP_LITE,
  fixtureFile: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "erp-lite.ts",
  ),
  tablesExport: "ERP_LITE",
};

/** Les cas que les tables d'`erp-lite` permettent d'éprouver. */
function erpLiteCases(ctx: ISchemaSuiteContext): void {
  const { dialect, repo, written } = ctx;

  it("l'horodatage recalculé avance à chaque écriture", async () => {
    const invoice = written.get("erp_invoice");
    assert.ok(invoice);
    assert.equal(invoice.tms instanceof Date && invoice.tms.getTime(), -1);
    const updated = await repo("erp_invoice").updateOne(
      { rowid: invoice.rowid },
      { close_code: "paid" },
    );
    assert.ok(updated?.tms instanceof Date);
    assert.ok(updated.tms.getTime() > Date.now() - 60_000, "tms recalculé");
  });

  it("une référence vers une ligne absente est refusée par le serveur", async () => {
    await assert.rejects(
      repo("erp_invoice_line").create({ fk_invoice: 2_000_000_000 }),
    );
  });

  it("la clé composite d'origine, devenue index unique, refuse le doublon", async () => {
    const category = written.get("erp_category");
    const product = written.get("erp_product");
    assert.ok(category && product);
    const pair = { fk_category: category.rowid, fk_product: product.rowid };
    const existing = await repo("erp_category_product").findOne(pair);
    assert.ok(existing, "la paire témoin existe");
    await assert.rejects(repo("erp_category_product").create(pair));
  });

  describe("requêtes métier lourdes — les montants se comparent en NOMBRES", () => {
    /** Clés des tiers du jeu, pour borner chaque requête à ses propres lignes. */
    let thirdparties: [number, number];
    let invoices: Row[];

    /** Lignes rendues par une requête native, quel que soit le pilote. */
    async function nativeRows(statement: string): Promise<Row[]> {
      const query = sql.raw(statement);
      let rows: unknown;
      if (dialect === "sqlite") {
        rows = ctx
          .orm()
          .getNativeConnection<{ all(q: SQL): unknown[] }>()
          .all(query);
      } else {
        const result: unknown = await ctx
          .orm()
          .getNativeConnection<{ execute(q: SQL): Promise<unknown> }>()
          .execute(query);
        // node-postgres rend `{ rows }`, mysql2 le tuple `[rows, fields]`.
        rows = Array.isArray(result)
          ? result[0]
          : typeof result === "object" && result !== null && "rows" in result
            ? result.rows
            : undefined;
      }
      assert.ok(
        Array.isArray(rows) && rows.every(isRow),
        `${dialect} : lignes natives`,
      );
      return rows;
    }

    beforeAll(async () => {
      const country = await repo("erp_country").create({ code: "QX" });
      const currency = await repo("erp_currency").create({ code_iso: "QXC" });
      const user = await repo("erp_user").create({
        login: "q-user",
        fk_country: country.rowid,
      });
      const party = (nom: string): Promise<Row> =>
        repo("erp_thirdparty").create({
          nom,
          fk_currency: currency.code_iso,
          fk_user_creat: user.rowid,
        });
      const t1 = await party("q-t1");
      const t2 = await party("q-t2");
      thirdparties = [Number(t1.rowid), Number(t2.rowid)];
      const p1 = await repo("erp_product").create({ ref: "q-p1", label: "p1" });
      const p2 = await repo("erp_product").create({ ref: "q-p2", label: "p2" });
      // Montants choisis pour que l'ordre ALPHABÉTIQUE et l'ordre NUMÉRIQUE
      // divergent : longueurs différentes, un négatif, 16 chiffres entiers.
      const amounts: [Row, string][] = [
        [t1, "9.5"],
        [t1, "100"],
        [t1, "-3.25"],
        [t2, "1234567890123456.12345678"],
        [t2, "0.1"],
        [t2, "0.2"],
      ];
      invoices = [];
      for (const [i, [soc, total]] of amounts.entries()) {
        invoices.push(
          await repo("erp_invoice").create({
            ref: `q-inv-${i}`,
            fk_soc: soc.rowid,
            total_ht: total,
          }),
        );
      }
      // Deux sommes que le flottant ne sait pas rendre : 0,1 + 0,2, et une
      // retenue qui traverse les 24 chiffres.
      const lines: [number, Row, string][] = [
        [0, p1, "0.1"],
        [0, p2, "0.2"],
        [3, p1, "9999999999999999.99999999"],
        [3, p2, "0.00000001"],
      ];
      for (const [invoice, product, total] of lines) {
        await repo("erp_invoice_line").create({
          fk_invoice: invoices[invoice]?.rowid,
          fk_product: product.rowid,
          total_ht: total,
        });
      }
    });

    it("ORDER BY sur un montant suit l'ordre numérique", async () => {
      const rows = await repo("erp_invoice").find(
        { fk_soc: { $in: thirdparties } },
        { order: [["total_ht", "ASC"]] },
      );
      assert.deepEqual(
        rows.map((r) => r.total_ht),
        [
          "-3.25000000",
          "0.10000000",
          "0.20000000",
          "9.50000000",
          "100.00000000",
          "1234567890123456.12345678",
        ],
      );
    });

    it("$gt sur un montant compare des nombres, pas des chaînes", async () => {
      const rows = await repo("erp_invoice").find(
        { fk_soc: { $in: thirdparties }, total_ht: { $gt: "50" } },
        { order: [["rowid", "ASC"]] },
      );
      assert.deepEqual(
        rows.map((r) => r.total_ht),
        ["100.00000000", "1234567890123456.12345678"],
      );
      // `$or` n'a pas de forme préparée : même règle par le chemin direct.
      const low = await repo("erp_invoice").find(
        {
          fk_soc: { $in: thirdparties },
          $or: [{ total_ht: { $lte: "50" } }],
        },
        { order: [["total_ht", "DESC"]] },
      );
      assert.deepEqual(
        low.map((r) => r.total_ht),
        ["9.50000000", "0.20000000", "0.10000000", "-3.25000000"],
      );
    });

    // Le SQL NATIF suit la sémantique du moteur. SQLite n'a pas de type
    // décimal (`decimal` y est rangé en TEXT) : c'est une divergence DÉCLARÉE
    // (docs/index.md, « Le décimal en SQLite »), et ces cas prouvent que la page
    // dit vrai — un changement de moteur ou de stockage les fera rougir.
    const sqlite = dialect === "sqlite";

    it("SUM groupé de decimal(24,8) : exact sur serveur, flottant en SQLite (déclaré)", async () => {
      const rows = await nativeRows(
        `SELECT i.fk_soc AS soc, SUM(l.total_ht) AS total
           FROM erp_invoice_line l
           JOIN erp_invoice i ON i.rowid = l.fk_invoice
          WHERE i.fk_soc IN (${thirdparties.join(", ")})
          GROUP BY i.fk_soc
          ORDER BY i.fk_soc`,
      );
      assert.deepEqual(
        rows.map((r) => [Number(r.soc), sqlite ? r.total : String(r.total)]),
        [
          [thirdparties[0], sqlite ? 0.1 + 0.2 : "0.30000000"],
          [thirdparties[1], sqlite ? 1e16 : "10000000000000000.00000000"],
        ],
      );
    });

    // Propre à SQLite : déclaré là seulement, plutôt qu'un skip ailleurs.
    if (sqlite)
      it("SQLite : un ORDER BY natif sur un décimal est alphabétique (déclaré)", async () => {
        const rows = await nativeRows(
          `SELECT total_ht FROM erp_invoice
          WHERE fk_soc = ${thirdparties[0]} ORDER BY total_ht`,
        );
        assert.deepEqual(
          rows.map((r) => r.total_ht),
          ["-3.25000000", "100.00000000", "9.50000000"],
        );
      });

    it("fenêtre RANK() par tiers, ordonnée sur le montant", async () => {
      // La recette de la page pour SQLite : lire le montant en nombre.
      const amount = sqlite ? "CAST(total_ht AS REAL)" : "total_ht";
      const rows = await nativeRows(
        `SELECT ref, RANK() OVER (PARTITION BY fk_soc ORDER BY ${amount} DESC) AS rang
           FROM erp_invoice
          WHERE fk_soc IN (${thirdparties.join(", ")})
          ORDER BY fk_soc, rang`,
      );
      assert.deepEqual(
        rows.map((r) => [r.ref, Number(r.rang)]),
        [
          ["q-inv-1", 1],
          ["q-inv-0", 2],
          ["q-inv-2", 3],
          ["q-inv-3", 1],
          ["q-inv-5", 2],
          ["q-inv-4", 3],
        ],
      );
    });

    it("jointure sur six tables : ligne, facture, produit, tiers, auteur, pays", async () => {
      const rows = await nativeRows(
        `SELECT l.rowid AS line, i.ref AS invoice, p.ref AS product,
                t.nom AS party, u.login AS author, c.code AS country
           FROM erp_invoice_line l
           JOIN erp_invoice i ON i.rowid = l.fk_invoice
           JOIN erp_product p ON p.rowid = l.fk_product
           JOIN erp_thirdparty t ON t.rowid = i.fk_soc
           JOIN erp_user u ON u.rowid = t.fk_user_creat
           JOIN erp_country c ON c.rowid = u.fk_country
          WHERE c.code = 'QX'
          ORDER BY l.rowid`,
      );
      assert.deepEqual(
        rows.map((r) => [r.invoice, r.product, r.party, r.author, r.country]),
        [
          ["q-inv-0", "q-p1", "q-t1", "q-user", "QX"],
          ["q-inv-0", "q-p2", "q-t1", "q-user", "QX"],
          ["q-inv-3", "q-p1", "q-t2", "q-user", "QX"],
          ["q-inv-3", "q-p2", "q-t2", "q-user", "QX"],
        ],
      );
    });
  });
}

/**
 * Déroule le banc sur un dialecte, dans son PROPRE `describe`. À appeler DANS un
 * `describe` (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 */
export function runErpLite(opts: IErpLiteRunOptions): void {
  runSchemaContract(opts, CORPUS, erpLiteCases);
}
