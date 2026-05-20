import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAppWindow,
  IconPuzzle,
  IconArrowLeft,
  IconInfoCircle,
  IconPackages,
  IconRoute,
  IconSettings,
  IconAffiliate,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useStore } from "../stores";

interface ModuleDetailData {
  key: string;
  name: string;
  version: string | null;
  isApp: boolean;
  path: string | null;
  dependencies: string[];
  services: { name: string; class: string | null }[];
  config: Record<string, unknown>;
}
interface RouteRow {
  name: string;
  path: string | null;
  methods: string[];
  controller: string | null;
  action: string | null;
  module: string | null;
  bypassFirewall: boolean;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "teal",
  POST: "blue",
  PUT: "yellow",
  PATCH: "grape",
  DELETE: "red",
  WEBSOCKET: "cyan",
  ANY: "gray",
};

/**
 * ModuleDetail — page d'un module (route `/nodefony/modules/:name`).
 * Inspirée du détail legacy `Bundle.vue` (onglets infos / deps / routes /
 * config / services). Branchée sur le data plane réel : détail via
 * `/api/module/{key}`, routes via `/api/routes` filtré par module.
 */
export const ModuleDetail = observer(() => {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const store = useStore();
  const [data, setData] = useState<ModuleDetailData | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      store.api.getAbsolute<ModuleDetailData>(
        `/nodefony/kernel/api/module/${encodeURIComponent(name)}`,
      ),
      store.api
        .getAbsolute<RouteRow[]>("/nodefony/framework/api/routes")
        .catch(() => [] as RouteRow[]),
    ])
      .then(([d, allRoutes]) => {
        if (cancelled) return;
        setData(d);
        setRoutes(allRoutes.filter((r) => r.module === name));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, name]);

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  if (error || !data) {
    return (
      <Stack gap="md">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate("/nodefony/modules")}
          w="fit-content"
        >
          Modules
        </Button>
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Module introuvable">
          {error ?? `Aucun module "${name}".`}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/nodefony/modules")}
        w="fit-content"
        px={0}
      >
        Modules
      </Button>

      {/* ── En-tête ── */}
      <Group gap="md" wrap="nowrap">
        <ThemeIcon variant="light" color={data.isApp ? "orange" : "gray"} size={54} radius="md">
          {data.isApp ? <IconAppWindow size={30} /> : <IconPuzzle size={30} />}
        </ThemeIcon>
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={2}>{data.name}</Title>
            {data.version && <Badge variant="default">v{data.version}</Badge>}
            <Badge variant="light" color={data.isApp ? "orange" : "gray"}>
              {data.isApp ? "application" : "package"}
            </Badge>
          </Group>
          <Text c="dimmed" size="sm" ff="monospace">
            {data.path ?? "—"}
          </Text>
        </Stack>
      </Group>

      {/* ── Card à onglets ── */}
      <Card withBorder radius="md" p={0}>
        <Tabs defaultValue="overview">
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconInfoCircle size={16} />}>
              Vue d'ensemble
            </Tabs.Tab>
            <Tabs.Tab
              value="deps"
              leftSection={<IconPackages size={16} />}
              rightSection={<Badge size="xs" variant="light" color="gray">{data.dependencies.length}</Badge>}
            >
              Dépendances
            </Tabs.Tab>
            <Tabs.Tab
              value="routes"
              leftSection={<IconRoute size={16} />}
              rightSection={<Badge size="xs" variant="light" color="gray">{routes.length}</Badge>}
            >
              Routes
            </Tabs.Tab>
            <Tabs.Tab
              value="services"
              leftSection={<IconAffiliate size={16} />}
              rightSection={<Badge size="xs" variant="light" color="gray">{data.services.length}</Badge>}
            >
              Services
            </Tabs.Tab>
            <Tabs.Tab value="config" leftSection={<IconSettings size={16} />}>
              Config
            </Tabs.Tab>
          </Tabs.List>

          <Box p="lg">
            <Tabs.Panel value="overview">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Field k="Clé" v={data.key} mono />
                    <Field k="Package" v={data.name} />
                    <Field k="Version" v={data.version ?? "—"} />
                    <Field k="Type" v={data.isApp ? "application" : "package"} />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Field k="Dépendances" v={String(data.dependencies.length)} />
                    <Field k="Routes" v={String(routes.length)} />
                    <Field k="Services" v={String(data.services.length)} />
                    <Field k="Chemin" v={data.path ?? "—"} mono />
                  </Stack>
                </Grid.Col>
              </Grid>
            </Tabs.Panel>

            <Tabs.Panel value="deps">
              {data.dependencies.length === 0 ? (
                <Text c="dimmed" size="sm">Aucune dépendance.</Text>
              ) : (
                <Group gap={8}>
                  {data.dependencies.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      size="md"
                      color={d === "nodefony" || d.startsWith("@nodefony/") ? "orange" : "gray"}
                    >
                      {d}
                    </Badge>
                  ))}
                </Group>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="routes">
              {routes.length === 0 ? (
                <Text c="dimmed" size="sm">Ce module n'enregistre aucune route.</Text>
              ) : (
                <Table.ScrollContainer minWidth={560}>
                  <Table striped highlightOnHover withRowBorders={false}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Méthodes</Table.Th>
                        <Table.Th>Chemin</Table.Th>
                        <Table.Th>Controller</Table.Th>
                        <Table.Th>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {routes.map((r) => (
                        <Table.Tr key={r.name}>
                          <Table.Td>
                            <Group gap={4}>
                              {r.methods.map((m) => (
                                <Badge key={m} size="xs" color={METHOD_COLORS[m] ?? "gray"} variant="light">
                                  {m}
                                </Badge>
                              ))}
                            </Group>
                          </Table.Td>
                          <Table.Td><Code>{r.path}</Code></Table.Td>
                          <Table.Td><Text size="xs">{r.controller ?? "—"}</Text></Table.Td>
                          <Table.Td><Text size="xs" c="dimmed">{r.action ?? "—"}</Text></Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="services">
              {data.services.length === 0 ? (
                <Text c="dimmed" size="sm">Ce module n'enregistre aucun service.</Text>
              ) : (
                <Table.ScrollContainer minWidth={420}>
                  <Table striped highlightOnHover withRowBorders={false}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Nom (DI)</Table.Th>
                        <Table.Th>Classe</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.services.map((s) => (
                        <Table.Tr key={s.name}>
                          <Table.Td>
                            <Code>{s.name}</Code>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">{s.class ?? "—"}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="config">
              {!data.config || Object.keys(data.config).length === 0 ? (
                <Text c="dimmed" size="sm">Aucune configuration.</Text>
              ) : (
                <ScrollArea.Autosize mah={520}>
                  <Code block>{JSON.stringify(data.config, null, 2)}</Code>
                </ScrollArea.Autosize>
              )}
            </Tabs.Panel>
          </Box>
        </Tabs>
      </Card>
    </Stack>
  );
});

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <Text size="sm" c="dimmed">{k}</Text>
      <Text size="sm" fw={500} ff={mono ? "monospace" : undefined} style={{ wordBreak: "break-all", textAlign: "right" }}>
        {v}
      </Text>
    </Group>
  );
}

export default ModuleDetail;
