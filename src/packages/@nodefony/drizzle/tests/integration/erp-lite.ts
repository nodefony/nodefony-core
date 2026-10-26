import type { IPortableTable } from "../../nodefony/entity/colKit";
import type { ITableSpec } from "../../nodefony/entity/colKit.spec";
import { SPECS } from "../fixtures/erp-lite/specs";
import {
  creationOrder as orderOf,
  materializeSpecs,
  type ISerializedSpec,
} from "./serialized-specs";

/**
 * Le corpus synthétique `erp-lite` — 15 tables écrites dans le style d'un
 * progiciel de gestion né sur MySQL, converties en descriptions NEUTRES par
 * `mysql-ddl-to-specs.mjs` (`../fixtures/erp-lite/specs.ts`, généré), puis
 * déclarées par le matérialiseur partagé (`serialized-specs.ts`).
 *
 * `drizzle-kit` relit ce fichier pour générer la migration du banc : aucun
 * `await` de premier niveau, aucun effet de bord.
 */

export {
  primaryKeyOf,
  type ISerializedColumn,
  type ISerializedSpec,
} from "./serialized-specs";

/** Les descriptions sérialisées du corpus. */
export const ERP_LITE_SPECS: readonly ISerializedSpec[] = SPECS;

/** Les tables portables du corpus, par nom. */
export const ERP_LITE: ReadonlyMap<
  string,
  IPortableTable<ITableSpec>
> = materializeSpecs(ERP_LITE_SPECS);

/** Ordre de création du corpus (cf `serialized-specs.ts#creationOrder`). */
export function creationOrder(): ISerializedSpec[] {
  return orderOf(ERP_LITE_SPECS);
}
