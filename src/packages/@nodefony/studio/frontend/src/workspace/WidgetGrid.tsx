import { observer } from "mobx-react-lite";
import { useState } from "react";
import type { DragEvent } from "react";
import { Box } from "@mantine/core";
import { useWorkspace } from "../stores";
import { getWidget } from "./registry";
import { WidgetHost } from "./WidgetHost";
import { GRID_COLS, GRID_ROW } from "./types";
import type { WidgetRuntimeContext, WorkspaceLayout } from "./types";

/** Type MIME du drag & drop interne (réorganisation des widgets). */
const DRAG_MIME = "application/nf-widget";

function clampSpan(n: number): number {
  return Math.min(GRID_COLS, Math.max(2, Math.round(n)));
}

/**
 * Grille **dense 2D** (CSS grid `auto-flow: dense`) — chaque widget occupe `span`
 * colonnes × `h` rangées et le navigateur **tuile sans trou**. On glisse un widget par
 * son en-tête (fantôme = la carte) → dépose sur une tuile pour réordonner ; on tire le
 * **coin bas-droit** pour redimensionner (largeur ET hauteur, en direct). 0 dépendance,
 * React 19 natif. Les `widgetId` absents du registry sont filtrés.
 */
export const WidgetGrid = observer(
  ({ layout, ctx }: { layout: WorkspaceLayout; ctx: WidgetRuntimeContext }) => {
    const workspace = useWorkspace();
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const items = layout.items.filter((i) => getWidget(i.widgetId));

    const handleDrop = (targetId: string) => (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData(DRAG_MIME) || dragId;
      if (id && id !== targetId) workspace.reorder(id, targetId);
      setOverId(null);
      setDragId(null);
    };

    return (
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gridAutoRows: `${GRID_ROW}px`,
          gridAutoFlow: "row dense",
          gap: "var(--mantine-spacing-sm)",
        }}
      >
        {items.map((it) => {
          const def = getWidget(it.widgetId);
          if (!def) return null;
          const dragged = dragId === it.widgetId;
          const isTarget =
            overId === it.widgetId && !!dragId && dragId !== it.widgetId;
          return (
            <Box
              key={it.widgetId}
              data-widget={it.widgetId}
              onDragOver={(e) => {
                e.preventDefault();
                if (overId !== it.widgetId) setOverId(it.widgetId);
              }}
              onDragLeave={() =>
                setOverId((c) => (c === it.widgetId ? null : c))
              }
              onDrop={handleDrop(it.widgetId)}
              style={{
                gridColumn: `span ${clampSpan(it.span)}`,
                gridRow: `span ${Math.max(2, it.h)}`,
                minHeight: 0,
                opacity: dragged ? 0.4 : 1,
                outline: isTarget
                  ? "2px dashed var(--mantine-color-brand-5)"
                  : "2px dashed transparent",
                outlineOffset: -2,
                borderRadius: 12,
                transition: "opacity 120ms ease",
              }}
            >
              <WidgetHost
                def={def}
                instance={it}
                ctx={ctx}
                dragMime={DRAG_MIME}
                onDragChange={setDragId}
              />
            </Box>
          );
        })}
      </Box>
    );
  },
);
