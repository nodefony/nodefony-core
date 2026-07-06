/**
 * **ProfilingTab** — onglet « Profiling » de la console Logs : liste des dernières
 * requêtes profilées (data plane `/nodefony/profiler/api/recent`, dev-only) dans
 * une **`DataGrid`** (pagination, tri, recherche, filtre Protocole HTTP/WS,
 * colonnes enrichies, persistance). Un clic ouvre le **Suivi de requête**
 * (`/nodefony/logs/trace/:requestId`) — profil + logs corrélés au même requestId.
 *
 * Remplace l'ancienne page Profiler autonome : la liste vit ici (point d'entrée
 * par requête), le détail vit dans le Suivi de requête (1 axe = le `requestId`).
 */
import { observer } from "mobx-react-lite";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Code, Group, Switch, Text, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowsLeftRight,
  IconBolt,
  IconInfoCircle,
  IconRefresh,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { useProfiler } from "../../stores";
import type { ProfileSummary } from "../../stores/ProfilerStore";
import { DataGrid, DocHint, type DataGridColumn } from "../../components/ui";
import { METHOD_COLORS, ago, fmtMs, statusColor } from "./profileVisuals";

/** Chemin (pathname) d'une URL, ou l'URL brute si non parsable. */
function pathOf(url: string): string {
  try {
    return new URL(url, "http://x").pathname;
  } catch {
    return url;
  }
}

export const ProfilingTab = observer(
  ({ onGoDebug }: { onGoDebug?: () => void }) => {
    const store = useProfiler();
    const navigate = useNavigate();

  useEffect(() => {
    void store.loadRecent();
    return () => store.dispose();
  }, [store]);

  const columns = useMemo<DataGridColumn<ProfileSummary>[]>(
    () => [
      {
        key: "kind",
        header: "Protocole",
        size: 116,
        sortable: true,
        filterable: true,
        filterType: "select",
        filterOptions: ["http", "ws"],
        value: (r) => r.kind,
        render: (r) => (
          <Badge
            size="sm"
            variant="light"
            color={r.kind === "ws" ? "cyan" : "blue"}
            leftSection={
              r.kind === "ws" ? (
                <IconArrowsLeftRight size={11} />
              ) : (
                <IconWorld size={11} />
              )
            }
          >
            {r.kind === "ws" ? "WS" : "HTTP"}
          </Badge>
        ),
      },
      {
        key: "method",
        header: "Méthode",
        size: 96,
        sortable: true,
        value: (r) => r.method ?? r.kind,
        render: (r) => (
          <Badge
            size="sm"
            variant="filled"
            color={METHOD_COLORS[r.method ?? ""] ?? "grape"}
          >
            {r.method ?? r.kind}
          </Badge>
        ),
      },
      {
        key: "path",
        header: "Chemin",
        size: 300,
        sortable: true,
        value: (r) => pathOf(r.url),
        render: (r) => (
          <Tooltip label={r.url} openDelay={400} multiline maw={460}>
            <Text size="xs" lineClamp={1}>
              {pathOf(r.url)}
            </Text>
          </Tooltip>
        ),
      },
      {
        key: "route",
        header: "Route",
        size: 180,
        sortable: true,
        value: (r) => r.route ?? "",
        render: (r) =>
          r.route ? (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {r.route}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              —
            </Text>
          ),
      },
      {
        key: "status",
        header: "Statut",
        size: 92,
        sortable: true,
        value: (r) => (r.error ? -1 : (r.status ?? 0)),
        render: (r) => (
          <Badge size="sm" variant="light" color={statusColor(r.status)}>
            {r.error ? "ERR" : (r.status ?? "—")}
          </Badge>
        ),
      },
      {
        key: "duration",
        header: "Durée",
        size: 92,
        align: "right",
        sortable: true,
        value: (r) => r.durationMs ?? -1,
        render: (r) => (
          <Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtMs(r.durationMs)}
          </Text>
        ),
      },
      {
        key: "age",
        header: "Âge",
        size: 92,
        align: "right",
        sortable: true,
        value: (r) => r.ts,
        render: (r) => (
          <Text size="xs" c="dimmed">
            {ago(r.ts)}
          </Text>
        ),
      },
      {
        key: "requestId",
        header: "requestId",
        size: 118,
        value: (r) => r.requestId,
        render: (r) => (
          <Code style={{ fontSize: 11 }}>{r.requestId.slice(0, 8)}</Code>
        ),
      },
    ],
    [],
  );

  // Prod : le data plane profiler renvoie 404 (dev-only, non monté). On n'affiche
  // PAS d'erreur brute → encart clair qui renvoie vers le debug runtime (onglet Debug),
  // le bon outil d'observation EN PRODUCTION.
  if (store.unavailable) {
    return (
      <Alert
        color="blue"
        variant="light"
        icon={<IconInfoCircle size={18} />}
        title="Profiler désactivé en production"
      >
        <Text size="sm" mb="xs">
          Le profiling <b>par requête</b> (timing des phases + requêtes SQL) est{" "}
          <b>dev-only</b> : il ajoute un coût à chaque requête et exposerait des
          détails internes. Il n'est donc pas monté en production.
        </Text>
        <Text size="sm" mb="sm">
          Pour observer <b>en production</b>, utilise le <b>debug runtime ciblé</b> :
          niveau DEBUG par module, activé à chaud sans redémarrage, auto-expirant et
          audité — sur l'onglet Debug.
        </Text>
        {onGoDebug && (
          <Button
            size="xs"
            color="blue"
            leftSection={<IconBolt size={16} />}
            onClick={onGoDebug}
          >
            Aller à l'onglet Debug
          </Button>
        )}
      </Alert>
    );
  }

  return (
    <>
      <Group justify="space-between" align="center" mb="sm">
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
            version="v1.1"
            summary="Chaque appel HTTP/WS profilé apparaît ici. Trie, filtre (Protocole, recherche), pagine ; clique une ligne pour ouvrir son Suivi de requête : waterfall des phases serveur, requêtes ORM mesurées et logs corrélés au même requestId."
            sections={[
              {
                label: "Source",
                body: "Profiler ALS (AsyncLocalStorage), dev-only. Les profils sont gardés dans un ring buffer borné (les plus anciens sont évincés).",
              },
              {
                label: "Colonnes & filtres",
                body: "Protocole (HTTP/WS, filtrable), Méthode, Chemin, Route, Statut, Durée, Âge, requestId. La recherche porte sur le chemin/route. Tri sur toutes les colonnes ; l'état est mémorisé.",
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
        <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="sm">
          {store.error}
        </Alert>
      )}

      <DataGrid
        mode="client"
        data={store.recent}
        columns={columns}
        getRowId={(r) => r.requestId}
        onRowClick={(r) =>
          navigate(`/nodefony/logs/trace/${encodeURIComponent(r.requestId)}`)
        }
        initialSort={{ key: "age", dir: "desc" }}
        pageSize={25}
        height={560}
        searchable
        searchPlaceholder="Recherche : chemin / route…"
        emptyMessage="Aucun profil. Fais des appels AJAX/HTTP — ils apparaissent ici en temps quasi-réel (active l'auto-refresh)."
        persist={{ key: "studio.logs.profiling", storage: "session" }}
      />
    </>
  );
});
