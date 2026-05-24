import { Card, Grid, Group, Text, ThemeIcon } from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import type { ReactNode } from "react";
import { DocHint } from "./DocHint";

export interface KpiCardProps {
  icon: ReactNode;
  label: string;
  /** Bulle ⓘ simple (idéalement DYNAMIQUE — interpolée des données live). */
  hint?: string;
  /** Fiche d'aide riche (ex. `<DocHint/>`) — rendue À LA PLACE de `hint` si fournie. */
  info?: ReactNode;
  value: ReactNode;
  /** Couleur d'accent (icône + bordure active). Défaut `brand`. */
  accent?: MantineColor;
  /** Pied de carte : sous-métriques live (badges). */
  footer?: ReactNode;
  /** Rend la carte cliquable (→ navigation/onglet) ; accessible clavier. */
  onClick?: () => void;
  /** Bordure d'accent quand la cible est active. */
  active?: boolean;
  /** Accent « live » : anneau STATIQUE discret (`.nf-live-card`) — calme, pas un halo qui bat. */
  pulse?: boolean;
  /** Span Grid responsive. Rend sa propre `Grid.Col` → s'utilise DANS une `<Grid>`. */
  span?: Record<string, number>;
}

/**
 * **KpiCard** — carte de tête riche du PATRON sondes+hub : label + ⓘ, grande
 * valeur, **pied de carte** (sous-métriques live), accent coloré, **halo pulsant**
 * en temps réel, et **clic → onglet/page** (bordure accent quand la cible est
 * active). Plus riche que `StatCard` (qui est une KPI statique simple). Réutilisée
 * par tout dashboard d'observabilité (ORM, Supervision…).
 */
export function KpiCard({
  icon,
  label,
  hint,
  info,
  value,
  accent = "brand",
  footer,
  onClick,
  active,
  pulse,
  span = { base: 12, sm: 6, lg: 3 },
}: KpiCardProps) {
  return (
    <Grid.Col span={span}>
      <Card
        withBorder
        radius="md"
        p="md"
        h="100%"
        className={pulse ? "nf-live-card" : undefined}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-pressed={onClick ? active : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        style={{
          cursor: onClick ? "pointer" : undefined,
          borderColor: active
            ? `var(--mantine-color-${accent}-filled)`
            : undefined,
          transition: "border-color 120ms ease",
        }}
      >
        <Group justify="space-between" wrap="nowrap" mb={8} align="flex-start">
          <Group gap={6} wrap="nowrap" c="dimmed" style={{ minWidth: 0 }}>
            <Text
              size="xs"
              fw={600}
              tt="uppercase"
              style={{ letterSpacing: 0.3 }}
              truncate
            >
              {label}
            </Text>
            {info ?? (hint ? <DocHint title={label} summary={hint} /> : null)}
          </Group>
          <ThemeIcon variant="light" color={accent} size={34} radius="md">
            {icon}
          </ThemeIcon>
        </Group>
        <Text
          fw={700}
          style={{
            fontSize: 30,
            lineHeight: 1.05,
            // valeur live → chiffres à chasse fixe = pas de jitter de largeur au tick.
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </Text>
        {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
      </Card>
    </Grid.Col>
  );
}
