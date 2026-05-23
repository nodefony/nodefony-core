import { useState } from "react";
import {
  ActionIcon,
  Card,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconArrowsMaximize } from "@tabler/icons-react";
import type { ReactNode } from "react";

/** Une série de points pour {@link MiniChart}. */
export interface MiniChartSeries {
  data: number[];
  color: string;
  label: string;
}

export interface MiniChartProps {
  series: MiniChartSeries[];
  height?: number;
  /** Plafond Y forcé (sinon auto = max × 1.15). */
  max?: number;
  /** Zone rouge au-dessus de ce seuil (alerte visuelle). */
  threshold?: number;
  /** Formate une valeur (axe + tooltip). Défaut = entier. */
  format?: (v: number) => string;
}

/**
 * MiniChart — mini-graphe SVG temps-réel, **zéro dépendance** (recharts 2.x est
 * cassé sous React 19). Survol : ligne-guide + points + tooltip. Repères Y, zone
 * de seuil optionnelle. Extrait du Dashboard → réutilisable par toute page live.
 *
 * Accessibilité : `role="img"` + `aria-label` résumant la dernière valeur de
 * chaque série (le SVG seul est opaque au lecteur d'écran).
 */
export function MiniChart({
  series,
  height = 190,
  max,
  threshold,
  format = (v) => String(Math.round(v)),
}: MiniChartProps) {
  const W = 600;
  const H = 200;
  const pad = 6;
  const [hover, setHover] = useState<{ idx: number; xPx: number; w: number } | null>(null);
  const n = Math.max(0, ...series.map((s) => s.data.length));
  if (n < 2) return null;
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.data)) * 1.15;
  const xOf = (i: number) => (i / (n - 1)) * (W - pad * 2) + pad;
  const yOf = (v: number) => H - pad - (Math.min(v, top) / top) * (H - pad * 2);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover({ idx: Math.round(frac * (n - 1)), xPx: frac * r.width, w: r.width });
  };

  const tipLeft = hover ? (hover.xPx > hover.w * 0.6 ? hover.xPx - 140 : hover.xPx + 12) : 0;
  const ariaLabel = series
    .map((s) => `${s.label} ${format(s.data[s.data.length - 1] ?? 0)}`)
    .join(", ");

  return (
    <div
      style={{ position: "relative" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label={`Graphe temps réel — ${ariaLabel}`}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {threshold != null && (
          <rect
            x={pad}
            y={yOf(top)}
            width={W - pad * 2}
            height={Math.max(0, yOf(threshold) - yOf(top))}
            fill="var(--mantine-color-red-6)"
            opacity={0.07}
          />
        )}
        <line
          x1={pad}
          y1={yOf(0)}
          x2={W - pad}
          y2={yOf(0)}
          stroke="var(--mantine-color-default-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.6}
        />
        {series.map((s, si) => {
          const line = s.data.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
          const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
          const last = s.data[s.data.length - 1];
          return (
            <g key={si}>
              <polygon points={area} fill={s.color} opacity={0.1} />
              <polyline
                points={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={xOf(n - 1)} cy={yOf(last)} r={3} fill={s.color} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hover && (
          <>
            <line
              x1={xOf(hover.idx)}
              y1={pad}
              x2={xOf(hover.idx)}
              y2={H - pad}
              stroke="var(--mantine-color-dimmed)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.6}
            />
            {series.map((s, si) => (
              <circle
                key={si}
                cx={xOf(hover.idx)}
                cy={yOf(s.data[hover.idx] ?? 0)}
                r={3.5}
                fill={s.color}
                stroke="var(--mantine-color-body)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}
      </svg>
      <Text c="dimmed" style={{ position: "absolute", top: 0, left: 2, fontSize: 10 }}>
        {format(top)}
      </Text>
      <Text c="dimmed" style={{ position: "absolute", bottom: 0, left: 2, fontSize: 10 }}>
        0
      </Text>
      {hover && (
        <Paper
          shadow="sm"
          p={6}
          withBorder
          style={{ position: "absolute", top: 4, left: tipLeft, pointerEvents: "none", zIndex: 5 }}
        >
          <Stack gap={2}>
            {series.map((s, si) => (
              <Group key={si} gap={6} wrap="nowrap">
                <span style={{ width: 8, height: 8, background: s.color, borderRadius: 2 }} />
                <Text size="xs">
                  {s.label} : <b>{format(s.data[hover.idx] ?? 0)}</b>
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </div>
  );
}

/**
 * Carte titrée enveloppant un graphe (titre + badge + légende courte).
 *
 * `fullscreen` (opt-in) ajoute un bouton ⤢ qui ouvre le graphe en plein écran
 * (Modal `fullScreen`). Pour que le graphe **grossisse vraiment** (et pas juste
 * se centre), passer `children` en **render-prop** `({ fullscreen }) => …` et
 * adapter la hauteur du `MiniChart` (le SVG est `preserveAspectRatio="none"` →
 * il s'étire à la hauteur donnée). `children` ReactNode simple reste supporté.
 */
export function ChartCard({
  title,
  caption,
  badge,
  icon,
  fullscreen = false,
  children,
}: {
  title: string;
  caption: string;
  badge?: ReactNode;
  /** Icône de provenance (ex. logo Node.js, icône de l'élément qui détient la sonde). */
  icon?: ReactNode;
  fullscreen?: boolean;
  children: ReactNode | ((opts: { fullscreen: boolean }) => ReactNode);
}) {
  const [opened, setOpened] = useState(false);
  const render = (fs: boolean): ReactNode =>
    typeof children === "function" ? children({ fullscreen: fs }) : children;
  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb={2} wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {icon}
          <Title order={2} size="h4">
            {title}
          </Title>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {badge}
          {fullscreen && (
            <Tooltip label="Plein écran" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Afficher « ${title} » en plein écran`}
                onClick={() => setOpened(true)}
              >
                <IconArrowsMaximize size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        {caption}
      </Text>
      {render(false)}
      {fullscreen && (
        <Modal
          opened={opened}
          onClose={() => setOpened(false)}
          fullScreen
          radius={0}
          title={title}
          transitionProps={{ transition: "fade", duration: 150 }}
        >
          <Stack gap="sm">
            {badge && <Group gap="xs">{badge}</Group>}
            <Text size="sm" c="dimmed">
              {caption}
            </Text>
            {render(true)}
          </Stack>
        </Modal>
      )}
    </Card>
  );
}

/** Pastille de légende (trait coloré + libellé gris). `size` adapte la police
 *  (ex. `"md"` en plein écran). */
export function Legend({
  color,
  label,
  size = "xs",
}: {
  color: string;
  label: string;
  size?: string;
}) {
  const big = size !== "xs";
  return (
    <Group gap={6} wrap="nowrap">
      <span
        style={{
          width: big ? 18 : 12,
          height: big ? 4 : 3,
          background: color,
          borderRadius: 2,
        }}
      />
      <Text size={size} c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
