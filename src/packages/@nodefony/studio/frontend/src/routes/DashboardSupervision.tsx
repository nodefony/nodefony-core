import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Grid,
  Stack,
  Card,
  Group,
  Text,
  Title,
  Badge,
  Alert,
  RingProgress,
  Tabs,
  Skeleton,
  Button,
  Switch,
  HoverCard,
  SegmentedControl,
  Progress,
} from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconCpu,
  IconClock,
  IconDatabase,
  IconAlertTriangle,
  IconCircleCheck,
  IconBug,
  IconServer,
  IconBolt,
  IconRecycle,
  IconBoxMultiple,
  IconPlugConnected,
  IconPlug,
  IconRefresh,
  IconPlayerPause,
} from "@tabler/icons-react";
import { useStore, useAuth } from "../stores";
import { useNodefonyState, useNodefonyChannel } from "nodefony/react";
import {
  PageHeader,
  KpiCard,
  ChartCard,
  MiniChart,
  KeyValue as Row,
  Legend,
  InfoHint,
  FlashValue,
  ensureLiveStyles,
} from "../components/ui";

/**
 * Sondes process (PATRON sondes+hub) poussées sur le canal WS
 * `dashboard:supervision[:ms]` (live) OU lues en one-shot via
 * `GET /nodefony/studio/api/stats` (snapshot statique quand le temps réel est OFF).
 */
interface StatsPayload {
  ts: number;
  instanceId: string;
  uptime: number;
  pid: number;
  cpuPercent: number;
  cpuCount: number;
  eventLoopMs: number;
  loadavg: number[];
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    heapLimit?: number;
    external: number;
  };
  /** Sondes riches — optionnelles ; `gc` est null dans le snapshot (live-only). */
  gc?: { count: number; pauseMs: number; major: number; minor: number } | null;
  heapSpaces?: { name: string; used: number; size: number }[];
  handles?: { total: number; byType: Record<string, number> };
}

interface KernelInfo {
  version: string;
  environment: string;
  pid: number;
}

/**
 * Connecteur ORM unifié pour la supervision : LIVE via le canal `orm:health[:ms]`
 * (ping/erreurs/reconnexions), SNAPSHOT via `GET /nodefony/orm/api/orms` (état +
 * driver/target/entités). Vue « tout d'un coup d'œil » : bases ↔ process.
 */
interface OrmConn {
  name: string;
  vendor: string;
  driver: string;
  target?: string;
  connected: boolean;
  entityCount?: number;
  pingMs?: number | null;
  pingOk?: boolean;
  errorCount?: number;
  reconnectCount?: number;
}
/** Sous-ensemble du payload `orm:health` (live) qu'on consomme. */
interface OrmHealth {
  name: string;
  vendor: string;
  driver: string;
  target?: string;
  connected: boolean;
  pingMs?: number | null;
  pingOk?: boolean;
  errorCount?: number;
  reconnectCount?: number;
}
/** Sous-ensemble de `/orm/api/orms` (snapshot). */
interface OrmSummary {
  name: string;
  vendor: string;
  connected: boolean;
  entityCount?: number;
  connection?: { driver?: string; target?: string };
}

const HISTORY = 60;
const MB = 1024 ** 2;

/** Lecture localStorage tolérante (navigation privée / quota). */
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
/** Écriture localStorage tolérante. */
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

