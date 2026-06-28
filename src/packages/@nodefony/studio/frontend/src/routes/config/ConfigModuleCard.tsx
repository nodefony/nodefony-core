/**
 * **ConfigModuleCard** — tuile « résumé parfait » de la config d'UN module, pour le
 * dashboard de `/nodefony/config` (remplace le gros accordion). Scannable d'un coup
 * d'œil + cliquable → ouvre la fiche du module sur l'onglet Config (`?tab=config`).
 *
 * Mène par l'ESSENTIEL : combien de surcharges (l'identité du module), réparties
 * app/env, + un aperçu des 3 premières. Le détail complet est derrière le clic
 * (divulgation progressive — jamais 100 réglages dumpés ici).
 */
import { Badge, Card, Code, Group, Stack, Text } from "@mantine/core";
import { IconBolt, IconChevronRight, IconEyeOff } from "@tabler/icons-react";
import type { ModuleConfig } from "./configModel";

/** Provenance → couleur de pastille (aligné sur ConfigLayout). */
const SRC_COLOR: Record<string, string> = { app: "grape", env: "teal" };

export interface ConfigModuleCardProps {
  /** Module agrégé (entrée + sections). */
  m: ModuleConfig;
  /** Ouvre la fiche du module (onglet Config). */
  onOpen: () => void;
}

/** Tuile de synthèse config d'un module — cliquable (clavier + souris). */
export function ConfigModuleCard({ m, onOpen }: ConfigModuleCardProps) {
  const fields = m.sections.flatMap((s) => s.fields);
  const overrides = fields.filter(
    (f) => f.source === "app" || f.source === "env",
  );
  const appN = overrides.filter((f) => f.source === "app").length;
  const envN = overrides.filter((f) => f.source === "env").length;
  const secrets = fields.filter((f) => f.secret).length;
  const live = fields.filter(
    (f) => f.mutability === "live" && !f.reserved,
  ).length;
  const top = overrides.slice(0, 3);

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      role="button"
      tabIndex={0}
      aria-label={`Configuration de ${m.entry.name} — ${overrides.length} surcharge(s)`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        contain: "content",
      }}
    >
      {/* En-tête : nom + badges (app / schéma) + chevron d'ouverture */}
      <Group justify="space-between" wrap="nowrap" mb={4} gap="xs">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {m.entry.isApp && (
            <Badge size="xs" variant="light" color="grape" tt="none">
              app
            </Badge>
          )}
          <Text fw={600} truncate>
            {m.entry.name}
          </Text>
        </Group>
        <IconChevronRight
          size={16}
          style={{ opacity: 0.4, flexShrink: 0 }}
          aria-hidden
        />
      </Group>

      <Badge
        size="xs"
        variant="light"
        color={m.schemaStatus === "zod" ? "teal" : "gray"}
        tt="none"
        mb="sm"
        style={{ alignSelf: "flex-start" }}
      >
        {m.schemaStatus === "zod" ? "validé Zod" : "non migré"}
      </Badge>

      {/* Hero : le nombre de surcharges (l'identité du module) */}
      <Group align="baseline" gap={6}>
        <Text
          fw={700}
          fz={28}
          lh={1}
          c={overrides.length ? undefined : "dimmed"}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {overrides.length}
        </Text>
        <Text size="sm" c="dimmed">
          {overrides.length > 1 ? "surcharges" : "surcharge"}
        </Text>
      </Group>

      {/* Répartition + état */}
      <Group gap={6} wrap="wrap" mt={6} mb="xs">
        {appN > 0 && (
          <Badge size="xs" variant="dot" color="grape" tt="none">
            {appN} app
          </Badge>
        )}
        {envN > 0 && (
          <Badge size="xs" variant="dot" color="teal" tt="none">
            {envN} env
          </Badge>
        )}
        {live > 0 && (
          <Badge
            size="xs"
            variant="light"
            color="teal"
            leftSection={<IconBolt size={10} />}
            tt="none"
          >
            {live} à chaud
          </Badge>
        )}
        {secrets > 0 && (
          <Badge
            size="xs"
            variant="light"
            color="orange"
            leftSection={<IconEyeOff size={10} />}
            tt="none"
          >
            {secrets} secret{secrets > 1 ? "s" : ""}
          </Badge>
        )}
      </Group>

      {/* Aperçu des surcharges (top 3) — le reste derrière le clic */}
      <Stack gap={3} style={{ flex: 1 }}>
        {top.length === 0 ? (
          <Text size="xs" c="dimmed">
            Tout par défaut · {fields.length} réglage
            {fields.length > 1 ? "s" : ""}
          </Text>
        ) : (
          <>
            {top.map((f) => (
              <Group key={f.key} gap={6} wrap="nowrap" justify="space-between">
                <Code
                  fz={11}
                  title={f.key}
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {f.key}
                </Code>
                <Badge
                  size="xs"
                  variant="light"
                  color={SRC_COLOR[f.source ?? "app"] ?? "gray"}
                  tt="none"
                  style={{ flexShrink: 0 }}
                >
                  {f.source}
                </Badge>
              </Group>
            ))}
            {overrides.length > top.length && (
              <Text size="xs" c="dimmed">
                +{overrides.length - top.length} autre
                {overrides.length - top.length > 1 ? "s" : ""}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
