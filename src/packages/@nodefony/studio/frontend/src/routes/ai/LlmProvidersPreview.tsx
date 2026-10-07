import {
  Badge,
  Card,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Timeline,
} from "@mantine/core";
import { IconBrain, IconCheck, IconLock, IconX } from "@tabler/icons-react";
import {
  DataGrid,
  DocHint,
  PageLayout,
  StatCard,
  type DataGridColumn,
} from "../../components/ui";
import {
  DATA_FRONTIER,
  GUARDRAILS,
  PROVIDERS,
  SUPERVISED_BACKEND,
  ZONES,
  type IPreviewProvider,
} from "./aiPreviewModel";
import {
  HealthBadge,
  LimitGauge,
  PreviewBanner,
  ZoneBadge,
  fmt,
} from "./aiPreviewParts";

const COLUMNS: DataGridColumn<IPreviewProvider>[] = [
  {
    key: "label",
    header: "Fournisseur",
    render: (p) => (
      <Stack gap={0}>
        <Text size="sm" fw={600}>
          {p.label}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          {p.model}
        </Text>
      </Stack>
    ),
    value: (p) => p.label,
  },
  {
    key: "mode",
    header: "Mode",
    render: (p) =>
      p.mode === "sovereign" ? (
        <Badge
          color="teal"
          variant="light"
          size="sm"
          leftSection={<IconLock size={12} />}
        >
          souverain
        </Badge>
      ) : (
        <Badge color="gray" variant="light" size="sm">
          cloud
        </Badge>
      ),
    value: (p) => p.mode,
  },
  { key: "hosting", header: "Hébergement", value: (p) => p.hosting },
  {
    key: "status",
    header: "État",
    render: (p) => <HealthBadge status={p.status} />,
    value: (p) => p.status,
  },
  {
    key: "ttftMs",
    header: "1er jeton (p50)",
    align: "right",
    value: (p) => p.ttftMs,
    render: (p) => (p.ttftMs === null ? "—" : `${fmt(p.ttftMs)} ms`),
  },
  {
    key: "tokensPerSec",
    header: "Débit",
    align: "right",
    value: (p) => p.tokensPerSec,
    render: (p) =>
      p.tokensPerSec === null ? "—" : `${p.tokensPerSec} jetons/s`,
  },
  {
    key: "calls24h",
    header: "Appels 24 h",
    align: "right",
    value: (p) => p.calls24h,
    render: (p) => fmt(p.calls24h),
  },
  {
    key: "costEur24h",
    header: "Coût 24 h",
    align: "right",
    value: (p) => p.costEur24h,
    render: (p) => `${fmt(p.costEur24h, 2)} €`,
  },
];

/**
 * Fournisseurs LLM — un contrat (`ILLMProvider`), plusieurs back-ends, et la
 * frontière qui décide quelle donnée part chez qui.
 */
