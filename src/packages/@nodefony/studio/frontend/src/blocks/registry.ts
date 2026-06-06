/* ════════════════════════════════════════════════════════════════════════
 * Registre de BLOCS unifié = le registre de widgets (un bloc EST un widget).
 *
 * On ne duplique PAS la Map : on ré-expose l'unique catalogue
 * (`workspace/registry`) sous une terminologie « bloc » neutre par rapport au
 * contenant. Enregistrer un bloc = `registerBlock(def)` ; le résoudre =
 * `getBlock(id)`. Les mêmes blocs alimentent le bureau, les dialogs du Jumeau
 * et les panneaux de page.
 * ════════════════════════════════════════════════════════════════════════ */

export {
  registerWidget as registerBlock,
  getWidget as getBlock,
  hasWidget as hasBlock,
  listWidgets as listBlocks,
} from "../workspace/registry";

export type {
  IWidgetDef as IBlockDef,
  WidgetRenderProps as BlockRenderProps,
  WidgetData as BlockData,
  WidgetRuntimeContext as BlockContext,
  WidgetSource as BlockSource,
  WidgetCategory as BlockCategory,
} from "../workspace/types";
