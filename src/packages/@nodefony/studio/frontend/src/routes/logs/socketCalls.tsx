/**
 * **SocketCalls** — les appels passés par UNE socket WebSocket, pour le Suivi
 * de requête d'une connexion. Une connexion n'a pas de profil à elle : elle ne
 * se termine qu'à sa fermeture. Chaque appel du pont (`api.request`) en a un, et
 * ses propres lignes, sous `<requestId>.<n>`.
 *
 * Data plane : `/nodefony/profiler/api/recent?connection=<requestId>` — le
 * serveur ne rend que ces frames, cherchées sur tout l'anneau (règle
 * `frameIndexOf` du cœur, la même que la barre de débogage). Les colonnes sont
 * celles de l'onglet Profiling ; un clic ouvre le Suivi de requête de l'appel.
 */
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Code, Group, Stack, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { frameIndexOf } from "nodefony/syslog";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DataGrid, type DataGridColumn } from "../../components/ui";
import type { ProfileSummary } from "../../stores/ProfilerStore";
import { profileSummaryColumns } from "./profileVisuals";

/** Les appels d'une socket, du plus récent au plus ancien. */
export function SocketCalls({ requestId }: { requestId: string }) {
  const store = useStore();
  const navigate = useNavigate();
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<{ entries?: ProfileSummary[] }>(
        `/nodefony/profiler/api/recent?connection=${encodeURIComponent(
          requestId,
        )}&limit=200`,
      ),
    [store, requestId],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const columns = useMemo<DataGridColumn<ProfileSummary>[]>(
    () => [
      {
        key: "frame",
        header: "#",
        size: 64,
        sortable: true,
        value: (r) => frameIndexOf(r.requestId, requestId) ?? 0,
        render: (r) => (
          <Code style={{ fontSize: 11 }}>
            #{frameIndexOf(r.requestId, requestId) ?? "?"}
          </Code>
        ),
      },
      ...profileSummaryColumns().filter(
        (c) => c.key !== "kind" && c.key !== "requestId",
      ),
    ],
    [requestId],
  );

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          Appels passés par la socket — chacun a son profil et ses lignes, sous{" "}
          <Code>{requestId.slice(0, 8)}.n</Code>.
        </Text>
        <Button
          variant="light"
          size="xs"
          leftSection={<IconRefresh size={14} />}
          loading={loading}
          onClick={reload}
        >
          Rafraîchir
        </Button>
      </Group>
      {error ? (
        <Alert color="gray" variant="light">
          Profileur indisponible ({error}) — il ne tourne qu'en développement.
        </Alert>
      ) : (
        <DataGrid
          mode="client"
          data={data?.entries ?? []}
          columns={columns}
          getRowId={(r) => r.requestId}
          onRowClick={(r) =>
            void navigate(
              `/nodefony/logs/trace/${encodeURIComponent(r.requestId)}`,
            )
          }
          initialSort={{ key: "frame", dir: "desc" }}
          pageSize={25}
          loading={loading}
          emptyMessage="Aucun appel du pont (api.request) par cette socket."
        />
      )}
    </Stack>
  );
}
