/**
 * **StatusBar** — barre de **mode** réutilisable, collée sous le `PageHeader`
 * sticky : « quel que soit l'onglet, je sais dans quel état/mode je suis ».
 *
 * Générique et data-driven (`segments`) → le MÊME pattern d'ergonomie s'applique
 * à toutes les consoles Studio (Logs, Realtime Hub, ORM, Cluster, Supervision…) :
 * l'utilisateur arrive sur n'importe quelle page, la logique de lecture est
 * identique. Un segment = un axe (label court + valeur live + fiche d'aide).
 *
 * Ergonomie « temps réel calme » : `tone` pilote une couleur **stable** (pas
 * d'animation qui rejoue), `tabular-nums` partout (0 jitter), `contain: content`
 * (le re-render d'une valeur n'invalide pas la page). Accessible : `role="region"`
 * + `aria-label` ; chaque point d'état porte un `aria-label` lisible.
 */
import type { ReactNode } from "react";
import { Box, Divider, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { CONTENT_STICKY_TOP } from "./layout";

/** Accent de couleur d'un segment (point d'état + pastille d'icône). */
export type StatusTone = "neutral" | "active" | "ok" | "warn" | "danger";

/** Un axe affiché dans la barre de mode. */
export interface StatusSegment {
  id: string;
  /** Label court au-dessus de la valeur (« Écriture », « Lecture », « Live »). */
  label: string;
  /** Icône à gauche du segment. */
  icon?: ReactNode;
  /** Valeur affichée (chips, badge, texte) — déjà mise en forme. */
  value: ReactNode;
  /** Accent de couleur (point d'état). Défaut `neutral`. */
  tone?: StatusTone;
  /** Fiche d'aide (`DocHint`…) ouverte au survol/focus, à droite de la valeur. */
  info?: ReactNode;
}

export interface StatusBarProps {
  /** Les axes du mode courant (gauche). */
  segments: StatusSegment[];
  /** Élément(s) alignés à droite (chip env, compteurs santé…). */
  trailing?: ReactNode;
  /**
   * Colle la barre sous le `PageHeader` sticky (top = hauteur réelle publiée du
   * PageHeader). Défaut `true`. Mettre `false` pour un usage en flux normal.
   */
  sticky?: boolean;
  /** `aria-label` de la région. Défaut « Barre d'état ». */
  ariaLabel?: string;
}

/** Couleur Mantine d'un `tone`. */
const TONE_COLOR: Record<StatusTone, string> = {
  neutral: "gray",
  active: "brand",
  ok: "teal",
  warn: "yellow",
  danger: "red",
};

/** Un segment : pastille d'icône (tone) + label + valeur + aide. */
function Segment({
  label,
  icon,
  value,
  tone = "neutral",
  info,
}: StatusSegment) {
  return (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
      {icon && (
        <ThemeIcon
          variant="light"
          color={TONE_COLOR[tone]}
          size="lg"
          radius="md"
        >
          {icon}
        </ThemeIcon>
      )}
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text
          fz={10}
          fw={700}
          tt="uppercase"
          c="dimmed"
          style={{ letterSpacing: 0.4, lineHeight: 1.2 }}
        >
          {label}
        </Text>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Box
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
              lineHeight: 1.2,
              minWidth: 0,
            }}
          >
            {value}
          </Box>
          {info}
        </Group>
      </Stack>
    </Group>
  );
}

/**
 * Barre de mode horizontale (segments séparés par un trait vertical) + zone
 * `trailing` à droite. Sticky par défaut sous le PageHeader.
 */
export function StatusBar({
  segments,
  trailing,
  sticky = true,
  ariaLabel = "Barre d'état",
}: StatusBarProps) {
  return (
    <Box
      role="region"
      aria-label={ariaLabel}
      style={{
        contain: "content",
        ...(sticky
          ? {
              position: "sticky",
              // Pile sous le PageHeader sticky (sa hauteur réelle est publiée
              // dans --nf-pageheader-height par <PageHeader sticky>).
              top: CONTENT_STICKY_TOP,
              zIndex: 1,
              background: "var(--mantine-color-body)",
              // Largeur pleine malgré le padding de AppShell.Main.
              marginInline: "calc(var(--mantine-spacing-md) * -1)",
              paddingInline: "var(--mantine-spacing-md)",
              paddingBlock: "var(--mantine-spacing-xs)",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            }
          : {}),
      }}
    >
      <Group justify="space-between" wrap="wrap" gap="md">
        <Group gap="md" wrap="wrap" style={{ minWidth: 0 }}>
          {segments.map((seg, i) => (
            <Group key={seg.id} gap="md" wrap="nowrap">
              {i > 0 && (
                <Divider
                  orientation="vertical"
                  style={{ alignSelf: "stretch" }}
                />
              )}
              <Segment {...seg} />
            </Group>
          ))}
        </Group>
        {trailing && (
          <Group gap="sm" wrap="nowrap">
            {trailing}
          </Group>
        )}
      </Group>
    </Box>
  );
}
