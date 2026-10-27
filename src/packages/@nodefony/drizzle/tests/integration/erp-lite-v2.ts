import type { IPortableTable } from "../../nodefony/entity/colKit";
import type { ITableSpec } from "../../nodefony/entity/colKit.spec";
import { SPECS } from "../fixtures/erp-lite/specs-v2";
import { materializeSpecs, type ISerializedSpec } from "./serialized-specs";

/**
 * Le corpus `erp-lite` en VERSION 2 — ce qu'un progiciel fait à son schéma
 * d'une version à la suivante, d'après le script de passage réel 19 → 20 du
 * corpus `erp` : une table renommée PUIS une colonne renommée dans cette table,
 * des colonnes renommées (dont une élargie en même temps), un `varchar` élargi,
 * des ajouts (dont un NOT NULL à défaut sur une table peuplée), une référence
 * neuve vers une table existante, une table neuve qui référence des lignes
 * d'avant.
 *
 * Généré depuis `../fixtures/erp-lite/ddl-v2/` par `mysql-ddl-to-specs.mjs`.
 * `drizzle-kit` relit ce fichier : aucun `await` de premier niveau.
 */

/** Les descriptions sérialisées de la version 2. */
export const ERP_LITE_V2_SPECS: readonly ISerializedSpec[] = SPECS;

/** Les tables portables de la version 2, par nom. */
export const ERP_LITE_V2: ReadonlyMap<
  string,
  IPortableTable<ITableSpec>
> = materializeSpecs(ERP_LITE_V2_SPECS);

/**
 * L'ORACLE : les renommages v1 → v2 tels que l'auteur du schéma les a voulus
 * — ce que le script de passage d'un vrai progiciel écrit en `RENAME TO` et
 * `CHANGE COLUMN a b`. Un diff ne les voit pas : sans eux, ce sont des pertes.
 *
 * Une colonne se désigne par le nom NOUVEAU de sa table.
 */
export const ERP_LITE_V2_RENAMES: readonly string[] = [
  "erp_invoice_line=erp_invoice_det",
  "erp_invoice_det.fk_parent_line=fk_parent",
  "erp_user.lastname=last_name",
  "erp_category.color=colour",
];
