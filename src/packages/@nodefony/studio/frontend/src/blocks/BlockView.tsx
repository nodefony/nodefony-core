import type { IWidgetDef, WidgetRuntimeContext } from "../workspace/types";
import {
  BlockBody,
  useBlockSource,
  type BlockContainer,
} from "./useBlockSource";

/* ════════════════════════════════════════════════════════════════════════
 * BlockView — monte un bloc (déjà résolu) dans N'IMPORTE quel contenant.
 *
 * C'est LE point d'unification : un bloc écrit une fois (`def.render`) est
 * rendu à l'identique en page / widget / dialog. Les enveloppes ne font
 * qu'entourer ce composant. Le widget de bureau ajoute sa Card + drag/resize
 * ; le dialog son Modal ; la page son Paper.
 * ════════════════════════════════════════════════════════════════════════ */

export interface BlockViewProps {
  def: IWidgetDef;
  ctx: WidgetRuntimeContext;
  /** Largeur logique (colonnes 1-12) ; 12 = pleine largeur (page/dialog). */
  span?: number;
  container?: BlockContainer;
}

export function BlockView({
  def,
  ctx,
  span = 12,
  container = "dialog",
}: BlockViewProps) {
  const state = useBlockSource(def.source, ctx.live);
  return (
    <BlockBody
      def={def}
      state={state}
      ctx={ctx}
      span={span}
      container={container}
    />
  );
}

export default BlockView;
