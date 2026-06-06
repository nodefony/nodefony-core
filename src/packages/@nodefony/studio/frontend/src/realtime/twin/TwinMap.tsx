import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  ActionIcon,
  Box,
  Group,
  Paper,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { IconChevronRight, IconInfoCircle } from "@tabler/icons-react";
import type { LiveNodeData } from "../../components/ui";
import type { NormalizedHealth } from "../../utils/realtimeHealth";
import { useTwinLive } from "./twinLive";
import { useRecentLogActivity } from "./twinArchitecture";
import {
  buildSchema,
  type Pt,
  type SchemaBrick,
  type TwinSchema,
} from "./twinSchemas";

/** Borne une coordonnée % pour garder la brique dans le cadre. */
const clamp = (v: number, lo = 4, hi = 96) => Math.max(lo, Math.min(hi, v));
import type { ConnectorRow, KernelInfo } from "./useTwinTopology";

/* ════════════════════════════════════════════════════════════════════════
 * TwinMap — la carte d'architecture DATA-DRIVEN (rend n'importe quel schéma).
 *
 * Deux gestes par brique interne :
 *  - CLIC      → entre dans son sous-schéma (`enter`) sinon ouvre le dialog.
 *  - ⓘ INFO    → ouvre le dialog (liens + docs + explications).
 *
 * Nœuds externes (clients, bases, backends d'infra) hors frontière, surlignés
 * « actif » quand la config les sélectionne. Positions en % (responsive) ;
 * liens SVG animés quand le temps réel est actif.
 * ════════════════════════════════════════════════════════════════════════ */

function ensureTwinMapStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("nf-twinmap-styles")) return;
  const s = document.createElement("style");
  s.id = "nf-twinmap-styles";
  s.textContent = `
    .nf-tm-link { stroke-width: 1.5; vector-effect: non-scaling-stroke; fill: none; opacity: .42; }
    .nf-tm-link.is-cross { stroke-dasharray: 2 3; opacity: .28; }
    .nf-tm-link.is-live { stroke-dasharray: 3 5; animation: nf-tm-flow 1.1s linear infinite; opacity: .7; }
    @keyframes nf-tm-flow { to { stroke-dashoffset: -8; } }
    .nf-tm-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; transition: background-color .25s ease, opacity .25s ease; }
    .nf-tm-dot.is-ok { background: var(--mantine-color-teal-5); }
    .nf-tm-dot.is-warn { background: var(--mantine-color-yellow-5); }
    .nf-tm-dot.is-down { background: var(--mantine-color-red-5); }
    .nf-tm-dot.is-idle { background: var(--mantine-color-gray-5); opacity: .5; }
    .nf-tm-dot.is-pulse { animation: nf-tm-pulse 2.4s ease-in-out infinite; }
    @keyframes nf-tm-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    .nf-tm-brick { cursor: pointer; text-align: left; background: none; border: none; padding: 0; display: block; }
    .nf-tm-brick:focus-visible { outline: 2px solid var(--mantine-color-blue-5); outline-offset: 3px; border-radius: 12px; }
    @media (prefers-reduced-motion: reduce) {
      .nf-tm-link.is-live { animation: none; }
      .nf-tm-dot.is-pulse { animation: none; opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

const mc = (color: string, shade: number) =>
  `var(--mantine-color-${color}-${shade})`;

/** Une brique INTERNE : clic = entrer/dialog, ⓘ = dialog. */
function InternalBrick({
  brick,
  pos,
  live,
  liveOn,
  containerRef,
  onMove,
  onEnter,
  onInfo,
}: {
  brick: SchemaBrick;
  pos: Pt;
  live: LiveNodeData | undefined;
  liveOn: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onMove: (id: string, x: number, y: number) => void;
  onEnter: (schemaId: string) => void;
  onInfo: (id: string) => void;
}) {
  const metric = live?.metrics?.[0];
  const drag = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const handleMain = () =>
    brick.enter ? onEnter(brick.enter) : onInfo(brick.id);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: pos.x,
      oy: pos.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4)
      d.moved = true;
    if (d.moved) {
      onMove(
        brick.id,
        clamp(d.ox + ((e.clientX - d.sx) / rect.width) * 100),
        clamp(d.oy + ((e.clientY - d.sy) / rect.height) * 100),
      );
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture déjà relâchée */
    }
    if (d && !d.moved) handleMain();
  };
  return (
    <Box
      role="button"
      tabIndex={0}
      className="nf-tm-brick"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleMain();
        }
      }}
      aria-label={`${brick.title}${brick.enter ? " — entrer dans le détail" : " — ouvrir la fiche"}`}
      style={{
        position: "absolute",
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: "translate(-50%,-50%)",
        zIndex: 2,
        cursor: "grab",
        touchAction: "none",
      }}
    >
      <Paper
        radius="md"
        p="xs"
        withBorder
        style={{
          width: brick.emphasis ? 188 : 162,
          borderColor: mc(brick.color, 5),
          borderWidth: brick.emphasis ? 2 : 1,
          background: `color-mix(in srgb, ${mc(brick.color, 6)} 14%, var(--mantine-color-body))`,
          boxShadow: brick.emphasis
            ? `0 0 0 3px color-mix(in srgb, ${mc(brick.color, 6)} 20%, transparent)`
            : undefined,
        }}
      >
        <Group gap={8} wrap="nowrap" align="flex-start">
          <ThemeIcon
            variant="light"
            color={brick.color}
            size={brick.emphasis ? 34 : 28}
            radius="md"
            style={{ flexShrink: 0 }}
          >
            {brick.icon}
          </ThemeIcon>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Group gap={4} wrap="nowrap" justify="space-between">
              <Text fw={700} size="sm" lh={1.15} lineClamp={1}>
                {brick.title}
              </Text>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                {live ? (
                  <span
                    className={`nf-tm-dot is-${live.status ?? "idle"}${liveOn && live.pulse ? " is-pulse" : ""}`}
                    aria-hidden
                  />
                ) : null}
                {brick.info ? (
                  <Tooltip label="Explications & docs" withArrow>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Explications : ${brick.title}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInfo(brick.id);
                      }}
                    >
                      <IconInfoCircle size={15} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </Group>
            </Group>
            <Group gap={4} wrap="nowrap" justify="space-between">
              {metric ? (
                <Text
                  size="xs"
                  c="dimmed"
                  lineClamp={1}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {metric.label} : <b>{metric.value}</b>
                </Text>
              ) : (
                <span />
              )}
              {brick.enter ? (
                <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Text size="10px" c={brick.color} fw={600}>
                    creuser
                  </Text>
                  <IconChevronRight
                    size={12}
                    color={`var(--mantine-color-${brick.color}-5)`}
                  />
                </Group>
              ) : null}
            </Group>
          </Box>
        </Group>
      </Paper>
    </Box>
  );
}

/** Nœud EXTERNE (hors frontière). Surligné quand actif (config). */
function ExternalBrick({
  brick,
  live,
}: {
  brick: SchemaBrick;
  live: LiveNodeData | undefined;
}) {
  const active = live?.status === "ok";
  return (
    <Box
      style={{
        position: "absolute",
        left: `${brick.pos.x}%`,
        top: `${brick.pos.y}%`,
        transform: "translate(-50%,-50%)",
        zIndex: 2,
      }}
    >
      <Group
        gap={6}
        wrap="nowrap"
        px="xs"
        py={4}
        style={{
          border: `1px ${active ? "solid" : "dashed"} ${active ? mc(brick.color === "gray" ? "teal" : brick.color, 5) : "var(--mantine-color-dimmed)"}`,
          borderRadius: 999,
          opacity: active ? 1 : 0.6,
          background: active
            ? `color-mix(in srgb, var(--mantine-color-teal-6) 10%, var(--mantine-color-body))`
            : undefined,
        }}
      >
        <ThemeIcon
          variant="transparent"
          color={active ? "teal" : "gray"}
          size={18}
        >
          {brick.icon}
        </ThemeIcon>
        <Box>
          <Text
            size="xs"
            c={active ? undefined : "dimmed"}
            fw={active ? 600 : 400}
          >
            {brick.title}
          </Text>
          {live?.metrics?.[0] ? (
            <Text size="9px" c="dimmed" lh={1}>
              {live.metrics[0].label}
            </Text>
          ) : null}
        </Box>
      </Group>
    </Box>
  );
}

function Boundary({ y, label }: { y: number; label: string }) {
  return (
    <Box
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `${y}%`,
        borderTop: "1px dashed var(--mantine-color-default-border)",
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      <Text
        size="10px"
        c="dimmed"
        tt="uppercase"
        fw={600}
        style={{
          position: "absolute",
          left: 16,
          top: -8,
          background: "var(--mantine-color-body)",
          padding: "0 6px",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
    </Box>
  );
}

export interface TwinMapProps {
  schema: TwinSchema;
  liveNodeData: Record<string, LiveNodeData> | null;
  live: boolean;
  height: number | string;
  onEnter: (schemaId: string) => void;
  onInfo: (id: string) => void;
}

/** Carte présentationnelle (pure) — rend un schéma donné. */
export function TwinMap({
  schema,
  liveNodeData,
  live,
  height,
  onEnter,
  onInfo,
}: TwinMapProps) {
  useEffect(() => ensureTwinMapStyles(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Pt>>({});
  // Les déplacements (drag) sont propres à CHAQUE schéma → reset au changement.
  useEffect(() => setOverrides({}), [schema.id]);
  const posOf = (id: string): Pt =>
    overrides[id] ??
    schema.bricks.find((b) => b.id === id)?.pos ?? { x: 50, y: 50 };
  const moveBrick = useCallback(
    (id: string, x: number, y: number) =>
      setOverrides((o) => ({ ...o, [id]: { x, y } })),
    [],
  );
  return (
    <Box
      ref={containerRef}
      role="img"
      aria-label={`Carte d'architecture : ${schema.title}`}
      style={{
        position: "relative",
        height,
        borderRadius: 12,
        border: "1px solid var(--mantine-color-default-border)",
        overflow: "hidden",
        background:
          "radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--mantine-color-indigo-9) 14%, var(--mantine-color-body)) 0%, var(--mantine-color-body) 60%)",
        contain: "content",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
        aria-hidden
      >
        {schema.links.map((l, i) => {
          const a = posOf(l.from);
          const b = posOf(l.to);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`nf-tm-link${l.cross ? " is-cross" : ""}${live && !l.cross ? " is-live" : ""}`}
              stroke="var(--mantine-color-blue-4)"
            />
          );
        })}
      </svg>

      {schema.boundaries.map((bd, i) => (
        <Boundary key={i} y={bd.y} label={bd.label} />
      ))}

      {schema.bricks.map((brick) =>
        brick.external ? (
          <ExternalBrick
            key={brick.id}
            brick={brick}
            live={liveNodeData?.[brick.id]}
          />
        ) : (
          <InternalBrick
            key={brick.id}
            brick={brick}
            pos={posOf(brick.id)}
            live={liveNodeData?.[brick.id]}
            liveOn={live}
            containerRef={containerRef}
            onMove={moveBrick}
            onEnter={onEnter}
            onInfo={onInfo}
          />
        ),
      )}
    </Box>
  );
}

