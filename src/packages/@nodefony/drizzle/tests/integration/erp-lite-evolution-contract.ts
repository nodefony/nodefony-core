import assert from "node:assert/strict";
import { ERP_LITE_SPECS } from "./erp-lite";
import { ERP_LITE_V2_RENAMES, ERP_LITE_V2_SPECS } from "./erp-lite-v2";
import {
  runSchemaEvolution,
  type ISchemaEvolutionRunOptions,
} from "./schema-evolution-contract";

/**
 * Banc d'ÉVOLUTION du corpus `erp-lite` : une base peuplée en v1 passe en v2
 * sans perdre une valeur. Le déroulé est celui de `runSchemaEvolution` (le
 * même code que `orm:generate --rename` et `orm:migrate`) ; ce fichier ajoute
 * ce que SEUL ce corpus sait éprouver : la table neuve qui référence des lignes
 * écrites avant la migration.
 */
export function runErpLiteEvolution(opts: ISchemaEvolutionRunOptions): void {
  const ctx = runSchemaEvolution(opts, {
    name: "erp-lite",
    from: ERP_LITE_SPECS,
    to: ERP_LITE_V2_SPECS,
    renames: ERP_LITE_V2_RENAMES,
    withheld: "erp_user.lastname=last_name",
  });

  it("la table NEUVE référence des lignes écrites avant la migration", async () => {
    const invoice = ctx.written.get("erp_invoice");
    const user = ctx.written.get("erp_user");
    assert.ok(invoice && user, "lignes v1 écrites");
    const contact = await ctx.repo("erp_invoice_contact").create({
      fk_invoice: invoice.rowid,
      fk_user: user.rowid,
    });
    assert.equal(contact.role, "BILLING");
    const later = await ctx
      .repo("erp_invoice")
      .updateOne({ rowid: invoice.rowid }, { fk_user_valid: user.rowid });
    assert.equal(later?.fk_user_valid, user.rowid);
  });
}
