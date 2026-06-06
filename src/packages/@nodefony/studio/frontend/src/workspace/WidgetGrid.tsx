import { observer } from "mobx-react-lite";
import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Box } from "@mantine/core";
import { useWorkspace } from "../stores";
import { getWidget } from "./registry";
import { WidgetHost } from "./WidgetHost";
import { MIN_H, MIN_W } from "./types";
import type { WidgetRuntimeContext, WorkspaceLayout } from "./types";
import { clamp } from "./grid";

/**
 * Gouttière visuelle entre fenêtres (px) : la fenêtre est **inset** dans sa case
 * (padding du conteneur absolu) → deux fenêtres adjacentes ne se touchent jamais,
 * sans toucher au modèle (positions/tailles restent continues).
 */
const GUTTER = 6;

/** État mutable d'un drag (refs → 0 render par frame, transform compositor). */
interface DragRef {
  id: string;
  el: HTMLElement;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  ox: number;
  oy: number;
  W: number;
}
/** État mutable d'un resize. */
interface ResizeRef {
  id: string;
  el: HTMLElement;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  w0: number;
  h0: number;
  W: number;
}

/**
 * **Bureau libre** — fenêtres flottantes positionnées en ABSOLU (X + largeur en
 * `%` de la largeur → responsive ; Y + hauteur en px → défile), avec
 * **chevauchement** + **z-order** (clic = au 1er plan). Drag par l'en-tête,
 * resize par le coin, tous deux au **pointeur via `setPointerCapture`** (aucun
 * event perdu) : suivi du curseur en `transform`/taille directe (compositor, 0
 * render par frame) ; le store n'est touché **qu'au relâché** (1 commit, snap +
 * bornes). « Ranger » (store.tidy) aligne tout sur la grille à la demande.
 */
export const WidgetGrid = observer(
  ({ layout, ctx }: { layout: WorkspaceLayout; ctx: WidgetRuntimeContext }) => {
    const workspace = useWorkspace();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<DragRef | null>(null);
    const resizeRef = useRef<ResizeRef | null>(null);
    const rafRef = useRef(0);
    const [dragId, setDragId] = useState<string | null>(null);
    const [resizeId, setResizeId] = useState<string | null>(null);

    const items = layout.items.filter((i) => getWidget(i.widgetId));
    const minHeight = items.reduce((m, it) => Math.max(m, it.y + it.h), 0) + 80;

    /* ── Drag (pointer capture) ─────────────────────────────────────────── */
    const dragMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      d.cx = e.clientX;
      d.cy = e.clientY;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const d2 = dragRef.current;
        if (!d2) return;
        d2.el.style.transform = `translate3d(${d2.cx - d2.sx}px, ${d2.cy - d2.sy}px, 0)`;
      });
    }, []);

    const dragUp = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        if (!d) return;
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* déjà relâché */
        }
        d.el.style.transform = "";
        d.el.style.willChange = "";
        document.body.style.userSelect = "";
        const nx = d.ox + (d.cx - d.sx) / d.W;
        const ny = d.oy + (d.cy - d.sy);
        dragRef.current = null;
        setDragId(null);
        workspace.moveTo(d.id, nx, ny); // commit unique (snap + bornes)
      },
      [workspace],
    );

    const dragDown = useCallback(
      (id: string, ox: number, oy: number) =>
        (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.button !== 0) return;
          const container = containerRef.current;
          const el = (e.currentTarget as HTMLElement).closest(
            "[data-window]",
          ) as HTMLElement | null;
          if (!container || !el) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* capture non supportée */
          }
          workspace.bringToFront(id);
          dragRef.current = {
            id,
            el,
            sx: e.clientX,
            sy: e.clientY,
            cx: e.clientX,
            cy: e.clientY,
            ox,
            oy,
            W: container.getBoundingClientRect().width || 1,
          };
          el.style.willChange = "transform";
          document.body.style.userSelect = "none";
          setDragId(id);
        },
      [workspace],
    );

    /* ── Resize (pointer capture) ───────────────────────────────────────── */
    const resizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      r.cx = e.clientX;
      r.cy = e.clientY;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const r2 = resizeRef.current;
        if (!r2) return;
        const w = clamp(r2.w0 + (r2.cx - r2.sx) / r2.W, MIN_W, 1);
        const h = Math.max(MIN_H, r2.h0 + (r2.cy - r2.sy));
        r2.el.style.width = `${w * 100}%`;
        r2.el.style.height = `${h}px`;
      });
    }, []);

    const resizeUp = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        const r = resizeRef.current;
        if (!r) return;
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* déjà relâché */
        }
        r.el.style.willChange = "";
        document.body.style.userSelect = "";
        const w = clamp(r.w0 + (r.cx - r.sx) / r.W, MIN_W, 1);
        const h = Math.max(MIN_H, r.h0 + (r.cy - r.sy));
        resizeRef.current = null;
        setResizeId(null);
        workspace.setSize(r.id, w, h); // commit unique (snap + bornes)
      },
      [workspace],
    );

    const resizeDown = useCallback(
      (id: string, w0: number, h0: number) =>
        (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.button !== 0) return;
          const container = containerRef.current;
          const el = (e.currentTarget as HTMLElement).closest(
            "[data-window]",
          ) as HTMLElement | null;
          if (!container || !el) return;
          e.preventDefault();
          e.stopPropagation();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* capture non supportée */
          }
          workspace.bringToFront(id);
          resizeRef.current = {
            id,
            el,
            sx: e.clientX,
            sy: e.clientY,
            cx: e.clientX,
            cy: e.clientY,
            w0,
            h0,
            W: container.getBoundingClientRect().width || 1,
          };
          el.style.willChange = "width, height";
          document.body.style.userSelect = "none";
          setResizeId(id);
        },
      [workspace],
    );

    return (
      <Box
        ref={containerRef}
        style={{
          position: "relative",
          minHeight,
          width: "100%",
          // Stacking context PROPRE : confine les z-order des fenêtres (qui montent
          // au fil des « passer devant ») → elles ne remontent JAMAIS au-dessus du
          // bandeau sticky (z:3) ni de la top bar. Fix « topbar perdue / vignettes
          // recouvertes ».
          isolation: "isolate",
        }}
      >
        {items.map((it) => {
          const def = getWidget(it.widgetId);
          if (!def) return null;
          const active = dragId === it.widgetId || resizeId === it.widgetId;
          return (
            <Box
              key={it.widgetId}
              data-window
              data-widget={it.widgetId}
              onPointerDownCapture={() => workspace.bringToFront(it.widgetId)}
              style={{
                position: "absolute",
                left: `${it.x * 100}%`,
                top: it.y,
                width: `${it.w * 100}%`,
                height: it.h,
                padding: GUTTER,
                zIndex: it.z,
                transition: active
                  ? "none"
                  : "left .18s ease, top .18s ease, width .12s ease, height .12s ease",
              }}
            >
              <WidgetHost
                def={def}
                instance={it}
                ctx={ctx}
                dragHandlers={{
                  onPointerDown: dragDown(it.widgetId, it.x, it.y),
                  onPointerMove: dragMove,
                  onPointerUp: dragUp,
                }}
                resizeHandlers={{
                  onPointerDown: resizeDown(it.widgetId, it.w, it.h),
                  onPointerMove: resizeMove,
                  onPointerUp: resizeUp,
                }}
              />
            </Box>
          );
        })}
      </Box>
    );
  },
);

export default WidgetGrid;