/** Branche LIVE : s'abonne (santé + logs) et construit le schéma courant. */
function TwinMapLive({
  schemaId,
  info,
  connectors,
  snapshot,
  height,
  onEnter,
  onInfo,
}: {
  schemaId: string;
  info: KernelInfo | null;
  connectors: ConnectorRow[];
  snapshot: NormalizedHealth | null;
  height: number | string;
  onEnter: (id: string) => void;
  onInfo: (id: string) => void;
}) {
  const liveSnap = useTwinLive();
  const activity = useRecentLogActivity();
  const { schema, live } = buildSchema(schemaId, {
    info,
    normalized: liveSnap.normalized ?? snapshot,
    activity: activity.count,
    connectors,
  });
  return (
    <TwinMap
      schema={schema}
      liveNodeData={live}
      live
      height={height}
      onEnter={onEnter}
      onInfo={onInfo}
    />
  );
}

export interface TwinMapViewProps {
  schemaId: string;
  info: KernelInfo | null;
  connectors: ConnectorRow[];
  /** Santé du snapshot HTTP (1er paint / mode statique). */
  snapshot: NormalizedHealth | null;
  live: boolean;
  height: number | string;
  onEnter: (id: string) => void;
  onInfo: (id: string) => void;
}

/** Aiguille statique/live (« 0 ticker quand OFF » : sous-arbre live démonté). */
export function TwinMapView({
  schemaId,
  info,
  connectors,
  snapshot,
  live,
  height,
  onEnter,
  onInfo,
}: TwinMapViewProps) {
  if (live)
    return (
      <TwinMapLive
        schemaId={schemaId}
        info={info}
        connectors={connectors}
        snapshot={snapshot}
        height={height}
        onEnter={onEnter}
        onInfo={onInfo}
      />
    );
  const { schema, live: liveData } = buildSchema(schemaId, {
    info,
    normalized: snapshot,
    activity: 0,
    connectors,
  });
  return (
    <TwinMap
      schema={schema}
      liveNodeData={liveData}
      live={false}
      height={height}
      onEnter={onEnter}
      onInfo={onInfo}
    />
  );
}

export default TwinMapView;
