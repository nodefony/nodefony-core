import { type ReactNode } from "react";
import { Anchor, Badge, Group, Stack, Text, Title, rem } from "@mantine/core";
import { IconBrandGithub, IconClock } from "@tabler/icons-react";

/* ════════════════════════════════════════════════════════════════════════
 * DocPageHeader — en-tête riche d'une page de doc.
 *
 * Modèle : breadcrumb (Section › Page) · titre · badges (version, status, wip)
 *          · meta line (Mis à jour le …, Modifier sur GitHub).
 *
 * Tout est OPTIONNEL au-delà du titre — dégradation gracieuse. Le backend
 * documentation pourra fournir `updated`/`sourceUrl` plus tard sans changer
 * les call-sites.
 * ════════════════════════════════════════════════════════════════════════ */

export interface DocPageHeaderProps {
  /** Chaîne d'ancêtres affichée en breadcrumb (ex : ["Documentation", "Realtime"]). */
  breadcrumbs?: string[];
  /** Titre principal de la page (h2 — la page hôte porte le h1 global). */
  title: string;
  /** Version affichée en badge (ex : "v1.2.0", "v0.1-démo"). */
  version?: string;
  /** Statut : "stable" · "draft" · "temporary" · "experimental" · "deprecated". */
  status?: string;
  /** Marque "à venir" — page non livrée. */
  wip?: boolean;
  /** Date ISO ou Date — rendue "Mis à jour le 27 mai 2026". */
  updated?: string | Date;
  /** URL absolue de la source markdown ("Modifier sur GitHub"). */
  sourceUrl?: string;
  /** Actions à droite (filtre persona, switch live…). */
  actions?: ReactNode;
}

const STATUS_COLOR: Record<string, string> = {
  stable: "teal",
  draft: "yellow",
  temporary: "orange",
  experimental: "violet",
  deprecated: "red",
};

function formatUpdated(updated?: string | Date): string | null {
  if (!updated) return null;
  const d = typeof updated === "string" ? new Date(updated) : updated;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function DocPageHeader({
  breadcrumbs,
  title,
  version,
  status,
  wip,
  updated,
  sourceUrl,
  actions,
}: DocPageHeaderProps) {
  const updatedLabel = formatUpdated(updated);
  const statusColor = status
    ? (STATUS_COLOR[status.toLowerCase()] ?? "gray")
    : "gray";
  return (
    <Stack gap={4}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Group gap={4} wrap="nowrap">
          {breadcrumbs.map((b, i) => (
            <Group key={`${i}-${b}`} gap={4} wrap="nowrap">
              {i > 0 && (
                <Text size="xs" c="dimmed" aria-hidden>
                  ›
                </Text>
              )}
              <Text
                size="xs"
                c="dimmed"
                tt="uppercase"
                fw={700}
                style={{ letterSpacing: "0.04em" }}
              >
                {b}
              </Text>
            </Group>
          ))}
        </Group>
      )}
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Group
          gap="xs"
          wrap="nowrap"
          style={{ flex: 1, minWidth: 0 }}
          align="center"
        >
          <Title order={2} lineClamp={2} style={{ minWidth: 0 }}>
            {title}
          </Title>
          {wip && (
            <Badge color="gray" variant="light">
              à venir
            </Badge>
          )}
          {status && (
            <Badge color={statusColor} variant="light">
              {status}
            </Badge>
          )}
          {version && (
            <Badge
              variant="default"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {version}
            </Badge>
          )}
        </Group>
        {actions}
      </Group>
      {(updatedLabel || sourceUrl) && (
        <Group gap="md" wrap="wrap">
          {updatedLabel && (
            <Group gap={4} wrap="nowrap">
              <IconClock
                size={13}
                color="var(--mantine-color-dimmed)"
                aria-hidden
              />
              <Text size="xs" c="dimmed">
                Mis à jour le {updatedLabel}
              </Text>
            </Group>
          )}
          {sourceUrl && (
            <Anchor
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              size="xs"
              c="dimmed"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: rem(4),
              }}
            >
              <IconBrandGithub size={13} aria-hidden />
              Modifier sur GitHub
            </Anchor>
          )}
        </Group>
      )}
    </Stack>
  );
}

export default DocPageHeader;