export function LlmProvidersPreview() {
  const active = PROVIDERS.filter((p) => p.status !== "off");
  const calls = PROVIDERS.reduce((n, p) => n + p.calls24h, 0);
  const local = PROVIDERS.filter((p) => p.mode === "sovereign").reduce(
    (n, p) => n + p.calls24h,
    0,
  );
  const cost = PROVIDERS.reduce((n, p) => n + p.costEur24h, 0);
  const b = SUPERVISED_BACKEND;

  return (
    <PageLayout
      title="Fournisseurs LLM"
      subtitle="Une interface, plusieurs modèles — et la donnée ne sort pas sans décision."
      icon={<IconBrain size={22} />}
    >
      <PreviewBanner module="@nodefony/llm" contract="ILLMProvider" />

      <Grid>
        <StatCard label="Fournisseurs actifs" hint="configurés et joignables">
          {active.length} / {PROVIDERS.length}
        </StatCard>
        <StatCard
          label="Part souveraine"
          hint={`${fmt(local)} appels sur ${fmt(calls)} servis sans sortir de l'infrastructure`}
        >
          {fmt((local / calls) * 100)} %
        </StatCard>
        <StatCard label="Coût 24 h" hint="somme des usages facturés, en euros">
          {fmt(cost, 2)} €
        </StatCard>
        <StatCard
          label="Appels 24 h"
          hint="chaque appel est corrélé à son requestId dans le journal d'audit"
        >
          {fmt(calls)}
        </StatCard>
      </Grid>

      <DataGrid
        mode="client"
        data={PROVIDERS}
        columns={COLUMNS}
        getRowId={(p) => p.name}
        searchable={false}
        height={260}
      />

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" padding="md">
          <Group gap={6} mb="sm">
            <Text fw={600}>Inférence supervisée</Text>
            <DocHint
              title="Nodefony orchestre, il n'exécute pas"
              summary="ADR-0004 : le modèle tourne dans SON process, que Nodefony lance, surveille et expose."
              sections={[
                {
                  label: "Pourquoi pas dans le serveur",
                  body: "Une inférence monopolise le CPU ou le GPU plusieurs secondes : dans le process du serveur, elle bloquerait toutes les autres requêtes. Et les deux plans ne passent pas à l'échelle de la même façon — le serveur se duplique, la mémoire vidéo coûte cher.",
                },
                {
                  label: "Comment",
                  body: "Le même modèle que pour le front : ViteSupervisor ne réimplémente pas Vite, il le supervise. Ici, une ligne de configuration lance Ollama, télécharge le modèle s'il manque et l'expose derrière ILLMProvider.",
                },
              ]}
            />
          </Group>
          <Group gap="lg" mb="md">
            <Text size="sm">
              <Text span c="dimmed">
                process{" "}
              </Text>
              <Text span ff="monospace">
                {b.command}
              </Text>{" "}
              · pid {b.pid}
            </Text>
            <Text size="sm" c="dimmed">
              actif depuis {b.uptime}
            </Text>
          </Group>
          <Timeline active={b.steps.length - 1} bulletSize={20} lineWidth={2}>
            {b.steps.map((s) => (
              <Timeline.Item
                key={s.label}
                bullet={<IconCheck size={12} />}
                title={<Text size="sm">{s.label}</Text>}
              >
                <Text size="xs" c="dimmed">
                  {s.detail}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
          <LimitGauge
            label="Mémoire vidéo"
            current={b.vramUsedGb}
            limit={b.vramTotalGb}
            unit="Go"
          />
        </Card>

        <Card withBorder radius="md" padding="md">
          <Group gap={6} mb="sm">
            <Text fw={600}>Garde-fous</Text>
            <DocHint
              title="Des bornes avant le disjoncteur"
              summary="Valeurs prudentes par défaut, surchargeables : elles plafonnent le coût et l'impact d'un agent qui dérive."
            />
          </Group>
          <Stack gap="sm">
            {GUARDRAILS.map((g) => (
              <LimitGauge
                key={g.label}
                label={g.label}
                current={g.current}
                limit={g.limit}
                unit={g.unit}
              />
            ))}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Frontière des données</Text>
          <DocHint
            title="Quelle donnée part chez qui"
            summary="La zone de confiance d'une requête décide des fournisseurs autorisés. En zone restreinte, seul le modèle local répond."
            sections={[
              {
                label: "Ce que ça garantit",
                body: "Une donnée de santé ou de défense ne quitte jamais l'infrastructure : aucun fournisseur cloud n'est même candidat. La règle se lit ici, elle ne se déduit pas du code.",
              },
            ]}
          />
        </Group>
        <Table withTableBorder={false} striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Zone</Table.Th>
              {PROVIDERS.filter((p) => p.status !== "off").map((p) => (
                <Table.Th key={p.name}>{p.label}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ZONES.map((z) => (
              <Table.Tr key={z}>
                <Table.Td>
                  <ZoneBadge zone={z} />
                </Table.Td>
                {PROVIDERS.filter((p) => p.status !== "off").map((p) => {
                  const ok = DATA_FRONTIER[z].includes(p.name);
                  return (
                    <Table.Td key={p.name}>
                      <ThemeIcon
                        size="sm"
                        radius="xl"
                        variant="light"
                        color={ok ? "teal" : "red"}
                        role="img"
                        aria-label={ok ? "autorisé" : "interdit"}
                      >
                        {ok ? <IconCheck size={12} /> : <IconX size={12} />}
                      </ThemeIcon>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </PageLayout>
  );
}
