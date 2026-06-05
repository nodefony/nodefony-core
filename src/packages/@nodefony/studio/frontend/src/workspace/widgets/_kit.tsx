/**
 * Briques de rendu PARTAGÉES par les widgets — grande valeur live (flash + sparkline),
 * séries temps réel, tuile worker, formateurs. Respecte « temps réel calme » : flash
 * one-shot bref, sparkline compositor (SVG), `tabular-nums`.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Box, Group, Paper, Text } from "@mantine/core";
import { FlashValue, MiniChart, ensureLiveStyles } from "../../components/ui";

/** Bufferise la dernière valeur scalaire en série bornée (sparklines live). */
export function useLiveSeries(value: number | null, max = 40): number[] {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    if (value == null || Number.isNaN(value)) return;
    setSeries((s) => {
      const next = [...s, value];
      return next.length > max ? next.slice(-max) : next;
    });
  }, [value, max]);
  return series;
}

/** Débit/seconde dérivé d'un cumul monotone (`total`) + son horodatage (`ts`). */
export function useRate(
  total: number | null | undefined,
  ts: number | null | undefined,
): number | null {
  const prev = useRef<{ total: number; ts: number } | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (total == null || ts == null) return;
    const p = prev.current;
    if (p && ts > p.ts) {
      const dt = (ts - p.ts) / 1000;
      if (dt > 0) setRate(Math.max(0, (total - p.total) / dt));
    }
    prev.current = { total, ts };
  }, [total, ts]);
  return rate;
}

/** Couleur Mantine selon des seuils « smaller is better » (vert→orange→rouge). */
export function levelColor(
  value: number | null | undefined,
  warn: number,
  crit: number,
): string {
  if (value == null) return "gray";
  if (value >= crit) return "red";
  if (value >= warn) return "orange";
  return "teal";
}

/** Variable CSS de la couleur de tracé (MiniChart). */
function chartColor(c: string): string {
  return `var(--mantine-color-${c}-6)`;
}

/**
 * Grande métrique live : valeur en gros (flash one-shot au changement) + unité +
 * sparkline optionnelle. Le cœur visuel des widgets « système ».
 */
export function BigMetric({
  label,
  value,
  unit,
  color = "teal",
  series,
  sub,
}: {
  label?: string;
  value: number | string | null | undefined;
  unit?: string;
  color?: string;
  series?: number[];
  sub?: string;
}) {
  useEffect(ensureLiveStyles, []);
  const display = value == null ? "—" : value;
  return (
    <div>
      {label ? (
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {label}
        </Text>
      ) : null}
      <Group gap={6} align="flex-end" wrap="nowrap">
        <FlashValue value={display}>
          <Text
            fw={800}
            fz={26}
            lh={1.1}
            c={color}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {display}
          </Text>
        </FlashValue>
        {unit ? (
          <Text size="sm" c="dimmed" style={{ marginBottom: 3 }}>
            {unit}
          </Text>
        ) : null}
      </Group>
      {sub ? (
        <Text size="xs" c="dimmed" mt={2}>
          {sub}
        </Text>
      ) : null}
      {series && series.length >= 2 ? (
        <Box mt={6}>
          <MiniChart
            series={[
              { data: series, color: chartColor(color), label: label ?? "" },
            ]}
            height={46}
          />
        </Box>
      ) : null}
    </div>
  );
}

/** Métrique compacte label → valeur (tabular-nums). */
export function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Group gap={4} align="baseline" wrap="nowrap">
        <Text fw={700} fz="lg" style={{ fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Text>
        {unit ? (
          <Text size="xs" c="dimmed">
            {unit}
          </Text>
        ) : null}
      </Group>
    </div>
  );
}

/** Tuile d'un worker (cluster) — encadre la métrique + son PID. */
export function WorkerTile({
  pid,
  children,
}: {
  pid?: number;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="xs">
      {pid ? (
        <Text size="xs" c="dimmed" mb={4}>
          PID {pid}
        </Text>
      ) : null}
      {children}
    </Paper>
  );
}

export function fmtUptime(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}

/** Octets → Mo (entier). */
export function fmtMB(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** Millisecondes lisibles (1 décimale sous 100 ms, entier au-delà). */
export function fmtMs(ms: number): string {
  return ms >= 100 ? Math.round(ms).toString() : ms.toFixed(1);
}
