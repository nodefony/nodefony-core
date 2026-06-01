/**
 * **ConfigSummaryCard** — carte de **synthèse** de la configuration d'un module,
 * pour un accueil / une vue d'ensemble. Réutilisable PARTOUT (le pendant compact
 * de `ConfigLayout`).
 *
 * Dérive ses chiffres des **mêmes `ConfigSection[]`** que la fiche détaillée (DRY,
 * 0 divergence) : total de réglages, répartition par état (à chaud / au
 * redémarrage / réservé / dérivé kernel / secret), statut du schéma Zod. Un bouton
 * « Tout voir » mène à la fiche complète.
 */
import {
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconSettings,
  IconBolt,
  IconLock,
  IconWand,
  IconEyeOff,
} from "@tabler/icons-react";
import type { ConfigSchemaStatus, ConfigSection } from "./ConfigLayout";
import { DocHint } from "./DocHint";

export interface ConfigSummaryCardProps {
  /** Nom du module. */
  module: string;
  /** Statut de migration Zod. Défaut `none`. */
  schema?: ConfigSchemaStatus;
  /** Les sections (mêmes données que `ConfigLayout`). */
  sections: ConfigSection[];
  /** Action « Tout voir » (ouvre la fiche détaillée / l'onglet Config). */
  onOpen?: () => void;
  /** Hauteur de la carte (défaut `100%` pour épouser une Grid.Col). */
  height?: number | string;
}

const SCHEMA: Record<ConfigSchemaStatus, { label: string; color: string }> = {
  zod: { label: "validé Zod", color: "teal" },
  partial: { label: "schéma partiel", color: "yellow" },
  none: { label: "non migré (Zod)", color: "gray" },
};

/** Grand chiffre + libellé (mini-stat). */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Stack gap={0}>
      <Text
        fw={700}
        fz={26}
        lh={1}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Stack>
  );
}

export function ConfigSummaryCard({
  module,
  schema = "none",
  sections,
  onOpen,
  height = "100%",
}: ConfigSummaryCardProps) {
  const fields = sections.flatMap((s) => s.fields);
  const total = fields.length;
  const reserved = fields.filter((f) => f.reserved).length;
  const live = fields.filter(
    (f) => f.mutability === "live" && !f.reserved,
  ).length;
  const derived = fields.filter((f) => f.kernelDerived).length;
  const secret = fields.filter((f) => f.secret).length;
  // « au redémarrage » = tout ce qui n'est ni à chaud ni réservé (boot + readonly).
  const atBoot = total - live - reserved;
  const sm = SCHEMA[schema];

  return (
    <Card
      withBorder
      radius="md"
      p="lg"
      h={height}
      style={{ contain: "content" }}
    >
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="brand" size="md" radius="md">
            <IconSettings size={16} />
          </ThemeIcon>
          <Title order={5}>Configuration</Title>
          <Badge variant="light" color={sm.color} tt="none">
            {sm.label}
          </Badge>
          <DocHint
            title="Synthèse de la configuration"
            summary="Aperçu de ce qui est configurable sur ce module : combien de réglages, et lesquels peuvent changer sans redémarrer."
            sections={[
              {
                label: "À chaud vs au redémarrage",
                body: "« À chaud » = relu à chaque requête (modifiable en dev sans reboot). Le reste est figé au démarrage (12-factor).",
              },
            ]}
          />
        </Group>
        {onOpen && (
          <Button variant="light" size="xs" onClick={onOpen}>
            Tout voir
          </Button>
        )}
      </Group>

      <Group gap="xl" mb="md">
        <Stat value={total} label="réglages" />
        <Stat value={sections.length} label="sections" />
      </Group>

      <Group gap={6} wrap="wrap">
        <Badge
          variant="light"
          color="teal"
          leftSection={<IconBolt size={11} />}
          tt="none"
        >
          {live} à chaud
        </Badge>
        <Badge
          variant="light"
          color="gray"
          leftSection={<IconLock size={11} />}
          tt="none"
        >
          {atBoot} au redémarrage
        </Badge>
        {reserved > 0 && (
          <Badge
            variant="light"
            color="gray"
            leftSection={<IconLock size={11} />}
            tt="none"
          >
            {reserved} réservé{reserved > 1 ? "s" : ""}
          </Badge>
        )}
        {derived > 0 && (
          <Badge
            variant="light"
            color="cyan"
            leftSection={<IconWand size={11} />}
            tt="none"
          >
            {derived} auto (kernel)
          </Badge>
        )}
        {secret > 0 && (
          <Badge
            variant="light"
            color="orange"
            leftSection={<IconEyeOff size={11} />}
            tt="none"
          >
            {secret} secret{secret > 1 ? "s" : ""}
          </Badge>
        )}
      </Group>
    </Card>
  );
}
