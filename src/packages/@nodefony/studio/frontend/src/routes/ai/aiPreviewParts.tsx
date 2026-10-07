import {
  Alert,
  Badge,
  Code,
  Group,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { IconFlask } from "@tabler/icons-react";
import type {
  BreakerState,
  PreviewHealth,
  PreviewZone,
} from "./aiPreviewModel";

/**
 * Bandeau commun des écrans « IA — Atelier » : ce qu'on regarde est une
 * SIMULATION de la destination, et il le dit avant toute donnée.
 *
 * Il nomme le module et le contrat visés : c'est ce qui permet de lire l'écran
 * comme une spécification, pas comme un état de production.
 */
export function PreviewBanner({
  module,
  contract,
}: {
  module: string;
  contract: string;
}) {
  return (
    <Alert
      variant="light"
      color="violet"
      icon={<IconFlask size={18} />}
      title="Aperçu — données simulées"
    >
      <Text size="sm">
        Cet écran montre la cible de <Code>{module}</Code>, dans la forme de son
        contrat <Code>{contract}</Code>. Aucune donnée n'est réelle et rien
        n'est branché : la couche IA n'est pas dans la version 10.
      </Text>
    </Alert>
  );
}

const HEALTH: Record<PreviewHealth, { color: string; label: string }> = {
  ok: { color: "teal", label: "sain" },
  degraded: { color: "yellow", label: "dégradé" },
  down: { color: "red", label: "injoignable" },
  off: { color: "gray", label: "non configuré" },
};

export function HealthBadge({ status }: { status: PreviewHealth }) {
  const h = HEALTH[status];
  return (
    <Badge variant="light" color={h.color} size="sm">
      {h.label}
    </Badge>
  );
}

const ZONE: Record<PreviewZone, { color: string; label: string }> = {
  public: { color: "blue", label: "public" },
  internal: { color: "grape", label: "interne" },
  restricted: { color: "red", label: "restreinte" },
};

export function ZoneBadge({ zone }: { zone: PreviewZone }) {
  return (
    <Badge variant="outline" color={ZONE[zone].color} size="sm">
      {ZONE[zone].label}
    </Badge>
  );
}

const BREAKER: Record<BreakerState, { color: string; label: string }> = {
  closed: { color: "teal", label: "fermé" },
  "half-open": { color: "yellow", label: "semi-ouvert" },
  open: { color: "red", label: "ouvert" },
};

export function BreakerBadge({ state }: { state: BreakerState }) {
  const b = BREAKER[state];
  return (
    <Badge variant="light" color={b.color} size="sm">
      disjoncteur {b.label}
    </Badge>
  );
}

/** Une jauge « consommé / plafond » : la couleur suit la proximité du plafond. */
export function LimitGauge({
  label,
  current,
  limit,
  unit,
}: {
  label: string;
  current: number;
  limit: number;
  unit: string;
}) {
  const pct = Math.min(100, (current / limit) * 100);
  const color = pct >= 90 ? "red" : pct >= 70 ? "yellow" : "teal";
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {current.toLocaleString("fr-FR")} / {limit.toLocaleString("fr-FR")}{" "}
          {unit}
        </Text>
      </Group>
      <Progress
        value={pct}
        color={color}
        size="sm"
        aria-label={`${label} : ${Math.round(pct)} % du plafond`}
      />
    </Stack>
  );
}

/** Nombre au format français, chiffres alignés. */
export function fmt(n: number, digits = 0): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
