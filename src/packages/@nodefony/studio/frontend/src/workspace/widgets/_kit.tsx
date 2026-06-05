/**
 * Briques de rendu PARTAGÉES par les widgets — métriques calmes (tabular-nums), tuile
 * worker, formateurs. Volontairement minimal : un widget = du rendu pur.
 */
import type { ReactNode } from "react";
import { Group, Paper, Text } from "@mantine/core";

/** Métrique label → valeur (tabular-nums = pas de jitter de largeur au tick). */
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
