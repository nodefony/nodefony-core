import { useState } from "react";
import { Card, Group, Paper, Stack, Text, Title } from "@mantine/core";
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

/** Carte titrée enveloppant un graphe (titre + badge + légende courte). */
export function ChartCard({
  title,
  caption,
  badge,
  children,
}: {
  title: string;
  caption: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb={2}>
        <Title order={2} size="h4">
          {title}
        </Title>
        {badge}
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        {caption}
      </Text>
      {children}
    </Card>
  );
}

/** Pastille de légende (trait coloré + libellé gris). */
export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span style={{ width: 12, height: 3, background: color, borderRadius: 2 }} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
