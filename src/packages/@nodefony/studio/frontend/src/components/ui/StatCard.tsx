import { Card, Grid, Group, Stack, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

/**
 * InfoHint — bulle d'aide ⓘ accessible : ouvre au survol, au focus clavier ET
 * au touch (`events`), `tabIndex={0}` + `aria-label` pour le lecteur d'écran.
 * Le standard Studio pour expliciter une métrique sans alourdir le label.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip
      label={text}
      multiline
      w={280}
      withArrow
      position="top"
      events={{ hover: true, focus: true, touch: true }}
    >
      <ThemeIcon
        variant="subtle"
        color="gray"
        size="sm"
        style={{ cursor: "help" }}
        aria-label={text}
        tabIndex={0}
      >
        <IconInfoCircle size={15} />
      </ThemeIcon>
    </Tooltip>
  );
}

export interface StatCardProps {
  label: string;
  icon?: ReactNode;
  /** Texte d'aide (bulle ⓘ accessible à droite du label). */
  hint?: string;
  /** Span Grid responsive. Le composant rend sa propre `Grid.Col`. Défaut 1/4 large. */
  span?: Record<string, number>;
  children: ReactNode;
}

/**
 * StatCard — carte KPI standard (label en capitales + ⓘ + icône + valeur).
 * Extraite du Dashboard, réutilisable par toute page métrique (Database,
 * Firewall stats, Sessions…). Rend sa propre `Grid.Col` → s'utilise DANS une
 * `<Grid>`. `h="100%"` aligne les cartes d'une même ligne.
 */
export function StatCard({
  label,
  icon,
  hint,
  span = { base: 12, sm: 6, lg: 3 },
  children,
}: StatCardProps) {
  return (
    <Grid.Col span={span}>
      <Card withBorder radius="md" p="lg" h="100%">
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={2}>
            <Group gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {label}
              </Text>
              {hint && <InfoHint text={hint} />}
            </Group>
            {children}
          </Stack>
          {icon}
        </Group>
      </Card>
    </Grid.Col>
  );
}
