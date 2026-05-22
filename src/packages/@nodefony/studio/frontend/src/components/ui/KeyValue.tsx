import { Group, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

export interface KeyValueProps {
  k: ReactNode;
  v: ReactNode;
  /** Valeur en police monospace (versions, PID, chemins, hashes…). */
  mono?: boolean;
}

/**
 * KeyValue — ligne clé→valeur alignée (label gris à gauche, valeur en gras à
 * droite). Brique des panneaux d'info (Dashboard « Système », ModuleDetail…).
 */
export function KeyValue({ k, v, mono }: KeyValueProps) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Text size="sm" c="dimmed">
        {k}
      </Text>
      <Text size="sm" fw={600} ff={mono ? "monospace" : undefined} ta="right">
        {v}
      </Text>
    </Group>
  );
}

/** Liste verticale de paires {@link KeyValue}. */
export function DefinitionList({
  children,
  gap = 6,
}: {
  children: ReactNode;
  gap?: number;
}) {
  return <Stack gap={gap}>{children}</Stack>;
}
