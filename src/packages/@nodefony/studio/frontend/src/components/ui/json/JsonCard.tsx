/**
 * **JsonCard** — petite carte JSON **autonome** : en-tête optionnel (titre +
 * badge type/taille) au-dessus d'un {@link JsonView} compact. Pensée pour être
 * posée *inline* OU à l'intérieur d'un survol (`JsonPeek`) / d'un `Popover`.
 *
 * Rendu en TEXTE (via `JsonView`) → sûr pour des données non maîtrisées.
 */
import { Box, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { JsonView } from "./JsonView";
import { countLabel, jsonKind } from "./jsonFormat";

export interface JsonCardProps {
  /** Valeur JSON à présenter. */
  value: unknown;
  /** Titre de la carte (ex. nom du champ, direction d'un message…). */
  title?: ReactNode;
  /** Hauteur max scrollable du corps (px). Défaut 260. */
  maxHeight?: number;
  /** Profondeur ouverte par défaut. Défaut 1. */
  defaultExpandedDepth?: number;
  /** Affiche la barre d'outils du `JsonView`. Défaut `true`. */
  toolbar?: boolean;
  /** Largeur fixe (px) — utile en `Popover`/`HoverCard`. */
  width?: number;
}

/** Carte compacte enveloppant un {@link JsonView}, avec en-tête type + taille. */
export function JsonCard({
  value,
  title,
  maxHeight = 260,
  defaultExpandedDepth = 1,
  toolbar = true,
  width,
}: JsonCardProps) {
  const kind = jsonKind(value);
  const isContainer = kind === "object" || kind === "array";
  return (
    <Paper withBorder radius="md" p="xs" style={width ? { width } : undefined}>
      <Group justify="space-between" gap="xs" wrap="nowrap" mb={6}>
        <Text size="xs" fw={700} truncate>
          {title ?? "JSON"}
        </Text>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {isContainer ? countLabel(value) : kind}
        </Text>
      </Group>
      <Box>
        <JsonView
          value={value}
          maxHeight={maxHeight}
          defaultExpandedDepth={defaultExpandedDepth}
          toolbar={toolbar}
        />
      </Box>
    </Paper>
  );
}
