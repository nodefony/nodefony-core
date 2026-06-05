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
 * On glisse un widget par son **en-tête**, on dépose sur une tuile cible → insertion
 * AVANT elle (barre d'accent à gauche = repère d'insertion). Largeur réglable au bord
 * droit (poignée du `WidgetHost`). Les `widgetId` absents du registry sont filtrés.
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
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          gap: "var(--mantine-spacing-md)",
          alignItems: "start",
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
                opacity: dragged ? 0.4 : 1,
                boxShadow: isTarget
                  ? "inset 4px 0 0 0 var(--mantine-color-brand-6)"
                  : undefined,
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
