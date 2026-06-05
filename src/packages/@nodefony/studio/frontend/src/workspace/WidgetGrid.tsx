import { observer } from "mobx-react-lite";
import { useState } from "react";
import type { DragEvent } from "react";
import { Box } from "@mantine/core";
import { useWorkspace } from "../stores";
import { getWidget } from "./registry";
import { WidgetHost } from "./WidgetHost";
import type { WidgetRuntimeContext, WorkspaceLayout } from "./types";

const COLS = 12;
/** Type MIME du drag & drop interne (réorganisation des widgets). */
const DRAG_MIME = "application/nf-widget";

function clampSpan(n: number): number {
  return Math.min(COLS, Math.max(2, Math.round(n)));
}

/**
 * Grille CSS 12 colonnes + **drag & drop** de réorganisation (HTML5 natif, 0 dep).
 * On glisse par la poignée du widget (`WidgetHost`), on dépose sur une tuile cible →
 * `workspace.reorder`. La taille reste réglable au menu du widget. Les `widgetId`
 * absents du registry sont filtrés (défensif).
 */
export const WidgetGrid = observer(
  ({ layout, ctx }: { layout: WorkspaceLayout; ctx: WidgetRuntimeContext }) => {
    const workspace = useWorkspace();
    const [overId, setOverId] = useState<string | null>(null);
    const items = layout.items.filter((i) => getWidget(i.widgetId));

    const handleDrop = (targetId: string) => (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dragId = e.dataTransfer.getData(DRAG_MIME);
      if (dragId && dragId !== targetId) workspace.reorder(dragId, targetId);
      setOverId(null);
    };

    return (
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          gap: "var(--mantine-spacing-md)",
          alignItems: "start",
        }}
      >
        {items.map((it) => {
          const def = getWidget(it.widgetId);
          if (!def) return null;
          const isOver = overId === it.widgetId;
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
                outline: isOver
                  ? "2px dashed var(--mantine-color-brand-5)"
                  : "2px dashed transparent",
                outlineOffset: 2,
                borderRadius: 10,
                transition: "outline-color 120ms ease",
              }}
            >
              <WidgetHost
                def={def}
                instance={it}
                ctx={ctx}
                dragMime={DRAG_MIME}
              />
            </Box>
          );
        })}
      </Box>
    );
  },
);
