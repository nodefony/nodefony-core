import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconRefresh,
  IconTrash,
  IconBug,
  IconAlertTriangle,
  IconClockHour4,
} from "@tabler/icons-react";
import { computeWaterfall, type ProfileEntry } from "nodefony/debugbar";
import { useProfiler } from "../stores";

/** Couleur de badge par méthode HTTP. */
const METHOD_COLORS: Record<string, string> = {
  GET: "blue",
  POST: "green",
  PUT: "orange",
  PATCH: "orange",
  DELETE: "red",
};

/** Couleur de phase (alignée sur la debug bar par-page). */
const PHASE_COLORS: Record<string, string> = {
  parse: "#4c9aff",
  resolve: "#3aa0ff",
  firewall: "#ff8a3d",
  init: "#a06bff",
  action: "#36b37e",
  render: "#ffab00",
  send: "#00b8d9",
  other: "#8a9099",
};

/** Couleur de badge selon la famille de status HTTP. */
function statusColor(status: number | null): string {
  if (status === null) return "gray";
  if (status >= 500) return "red";
  if (status >= 400) return "yellow";
  if (status >= 300) return "blue";
  return "green";
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Une ligne du waterfall serveur (barre proportionnelle colorée). */
function WaterfallRow({
  name,
  leftPct,
  widthPct,
  tier,
  durationMs,
}: {
  name: string;
  leftPct: number;
  widthPct: number;
  tier: string;
  durationMs: number;
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Text size="xs" w={84} ta="right" c="dimmed" style={{ flex: "none" }}>
        {name}
      </Text>
      <Box
        style={{
          flex: 1,
          position: "relative",
          height: 16,
          background: "rgba(255,255,255,.05)",
          borderRadius: 4,
        }}
      >
        <Box
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: 2,
            borderRadius: 4,
            background: PHASE_COLORS[tier] ?? PHASE_COLORS.other,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
          }}
        />
      </Box>
      <Text size="xs" w={70} ta="right" c="dimmed" style={{ flex: "none" }}>
        {durationMs}ms
      </Text>
    </Group>
  );
}