function bytes(n: number): string {
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function uptimeStr(s: number): string {
  s = Math.floor(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}j ${p(h)}:${p(m)}` : `${p(h)}:${p(m)}:${p(sec)}`;
}

interface Health {
  color: string;
  label: string;
}

/** Niveau de santé : plus la valeur est haute, plus c'est grave. */
function level(v: number, warn: number, crit: number): Health {
  if (v >= crit) return { color: "red", label: "Critique" };
  if (v >= warn) return { color: "yellow", label: "Élevé" };
  return { color: "teal", label: "OK" };
}

/**
 * Abonné HUB au canal supervision — monté UNIQUEMENT quand « Temps réel » est ON.
 * `useNodefonyChannel` est ref-compté : démonter ce composant désabonne (→ le
 * serveur arrête le ticker, 0 travail quand OFF). C'est la mécanique du OFF par
 * défaut « pour la perf ». Granularité = canal paramétré `:<ms>` (re-cadence).
 */
function SupervisionLive({
  channel,
  ormChannel,
  onStats,
  onLog,
  onOrm,
}: {
  channel: string;
  ormChannel: string;
  onStats: (p: unknown) => void;
  onLog: (d: unknown) => void;
  onOrm: (p: unknown) => void;
}) {
  useNodefonyChannel(channel, onStats);
  useNodefonyChannel("syslog:stream", onLog);
  useNodefonyChannel(ormChannel, onOrm);
  return null;
}

/**
 * Dashboard SUPERVISION — vue ops « est-ce que ça va » : indicateurs de santé
 * seuillés + bandeau d'alertes + sondes process riches. Per-instance (le process
 * courant) ; vue cluster = Redis P13.
 *
 * Temps réel **OFF par défaut** (perf) : au chargement, un snapshot HTTP one-shot
 * peuple les cartes ; activer « Temps réel » ouvre le flux WS (courbes + GC +
 * flash). Les KPIs cliquables naviguent vers l'onglet de détail correspondant.
 */
export const DashboardSupervision = observer(() => {
  const auth = useAuth();
  const store = useStore();
  const rtState = useNodefonyState();
  const rtOnline = rtState === "connected";

  const [info, setInfo] = useState<KernelInfo | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [loopHist, setLoopHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<{ heap: number; rss: number }[]>([]);
  const [errHist, setErrHist] = useState<number[]>([]);
  const [gcHist, setGcHist] = useState<number[]>([]);
  // Historique CORRÉLÉ CPU% / Heap% (même échelle 0-100) — vue superviseur :
  // CPU et mémoire sont liés (un pic mémoire → pression GC → CPU).
  const [sysHist, setSysHist] = useState<{ cpu: number; heap: number }[]>([]);
  // Connecteurs ORM : snapshot (/orm/api/orms) + santé live (canal orm:health).
  const [orms, setOrms] = useState<OrmSummary[]>([]);
  const [ormHealth, setOrmHealth] = useState<OrmHealth[] | null>(null);
  const errSec = useRef(0);
  // Cadence RÉELLE du temps réel (client-observée). Sous saturation event-loop
  // côté serveur, les ticks arrivent en retard → le « temps réel » ne tient plus
  // sa cadence (symptôme #1 vu sous charge : refresh « par paliers de N s »). On
  // mesure l'écart entre 2 frames reçues (tickGap) + le retard courant depuis la
  // dernière (overdue, via heartbeat) pour le SIGNALER au lieu d'avoir l'air figé.
  const lastTickRef = useRef(0);
  const [tickGapMs, setTickGapMs] = useState(0);
  const [overdueMs, setOverdueMs] = useState(0);

  // Onglet de détail actif (CONTRÔLÉ) → les KPIs du haut y naviguent au clic.
  const [tab, setTab] = useState<string>("performance");

  // Temps réel : OFF par défaut (opt-in par SESSION, NON persisté) — pour la perf.
  // OFF → snapshot HTTP statique ; ON → flux WS (courbes + GC + flash).
  const [live, setLive] = useState<boolean>(false);
  // Granularité (cadence des pushes) — préférence PERSISTÉE, défaut 1 s. Canal
  // paramétré `dashboard:supervision:<ms>` ; 1 s = canal nu. Re-cadence = ré-abo.
  const [liveMs, setLiveMs] = useState<number>(
    () => Number(lsGet("nf.supervision.liveMs")) || 1000,
  );
  useEffect(() => lsSet("nf.supervision.liveMs", String(liveMs)), [liveMs]);
  useEffect(ensureLiveStyles, []);
  // Heartbeat client (1/s, live-only) : détecte un tick EN RETARD même quand
  // AUCUNE frame n'arrive (serveur affamé) — sinon « en retard » ne se verrait
  // jamais (pas de re-render sans tick). Cheap : ne setState que si réellement en
  // retard (gap > cadence) ; sinon 0 → React bail-out (pas de render parasite/s).
  useEffect(() => {
    if (!live) {
      lastTickRef.current = 0;
      setTickGapMs(0);
      setOverdueMs(0);
      return;
    }
    const id = window.setInterval(() => {
      if (!lastTickRef.current) return;
      const gap = Date.now() - lastTickRef.current;
      setOverdueMs(gap > liveMs ? gap : 0);
    }, 1000);
    return () => window.clearInterval(id);
  }, [live, liveMs]);
  const statsChannel =
    liveMs === 1000
      ? "dashboard:supervision"
      : `dashboard:supervision:${liveMs}`;
  // Canal santé ORM (même granularité ; le canal nu vaut 5 s côté serveur).
  const ormChannel = liveMs === 5000 ? "orm:health" : `orm:health:${liveMs}`;

  const cap = (arr: number[], v: number): number[] => {
    const n = [...arr, v];
    return n.length > HISTORY ? n.slice(-HISTORY) : n;
  };

  // Infos kernel statiques (env, version, pid).
  useEffect(() => {
    let cancelled = false;
    store.api
      .getAbsolute<KernelInfo>("/nodefony/kernel/api/info")
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store]);

  // Snapshot one-shot des sondes process (sans flux WS) — pour le mode OFF.
  const fetchSnapshot = useCallback(() => {
    store.api
      .getAbsolute<StatsPayload>("/nodefony/studio/api/stats")
      .then((s) => {
        if (s && s.memory) setStats(s);
      })
      .catch(() => {});
  }, [store]);

  // Snapshot des connecteurs ORM (état + driver/target/entités), sans flux WS.
  const fetchOrms = useCallback(() => {
    store.api
      .getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms")
      .then((d) => {
        if (Array.isArray(d)) setOrms(d);
      })
      .catch(() => {});
  }, [store]);

  // OFF → on prend le snapshot et on vide les séries temporelles (live-only).
  // ON → `SupervisionLive` prend le relais (rien à faire ici).
  useEffect(() => {
    if (live) return;
    fetchSnapshot();
    fetchOrms();
    setOrmHealth(null);
    setCpuHist([]);
    setLoopHist([]);
    setMemHist([]);
    setErrHist([]);
    setGcHist([]);
    setSysHist([]);
    errSec.current = 0;
  }, [live, fetchSnapshot, fetchOrms]);

  // Handler tick stats (live) → jauges + séries + bascule du compteur d'erreurs.
  const onStats = (payload: unknown) => {
    const s = payload as StatsPayload;
    if (!s || typeof s !== "object" || !s.memory) return;
    // Cadence réelle : écart depuis le tick précédent ; retard remis à zéro.
    const now = Date.now();
    if (lastTickRef.current) setTickGapMs(now - lastTickRef.current);
    lastTickRef.current = now;
    setOverdueMs(0);
    setStats(s);
    setCpuHist((prev) => cap(prev, s.cpuPercent));
    setLoopHist((prev) => cap(prev, s.eventLoopMs));
    if (s.gc) setGcHist((prev) => cap(prev, s.gc!.pauseMs));
    const ceil =
      s.memory.heapLimit && s.memory.heapLimit > 0
        ? s.memory.heapLimit
        : s.memory.heapTotal;
    const hp = ceil > 0 ? Math.round((s.memory.heapUsed / ceil) * 100) : 0;
    setSysHist((prev) => {
      const next = [...prev, { cpu: s.cpuPercent, heap: hp }];
      return next.length > HISTORY ? next.slice(-HISTORY) : next;
    });
    setMemHist((prev) => {
      const next = [
        ...prev,
        { heap: s.memory.heapUsed / MB, rss: s.memory.rss / MB },
      ];
      return next.length > HISTORY ? next.slice(-HISTORY) : next;
    });
    setErrHist((prev) => {
      const next = [...prev, errSec.current];
      errSec.current = 0;
      return next.length > HISTORY ? next.slice(-HISTORY) : next;
    });
  };

  // Handler santé ORM (live) : remplace l'état par le dernier paquet du hub.
  const onOrm = (payload: unknown) => {
    if (Array.isArray(payload)) setOrmHealth(payload as OrmHealth[]);
  };

  // Handler syslog (live) : on ne compte QUE les ERROR/CRITIC. Frame coalescée.
  const onLog = (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const rec = data as { logs?: Array<{ severityName?: string }> };
    if (!Array.isArray(rec.logs)) return;
    for (const log of rec.logs) {
      if (log?.severityName === "ERROR" || log?.severityName === "CRITIC") {
        errSec.current += 1;
      }
    }
  };

  const waiting = !stats;
  const cpu = stats?.cpuPercent ?? 0;
  const loop = stats?.eventLoopMs ?? 0;
  const heapCeiling =
    stats?.memory.heapLimit && stats.memory.heapLimit > 0
      ? stats.memory.heapLimit
      : (stats?.memory.heapTotal ?? 0);
  const heapPct =
    stats && heapCeiling > 0
      ? Math.round((stats.memory.heapUsed / heapCeiling) * 100)
      : 0;
  const errPerMin = errHist.reduce((a, b) => a + b, 0);
  const ms = (v: number) => `${v.toFixed(1)} ms`;

  // Cadence réelle observée vs demandée (liveMs). Pire des deux : écart entre 2
  // frames OU retard courant. > 3× la cadence = le serveur ne pousse plus à temps
  // (event-loop saturé) → on le DIT (le dashboard est affamé, pas planté).
  const observedGapMs = Math.max(tickGapMs, overdueMs);
  const realtimeStale =
    live && rtOnline && lastTickRef.current > 0 && observedGapMs > liveMs * 3;

  // En DÉVELOPPEMENT, l'event-loop partage le process avec Vite/HMR/rollup → un
  // lag de 15-25 ms est NORMAL (≠ prod). On relâche donc le seuil en dev pour ne
  // pas crier au loup ; en prod on vise <10 ms (seuils stricts).
  const isDev = info?.environment === "development";
  const cpuH = level(cpu, 50, 80);
  const memH = level(heapPct, 60, 80);
  const loopH = level(loop, isDev ? 50 : 20, isDev ? 120 : 50);
  // Erreurs : mesurées en LIVE uniquement (flux syslog). En pause → non évaluées.
  const errH = level(live ? errPerMin : 0, 1, 10);

  // Sondes process riches — optionnelles selon le payload.
  const gc = stats?.gc ?? undefined;
  const heapSpaces = stats?.heapSpaces ?? [];
  const handles = stats?.handles;

  // Connecteurs ORM unifiés : santé LIVE (orm:health) prioritaire, sinon SNAPSHOT.
  const connectors: OrmConn[] =
    live && ormHealth && ormHealth.length
      ? ormHealth.map((h) => ({
          name: h.name,
          vendor: h.vendor,
          driver: h.driver,
          target: h.target,
          connected: h.connected,
          pingMs: h.pingMs,
          pingOk: h.pingOk,
          errorCount: h.errorCount,
          reconnectCount: h.reconnectCount,
          entityCount: orms.find((o) => o.name === h.name)?.entityCount,
        }))
      : orms.map((o) => ({
          name: o.name,
          vendor: o.vendor,
          driver: o.connection?.driver ?? "",
          target: o.connection?.target,
          connected: o.connected,
          entityCount: o.entityCount,
        }));
  const connUp = connectors.filter((c) => c.connected).length;
  const connErr = connectors.reduce((a, c) => a + (c.errorCount ?? 0), 0);
  const connColor: string =
    connErr > 0
      ? "red"
      : connUp < connectors.length
        ? "orange"
        : connectors.length
          ? "teal"
          : "gray";

  // Bandeau d'alertes : tout indicateur hors-OK. Couleur + libellé (jamais la
  // couleur seule — WCAG 2.2). Les erreurs ne comptent qu'en live.
  // Chaque alerte porte une EXPLICATION (ⓘ) : ce que ça veut dire + si c'est
  // grave + quoi regarder — pour qu'un utilisateur non-expert comprenne.
  const alerts: { color: string; msg: string; help: string }[] = [];
  if (!rtOnline)
    alerts.push({
      color: "red",
      msg: `Temps réel ${rtState} — métriques figées`,
      help: "Le flux WebSocket temps réel est coupé : les valeurs affichées ne sont plus rafraîchies. Vérifiez que le serveur tourne et la connexion réseau.",
    });
  if (cpuH.color !== "teal")
    alerts.push({
      color: cpuH.color,
      msg: `CPU ${cpu}% (${cpuH.label})`,
      help: "Pourcentage d'UN cœur consommé par le process. Un pic court est normal (une requête lourde) ; élevé SUR LA DURÉE = charge de calcul soutenue. Voir l'onglet Performance.",
    });
  if (memH.color !== "teal")
    alerts.push({
      color: memH.color,
      msg: `Mémoire heap ${heapPct}% (${memH.label})`,
      help: "Part du tas V8 utilisée par rapport au plafond. >80% = risque d'OOM (crash mémoire). Surveillez surtout une croissance CONTINUE (fuite) plutôt qu'un pic. Voir l'onglet Mémoire.",
    });
  if (loopH.color !== "teal")
    alerts.push({
      color: loopH.color,
      msg: `Event-loop ${loop.toFixed(1)} ms (${loopH.label})`,
      help: isDev
        ? "Latence de la boucle d'événements Node. EN DÉVELOPPEMENT, Vite/HMR/rollup tournent dans le MÊME process → 15-25 ms est normal, ce n'est pas un incident. En production on vise <10 ms."
        : "Latence de la boucle d'événements Node : le temps avant que le serveur traite le prochain événement. Élevée = du code synchrone bloque la boucle (latence p99 dégradée). >50 ms = à investiguer.",
    });
  if (live && errH.color !== "teal")
    alerts.push({
      color: errH.color,
      msg: `${errPerMin} erreur(s)/min (${errH.label})`,
      help: "Nombre de logs ERROR + CRITIC sur les 60 dernières secondes (canal syslog). Ouvrez l'onglet Erreurs puis la page Logs pour la stack trace.",
    });
  if (realtimeStale)
    alerts.push({
      color: "orange",
      msg: `Temps réel en retard — rafraîchi ~toutes les ${(observedGapMs / 1000).toFixed(1)} s (cadence demandée ${(liveMs / 1000).toFixed(0)} s)`,
      help: "Les mesures arrivent en retard : la boucle d'événements du serveur est saturée (forte charge WS/HTTP) → le ticker temps réel ne tient plus sa cadence. Le dashboard n'est PAS planté, il est AFFAMÉ. Conséquence : les latences mesurées côté serveur (ex. ping ORM) sont gonflées par l'attente d'ordonnancement, PAS par la base.",
    });

  // Santé GLOBALE à 3 états (≠ binaire) : le ROUGE « Dégradé » est réservé aux
  // alertes critiques ; un simple warning jaune = « À surveiller » (PAS dégradé).
  // Évite le faux « Dégradé » permanent dès la moindre erreur/min.
  const hasRed = alerts.some((a) => a.color === "red");
  const hasWarn = alerts.length > 0;
  const globalState: "ok" | "watch" | "degraded" | "unknown" =
    !rtOnline || !stats
      ? "unknown"
      : hasRed
        ? "degraded"
        : hasWarn
          ? "watch"
          : "ok";
  const GLOBAL: Record<
    "ok" | "watch" | "degraded" | "unknown",
    { label: string; color: string }
  > = {
    ok: { label: "Opérationnel", color: "teal" },
    watch: { label: "À surveiller", color: "yellow" },
    degraded: { label: "Dégradé", color: "red" },
    unknown: { label: "En attente", color: "gray" },
  };
  const gState = GLOBAL[globalState];

  // Onglets visibles selon le mode : en OFF, on MASQUE les onglets purement
  // live (courbes temporelles : Performance, Erreurs) qui n'auraient rien à
  // montrer. Mémoire (anneau + espaces V8) et Système (infos + handles) restent
  // utiles depuis le snapshot. L'onglet actif retombe sur un onglet visible.
  const tabs = live
    ? ["performance", "memoire", "connecteurs", "erreurs", "systeme"]
    : ["memoire", "connecteurs", "systeme"];
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
  // Naviguer vers un onglet live-only depuis un KPI : si OFF, on active d'abord
  // le temps réel (sinon l'onglet n'existe pas).
  const goLiveTab = (t: string) => {
    if (!live) setLive(true);
    setTab(t);
  };

  // Légende du suffixe d'aide selon le mode (rend les ⓘ contextuelles/honnêtes).
  const liveSuffix = live
    ? `Temps réel ON (${liveMs / 1000}s).`
    : "Temps réel OFF — snapshot statique (activez pour les courbes).";
  const chartHint = "En attente des premières mesures…";

  return (
    <Stack gap="lg">
      {live && (
        <SupervisionLive
          channel={statsChannel}
          ormChannel={ormChannel}
          onStats={onStats}
          onLog={onLog}
          onOrm={onOrm}
        />
      )}

      <PageHeader
        sticky
        title="Supervision"
        subtitle={
          <>
            Santé applicative {live ? "en temps réel" : "(snapshot)"} —{" "}
            {auth.user?.username}. Vue per-instance.
          </>
        }
        actions={
          <Group gap="xs">
            {live && <span className="nf-live-dot" aria-hidden />}
            {!live && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={fetchSnapshot}
                aria-label="rafraîchir le snapshot"
              >
                Rafraîchir
              </Button>
            )}
            {/* Switch temps réel + granularité (HoverCard) — OFF par défaut. */}
            <HoverCard
              width={280}
              shadow="md"
              position="bottom-end"
              withinPortal
              openDelay={120}
              closeDelay={120}
            >
              <HoverCard.Target>
                <div>
                  <Switch
                    size="sm"
                    checked={live}
                    onChange={(e) => setLive(e.currentTarget.checked)}
                    label="Temps réel"
                    aria-label="abonnement temps réel (hub) des sondes de supervision"
                  />
                </div>
              </HoverCard.Target>
              <HoverCard.Dropdown>
                <Group gap={6} mb={6}>
                  <IconBolt size={14} />
                  <Text size="xs" fw={600}>
                    Temps réel & granularité
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" mb={8}>
                  OFF par défaut (perf) : snapshot statique. ON ouvre le flux WS
                  (courbes, GC, flash). Cadence des pushes :
                </Text>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={String(liveMs)}
                  onChange={(v) => setLiveMs(Number(v))}
                  data={[
                    { label: "1 s", value: "1000" },
                    { label: "2 s", value: "2000" },
                    { label: "5 s", value: "5000" },
                    { label: "10 s", value: "10000" },
                  ]}
                />
                <Text size="xs" c="dimmed" mt={6}>
                  Plus court = plus réactif, mais plus de mesures/s côté
                  serveur.
                </Text>
              </HoverCard.Dropdown>
            </HoverCard>
            {info && (
              <Badge variant="light" color="gray" size="lg">
                {info.environment}
              </Badge>
            )}
            {stats && (
              <Badge variant="outline" color="gray" size="lg">
                instance {stats.instanceId}
              </Badge>
            )}
            <Badge
              color={
                rtOnline
                  ? "teal"
                  : rtState === "reconnecting"
                    ? "yellow"
                    : "gray"
              }
              variant="light"
              size="lg"
            >
              {rtOnline
                ? live
                  ? "Realtime online"
                  : "Realtime prêt"
                : rtState}
            </Badge>
          </Group>
        }
      />

      {/* ── Bandeau état global / alertes ── */}
      {waiting ? (
        <Skeleton h={56} radius="md" />
      ) : !live ? (
        <Alert
          variant="light"
          color="blue"
          icon={<IconPlayerPause size={18} />}
          title="Temps réel en pause (snapshot statique)"
          role="status"
        >
          Les valeurs ci-dessous sont un instantané. Activez « Temps réel » pour
          les courbes, la pression GC et le suivi des erreurs (désactivé par
          défaut pour la perf).
        </Alert>
      ) : globalState === "ok" ? (
        <Alert
          variant="light"
          color="teal"
          icon={<IconCircleCheck size={18} />}
          title="Application opérationnelle"
          role="status"
        >
          Tous les indicateurs sont dans les seuils nominaux.
        </Alert>
      ) : (
        <Alert
          variant="light"
          color={hasRed ? "red" : "yellow"}
          icon={<IconAlertTriangle size={18} />}
          title={`${alerts.length} alerte(s) active(s) — ${gState.label}`}
          role="alert"
        >
          <Stack gap={4}>
            {alerts.map((a, i) => (
              <Group key={i} gap={8} wrap="nowrap">
                <Badge size="xs" color={a.color} variant="filled" circle>
                  {" "}
                </Badge>
                <Text size="sm">{a.msg}</Text>
                <InfoHint text={a.help} />
              </Group>
            ))}
            <Text size="xs" c="dimmed" mt={4}>
              Survolez ⓘ pour comprendre chaque alerte. « À surveiller » (jaune)
              = à garder à l'œil ; « Dégradé » (rouge) = action requise.
            </Text>
          </Stack>
        </Alert>
      )}

      {/* ── Indicateurs de santé (cards riches cliquables → onglet) ── */}
      <Grid>
        {/* État global — synthèse 3 états. */}
        <KpiCard
          label="État"
          accent={gState.color}
          icon={<IconActivityHeartbeat size={20} />}
          pulse={live}
          hint={`Synthèse 3 états : ROUGE « Dégradé » seulement si alerte critique, JAUNE « À surveiller » si avertissement, VERT sinon. Actuellement ${alerts.length} alerte(s), temps réel ${rtState}. ${liveSuffix}`}
          value={
            waiting ? (
              <Skeleton h={30} w={160} />
            ) : (
              <Text inherit c={gState.color}>
                <FlashValue value={gState.label}>{gState.label}</FlashValue>
              </Text>
            )
          }
          footer={
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color={gState.color}>
                {alerts.length === 0
                  ? "aucune alerte"
                  : `${alerts.length} alerte(s)`}
              </Badge>
              <Badge size="sm" variant="light" color={live ? "teal" : "gray"}>
                {live ? "live" : "snapshot"}
              </Badge>
              {realtimeStale && (
                <Badge size="sm" variant="light" color="orange">
                  retard ~{(observedGapMs / 1000).toFixed(1)}s
                </Badge>
              )}
            </Group>
          }
        />

        {/* CPU → onglet Performance. */}
        <KpiCard
          label="CPU"
          accent={cpuH.color}
          icon={<IconCpu size={20} />}
          pulse={live}
          active={activeTab === "performance"}
          onClick={() => goLiveTab("performance")}
          hint={`CPU à ${cpu}% d'un cœur (${cpuH.label}). Seuils : élevé ≥50%, critique ≥80%. Charge ⌀ ${stats ? stats.loadavg[0].toFixed(2) : "—"} sur ${stats?.cpuCount ?? "—"} cœur(s). Clic → onglet Performance.`}
          value={
            waiting ? (
              <Skeleton h={30} w={80} />
            ) : (
              <Text inherit c={cpuH.color}>
                <FlashValue value={cpu}>{cpu}%</FlashValue>
              </Text>
            )
          }
          footer={
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color={cpuH.color}>
                {cpuH.label}
              </Badge>
              {stats && (
                <Text size="xs" c="dimmed">
                  charge ⌀ {stats.loadavg[0].toFixed(2)}
                </Text>
              )}
            </Group>
          }
        />

        {/* Mémoire → onglet Mémoire. */}
        <KpiCard
          label="Mémoire heap"
          accent={memH.color}
          icon={<IconDatabase size={20} />}
          pulse={live}
          active={activeTab === "memoire"}
          onClick={() => setTab("memoire")}
          hint={`Heap V8 ${stats ? bytes(stats.memory.heapUsed) : "—"} / ${bytes(heapCeiling)} = ${heapPct}% (${memH.label}). Critique ≥80% (proche OOM). CPU et mémoire sont liés → voir le graphe « Corrélation ». Clic → onglet Mémoire.`}
          value={
            waiting ? (
              <Skeleton h={30} w={80} />
            ) : (
              <Text inherit c={memH.color}>
                <FlashValue value={heapPct}>{heapPct}%</FlashValue>
              </Text>
            )
          }
          footer={
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color={memH.color}>
                {stats ? bytes(stats.memory.heapUsed) : "—"}
              </Badge>
              {gc && (
                <Badge
                  size="sm"
                  variant="light"
                  color={gc.pauseMs > 50 ? "orange" : "gray"}
                  leftSection={<IconRecycle size={11} />}
                >
                  GC {gc.pauseMs.toFixed(0)} ms
                </Badge>
              )}
            </Group>
          }
        />

        {/* Event-loop → onglet Performance. */}
        <KpiCard
          label="Event-loop"
          accent={loopH.color}
          icon={<IconActivityHeartbeat size={20} />}
          pulse={live}
          active={activeTab === "performance"}
          onClick={() => goLiveTab("performance")}
          hint={`Retard de la boucle Node ${loop.toFixed(1)} ms (${loopH.label}). Plus c'est bas, plus le serveur est réactif. Seuils ${isDev ? "DEV (Vite in-process) : élevé ≥50ms, critique ≥120ms" : "PROD : élevé ≥20ms, critique ≥50ms"}. Quand il monte, il retarde AUSSI le rafraîchissement temps réel et gonfle le ping ORM (attente d'ordonnancement, pas la base). Clic → onglet Performance.`}
          value={
            waiting ? (
              <Skeleton h={30} w={90} />
            ) : (
              <Text inherit c={loopH.color}>
                <FlashValue value={loop.toFixed(1)}>
                  {loop.toFixed(1)} ms
                </FlashValue>
              </Text>
            )
          }
          footer={
            <Badge size="sm" variant="light" color={loopH.color}>
              {loopH.label}
            </Badge>
          }
        />

        {/* Erreurs (live-only) → onglet Erreurs. */}
        <KpiCard
          label="Erreurs / min"
          accent={errH.color}
          icon={<IconBug size={20} />}
          pulse={live}
          active={activeTab === "erreurs"}
          onClick={() => goLiveTab("erreurs")}
          hint={`ERROR + CRITIC sur les 60 dernières secondes (canal syslog:stream). Surveillé ≥1/min, critique ≥10/min. ${live ? `Actuellement ${errPerMin}/min.` : "Mesuré uniquement en temps réel (activez-le)."} Clic → onglet Erreurs.`}
          value={
            waiting ? (
              <Skeleton h={30} w={50} />
            ) : !live ? (
              <Text inherit c="dimmed">
                —
              </Text>
            ) : (
              <Text inherit c={errH.color}>
                <FlashValue value={errPerMin}>{errPerMin}</FlashValue>
              </Text>
            )
          }
          footer={
            <Badge size="sm" variant="light" color={live ? errH.color : "gray"}>
              {!live
                ? "temps réel requis"
                : errPerMin === 0
                  ? "aucune erreur"
                  : errH.label}
            </Badge>
          }
        />

        {/* Uptime → onglet Système. */}
        <KpiCard
          label="Uptime"
          accent="gray"
          icon={<IconClock size={20} />}
          active={activeTab === "systeme"}
          onClick={() => setTab("systeme")}
          hint={`Durée depuis le démarrage du process (per-instance). PID ${stats?.pid ?? info?.pid ?? "—"}, instance ${stats?.instanceId ?? "—"}. Clic → onglet Système.`}
          value={
            waiting ? <Skeleton h={30} w={110} /> : uptimeStr(stats!.uptime)
          }
          footer={
            <Badge size="sm" variant="light" color="gray">
              PID {stats?.pid ?? info?.pid ?? "—"}
            </Badge>
          }
        />

        {/* Connecteurs ORM → onglet Connecteurs. Live = ping/erreurs du hub. */}
        <KpiCard
          label="Connecteurs"
          accent={connColor}
          icon={<IconPlug size={20} />}
          pulse={live && !!ormHealth}
          active={activeTab === "connecteurs"}
          onClick={() => setTab("connecteurs")}
          hint={`Connexions ORM/bases ${connUp}/${connectors.length} actives${connErr > 0 ? `, ${connErr} erreur(s)` : ""}. ${live ? "Ping/erreurs en temps réel (canal orm:health)." : "Snapshot — activez le temps réel pour le ping live."} Clic → onglet Connecteurs.`}
          value={
            connectors.length ? (
              <Text inherit c={connColor}>
                <FlashValue value={`${connUp}/${connectors.length}`}>
                  {connUp}/{connectors.length}
                </FlashValue>
              </Text>
            ) : (
              <Text inherit c="dimmed">
                —
              </Text>
            )
          }
          footer={
            <Group gap="xs" wrap="nowrap">
              {[
                ...new Set(connectors.map((c) => c.vendor).filter(Boolean)),
              ].map((v) => (
                <Badge key={v} size="sm" variant="light" color="gray">
                  {v}
                </Badge>
              ))}
              {connErr > 0 && (
                <Badge size="sm" variant="light" color="red">
                  {connErr} err
                </Badge>
              )}
            </Group>
          }
        />
      </Grid>

      {/* ── Vue superviseur : CPU & mémoire CORRÉLÉS (live-only, masqué en OFF) ── */}
      {live && (
        <ChartCard
          title="Corrélation CPU / Mémoire"
          badge={
            <Group gap="xs" wrap="nowrap">
              <Badge variant="light" color={cpuH.color}>
                CPU {cpu}%
              </Badge>
              <Badge variant="light" color={memH.color}>
                Heap {heapPct}%
              </Badge>
              <InfoHint
                text={`CPU (% d'un cœur) et mémoire heap (% du plafond V8) tracés sur la MÊME échelle 0-100% (${sysHist.length} mesures). Lecture liée : pic mémoire qui tire le CPU = pression GC ; montée CPU sans mémoire = charge calcul ; les deux hauts ensemble = saturation. Zone rouge >80%. ${liveSuffix}`}
              />
            </Group>
          }
          caption="CPU et mémoire sont souvent liés — ici sur le même plan pour voir leur corrélation d'un coup d'œil."
        >
          {sysHist.length > 1 ? (
            <>
              <MiniChart
                height={210}
                max={100}
                threshold={80}
                format={(v) => `${Math.round(v)}%`}
                series={[
                  {
                    data: sysHist.map((p) => p.cpu),
                    color: "var(--mantine-color-teal-6)",
                    label: "CPU %",
                  },
                  {
                    data: sysHist.map((p) => p.heap),
                    color: "var(--mantine-color-blue-6)",
                    label: "Heap %",
                  },
                ]}
              />
              <Group gap="lg" mt="xs">
                <Legend
                  color="var(--mantine-color-teal-6)"
                  label="CPU (% d'un cœur)"
                />
                <Legend
                  color="var(--mantine-color-blue-6)"
                  label="Heap (% du plafond V8)"
                />
              </Group>
            </>
          ) : (
            <Waiting msg={chartHint} />
          )}
        </ChartCard>
      )}

      {/* ── Détail en onglets (« tablettes ») — onglets live-only masqués en OFF ── */}
      <Tabs
        value={activeTab}
        onChange={(v) => setTab(v ?? "memoire")}
        keepMounted={false}
        variant="outline"
        radius="md"
      >
        <Tabs.List mb="md">
          {live && (
            <Tabs.Tab value="performance" leftSection={<IconCpu size={15} />}>
              Performance
            </Tabs.Tab>
          )}
          <Tabs.Tab value="memoire" leftSection={<IconDatabase size={15} />}>
            Mémoire
          </Tabs.Tab>
          <Tabs.Tab value="connecteurs" leftSection={<IconPlug size={15} />}>
            Connecteurs
          </Tabs.Tab>
          {live && (
            <Tabs.Tab value="erreurs" leftSection={<IconBug size={15} />}>
              Erreurs
            </Tabs.Tab>
          )}
          <Tabs.Tab value="systeme" leftSection={<IconServer size={15} />}>
            Système
          </Tabs.Tab>
        </Tabs.List>

        {live && (
          <Tabs.Panel value="performance">
            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <ChartCard
                  title="Charge CPU"
                  badge={
                    <Badge variant="light" color={cpuH.color}>
                      {cpu}%
                    </Badge>
                  }
                  caption="% d'un cœur sur les 60 dernières secondes. Zone rouge = >80%."
                >
                  {cpuHist.length > 1 ? (
                    <MiniChart
                      height={180}
                      max={100}
                      threshold={80}
                      format={(v) => `${Math.round(v)}%`}
                      series={[
                        {
                          data: cpuHist,
                          color: "var(--mantine-color-teal-6)",
                          label: "CPU",
                        },
                      ]}
                    />
                  ) : (
                    <Waiting msg={chartHint} />
                  )}
                </ChartCard>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <ChartCard
                  title="Event-loop lag"
                  badge={
                    <Badge variant="light" color={loopH.color}>
                      {loop.toFixed(1)} ms
                    </Badge>
                  }
                  caption="Retard de la boucle Node. Plus c'est bas, plus le serveur est réactif. Zone rouge = >50ms."
                >
                  {loopHist.length > 1 ? (
                    <MiniChart
                      height={180}
                      threshold={50}
                      format={ms}
                      series={[
                        {
                          data: loopHist,
                          color: "var(--mantine-color-grape-6)",
                          label: "Lag",
                        },
                      ]}
                    />
                  ) : (
                    <Waiting msg={chartHint} />
                  )}
                </ChartCard>
              </Grid.Col>

              {/* Garbage Collector — pression GC (sonde process riche, live-only). */}
              <Grid.Col span={12}>
                <ChartCard
                  title="Garbage Collector"
                  badge={
                    gc ? (
                      <Badge
                        variant="light"
                        color={gc.pauseMs > 50 ? "orange" : "teal"}
                      >
                        {gc.pauseMs.toFixed(1)} ms / {liveMs / 1000}s
                      </Badge>
                    ) : undefined
                  }
                  caption={`Pause GC cumulée par intervalle (${liveMs / 1000}s). Une pause élevée = pression mémoire → latence. Majeurs (mark-sweep) plus coûteux que mineurs (scavenge). Disponible en temps réel uniquement.`}
                >
                  {gcHist.length > 1 ? (
                    <>
                      <MiniChart
                        height={150}
                        threshold={50}
                        format={(v) => `${v.toFixed(1)} ms`}
                        series={[
                          {
                            data: gcHist,
                            color: "var(--mantine-color-orange-6)",
                            label: "Pause GC",
                          },
                        ]}
                      />
                      {gc && (
                        <Group gap="xl" mt="sm">
                          <MiniMetric label="Cycles" value={gc.count} />
                          <MiniMetric label="Majeurs" value={gc.major} />
                          <MiniMetric label="Mineurs" value={gc.minor} />
                        </Group>
                      )}
                    </>
                  ) : (
                    <Waiting msg={chartHint} />
                  )}
                </ChartCard>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="memoire">
          <Stack gap="lg">
            {live && (
              <ChartCard
                title="Mémoire"
                badge={
                  stats && (
                    <Badge variant="light" color="blue">
                      {bytes(stats.memory.heapUsed)} / {bytes(stats.memory.rss)}
                    </Badge>
                  )
                }
                caption="Heap (bleu) = objets JS gérés par V8. RSS (violet) = mémoire totale du process. Une croissance continue du heap = fuite potentielle."
              >
                {memHist.length > 1 ? (
                  <>
                    <MiniChart
                      height={190}
                      format={(v) => `${v.toFixed(0)} MB`}
                      series={[
                        {
                          data: memHist.map((m) => m.heap),
                          color: "var(--mantine-color-blue-6)",
                          label: "Heap",
                        },
                        {
                          data: memHist.map((m) => m.rss),
                          color: "var(--mantine-color-grape-6)",
                          label: "RSS",
                        },
                      ]}
                    />
                    <Group gap="lg" mt="xs">
                      <Legend
                        color="var(--mantine-color-blue-6)"
                        label="Heap (objets JS)"
                      />
                      <Legend
                        color="var(--mantine-color-grape-6)"
                        label="RSS (process)"
                      />
                    </Group>
                  </>
                ) : (
                  <Waiting msg={chartHint} />
                )}
              </ChartCard>
            )}

            {/* Heap V8 — anneau (statique, OK en snapshot). */}
            <Card withBorder radius="md" p="lg">
              <Group gap={6} mb="md">
                <IconDatabase size={20} stroke={1.5} />
                <Title order={4}>Heap V8</Title>
                <InfoHint text="Part du tas V8 utilisée par rapport au plafond (--max-old-space-size). Critique au-delà de 80% (risque d'OOM). Disponible aussi en snapshot." />
              </Group>
              {waiting ? (
                <Skeleton h={120} />
              ) : (
                <Group align="center" gap="xl" wrap="nowrap">
                  <RingProgress
                    size={110}
                    thickness={12}
                    sections={[{ value: heapPct, color: memH.color }]}
                    label={
                      <Text ta="center" size="lg" fw={700}>
                        {heapPct}%
                      </Text>
                    }
                  />
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Row k="Heap utilisé" v={bytes(stats!.memory.heapUsed)} />
                    <Row k="Heap alloué" v={bytes(stats!.memory.heapTotal)} />
                    <Row k="Plafond V8" v={bytes(heapCeiling)} />
                    <Row k="RSS" v={bytes(stats!.memory.rss)} />
                    <Row k="Externe" v={bytes(stats!.memory.external)} />
                  </Stack>
                </Group>
              )}
            </Card>

            {/* Espaces mémoire V8 — sonde process riche (répartition du tas). */}
            <Card withBorder radius="md" p="lg">
              <Group gap={6} mb="md">
                <IconBoxMultiple size={20} stroke={1.5} />
                <Title order={4}>Espaces mémoire V8</Title>
                <InfoHint text="Répartition du tas V8 par espace : new_space (objets jeunes, scavenge fréquent), old_space (objets promus), large_object_space (gros objets), code_space (code compilé)… Une saturation cible la nature de la pression mémoire." />
              </Group>
              {waiting ? (
                <Skeleton h={120} />
              ) : heapSpaces.length ? (
                <Stack gap={10}>
                  {heapSpaces
                    .filter((sp) => sp.size > 0)
                    .map((sp) => {
                      const pct = Math.round((sp.used / sp.size) * 100);
                      return (
                        <div key={sp.name}>
                          <Group
                            justify="space-between"
                            gap="xs"
                            mb={3}
                            wrap="nowrap"
                          >
                            <Text size="xs" ff="monospace" truncate>
                              {sp.name}
                            </Text>
                            <Text
                              size="xs"
                              c="dimmed"
                              ff="monospace"
                              style={{ flexShrink: 0 }}
                            >
                              {bytes(sp.used)} / {bytes(sp.size)} ({pct}%)
                            </Text>
                          </Group>
                          <Progress
                            value={pct}
                            color={
                              pct >= 90 ? "red" : pct >= 70 ? "yellow" : "teal"
                            }
                            size="sm"
                            radius="sm"
                          />
                        </div>
                      );
                    })}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Sondes mémoire V8 indisponibles.
                </Text>
              )}
            </Card>
          </Stack>
        </Tabs.Panel>

        {/* Connecteurs ORM — snapshot toujours dispo ; ping/erreurs en live. */}
        <Tabs.Panel value="connecteurs">
          <Card withBorder radius="md" p="lg">
            <Group gap={6} mb="md">
              <IconPlug size={20} stroke={1.5} />
              <Title order={4}>Connecteurs ORM / bases</Title>
              <Text size="xs" c="dimmed">
                {connUp}/{connectors.length} actif(s)
              </Text>
              <InfoHint
                text={`Connexions ORM du process (per-instance). ${live ? "Ping, erreurs et reconnexions en temps réel (canal orm:health)." : "Snapshot statique — activez le temps réel pour le ping live."} Cible affichée en chemin relatif (sécurité).`}
              />
            </Group>
            {!connectors.length ? (
              <Text size="sm" c="dimmed">
                Aucun connecteur ORM monté.
              </Text>
            ) : (
              <Grid>
                {connectors.map((c) => (
                  <Grid.Col key={c.name} span={{ base: 12, sm: 6, lg: 4 }}>
                    <Card withBorder radius="sm" p="md" h="100%">
                      <Group justify="space-between" wrap="nowrap" mb={6}>
                        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                          <Text fw={600} truncate>
                            {c.name}
                          </Text>
                          <Badge size="xs" variant="light" color="gray">
                            {c.vendor}
                          </Badge>
                        </Group>
                        <Badge
                          size="sm"
                          variant="light"
                          color={c.connected ? "teal" : "red"}
                        >
                          {c.connected ? "connecté" : "coupé"}
                        </Badge>
                      </Group>
                      <Stack gap={4}>
                        <Row k="Driver" v={c.driver || "—"} mono />
                        <Row k="Cible" v={c.target ?? "—"} mono />
                        {c.entityCount != null && (
                          <Row k="Entités" v={String(c.entityCount)} />
                        )}
                        {live && (
                          <>
                            <Row
                              k={
                                loopH.color !== "teal" ? (
                                  <Group gap={4} wrap="nowrap">
                                    Ping
                                    <InfoHint
                                      text={`Latence mesurée côté serveur (await ping). L'event-loop est à ${loop.toFixed(0)} ms : une grande part de ce ping = attente d'ordonnancement, PAS la base (${c.vendor} local ≈ µs). Ne lisez pas ce ping comme un souci de base tant que l'event-loop est élevé.`}
                                    />
                                  </Group>
                                ) : (
                                  "Ping"
                                )
                              }
                              v={
                                c.pingOk ? (
                                  <FlashValue value={c.pingMs ?? 0}>
                                    {c.pingMs != null ? `${c.pingMs} ms` : "—"}
                                  </FlashValue>
                                ) : c.pingOk === false ? (
                                  <Text inherit c="red">
                                    échec
                                  </Text>
                                ) : (
                                  <Text inherit c="dimmed">
                                    en attente…
                                  </Text>
                                )
                              }
                            />
                            <Row
                              k="Erreurs"
                              v={
                                <FlashValue value={c.errorCount ?? 0}>
                                  {c.errorCount ?? 0}
                                </FlashValue>
                              }
                            />
                            <Row
                              k="Reconnexions"
                              v={
                                <FlashValue value={c.reconnectCount ?? 0}>
                                  {c.reconnectCount ?? 0}
                                </FlashValue>
                              }
                            />
                          </>
                        )}
                      </Stack>
                      {!live && (
                        <Text size="xs" c="dimmed" mt={6}>
                          Ping/erreurs : activez le temps réel.
                        </Text>
                      )}
                    </Card>
                  </Grid.Col>
                ))}
              </Grid>
            )}
          </Card>
        </Tabs.Panel>

        {live && (
          <Tabs.Panel value="erreurs">
            <ChartCard
              title="Erreurs / s"
              badge={
                <Badge variant="light" color={live ? errH.color : "gray"}>
                  {live ? `${errPerMin}/min` : "temps réel requis"}
                </Badge>
              }
              caption="Nombre d'ERROR+CRITIC par seconde (canal syslog:stream). Toute barre rouge = incident à investiguer. Mesuré en temps réel uniquement."
            >
              {errHist.length > 1 ? (
                <MiniChart
                  height={180}
                  threshold={1}
                  format={(v) => String(Math.round(v))}
                  series={[
                    {
                      data: errHist,
                      color: "var(--mantine-color-red-6)",
                      label: "Erreurs",
                    },
                  ]}
                />
              ) : (
                <Waiting msg={chartHint} />
              )}
            </ChartCard>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="systeme">
          <Stack gap="lg">
            <Card withBorder radius="md" p="lg">
              <Group justify="space-between" mb="md">
                <Title order={4}>Système</Title>
                <IconServer size={20} stroke={1.4} />
              </Group>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Row k="Environnement" v={info?.environment ?? "—"} mono />
                    <Row k="Version" v={info?.version ?? "—"} mono />
                    <Row
                      k="PID"
                      v={String(stats?.pid ?? info?.pid ?? "—")}
                      mono
                    />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Row
                      k="Load avg"
                      v={
                        stats
                          ? stats.loadavg.map((l) => l.toFixed(2)).join(" / ")
                          : "—"
                      }
                      mono
                    />
                    <Row k="Cœurs" v={String(stats?.cpuCount ?? "—")} mono />
                    <Row
                      k="Uptime"
                      v={stats ? uptimeStr(stats.uptime) : "—"}
                      mono
                    />
                  </Stack>
                </Grid.Col>
              </Grid>
            </Card>

            {/* Ressources actives — sonde process riche (ce qui tient la boucle). */}
            <Card withBorder radius="md" p="lg">
              <Group gap={6} mb="md">
                <IconPlugConnected size={20} stroke={1.5} />
                <Title order={4}>Ressources actives</Title>
                <Text size="xs" c="dimmed">
                  {handles ? (
                    <FlashValue value={handles.total}>
                      {handles.total}
                    </FlashValue>
                  ) : (
                    "—"
                  )}{" "}
                  handle(s)
                </Text>
                <InfoHint text="Ressources qui maintiennent la boucle d'événements vivante (timers, sockets, serveurs, file handles…), agrégées par type. Une croissance continue d'un type = fuite de handle potentielle." />
              </Group>
              {waiting ? (
                <Skeleton h={100} />
              ) : handles && Object.keys(handles.byType).length ? (
                <Grid>
                  {Object.entries(handles.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, n]) => (
                      <Grid.Col key={type} span={{ base: 6, sm: 4, md: 3 }}>
                        <Row
                          k={type}
                          v={<FlashValue value={n}>{n}</FlashValue>}
                          mono
                        />
                      </Grid.Col>
                    ))}
                </Grid>
              ) : (
                <Text size="sm" c="dimmed">
                  Aucune ressource active rapportée.
                </Text>
              )}
            </Card>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
});

/** Placeholder de graphe en attente (ou temps réel désactivé). */
function Waiting({ msg }: { msg?: string }) {
  return (
    <Stack align="center" justify="center" h={180} gap={4}>
      <Skeleton h={140} w="100%" />
      <Text size="xs" c="dimmed">
        {msg ?? "En attente des premières mesures…"}
      </Text>
    </Stack>
  );
}

/** Petite métrique inline (label + valeur), flashée à chaque changement. */
function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="md">
        <FlashValue value={value}>{value}</FlashValue>
      </Text>
    </Stack>
  );
}

export default DashboardSupervision;
