/**
 * Composants **visuels réutilisables** de la page Log Backplane. Briques sans
 * état, sûres (rendu en TEXTE, jamais d'HTML injecté), accessibles. Partagées
 * par les onglets Live / Explorer / Fichiers / Backplane et le drawer de détail.
 */
import { Badge, Group, Text, ThemeIcon, Tooltip } from "@mantine/core";
import {
  IconStack2,
  IconFileText,
  IconSearch,
  IconDatabase,
  IconDeviceFloppy,
  IconBroadcast,
} from "@tabler/icons-react";
import type { FC } from "react";
import type { LogDriverCapabilities, Severity } from "./logsTypes";
import {
  driverMeta,
  severityColor,
  severityVariant,
  type DriverIconKind,
} from "./logFormat";

/** Icône d'un type de driver. */
const DRIVER_ICONS: Record<DriverIconKind, FC<{ size?: number }>> = {
  memory: IconStack2,
  file: IconFileText,
  search: IconSearch,
  generic: IconDatabase,
};

/**
 * **DriverIcon** — icône d'un driver de relecture, dérivée de son nom via
 * {@link driverMeta}. Pastille `ThemeIcon` colorée.
 */
export function DriverIcon({
  name,
  size = 18,
  color = "brand",
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const Icon = DRIVER_ICONS[driverMeta(name).icon];
  return (
    <ThemeIcon variant="light" color={color} size={size + 14} radius="md">
      <Icon size={size} />
    </ThemeIcon>
  );
}

/**
 * **SeverityBadge** — badge de sévérité RFC 5424 (couleur + variante cohérentes
 * partout). Largeur min fixe → colonnes alignées dans les listes.
 */
export function SeverityBadge({
  severity,
  size = "xs",
  fullWidth = true,
}: {
  severity: string;
  size?: "xs" | "sm" | "md";
  fullWidth?: boolean;
}) {
  return (
    <Badge
      size={size}
      color={severityColor(severity)}
      variant={severityVariant(severity)}
      style={
        fullWidth
          ? { flexShrink: 0, minWidth: 78, textAlign: "center" }
          : { flexShrink: 0 }
      }
    >
      {severity}
    </Badge>
  );
}

/**
 * Libellé **en clair** + icône de chaque capacité d'un driver. Le `label` est en
 * français parlant (pas de jargon « queryable ») ; `tech` garde le nom technique
 * du contrat (`write`/`query`/`stream`) pour les développeurs, affiché en second
 * dans le tooltip.
 */
const CAPABILITY_META: Record<
  keyof LogDriverCapabilities,
  { label: string; tech: string; icon: FC<{ size?: number }>; help: string }
> = {
  write: {
    label: "Persistant",
    tech: "write",
    icon: IconDeviceFloppy,
    help: "Conserve les logs dans la durée : ils survivent à un redémarrage. Driver « en mémoire » = volatil (tout est perdu au reboot).",
  },
  query: {
    label: "Recherche",
    tech: "query",
    icon: IconSearch,
    help: "Permet de FOUILLER l'historique : filtres, recherche plein-texte, suivi d'une requête (onglet Explorer). Sans elle, on ne peut que regarder le flux en direct, pas chercher dans le passé.",
  },
  stream: {
    label: "Temps réel",
    tech: "stream",
    icon: IconBroadcast,
    help: "Alimente le flux direct des logs au fil de l'eau (onglet Live).",
  },
};

/**
 * **CapabilityBadges** — les 3 capacités d'un driver en badges **en clair**
 * (Persistant / Recherche / Temps réel) : vert plein si présente, gris barré
 * sinon. Chaque badge porte un tooltip qui explique la capacité + son nom
 * technique (`write`/`query`/`stream`) → auto-documentation, sans jargon.
 */
export function CapabilityBadges({
  capabilities,
  size = "sm",
}: {
  capabilities: LogDriverCapabilities;
  size?: "xs" | "sm";
}) {
  return (
    <Group gap={4} wrap="nowrap">
      {(Object.keys(CAPABILITY_META) as (keyof LogDriverCapabilities)[]).map(
        (cap) => {
          const meta = CAPABILITY_META[cap];
          const on = capabilities[cap];
          const Icon = meta.icon;
          return (
            <Tooltip
              key={cap}
              label={`${meta.label} (${meta.tech}) — ${on ? meta.help : "non disponible sur ce driver."}`}
              multiline
              w={260}
              withArrow
            >
              <Badge
                size={size}
                variant={on ? "light" : "outline"}
                color={on ? "teal" : "gray"}
                leftSection={<Icon size={11} />}
                styles={on ? undefined : { root: { opacity: 0.5 } }}
              >
                {meta.label}
              </Badge>
            </Tooltip>
          );
        },
      )}
    </Group>
  );
}

/**
 * **SeverityCountChips** — compteurs par sévérité, **cliquables** = bascule un
 * filtre (santé en un coup d'œil + filtrage immédiat). Une sévérité à 0 est
 * masquée (pas de bruit). La sévérité active est mise en avant (variant plein).
 * Ergonomie calme : le style ne dépend QUE de l'état actif (pas de la valeur qui
 * tique) → pas de clignotement quand un compteur s'incrémente.
 */
export function SeverityCountChips({
  counts,
  active,
  onToggle,
}: {
  counts: Record<Severity, number>;
  /** Sévérités actuellement filtrées (vide = aucune). */
  active: ReadonlySet<Severity>;
  onToggle: (severity: Severity) => void;
}) {
  const entries = (Object.entries(counts) as [Severity, number][]).filter(
    ([, n]) => n > 0,
  );
  if (entries.length === 0) return null;
  return (
    <Group gap={4} wrap="wrap">
      {entries.map(([sev, n]) => {
        const isActive = active.has(sev);
        return (
          <Badge
            key={sev}
            component="button"
            type="button"
            onClick={() => onToggle(sev)}
            size="sm"
            color={severityColor(sev)}
            variant={isActive ? "filled" : "light"}
            style={{ cursor: "pointer" }}
            aria-pressed={isActive}
            aria-label={`${sev} : ${n} — ${isActive ? "retirer du filtre" : "filtrer"}`}
            rightSection={
              <Text span size="xs" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                {n}
              </Text>
            }
          >
            {sev}
          </Badge>
        );
      })}
    </Group>
  );
}
