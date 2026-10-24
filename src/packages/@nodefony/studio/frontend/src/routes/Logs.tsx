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
 *  - **Live** : flux temps réel (WS `nodefony:syslog`), tail intelligent.
 *  - **Explorer** : requête froide paginée + **trace full-stack** par `requestId`.
 *  - **Fichiers** : viewer des fichiers de log (confort DEV).
 *
 * Un seul fetch de la méta backplane (partagé), un drawer de détail Pdu partagé
 * Live ↔ Explorer, et la trace qui bascule de Live vers l'Explorer filtré.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button } from "@mantine/core";
import {
  IconBolt,
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
import { useSearchParams } from "react-router";
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
import { SourceTab } from "./logs/SourceTab";
import { PduDetailDrawer } from "./logs/PduDetailDrawer";
import { ProfilingTab } from "./logs/ProfilingTab";
import { DebugTab } from "./logs/DebugTab";
import type {
  BackplaneMeta,
  ILogViewFilters,
  LogQueryResult,
  LogRecord,
} from "./logs/logsTypes";
import { parseViewFilters } from "./logs/logsTypes";
import { readStoredJson } from "../utils/storedJson";
import { describeSource } from "./logs/logFormat";

type TabId =
  "overview" | "live" | "explorer" | "profiling" | "files" | "doc" | "debug";

/** Onglets valides — garde contre une valeur périmée en sessionStorage. */
const TAB_IDS: ReadonlySet<string> = new Set<TabId>([
  "overview",
  "live",
  "explorer",
  "profiling",
  "files",
  "doc",
  "debug",
]);
const TAB_KEY = "nf.logs.tab";
/** Filtres d'affichage communs (Journaux + Direct), persistés le temps de l'onglet. */
const VIEW_KEY = "nf.logs.view.v1";

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

  // Ligne la plus récente de la source (tout trafic compris) → fraîcheur dite
  // dans la barre d'état. Une source distante qui ne reçoit plus rien répond
  // encore : seule cette date le montre.
  const latestFetcher = useCallback(
    () =>
      store.api.getAbsolute<LogQueryResult>(
        "/nodefony/syslog/api/logs/search?limit=1",
      ),
    [store],
  );
  const { data: latestRes, reload: reloadLatest } = useResource(latestFetcher);
  useEffect(() => {
    const id = setInterval(reloadLatest, 30_000);
    return () => clearInterval(id);
  }, [reloadLatest]);
  const latest =
    latestRes === null ? undefined : (latestRes.rows[0]?.timeStamp ?? null);

  // État du debug runtime → pastille sur l'onglet « Debug » quand actif.
  const debugFetcher = useCallback(
    () =>
      store.api.getAbsolute<{ overrides: Record<string, number> }>(
        "/nodefony/kernel/api/log/level",
      ),
    [store],
  );
  const { data: debugState, reload: reloadDebug } = useResource(debugFetcher);
  const debugCount = Object.keys(debugState?.overrides ?? {}).length;
  useEffect(() => {
    const id = setInterval(reloadDebug, 10_000);
    return () => clearInterval(id);
  }, [reloadDebug]);

  // Onglet actif PERSISTÉ (sessionStorage) → revenir du Suivi de requête
  // (`/nodefony/logs/trace/:id`) restaure l'onglet au lieu de retomber sur
  // « Vue d'ensemble ». Les filtres de l'Explorer sont persistés de leur côté.
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => {
    const q = searchParams.get("tab");
    if (q && TAB_IDS.has(q)) return q as TabId;
    const s = sessionStorage.getItem(TAB_KEY);
    return s && TAB_IDS.has(s) ? (s as TabId) : "explorer";
  });
  const changeTab = useCallback((v: TabId) => {
    setTab(v);
    try {
      sessionStorage.setItem(TAB_KEY, v);
    } catch {
      /* quota / mode privé — non bloquant */
    }
  }, []);
  // Deep-link `?tab=<id>` (ex. clic sur le chip top-bar Debug) → ouvre l'onglet,
  // même si la page Logs est déjà montée.
  useEffect(() => {
    const q = searchParams.get("tab");
    if (q && TAB_IDS.has(q)) {
      changeTab(q as TabId);
      // Nettoyer `?tab` → un re-clic du chip (même déjà sur la page) re-déclenche
      // l'effet (l'URL redevient « neuve » à chaque navigation).
      setSearchParams(
        (p) => {
          p.delete("tab");
          return p;
        },
        { replace: true },
      );
    }
  }, [searchParams, changeTab, setSearchParams]);
  const [viewFilters, setViewFilters] = useState<ILogViewFilters>(() =>
    parseViewFilters(readStoredJson("session", VIEW_KEY)),
  );
  const changeViewFilters = useCallback((next: ILogViewFilters) => {
    setViewFilters(next);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(next));
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

  // Une seule description de la source, partagée par tous les écrans qui la nomment.
  const source = useMemo(() => describeSource(meta ?? null), [meta]);
  const capabilities = meta?.activeDriver?.capabilities ?? null;
  const driverName = meta?.activeDriver?.name ?? null;

  // Cohérence « capacité absente → onglet grisé ».
  const ringOff = meta?.write.ringEnabled === false;
  // Explorer : driver non-queryable (ex. console) OU lecture « mémoire » alors que
  // le ring est coupé (plus rien à relire en RAM).
  const explorerDisabled = capabilities
    ? !capabilities.query || (driverName === "memory" && ringOff)
    : false;
  const explorerReason = !capabilities?.query
    ? `La source « ${driverName ?? "?"} » ne sait pas relire les journaux passés. L'onglet Direct montre les lignes au fil de l'eau.`
    : "La mémoire de ce processus est coupée : il n'y a rien à relire. La réactiver, ou choisir une autre source, dans l'onglet Source.";
  // Fichiers : pas de dossier de logs (prod cloud-native = stdout → collecteur).
  const filesDisabled = !meta?.write.logDir;
  // Live : diffusion temps réel coupée à chaud (tuile « Temps réel »).
  const liveDisabled = meta?.write.streamEnabled === false;

  // Si l'onglet ACTIF devient indisponible (ring coupé en plein Explorer mémoire,
  // diffusion coupée en plein Live, etc.) → repli sur des lignes encore
  // lisibles : le Direct, sinon la Source qui dit pourquoi.
  useEffect(() => {
    if (
      (tab === "explorer" && explorerDisabled) ||
      (tab === "files" && filesDisabled) ||
      (tab === "live" && liveDisabled)
    ) {
      changeTab(liveDisabled ? "overview" : "live");
    }
  }, [tab, explorerDisabled, filesDisabled, liveDisabled, changeTab]);

  return (
    <>
      <TabbedPage
        icon={<IconFileText size={24} />}
        title="Logs"
        subtitle="Ce que l'application a écrit, et d'où ces lignes sont lues"
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
          <SyslogStatusBar
            meta={meta}
            source={source}
            latest={latest}
            realtimeState={realtimeState}
          />
        }
        value={tab}
        onChange={(v) => changeTab(v as TabId)}
        tabs={[
          {
            value: "explorer",
            label: "Journaux",
            icon: <IconSearch size={16} />,
            disabled: explorerDisabled,
            disabledReason: explorerReason,
            panel: (
              <LogExplorer
                capabilities={capabilities}
                driverName={driverName}
                traceRequestId={traceRequestId}
                onSelect={setSelected}
                refreshKey={refreshKey}
                cluster={meta?.cluster}
                source={source}
                viewFilters={viewFilters}
                onViewFiltersChange={changeViewFilters}
              />
            ),
          },
          {
            value: "live",
            label: "Direct",
            icon: <IconBroadcast size={16} />,
            disabled: liveDisabled,
            disabledReason:
              "La diffusion en direct est coupée. La réactiver dans l'onglet Source (tuile « Temps réel »).",
            panel: (
              <LiveLogs
                onSelect={setSelected}
                cluster={meta?.cluster}
                viewFilters={viewFilters}
                onViewFiltersChange={changeViewFilters}
              />
            ),
          },
          {
            value: "overview",
            label: "Source",
            icon: <IconLayoutDashboard size={16} />,
            panel: (
              <SourceTab
                meta={meta}
                source={source}
                details={
                  <>
                    <BackplanePanel
                      meta={meta}
                      loading={loading}
                      error={error}
                      reload={reload}
                      onSwitched={() => setRefreshKey((k) => k + 1)}
                      realtimeState={realtimeState}
                    />
                    <SyslogHealthPanel meta={meta} />
                    <SyslogConfigPanel meta={meta} onChanged={reload} />
                  </>
                }
              />
            ),
          },
          {
            value: "profiling",
            label: "Profiling",
            icon: <IconBug size={16} />,
            panel: (
              <ProfilingTab
                onGoDebug={() => changeTab("debug")}
                onGoLogs={
                  explorerDisabled ? undefined : () => changeTab("explorer")
                }
              />
            ),
          },
          {
            value: "files",
            label: "Fichiers",
            icon: <IconFile size={16} />,
            disabled: filesDisabled,
            disabledReason:
              "Pas de dossier de logs (production cloud-native : logs → stdout → collecteur, aucun fichier local).",
            panel: <FilesTab logDir={meta?.write.logDir ?? null} />,
          },
          {
            value: "doc",
            label: "Doc",
            icon: <IconBook2 size={16} />,
            panel: <FlowLegendDoc />,
          },
          {
            value: "debug",
            label: "Debug",
            icon: <IconBolt size={16} />,
            badge:
              debugCount > 0 ? (
                <Badge size="xs" color="red" circle variant="filled">
                  {debugCount}
                </Badge>
              ) : undefined,
            panel: <DebugTab onGoLive={() => changeTab("live")} />,
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
