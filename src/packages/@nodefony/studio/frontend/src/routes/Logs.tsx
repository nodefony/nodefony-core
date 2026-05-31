/**
 * **Logs** — console du **Log Backplane** Nodefony (page `/nodefony/logs`).
 *
 * Bien plus qu'un viewer : un poste de pilotage des logs structuré autour des
 * **3 axes orthogonaux** du backplane (écriture / destination queryable / bus
 * temps réel). Structure :
 *
 *  - **Bandeau Backplane** (toujours visible) : sur quel driver on joue, ses
 *    capacités, la santé, et — en dev — le **switch de driver**.
 *  - **Onglet Live** : flux temps réel (WS `syslog:stream`), tail intelligent.
 *  - **Onglet Explorer** : requête froide paginée du driver actif + **trace
 *    full-stack** par `requestId`.
 *  - **Onglet Fichiers** : viewer des fichiers `*.log` (confort DEV).
 *  - **Onglet Backplane** : architecture (3 axes), registry des drivers, santé.
 *
 * Un seul fetch de la méta backplane (partagé), un drawer de détail Pdu partagé
 * Live ↔ Explorer, et la trace qui bascule de Live vers l'Explorer filtré.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useState } from "react";
import { Button, Stack, Tabs } from "@mantine/core";
import {
  IconBroadcast,
  IconFile,
  IconFileText,
  IconRefresh,
  IconSearch,
  IconStack2,
} from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { PageHeader } from "../components/ui";
import { FilesTab } from "./logs/FilesTab";
import { BackplaneBanner } from "./logs/BackplaneBanner";
import { LiveLogs } from "./logs/LiveLogs";
import { LogExplorer } from "./logs/LogExplorer";
import { BackplanePanel } from "./logs/BackplanePanel";
import { PduDetailDrawer } from "./logs/PduDetailDrawer";
import type { BackplaneMeta, LogRecord } from "./logs/logsTypes";

type TabId = "live" | "explorer" | "files" | "backplane";

export const Logs = observer(() => {
  const store = useStore();

  // Méta backplane — fetch UNIQUE partagé par le bandeau, l'Explorer (garde
  // capability) et l'onglet Backplane.
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<BackplaneMeta>("/nodefony/syslog/api/backplane"),
    [store],
  );
  const { data: meta, loading, error, reload } = useResource(fetcher);

  const [tab, setTab] = useState<TabId>("live");
  const [selected, setSelected] = useState<LogRecord | null>(null);
  const [traceRequestId, setTraceRequestId] = useState<string>("");
  // Bumpé à chaque switch de driver → force l'Explorer à recharger.
  const [refreshKey, setRefreshKey] = useState(0);

  // Trace full-stack : depuis le drawer → bascule sur l'Explorer filtré.
  const onTrace = useCallback((requestId: string) => {
    setTraceRequestId(requestId);
    setSelected(null);
    setTab("explorer");
  }, []);

  const capabilities = meta?.activeDriver?.capabilities ?? null;
  const driverName = meta?.activeDriver?.name ?? null;

  return (
    <Stack gap="md">
      <PageHeader
        icon={<IconFileText size={24} />}
        title="Logs"
        subtitle="Console du Log Backplane — flux live, exploration froide, contrôle du driver"
        sticky
        actions={
          <Button.Group>
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              loading={loading}
              onClick={reload}
            >
              Rafraîchir
            </Button>
          </Button.Group>
        }
      />

      {/* En-tête conceptuel : ce qu'est le Log Backplane (auto-explicatif). */}
      <BackplaneBanner
        meta={meta}
        loading={loading}
        error={error}
        reload={reload}
        onSwitched={() => setRefreshKey((k) => k + 1)}
      />

      <Tabs
        value={tab}
        onChange={(v) => v && setTab(v as TabId)}
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="live" leftSection={<IconBroadcast size={16} />}>
            Live
          </Tabs.Tab>
          <Tabs.Tab value="explorer" leftSection={<IconSearch size={16} />}>
            Explorer
          </Tabs.Tab>
          <Tabs.Tab value="files" leftSection={<IconFile size={16} />}>
            Fichiers
          </Tabs.Tab>
          <Tabs.Tab value="backplane" leftSection={<IconStack2 size={16} />}>
            Backplane
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="live" pt="md">
          <LiveLogs onSelect={setSelected} cluster={meta?.cluster} />
        </Tabs.Panel>

        <Tabs.Panel value="explorer" pt="md">
          <LogExplorer
            capabilities={capabilities}
            driverName={driverName}
            traceRequestId={traceRequestId}
            onSelect={setSelected}
            refreshKey={refreshKey}
            cluster={meta?.cluster}
          />
        </Tabs.Panel>

        <Tabs.Panel value="files" pt="md">
          <FilesTab />
        </Tabs.Panel>

        <Tabs.Panel value="backplane" pt="md">
          <BackplanePanel
            meta={meta}
            loading={loading}
            error={error}
            reload={reload}
          />
        </Tabs.Panel>
      </Tabs>

      <PduDetailDrawer
        record={selected}
        onClose={() => setSelected(null)}
        onTrace={onTrace}
      />
    </Stack>
  );
});
