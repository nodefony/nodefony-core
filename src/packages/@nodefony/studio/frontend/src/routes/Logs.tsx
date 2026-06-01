/**
 * **Logs** — console du **Log Backplane** Nodefony (page `/nodefony/logs`).
 *
 * Bâtie sur le layout réutilisable `TabbedPage` (en-tête + `StatusBar` de mode
 * sticky + onglets) → on arrive sur la page et la logique est **identique** aux
 * autres consoles Studio. La barre de mode (`SyslogStatusBar`) dit en permanence,
 * quel que soit l'onglet, les 3 axes du backplane : **Écriture** (fan-out) /
 * **Lecture** (destination relue) / **Live** (bus temps réel).
 *
 * Onglets :
 *  - **Vue d'ensemble** (défaut) : comprendre — le « fond de panier », les 3 axes,
 *    le registry des drivers, la santé, le switch de lecture (dev).
 *  - **Live** : flux temps réel (WS `syslog:stream`), tail intelligent.
 *  - **Explorer** : requête froide paginée + **trace full-stack** par `requestId`.
 *  - **Fichiers** : viewer des fichiers de log (confort DEV).
 *
 * Un seul fetch de la méta backplane (partagé), un drawer de détail Pdu partagé
 * Live ↔ Explorer, et la trace qui bascule de Live vers l'Explorer filtré.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useState } from "react";
import { Button } from "@mantine/core";
import {
  IconActivity,
  IconAdjustments,
  IconBook2,
  IconBroadcast,
  IconBug,
  IconFile,
  IconFileText,
  IconLayoutDashboard,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useNodefonyState } from "nodefony/react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { TabbedPage } from "../components/ui";
import { FilesTab } from "./logs/FilesTab";
import { SyslogStatusBar } from "./logs/SyslogStatusBar";
import { LiveLogs } from "./logs/LiveLogs";
import { LogExplorer } from "./logs/LogExplorer";
import {
  BackplanePanel,
  FlowLegendDoc,
  SyslogHealthPanel,
} from "./logs/BackplanePanel";
import { SyslogConfigPanel } from "./logs/SyslogConfigPanel";
import { PduDetailDrawer } from "./logs/PduDetailDrawer";
import { ProfilingTab } from "./logs/ProfilingTab";
import type { BackplaneMeta, LogRecord } from "./logs/logsTypes";

type TabId =
  | "overview"
  | "sante"
  | "live"
  | "explorer"
  | "profiling"
  | "files"
  | "doc"
  | "config";

/** Onglets valides — garde contre une valeur périmée en sessionStorage. */
const TAB_IDS: ReadonlySet<string> = new Set<TabId>([
  "overview",
  "sante",
  "live",
  "explorer",
  "profiling",
  "files",
  "doc",
  "config",
]);
const TAB_KEY = "nf.logs.tab";

export const Logs = observer(() => {
  const store = useStore();
  const realtimeState = useNodefonyState();

  // Méta backplane — fetch UNIQUE partagé par la barre de mode, l'onglet Vue
  // d'ensemble, et l'Explorer (garde capability).
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<BackplaneMeta>("/nodefony/syslog/api/backplane"),
    [store],
  );
  const { data: meta, loading, error, reload } = useResource(fetcher);

  // Onglet actif PERSISTÉ (sessionStorage) → revenir du Suivi de requête
  // (`/nodefony/logs/trace/:id`) restaure l'onglet au lieu de retomber sur
  // « Vue d'ensemble ». Les filtres de l'Explorer sont persistés de leur côté.
  const [tab, setTab] = useState<TabId>(() => {
    const s = sessionStorage.getItem(TAB_KEY);
    return s && TAB_IDS.has(s) ? (s as TabId) : "overview";
  });
  const changeTab = useCallback((v: TabId) => {
    setTab(v);
    try {
      sessionStorage.setItem(TAB_KEY, v);
    } catch {
      /* quota / mode privé — non bloquant */
    }
  }, []);
  const [selected, setSelected] = useState<LogRecord | null>(null);
  const [traceRequestId, setTraceRequestId] = useState<string>("");
  // Bumpé à chaque switch de driver → force l'Explorer à recharger.
  const [refreshKey, setRefreshKey] = useState(0);

  // Trace full-stack : depuis le drawer → bascule sur l'Explorer filtré.
  const onTrace = useCallback(
    (requestId: string) => {
      setTraceRequestId(requestId);
      setSelected(null);
      changeTab("explorer");
    },
    [changeTab],
  );

  const capabilities = meta?.activeDriver?.capabilities ?? null;
  const driverName = meta?.activeDriver?.name ?? null;

  return (
    <>
      <TabbedPage
        icon={<IconFileText size={24} />}
        title="Logs"
        subtitle="Console du Log Backplane — flux live, exploration froide, contrôle de la destination"
        actions={
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={reload}
          >
            Rafraîchir
          </Button>
        }
        statusBar={
          <SyslogStatusBar meta={meta} realtimeState={realtimeState} />
        }
        value={tab}
        onChange={(v) => changeTab(v as TabId)}
        tabs={[
          {
            value: "overview",
            label: "Vue d'ensemble",
            icon: <IconLayoutDashboard size={16} />,
            panel: (
              <BackplanePanel
                meta={meta}
                loading={loading}
                error={error}
                reload={reload}
                onSwitched={() => setRefreshKey((k) => k + 1)}
                realtimeState={realtimeState}
              />
            ),
          },
          {
            value: "sante",
            label: "Santé & compteurs",
            icon: <IconActivity size={16} />,
            panel: <SyslogHealthPanel meta={meta} />,
          },
          {
            value: "live",
            label: "Live",
            icon: <IconBroadcast size={16} />,
            panel: <LiveLogs onSelect={setSelected} cluster={meta?.cluster} />,
          },
          {
            value: "explorer",
            label: "Explorer",
            icon: <IconSearch size={16} />,
            panel: (
              <LogExplorer
                capabilities={capabilities}
                driverName={driverName}
                traceRequestId={traceRequestId}
                onSelect={setSelected}
                refreshKey={refreshKey}
                cluster={meta?.cluster}
              />
            ),
          },
          {
            value: "profiling",
            label: "Profiling",
            icon: <IconBug size={16} />,
            panel: <ProfilingTab />,
          },
          {
            value: "files",
            label: "Fichiers",
            icon: <IconFile size={16} />,
            panel: <FilesTab />,
          },
          {
            value: "doc",
            label: "Doc",
            icon: <IconBook2 size={16} />,
            panel: <FlowLegendDoc />,
          },
          {
            value: "config",
            label: "Config",
            icon: <IconAdjustments size={16} />,
            panel: <SyslogConfigPanel meta={meta} />,
          },
        ]}
      />

      <PduDetailDrawer
        record={selected}
        onClose={() => setSelected(null)}
        onTrace={onTrace}
      />
    </>
  );
});
