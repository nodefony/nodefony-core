/**
 * **ConfigExplorer** — exploration de la config d'UN module : un résumé qui mène
 * par les **écarts au défaut** (surcharges actives + secrets + champs éditables à
 * chaud), puis le détail complet éditable (`ConfigLayout`, le moteur partagé).
 *
 * Partagé : l'onglet Config d'un module (`ModuleDetail`) le consomme pour offrir
 * la MÊME lecture « écarts d'abord » que la page globale `/nodefony/config`, mais
 * scopée au module. La collecte des surcharges est factorisée (`collectFieldOverrides`,
 * configModel) ; le rendu détaillé reste `ConfigLayout` (aucune réécriture).
 */
import { useMemo, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Card,
  Code,
  CopyButton,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  ConfigLayout,
  DocHint,
  TipHint,
  type ConfigSchemaStatus,
  type ConfigSection,
  type ConfigField,
  type EditResult,
} from "../../components/ui";
import {
  collectFieldOverrides,
  type FieldOverride,
  type OverrideSource,
} from "./configModel";

export interface ConfigExplorerProps {
  /** Nom du module (en-tête). */
  module: string;
  /** Segment d'adressage des overrides (`NF__<SEG>__…`). */
  seg: string;
  /** État de migration du schéma de validation. */
  schema: ConfigSchemaStatus;
  /** Sections déjà enrichies (recette d'override injectée). */
  sections: ConfigSection[];
  /** Active l'édition LIVE (dev — le serveur reste autoritaire). */
  editable?: boolean;
  /** Applique une édition live (PATCH config + toast + refetch côté page). */
  onEdit?: (field: ConfigField, value: unknown) => Promise<EditResult>;
}

/** Méta d'affichage d'une provenance surchargée. */
const SRC: Record<OverrideSource, { label: string; color: string }> = {
  app: { label: "app", color: "grape" },
  env: { label: "env", color: "teal" },
  runtime: { label: "runtime", color: "cyan" },
};

/** Indicateur compact (valeur + label + aide optionnelle) du bandeau résumé. */
function Metric({
  value,
  label,
  hint,
  color,
}: {
  value: number;
  label: string;
  hint?: ReactNode;
  color?: string;
}) {
  return (
    <Group gap={8} wrap="nowrap">
      <Text fz={22} fw={700} lh={1} c={value > 0 ? color : "dimmed"}>
        {value}
      </Text>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {label}
        </Text>
        {hint}
      </Group>
    </Group>
  );
}

/** Recette d'override copiable (`NF__…`) — pastille compacte. */
function CopyRecipe({ value }: { value: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Code style={{ fontSize: 11 }}>{value}</Code>
      <CopyButton value={value} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copié" : "Copier"} withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={copied ? "teal" : "gray"}
              aria-label={`Copier ${value}`}
              onClick={copy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

/** Table compacte des surcharges actives du module (les écarts au défaut). */
function OverridesCard({ overrides }: { overrides: FieldOverride[] }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group gap={6} mb="sm">
        <Text fw={600} size="sm">
          Surcharges actives
        </Text>
        <Text size="xs" c="dimmed">
          {overrides.length} réglage(s) ≠ défaut
        </Text>
        <DocHint
          title="Surcharges actives"
          summary="Les réglages de ce module qui DIFFÈRENT du défaut du framework — d'où vient la valeur (app/env/runtime) et la recette 12-factor pour la piloter. C'est l'identité de ce module dans CE déploiement."
        />
      </Group>
      <Table verticalSpacing={6} horizontalSpacing="md" withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Réglage</Table.Th>
            <Table.Th style={{ width: 110 }}>Provenance</Table.Th>
            <Table.Th>Surchargé par / recette</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {overrides.map((o) => (
            <Table.Tr key={o.field}>
              <Table.Td>
                <Code style={{ fontSize: 12 }}>{o.field}</Code>
              </Table.Td>
              <Table.Td>
                <Badge
                  size="sm"
                  variant="light"
                  color={SRC[o.source].color}
                  tt="none"
                >
                  {SRC[o.source].label}
                </Badge>
              </Table.Td>
              <Table.Td>
                {o.source === "runtime" ? (
                  <Text size="xs" c="dimmed">
                    {o.where}
                  </Text>
                ) : (
                  <CopyRecipe value={o.overrideKey} />
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/**
 * Visualise + édite la config d'un module : résumé des écarts (surcharges,
 * éditables à chaud, secrets) puis détail complet (`ConfigLayout`).
 */
export function ConfigExplorer({
  module,
  seg,
  schema,
  sections,
  editable = false,
  onEdit,
}: ConfigExplorerProps) {
  const overrides = useMemo(
    () => collectFieldOverrides(sections, seg),
    [sections, seg],
  );
  const { live, secrets } = useMemo(() => {
    let live = 0;
    let secrets = 0;
    for (const s of sections) {
      for (const f of s.fields) {
        if (f.mutability === "live") live++;
        if (f.secret) secrets++;
      }
    }
    return { live, secrets };
  }, [sections]);

  return (
    <Stack gap="lg">
      {/* Résumé : ce que ConfigLayout ne met pas en avant (les écarts). */}
      <Card withBorder radius="md" p="md">
        <Group gap="xl" wrap="wrap">
          <Metric
            value={overrides.length}
            label="Surcharges"
            color="grape"
            hint={
              <DocHint
                title="Surcharges"
                summary="Réglages dont la valeur effective diffère du défaut du framework (app, env, ou édition à chaud). 0 = ce module tourne en config stock."
                width={260}
              />
            }
          />
          <Metric
            value={live}
            label="À chaud (dev)"
            color="teal"
            hint={
              <DocHint
                title="Éditables à chaud"
                summary="Réglages relus à chaque requête (ou recalculés via un seam) : modifiables en développement sans redémarrage, figés en production."
                width={280}
              />
            }
          />
          <Metric
            value={secrets}
            label="Secrets"
            color="orange"
            hint={
              <DocHint
                title="Secrets"
                summary="Champs sensibles masqués ici et rédigés dans les logs (redaction côté serveur). Jamais éditables via l'API (recette *_FILE)."
                width={260}
              />
            }
          />
        </Group>
      </Card>

      {overrides.length > 0 ? (
        <OverridesCard overrides={overrides} />
      ) : (
        <TipHint
          title="Module en configuration par défaut"
          summary="Aucun réglage ne diffère du défaut du framework — rien n'est surchargé par l'app, l'environnement ni une édition à chaud. État sain (config stock)."
        >
          <Badge variant="light" color="gray" tt="none">
            aucune surcharge
          </Badge>
        </TipHint>
      )}

      <ConfigLayout
        module={module}
        schema={schema}
        sections={sections}
        editable={editable}
        onEdit={onEdit}
      />
    </Stack>
  );
}

export default ConfigExplorer;
