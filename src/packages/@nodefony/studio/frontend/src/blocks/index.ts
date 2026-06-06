/**
 * Couche BLOCS — un contenu écrit une fois, monté en page / widget / dialog.
 * Le registre unifié + le cœur partagé + les enveloppes.
 */
export { BlockView, type BlockViewProps } from "./BlockView";
export {
  BlockDialog,
  BlockPanel,
  type BlockDialogProps,
  type BlockPanelProps,
} from "./BlockHost";
export {
  BlockBody,
  BlockLiveFeed,
  useBlockSource,
  type BlockContainer,
  type BlockSourceState,
} from "./useBlockSource";
export {
  registerBlock,
  getBlock,
  hasBlock,
  listBlocks,
  type IBlockDef,
  type BlockRenderProps,
  type BlockData,
  type BlockContext,
  type BlockSource,
  type BlockCategory,
} from "./registry";
