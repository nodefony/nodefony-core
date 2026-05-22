import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  /** Sous-titre gris sous le titre (description courte de la page). */
  subtitle?: ReactNode;
  /** Icône optionnelle à gauche du titre. */
  icon?: ReactNode;
  /** Actions alignées à droite (boutons « Recharger », filtres globaux…). */
  actions?: ReactNode;
}

/**
 * PageHeader — en-tête standard d'une page Studio : titre + sous-titre + zone
 * d'actions. Centralise le bloc dupliqué dans toutes les routes (Dashboard,
 * Routes, Modules…). Une page = un `<PageHeader/>`.
 *
 * Accessibilité : le titre est un `h1` (`order={1}`) — un seul par page, point
 * d'ancrage du lecteur d'écran ; `size="h2"` conserve la taille visuelle
 * historique. Les titres de cartes restent `h2`+ (hiérarchie cohérente).
 */
export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-end" wrap="nowrap" mb="md">
      <Stack gap={4}>
        <Group gap="xs" wrap="nowrap">
          {icon}
          <Title order={1} size="h2">
            {title}
          </Title>
        </Group>
        {subtitle && (
          <Text c="dimmed" size="sm">
            {subtitle}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
    </Group>
  );
}
