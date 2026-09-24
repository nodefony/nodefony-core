import {
  Card,
  Grid,
  Group,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import type { ReactNode } from "react";
import { DocHint } from "./DocHint";

export interface KpiCardProps {
  icon: ReactNode;
  label: string;
  /** Bulle ⓘ simple (idéalement DYNAMIQUE — interpolée des données live). */
  hint?: string;
  /** Version de doc affichée dans la bulle `hint` (badge de `DocHint`). */
  hintVersion?: string;
  /** Fiche d'aide riche (ex. `<DocHint/>`) — rendue À LA PLACE de `hint` si fournie. */
  info?: ReactNode;
  value: ReactNode;
  /** Couleur d'accent (icône + bordure active). Défaut `brand`. */
  accent?: MantineColor;
  /** Pied de carte : sous-métriques live (badges). */
  footer?: ReactNode;
  /**
   * Rend la carte cliquable (→ navigation/onglet). La carte ne devient PAS un
   * bouton : un vrai bouton nommé par `label` porte l'activation et s'étire sur
   * toute la surface, l'aide ⓘ restant atteignable au-dessus.
   */
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
  hintVersion,
  info,
  value,
  accent = "brand",
  footer,
  onClick,
  active,
  pulse,
  span = { base: 12, sm: 6, lg: 3 },
}: KpiCardProps) {
  const labelText = (
    <Text
      size="xs"
      fw={600}
      tt="uppercase"
      style={{ letterSpacing: 0.3 }}
      truncate
    >
      {label}
    </Text>
  );
  const help =
    info ??
    (hint ? (
      <DocHint title={label} version={hintVersion} summary={hint} />
    ) : null);
  return (
    <Grid.Col span={span}>
      <Card
        withBorder
        radius="md"
        p="md"
        h="100%"
        className={pulse ? "nf-live-card" : undefined}
        style={{
          // Bloc conteneur de la zone d'activation étirée (cf plus bas).
          position: "relative",
          cursor: onClick ? "pointer" : undefined,
          borderColor: active
            ? `var(--mantine-color-${accent}-filled)`
            : undefined,
          transition: "border-color 120ms ease",
          // Isole layout+paint à la carte : un tick live ne repeint QUE la carte
          // qui change, pas toute la page (règle CSS perf du skill). Les popovers
          // DocHint sont en portal → non clippés par `paint`.
          contain: "content",
        }}
      >
        <Group justify="space-between" wrap="nowrap" mb={8} align="flex-start">
          <Group gap={6} wrap="nowrap" c="dimmed" style={{ minWidth: 0 }}>
            {onClick ? (
              /*
                🔴 Une carte cliquable n'est PAS un bouton : elle contient déjà
                le bouton de sa fiche d'aide, et un contrôle ne s'imbrique pas
                dans un autre (`axe` : `nested-interactive`) — au clavier, la
                tabulation entrait dans la carte puis dans son aide sans rien
                annoncer. La zone d'activation est donc ce VRAI bouton, nommé
                par le libellé ; son enfant absolu s'étire sur toute la carte
                (bloc conteneur = la `Card`, le bouton restant `static`), si
                bien qu'un clic n'importe où l'active toujours. L'aide passe
                AU-DESSUS de cette nappe (`zIndex`), sinon elle deviendrait
                inatteignable à la souris.
              */
              <UnstyledButton
                onClick={onClick}
                aria-pressed={active}
                style={{ minWidth: 0, color: "inherit" }}
              >
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "inherit",
                  }}
                />
                {labelText}
              </UnstyledButton>
            ) : (
              labelText
            )}
            {help ? (
              <span style={{ position: "relative", zIndex: 1, lineHeight: 0 }}>
                {help}
              </span>
            ) : null}
          </Group>
          <ThemeIcon variant="light" color={accent} size={34} radius="md">
            {icon}
          </ThemeIcon>
        </Group>
        <Text
          component="div"
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
