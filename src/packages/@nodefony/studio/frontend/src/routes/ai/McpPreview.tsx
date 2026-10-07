import {
  Badge,
  Card,
  Code,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";
import { IconPlug, IconServer, IconServerBolt } from "@tabler/icons-react";
import {
  DataGrid,
  DocHint,
  JsonViewer,
  PageLayout,
  StatCard,
  StickyTabsList,
  type DataGridColumn,
} from "../../components/ui";
import {
  MCP_CLIENTS,
  MCP_SAMPLE_FRAME,
  MCP_SERVER_TOOLS,
  type IPreviewMcpClient,
} from "./aiPreviewModel";
import { HealthBadge, PreviewBanner } from "./aiPreviewParts";

const CLIENT_COLUMNS: DataGridColumn<IPreviewMcpClient>[] = [
  {
    key: "name",
    header: "Serveur",
    value: (c) => c.name,
    render: (c) => (
      <Text size="sm" fw={600}>
        {c.name}
      </Text>
    ),
  },
  {
    key: "transport",
    header: "Transport",
    value: (c) => c.transport,
    render: (c) => <Code>{c.transport}</Code>,
  },
  {
    key: "status",
    header: "État",
    value: (c) => c.status,
    render: (c) => <HealthBadge status={c.status} />,
  },
  { key: "tools", header: "Outils", align: "right", value: (c) => c.tools },
  {
    key: "allowedAgents",
    header: "Agents autorisés",
    value: (c) => c.allowedAgents.join(" "),
    render: (c) => (
      <Group gap={4}>
        {c.allowedAgents.map((a) => (
          <Badge key={a} variant="default" size="xs" tt="none">
            {a}
          </Badge>
        ))}
      </Group>
    ),
  },
];

/**
 * MCP — Nodefony des deux côtés du protocole : serveur (ses outils exposés à
 * un agent) et client (les serveurs externes que ses agents consomment).
 */
export function McpPreview() {
  const connected = MCP_CLIENTS.filter((c) => c.status === "ok").length;
  const external = MCP_CLIENTS.reduce((n, c) => n + c.tools, 0);

  return (
    <PageLayout
      title="MCP"
      subtitle="Model Context Protocol : exposer l'application aux agents, et brancher les agents sur le monde."
      icon={<IconPlug size={22} />}
    >
      <PreviewBanner
        module="@nodefony/mcp"
        contract="JSON-RPC 2.0 · MCP 2026-07-28"
      />

      <Grid>
        <StatCard
          label="Outils exposés"
          hint="servis par le serveur MCP de Nodefony (déjà réel en développement)"
        >
          {MCP_SERVER_TOOLS.length}
        </StatCard>
        <StatCard label="Serveurs consommés" hint="connectés / déclarés">
          {connected} / {MCP_CLIENTS.length}
        </StatCard>
        <StatCard
          label="Outils externes"
          hint="offerts par les serveurs consommés"
        >
          {external}
        </StatCard>
        <StatCard label="Appels 24 h" hint="tous outils, corrélés au requestId">
          3 418
        </StatCard>
      </Grid>

      <Tabs defaultValue="server" keepMounted={false}>
        <StickyTabsList>
          <Tabs.Tab value="server" leftSection={<IconServer size={16} />}>
            Nodefony serveur
          </Tabs.Tab>
          <Tabs.Tab value="clients" leftSection={<IconServerBolt size={16} />}>
            Serveurs consommés
          </Tabs.Tab>
        </StickyTabsList>

        <Tabs.Panel value="server" pt="md">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Card withBorder radius="md" padding="md">
              <Group gap={6} mb="sm">
                <Text fw={600}>Outils exposés</Text>
                <Badge color="teal" variant="light" size="sm">
                  réels en développement
                </Badge>
                <DocHint
                  title="Ce qui existe déjà, et ce qui viendra"
                  summary="Ces sept outils sont servis aujourd'hui par /nodefony/mcp, en développement : un agent de code y lit les vraies routes, la vraie configuration et le graphe symbolique."
                  sections={[
                    {
                      label: "En production",
                      body: "La même porte, protégée par OAuth : Nodefony se déclare ressource protégée (RFC 9728) et chaque outil exige le rôle de l'appelant, comme une route HTTP.",
                    },
                  ]}
                />
              </Group>
              <Table striped highlightOnHover>
                <Table.Tbody>
                  {MCP_SERVER_TOOLS.map((t) => (
                    <Table.Tr key={t.name}>
                      <Table.Td>
                        <Code>{t.name}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{t.purpose}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
            <Stack gap="md">
              <Card withBorder radius="md" padding="md">
                <Text fw={600} mb="xs">
                  Une trame telle qu'elle passe
                </Text>
                <JsonViewer value={MCP_SAMPLE_FRAME} maxHeight={260} />
              </Card>
              <Card withBorder radius="md" padding="md">
                <Text fw={600} mb="xs">
                  Ce qui protège la porte
                </Text>
                <Stack gap={6}>
                  <Text size="sm">
                    • Origine vérifiée et écoute locale en développement.
                  </Text>
                  <Text size="sm">
                    • Jeton OAuth et audience exacte en production.
                  </Text>
                  <Text size="sm">
                    • Rôle de l'appelant vérifié outil par outil.
                  </Text>
                  <Text size="sm">
                    • Une erreur interne ne renvoie jamais son détail.
                  </Text>
                </Stack>
              </Card>
            </Stack>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="clients" pt="md">
          <Stack gap="md">
            <Group gap={6}>
              <Text size="sm" c="dimmed">
                Chaque serveur externe n'est ouvert qu'aux agents nommés : une
                liste blanche, jamais « tous ».
              </Text>
              <DocHint
                title="Un outil externe obéit aux mêmes règles"
                summary="Un outil MCP consommé passe par la gouvernance comme un outil maison : zone de confiance, approbation, audit, disjoncteur."
              />
            </Group>
            <DataGrid
              mode="client"
              data={MCP_CLIENTS}
              columns={CLIENT_COLUMNS}
              getRowId={(c) => c.name}
              searchable={false}
              height={260}
            />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </PageLayout>
  );
}
