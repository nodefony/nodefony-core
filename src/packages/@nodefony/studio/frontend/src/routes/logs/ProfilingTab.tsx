/**
 * **ProfilingTab** — onglet « Profiling » de la console Logs : liste des dernières
 * requêtes profilées (data plane `/nodefony/profiler/api/recent`, dev-only). Un
 * clic ouvre le **Suivi de requête** (`/nodefony/logs/trace/:requestId`) où le
 * profil (phases, requêtes SQL) est fusionné avec les logs corrélés.
 *
 * Remplace l'ancienne page Profiler autonome : la liste vit ici (point d'entrée
 * par requête), le détail vit dans le Suivi de requête (1 axe unique = le
 * `requestId`). SPA-first comme la debug bar : on profile les appels (AJAX/WS).
 */
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useProfiler } from "../../stores";
import { DataState, DocHint } from "../../components/ui";
import { METHOD_COLORS, ago, fmtMs, statusColor } from "./profileVisuals";

export const ProfilingTab = observer(() => {
  const store = useProfiler();
  const navigate = useNavigate();

  useEffect(() => {
    void store.loadRecent();
    return () => store.dispose();
  }, [store]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Badge variant="light" color="brand">
            {store.count} profil{store.count > 1 ? "s" : ""}
          </Badge>
          <Text size="sm" c="dimmed">
            Requêtes profilées (timing des phases, route, user, requêtes SQL).
            Dev-only.
          </Text>
          <DocHint
            title="Profiling par requête"
            version="v1.0"
            summary="Chaque appel HTTP/WS profilé apparaît ici. Clique une ligne pour ouvrir son Suivi de requête : waterfall des phases serveur, requêtes ORM mesurées et logs corrélés au même requestId."
            sections={[
              {
                label: "Source",
                body: "Profiler ALS (AsyncLocalStorage), dev-only. Les profils sont gardés dans un ring buffer borné (les plus anciens sont évincés).",
              },
              {
                label: "Si vide",
                body: "Fais des appels AJAX/HTTP (active l'auto-refresh) — ils apparaissent en temps quasi-réel.",
              },
            ]}
          />
        </Group>
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

      <DataState
        loading={store.loading && store.recent.length === 0}
        empty={!store.loading && store.recent.length === 0}
        emptyMessage="Aucun profil. Fais des appels AJAX/HTTP — ils apparaissent ici en temps quasi-réel (active l'auto-refresh)."
      >
        <ScrollArea.Autosize mah={560}>
          <Table highlightOnHover stickyHeader verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Méth.</Table.Th>
                <Table.Th>Chemin</Table.Th>
                <Table.Th>Statut</Table.Th>
                <Table.Th ta="right">Durée</Table.Th>
                <Table.Th ta="right">Âge</Table.Th>
                <Table.Th />
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
                return (
                  <Table.Tr
                    key={r.requestId}
                    onClick={() =>
                      navigate(
                        `/nodefony/logs/trace/${encodeURIComponent(
                          r.requestId,
                        )}`,
                      )
                    }
                    style={{ cursor: "pointer" }}
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
                      <Badge
                        size="sm"
                        variant="light"
                        color={statusColor(r.status)}
                      >
                        {r.error ? "ERR" : (r.status ?? "—")}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text
                        size="xs"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {fmtMs(r.durationMs)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" c="dimmed">
                        {ago(r.ts)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <IconChevronRight
                        size={14}
                        style={{ opacity: 0.4 }}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </DataState>
    </Stack>
  );
});
