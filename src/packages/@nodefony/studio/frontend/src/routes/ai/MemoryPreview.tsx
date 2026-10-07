import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Timeline,
} from "@mantine/core";
import {
  IconArchive,
  IconRobot,
  IconSettings,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  DataGrid,
  DocHint,
  PageLayout,
  StatCard,
  type DataGridColumn,
} from "../../components/ui";
import {
  MEMORY_CONSOLIDATION,
  MEMORY_SESSIONS,
  MEMORY_TIERS,
  MEMORY_TIMELINE,
  type IPreviewMemorySession,
} from "./aiPreviewModel";
import { PreviewBanner, fmt } from "./aiPreviewParts";

const COLUMNS: DataGridColumn<IPreviewMemorySession>[] = [
  {
    key: "sessionId",
    header: "Session",
    value: (s) => s.sessionId,
    render: (s) => (
      <Text size="sm" ff="monospace">
        {s.sessionId}
      </Text>
    ),
  },
  { key: "agentId", header: "Agent", value: (s) => s.agentId },
  {
    key: "user",
    header: "Utilisateur",
    hint: "pseudonymisé : la console n'affiche jamais l'identité d'un utilisateur final",
    value: (s) => s.user,
  },
  {
    key: "entries",
    header: "Entrées",
    align: "right",
    value: (s) => s.entries,
  },
  {
    key: "lastActivity",
    header: "Dernière activité",
    value: (s) => s.lastActivity,
  },
  {
    key: "consolidated",
    header: "Consolidée",
    value: (s) => (s.consolidated ? "oui" : "non"),
    render: (s) =>
      s.consolidated ? (
        <Badge color="teal" variant="light" size="sm">
          résumée
        </Badge>
      ) : (
        <Badge color="blue" variant="light" size="sm">
          en cours
        </Badge>
      ),
  },
];

const ROLE_ICON = {
  user: <IconUser size={12} />,
  assistant: <IconRobot size={12} />,
  system: <IconSettings size={12} />,
};

/**
 * Mémoire des agents — trois niveaux (court, long, épisodique), le fil d'une
 * session, sa consolidation, et l'effacement qu'exige le RGPD.
 */
export function MemoryPreview() {
  const [selected, setSelected] = useState<IPreviewMemorySession>(
    MEMORY_SESSIONS[0] as IPreviewMemorySession,
  );
  const [forgetUser, setForgetUser] = useState("u-…91");
  const [forgotten, setForgotten] = useState<string | null>(null);

  const entries = MEMORY_TIERS.reduce((n, t) => n + t.entries, 0);
  const agents = new Set(MEMORY_SESSIONS.map((s) => s.agentId)).size;

  return (
    <PageLayout
      title="Mémoire"
      subtitle="Ce que les agents retiennent, combien de temps — et comment l'oublier."
      icon={<IconArchive size={22} />}
    >
      <PreviewBanner module="@nodefony/memory" contract="IMemoryService" />

      <Grid>
        <StatCard label="Entrées" hint="tous niveaux confondus">
          {fmt(entries)}
        </StatCard>
        <StatCard label="Sessions" hint="conversations suivies sur la période">
          {MEMORY_SESSIONS.length}
        </StatCard>
        <StatCard label="Agents" hint="agents qui possèdent une mémoire">
          {agents}
        </StatCard>
        <StatCard
          label="Consolidations 24 h"
          hint="sessions closes résumées en mémoire épisodique"
        >
          38
        </StatCard>
      </Grid>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        {MEMORY_TIERS.map((t) => (
          <Card key={t.tier} withBorder radius="md" padding="md">
            <Text fw={600}>{t.tier}</Text>
            <Text size="xs" c="dimmed" mb="xs">
              {t.store}
            </Text>
            <Text
              fz={24}
              fw={700}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmt(t.entries)}
            </Text>
            <Text size="sm">{t.role}</Text>
            <Text size="xs" c="dimmed" mt={6}>
              Rétention : {t.retention}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <DataGrid
        mode="client"
        data={MEMORY_SESSIONS}
        columns={COLUMNS}
        getRowId={(s) => s.sessionId}
        onRowClick={setSelected}
        searchable={false}
        height={280}
      />

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" padding="md">
          <Group gap={6} mb="sm">
            <Text fw={600}>
              Fil de la session{" "}
              <Text span ff="monospace" fw={400}>
                {selected.sessionId}
              </Text>
            </Text>
            <DocHint
              title="Ce que l'agent relit à chaque tour"
              summary="Le court terme rejoue la conversation ; la ligne système vient du long terme, retrouvée par similarité."
            />
          </Group>
          <Timeline
            bulletSize={22}
            lineWidth={2}
            active={MEMORY_TIMELINE.length}
          >
            {MEMORY_TIMELINE.map((e) => (
              <Timeline.Item
                key={`${e.at}-${e.role}`}
                bullet={ROLE_ICON[e.role]}
                title={
                  <Text size="xs" c="dimmed">
                    {e.role} · {e.at}
                  </Text>
                }
              >
                <Text size="sm">{e.content}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>

        <Stack gap="md">
          <Card withBorder radius="md" padding="md">
            <Text fw={600} mb={4}>
              Résumé consolidé
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              Ce que la mémoire épisodique gardera de la session une fois close.
            </Text>
            <Text size="sm">{MEMORY_CONSOLIDATION}</Text>
          </Card>

          <Card withBorder radius="md" padding="md">
            <Group gap={6} mb="sm">
              <Text fw={600}>Droit à l'effacement</Text>
              <DocHint
                title="Oublier, dans les trois niveaux"
                summary="Un effacement retire la session en cours, les faits du long terme et les résumés épisodiques — et laisse une trace d'audit qui ne contient rien de ce qui a été effacé."
              />
            </Group>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setForgotten(forgetUser);
              }}
            >
              <Group gap="xs" align="flex-end">
                <TextInput
                  label="Utilisateur (pseudonyme)"
                  value={forgetUser}
                  onChange={(e) => setForgetUser(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  type="submit"
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size={16} />}
                >
                  Simuler l'oubli
                </Button>
              </Group>
            </form>
            {forgotten && (
              <Alert color="teal" variant="light" mt="sm" aria-live="polite">
                Simulation : 18 entrées court terme, 214 faits long terme et 3
                résumés seraient effacés pour{" "}
                <Text span ff="monospace">
                  {forgotten}
                </Text>
                . Rien n'a été supprimé.
              </Alert>
            )}
          </Card>
        </Stack>
      </SimpleGrid>
    </PageLayout>
  );
}
