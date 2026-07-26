/**
 * **ConfigSummaryCard** — carte de **synthèse + aperçu** de la configuration d'un
 * module (vue d'ensemble). Le pendant compact de `ConfigLayout`, mais
 * **intelligent** : chiffres clés (total / par état), **recherche**, et un aperçu
 * **scrollable** des réglages (clé → valeur effective ; les valeurs tableau/objet
 * s'ouvrent en carte JSON au survol, héritées du `field.effective`).
 *
 * Dérive tout des **mêmes `ConfigSection[]`** que la fiche détaillée (DRY, 0
 * divergence). Un bouton « Tout voir » mène à la fiche complète.
 */
import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconSettings,
  IconBolt,
  IconLock,
  IconWand,
  IconEyeOff,
  IconSearch,
} from "@tabler/icons-react";
import type {
  ConfigField,
  ConfigSchemaStatus,
  ConfigSection,
} from "./ConfigLayout";
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

/** Normalise pour une recherche tolérante (sans accents, minuscules). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Texte recherchable d'un réglage (champs string uniquement). */
function searchText(f: ConfigField): string {
  const parts = [f.key];
  if (typeof f.type === "string") parts.push(f.type);
  if (typeof f.description === "string") parts.push(f.description);
  if (typeof f.constraint === "string") parts.push(f.constraint);
  return parts.join(" ");
}

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

/** Une ligne d'aperçu : clé (tronquée) → valeur effective. */
function PreviewRow({ field }: { field: ConfigField }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
      <Code
        fz={11}
        title={field.key}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          flex: "1 1 auto",
        }}
      >
        {field.key}
      </Code>
      <Box style={{ flex: "0 0 auto", maxWidth: "55%", textAlign: "right" }}>
        {field.effective ?? (
          <Text span size="xs" c="dimmed">
            —
          </Text>
        )}
      </Box>
    </Group>
  );
}

export function ConfigSummaryCard({
  schema = "none",
  sections,
  onOpen,
  height = "100%",
}: ConfigSummaryCardProps) {
  const [query, setQuery] = useState("");
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
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

  // Carte INTELLIGENTE : par défaut on n'affiche QUE les surcharges (réglages ≠
  // défaut = l'identité du déploiement), pas les 100+ réglages (scroll inutile).
  // La recherche révèle alors TOUS les réglages ; « Tout voir » ouvre la fiche.
  const overrides = useMemo(
    () => fields.filter((f) => f.source === "app" || f.source === "env"),
    [fields],
  );
  const shown = useMemo(() => {
    const terms = norm(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return overrides;
    return fields.filter((f) => {
      const hay = norm(searchText(f));
      return terms.every((t) => hay.includes(t));
    });
  }, [fields, overrides, query]);

  return (
    <Card
      withBorder
      radius="md"
      p="lg"
      h={height}
      style={{ contain: "content", display: "flex", flexDirection: "column" }}
    >
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="brand" size="md" radius="md">
            <IconSettings size={16} />
          </ThemeIcon>
          <Text fw={600}>Configuration</Text>
          <Badge variant="light" color={sm.color} tt="none">
            {sm.label}
          </Badge>
          <DocHint
            title="Synthèse de la configuration"
            summary="Aperçu de ce qui est configurable sur ce module : combien de réglages, lesquels changent sans redémarrer, et la valeur effective de chacun (recherche + détail au survol)."
            sections={[
              {
                label: "À chaud vs au redémarrage",
                body: "« À chaud » = relu à chaque requête (modifiable en dev sans reboot). Le reste est figé au démarrage (12-factor).",
              },
              {
                label: "Valeurs complexes",
                body: "Une valeur tableau / objet s'affiche en aperçu compact ; survole-la pour la carte JSON complète.",
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

      <Group gap="xl" mb="sm">
        <Stat value={total} label="réglages" />
        <Stat value={sections.length} label="sections" />
      </Group>

      <Group gap={6} wrap="wrap" mb="sm">
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

      <TextInput
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder="Rechercher un réglage…"
        aria-label="Rechercher un réglage de configuration"
        leftSection={<IconSearch size={15} />}
        size="xs"
        mb="xs"
      />

      <Text size="xs" c="dimmed" mb={6}>
        {query
          ? `${shown.length} résultat${shown.length > 1 ? "s" : ""} sur ${total}`
          : overrides.length
            ? `${overrides.length} surcharge${overrides.length > 1 ? "s" : ""} — réglages ≠ défaut`
            : `Tout par défaut · ${total} réglage${total > 1 ? "s" : ""}`}
      </Text>

      <ScrollArea
        style={{ flex: 1 }}
        mih={60}
        mah={260}
        type="auto"
        offsetScrollbars
      >
        {shown.length === 0 ? (
          <Text c="dimmed" size="xs" py="sm">
            {query
              ? "Aucun réglage ne correspond."
              : "Aucune surcharge : ce module tourne sur ses défauts. Cherche un réglage ci-dessus pour explorer, ou « Tout voir »."}
          </Text>
        ) : (
          <Stack gap={6} pr="xs">
            {shown.map((f) => (
              <PreviewRow key={f.key} field={f} />
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Card>
  );
}
