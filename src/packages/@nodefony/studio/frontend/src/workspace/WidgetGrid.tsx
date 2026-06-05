import { observer } from "mobx-react-lite";
import { Box } from "@mantine/core";
import { getWidget } from "./registry";
import { WidgetHost } from "./WidgetHost";
import type { WidgetRuntimeContext, WorkspaceLayout } from "./types";

const COLS = 12;

function clampSpan(n: number): number {
  return Math.min(COLS, Math.max(2, Math.round(n)));
}

/**
 * Grille CSS 12 colonnes — chaque widget occupe `span` colonnes. Pas de drag en L1
 * (taille/déplacement au menu du widget) ; `@dnd-kit` viendra en L3. Les `widgetId`
 * absents du registry sont filtrés (défensif — un preset peut référencer un widget
 * pas encore livré).
 */
export const WidgetGrid = observer(
  ({ layout, ctx }: { layout: WorkspaceLayout; ctx: WidgetRuntimeContext }) => {
    const items = layout.items.filter((i) => getWidget(i.widgetId));
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
          return (
            <Box
              key={it.widgetId}
              data-widget={it.widgetId}
              style={{ gridColumn: `span ${clampSpan(it.span)}` }}
            >
              <WidgetHost def={def} instance={it} ctx={ctx} />
            </Box>
          );
        })}
      </Box>
    );
  },
);