/** Panneau de détail d'un profil serveur (méta + waterfall + requêtes ORM). */
const ProfileDetail = observer(({ profile }: { profile: ProfileEntry }) => {
  const bars = computeWaterfall(profile.phases);
  const traceId = profile.traceparent?.split("-")[1] ?? null;
  const kv = (label: string, value: React.ReactNode) => (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" w={92} style={{ flex: "none" }}>
        {label}
      </Text>
      <Text size="xs" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </Text>
    </Group>
  );
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={METHOD_COLORS[profile.method ?? ""] ?? "gray"} variant="filled">
          {profile.method ?? profile.kind}
        </Badge>
        <Badge color={statusColor(profile.status)} variant="light">
          {profile.status ?? "—"}
        </Badge>
        <Text size="sm" fw={600} style={{ wordBreak: "break-all" }}>
          {profile.url}
        </Text>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
        {kv("route", profile.route ?? "—")}
        {kv(
          "controller",
          profile.controller
            ? `${profile.controller}.${profile.action ?? "?"}`
            : "—",
        )}
        {kv("total serveur", fmtMs(profile.durationMs))}
        {kv("user", profile.user ?? "anonyme")}
        {kv("requestId", <Code>{profile.requestId.slice(0, 12)}…</Code>)}
        {kv("trace-id (W3C)", traceId ? <Code>{traceId.slice(0, 16)}…</Code> : "—")}
        {profile.error && kv("erreur", <Text c="red" size="xs">{profile.error}</Text>)}
      </SimpleGrid>

      <Box>
        <Text size="xs" tt="uppercase" c="dimmed" mb={6} fw={700}>
          Timeline des phases (serveur)
        </Text>
        {bars.length === 0 ? (
          <Text size="xs" c="dimmed">
            aucune phase mesurée (timing désactivé ?).
          </Text>
        ) : (
          <Stack gap={4}>
            {bars.map((b) => (
              <WaterfallRow key={b.name} {...b} />
            ))}
          </Stack>
        )}
      </Box>

      {profile.queries && profile.queries.length > 0 && (
        <Box>
          <Text size="xs" tt="uppercase" c="dimmed" mb={6} fw={700}>
            Requêtes ORM ({profile.queries.length})
          </Text>
          <Stack gap={3}>
            {profile.queries.map((q, i) => (
              <Group key={i} gap="xs" wrap="nowrap" justify="space-between">
                <Code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {q.sql}
                </Code>
                {q.connector && (
                  <Badge size="xs" variant="light">
                    {q.connector}
                  </Badge>
                )}
                <Text size="xs" c="dimmed">
                  {q.durationMs}ms
                </Text>
              </Group>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
});

/**
 * Profiler — vue centrale Studio du data plane `/nodefony/profiler/api/*`
 * (dev-only). Liste des dernières requêtes ; clic → waterfall des phases serveur.
 *
 * SPA-first comme la debug bar : on profile les appels (AJAX/WS), pas la page.
 * Réutilise `computeWaterfall` du Core isomorphe (`nodefony/debugbar`) — 0 dup.
 */
export const Profiler = observer(() => {
  const store = useProfiler();

  useEffect(() => {
    void store.loadRecent();
    return () => store.dispose();
  }, [store]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="xs">
            <IconBug size={22} />
            <Title order={2}>Profiler</Title>
            <Badge variant="light" color="brand">
              {store.count} profils
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Profil par requête (timing des phases, route, user, trace W3C). Dev-only.
          </Text>
        </div>
        <Group gap="xs">
          <Switch
            label="Auto-refresh"
            size="sm"
            checked={store.autoRefresh}
            onChange={(e) => store.setAutoRefresh(e.currentTarget.checked)}
          />
          <Button
            variant="light"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            loading={store.loading}
            onClick={() => void store.loadRecent()}
          >
            Rafraîchir
          </Button>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconTrash size={14} />}
            onClick={() => void store.clear()}
          >
            Vider
          </Button>
        </Group>
      </Group>

      {store.error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {store.error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper withBorder p="xs" radius="md">
          {store.recent.length === 0 && !store.loading ? (
            <Text size="sm" c="dimmed" p="md">
              Aucun profil. Fais des appels AJAX/HTTP — ils apparaissent ici en
              temps quasi-réel (active l'auto-refresh).
            </Text>
          ) : (
            <ScrollArea h={520}>
              <Table highlightOnHover stickyHeader verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Méth.</Table.Th>
                    <Table.Th>Path</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Durée</Table.Th>
                    <Table.Th ta="right">
                      <IconClockHour4 size={13} />
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {store.recent.map((r) => {
                    let path = r.url;
                    try {
                      path = new URL(r.url, "http://x").pathname;
                    } catch {
                      /* garde l'url brute */
                    }
                    const sel = r.requestId === store.selectedId;
                    return (
                      <Table.Tr
                        key={r.requestId}
                        onClick={() => void store.select(r.requestId)}
                        style={{
                          cursor: "pointer",
                          background: sel ? "rgba(58,160,255,.12)" : undefined,
                        }}
                      >
                        <Table.Td>
                          <Badge
                            size="sm"
                            variant="filled"
                            color={METHOD_COLORS[r.method ?? ""] ?? "grape"}
                          >
                            {r.method ?? r.kind}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={r.url} openDelay={400}>
                            <Text size="xs" lineClamp={1}>
                              {path}
                            </Text>
                          </Tooltip>
                          {r.route && (
                            <Text size="9px" c="dimmed">
                              {r.route}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="light" color={statusColor(r.status)}>
                            {r.error ? "ERR" : (r.status ?? "—")}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs">{fmtMs(r.durationMs)}</Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs" c="dimmed">
                            {ago(r.ts)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          {!store.selectedId ? (
            <Text size="sm" c="dimmed">
              Sélectionne une requête → profil serveur (waterfall des phases,
              route, user, trace W3C).
            </Text>
          ) : store.detailLoading ? (
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                chargement du profil…
              </Text>
            </Group>
          ) : store.detailError ? (
            <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
              {store.detailError} — profil peut-être évincé du ring buffer.
            </Alert>
          ) : store.detail ? (
            <ProfileDetail profile={store.detail} />
          ) : null}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
});

export default Profiler;
