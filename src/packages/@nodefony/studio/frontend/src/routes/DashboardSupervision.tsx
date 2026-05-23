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
  Table,
  Tooltip,
  Code,
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
  IconBrandNodejs,
} from "@tabler/icons-react";
import { useStore, useAuth } from "../stores";
import { NodefonyLogo } from "../components/NodefonyLogo";
import { DbLogo, hasDbLogo } from "../components/DbLogo";
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
  /** Saturation boucle (ELU) : utilization 0-1 + ms active/idle sur l'intervalle. */
  elu?: { utilization: number; active: number; idle: number } | null;
  /** Changements de contexte sur l'intervalle (live-only → null en snapshot). */
  ctx?: { voluntary: number; involuntary: number } | null;
  /** ERROR/CRITIC sur l'intervalle — compté serveur (évite d'abonner syslog:stream). */
  errCount?: number;
  /** Identité process (constante) : runtime Node, OS, parent. */
  proc?: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    ppid: number;
  };
  /** Métadonnées app (statiques) : nom, version framework, env, branche git. */
  app?: {
    name?: string;
    version?: string;
    env?: string;
    debug?: boolean;
    branch?: string;
  };
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

/** Une requête lente capturée (canal `orm:flow`). SQL paramétré + redacté. */
interface SlowQuery {
  ts: number;
  durationMs: number;
  connector: string;
  sql?: string;
}
/** Flux d'un connecteur (canal `orm:flow` / `GET /orm/api/flow`). */
interface FlowConn {
  connector: string;
  vendor: string;
  total: number;
  avgMs: number | null;
  ewmaMs: number | null;
  lastMs: number | null;
  maxMs: number;
  slowTotal: number;
  slow: SlowQuery[];
}
/** Rapport de flux ORM complet (per-instance). */
interface FlowReport {
  enabled: boolean;
  ts: number;
  instanceId: string;
  slowMs: number;
  connectors: FlowConn[];
}

const HISTORY = 60;
const MB = 1024 ** 2;

/**
 * Traduction des types de ressources actives Node (`getActiveResourcesInfo`) —
 * noms internes cryptiques → libellé clair + explication (aide ⓘ PAR élément).
 */
const HANDLE_INFO: Record<string, { label: string; desc: string }> = {
  TTYWrap: { label: "Terminal", desc: "Flux terminal (stdout / stderr / stdin)." },
  TCPSocketWrap: {
    label: "Socket TCP",
    desc: "Connexion TCP active — requête HTTP entrante, WebSocket, client sortant…",
  },
  TCPServerWrap: {
    label: "Serveur TCP",
    desc: "Serveur TCP en écoute (les serveurs HTTP/WS de Nodefony).",
  },
  PipeWrap: {
    label: "Pipe / IPC",
    desc: "Tube nommé ou canal IPC (communication inter-process).",
  },
  Timeout: {
    label: "Timer",
    desc: "setTimeout / setInterval encore programmé (non unref).",
  },
  Immediate: {
    label: "Immediate",
    desc: "setImmediate en attente d'exécution au prochain tick.",
  },
  FSReqCallback: {
    label: "I/O fichier",
    desc: "Opération de système de fichiers asynchrone en cours.",
  },
  FSEvent: {
    label: "Watch FS",
    desc: "Surveillance d'un fichier/dossier (fs.watch).",
  },
  StatWatcher: {
    label: "Stat watcher",
    desc: "Surveillance par polling (fs.watchFile).",
  },
  MessagePort: {
    label: "MessagePort",
    desc: "Canal de message (worker_threads / MessageChannel).",
  },
  Worker: { label: "Worker", desc: "Thread worker (worker_threads) actif." },
  ChildProcess: {
    label: "Process enfant",
    desc: "Process fils lancé (spawn / fork).",
  },
  SignalWrap: {
    label: "Signal POSIX",
    desc: "Écoute d'un signal système (SIGINT, SIGTERM…).",
  },
  HTTPParser: {
    label: "Parser HTTP",
    desc: "Analyseur de message HTTP en cours de traitement.",
  },
  GetAddrInfoReqWrap: {
    label: "DNS (lookup)",
    desc: "Résolution DNS en cours (getaddrinfo).",
  },
  TLSWrap: {
    label: "TLS",
    desc: "Connexion chiffrée TLS/SSL (HTTPS, WSS).",
  },
  UDPWrap: { label: "Socket UDP", desc: "Socket UDP active (datagrammes)." },
  ZlibStream: {
    label: "Compression",
    desc: "Flux de (dé)compression zlib / gzip / brotli.",
  },
};
/** Une entrée de l'indice de santé : valeur courante + seuils bon/critique + poids. */
interface HealthInput {
  label: string;
  /** Valeur courante (« smaller is better ») ou `null` si indisponible (exclue). */
  value: number | null;
  /** Seuil « bon » (d=1 en dessous). */
  good: number;
  /** Seuil « critique » (d=0 au-dessus). */
  crit: number;
  /** Poids dans la moyenne géométrique. */
  weight: number;
}

/** Résultat de l'agrégation : indice 0-100 + libellé/couleur + facteur limitant. */
interface HealthResult {
  score: number | null;
  label: string;
  color: string;
  worst: string | null;
  parts: { label: string; score: number }[];
}

/**
 * Désirabilité d'une métrique « smaller is better » (Derringer-Suich) : 1 sous le
 * seuil bon, 0 au-dessus du critique, rampe linéaire entre les deux.
 */
function healthDesirability(v: number, good: number, crit: number): number {
  if (crit <= good) return v <= good ? 1 : 0;
  if (v <= good) return 1;
  if (v >= crit) return 0;
  return (crit - v) / (crit - good);
}

/**
 * **Indice de santé composite** (0-100) — agrège des sondes hétérogènes via la
 * méthode **Derringer-Suich** (NIST Engineering Statistics Handbook §5.5.3.2.2) :
 * chaque sonde est normalisée en désirabilité [0,1], puis combinées par **moyenne
 * géométrique pondérée**. Propriété : si une sonde est critique (d=0), l'indice
 * tombe à 0 (le maillon faible domine — pas de masquage par les bonnes valeurs).
 * Les sondes `null` (indisponibles, ex. temps réel OFF) sont **exclues**.
 */
function buildHealth(inputs: HealthInput[]): HealthResult {
  const avail = inputs.filter((m) => m.value != null && m.weight > 0);
  if (!avail.length) {
    return { score: null, label: "—", color: "gray", worst: null, parts: [] };
  }
  let anyZero = false;
  let sumW = 0;
  let sumWln = 0;
  let worst: HealthInput | null = null;
  let worstD = 2;
  const parts: { label: string; score: number }[] = [];
  for (const m of avail) {
    const d = healthDesirability(m.value as number, m.good, m.crit);
    parts.push({ label: m.label, score: Math.round(d * 100) });
    if (d < worstD) {
      worstD = d;
      worst = m;
    }
    if (d <= 0) anyZero = true;
    sumW += m.weight;
    sumWln += m.weight * Math.log(Math.max(d, 1e-9));
  }
  const D = anyZero ? 0 : Math.exp(sumWln / sumW);
  const score = Math.round(D * 100);
  const [label, color] =
    score >= 90
      ? ["Excellent", "teal"]
      : score >= 75
        ? ["Bon", "green"]
        : score >= 50
          ? ["À surveiller", "yellow"]
          : score >= 25
            ? ["Dégradé", "orange"]
            : ["Critique", "red"];
  return { score, label, color, worst: worst?.label ?? null, parts };
}

/** Icône de provenance d'un connecteur ORM : vrai logo (Drizzle/SQLite…) si connu,
 *  sinon icône base générique. `name` = vendor (drizzle…) ou driver (sqlite…). */
function dbIcon(name?: string, size = 18) {
  return name && hasDbLogo(name) ? (
    <DbLogo name={name} size={size} />
  ) : (
    <IconDatabase size={size} color="var(--mantine-color-blue-5)" />
  );
}

/** Description d'un type de handle (fallback générique si inconnu). */
function describeHandle(type: string): { label: string; desc: string } {
  return (
    HANDLE_INFO[type] ?? {
      label: type,
      desc: `Ressource interne Node.js « ${type} » qui maintient la boucle d'événements active.`,
    }
  );
}

// Icônes de PROVENANCE des sondes (réfs stables au niveau module — 0 alloc/render) :
// Node.js (runtime/V8/process), Nodefony (framework), ORM (élément qui détient la sonde).
const SRC_NODE = (
  <IconBrandNodejs size={18} color="#83CD29" aria-label="Source : Node.js" />
);
const SRC_NODEFONY = <NodefonyLogo height={18} />;
const SRC_ORM = (
  <IconDatabase
    size={18}
    color="var(--mantine-color-blue-5)"
    aria-label="Source : connecteur ORM"
  />
);

/** Palette stable des séries de débit par connecteur (assignée par index). */
const FLOW_PALETTE = [
  "var(--mantine-color-yellow-6)",
  "var(--mantine-color-blue-6)",
  "var(--mantine-color-teal-6)",
  "var(--mantine-color-grape-6)",
  "var(--mantine-color-orange-6)",
  "var(--mantine-color-cyan-6)",
];

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

/** Couleur Mantine d'une opération SQL (lecture en un coup d'œil). */
const SQL_OP_COLOR: Record<string, string> = {
  SELECT: "blue",
  INSERT: "teal",
  UPDATE: "yellow",
  DELETE: "red",
};
/**
 * Extrait l'opération + la table cible d'un SQL paramétré (jamais de valeur dans
 * le texte). Heuristique tolérante : 1er mot-clé + 1ʳᵉ table après from/into/update.
 * Sert l'affichage « quelle table est lente » sans exécuter le SQL (0 injection).
 */
function parseSql(sql?: string): { op: string; table: string } {
  if (!sql) return { op: "?", table: "—" };
  const op = (sql.trim().split(/\s+/)[0] ?? "?").toUpperCase();
  const m = sql.match(/\b(?:from|into|update)\s+"?([A-Za-z0-9_]+)"?/i);
  return { op, table: m?.[1] ?? "—" };
}

/** Couleur de gravité d'une latence (ms) — jamais l'info par la couleur seule. */
function durColor(ms: number): string {
  return ms >= 500 ? "red" : ms >= 200 ? "orange" : "yellow";
}

/** Temps écoulé compact (« 3 s », « 2 min »…) depuis un epoch ms. */
function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
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
  flowChannel,
  onStats,
  onOrm,
  onFlow,
}: {
  channel: string;
  ormChannel: string;
  flowChannel: string;
  onStats: (p: unknown) => void;
  onOrm: (p: unknown) => void;
  onFlow: (p: unknown) => void;
}) {
  // Pas d'abo `syslog:stream` ici : le compteur d'erreurs vient du payload
  // supervision (compté serveur) → on n'inonde pas le dashboard de tous les logs.
  useNodefonyChannel(channel, onStats);
  useNodefonyChannel(ormChannel, onOrm);
  useNodefonyChannel(flowChannel, onFlow);
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
  // Flux ORM (débit/latence/slow) : snapshot (/orm/api/flow) + live (orm:flow).
  // Le débit/s se DÉRIVE du delta de `total` entre 2 rapports (comme le CPU%) →
  // on garde le rapport précédent (ts + totals) pour le calcul, live-only.
  const [ormFlow, setOrmFlow] = useState<FlowReport | null>(null);
  const [flowRates, setFlowRates] = useState<Record<string, number>>({});
  const prevFlowRef = useRef<{ ts: number; totals: Record<string, number> } | null>(
    null,
  );
  // Historique du débit PAR CONNECTEUR (1 point = un instantané {connecteur→req/s})
  // → courbe multi-séries (1 ligne/connecteur) + légendes au débit temps réel.
  const [flowHist, setFlowHist] = useState<{ rates: Record<string, number> }[]>(
    [],
  );
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
  // Canal flux ORM (même granularité ; le canal nu vaut 2 s côté serveur).
  const flowChannel = liveMs === 2000 ? "orm:flow" : `orm:flow:${liveMs}`;

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

  // Snapshot one-shot du flux ORM (total/latence/slow, SANS débit/s — le débit
  // exige des deltas live). Peuple la carte Flux en mode OFF.
  const fetchFlow = useCallback(() => {
    store.api
      .getAbsolute<FlowReport>("/nodefony/orm/api/flow")
      .then((d) => {
        if (d && Array.isArray(d.connectors)) setOrmFlow(d);
      })
      .catch(() => {});
  }, [store]);

  // OFF → on prend le snapshot et on vide les séries temporelles (live-only).
  // ON → `SupervisionLive` prend le relais (rien à faire ici).
  useEffect(() => {
    if (live) return;
    fetchSnapshot();
    fetchOrms();
    fetchFlow();
    setOrmHealth(null);
    setCpuHist([]);
    setLoopHist([]);
    setMemHist([]);
    setErrHist([]);
    setGcHist([]);
    setSysHist([]);
    setFlowRates({});
    setFlowHist([]);
    prevFlowRef.current = null;
  }, [live, fetchSnapshot, fetchOrms, fetchFlow]);

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
    // Erreurs comptées CÔTÉ SERVEUR sur l'intervalle (plus de syslog:stream ici).
    setErrHist((prev) => {
      const next = [...prev, s.errCount ?? 0];
      return next.length > HISTORY ? next.slice(-HISTORY) : next;
    });
  };

  // Handler santé ORM (live) : remplace l'état par le dernier paquet du hub.
  const onOrm = (payload: unknown) => {
    if (Array.isArray(payload)) setOrmHealth(payload as OrmHealth[]);
  };

  // Handler flux ORM (live) : dérive le débit/s du delta de `total` entre 2
  // rapports (Δtotal / Δts) — robuste même si l'event-loop dérape (le delta
  // couvre alors une fenêtre plus large). Garde le dernier rapport pour le delta.
  const onFlow = (payload: unknown) => {
    const r = payload as FlowReport;
    if (!r || !Array.isArray(r.connectors)) return;
    const prev = prevFlowRef.current;
    if (prev && r.ts > prev.ts) {
      const dt = (r.ts - prev.ts) / 1000;
      const rates: Record<string, number> = {};
      for (const c of r.connectors) {
        const p = prev.totals[c.connector];
        if (p != null && dt > 0) {
          rates[c.connector] = Math.max(0, (c.total - p) / dt);
        }
      }
      setFlowRates(rates);
      setFlowHist((h) => {
        const n = [...h, { rates }];
        return n.length > HISTORY ? n.slice(-HISTORY) : n;
      });
    }
    const totals: Record<string, number> = {};
    for (const c of r.connectors) totals[c.connector] = c.total;
    prevFlowRef.current = { ts: r.ts, totals };
    setOrmFlow(r);
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
  // Overhead GC = part de l'intervalle passée en pause (stop-the-world) → la
  // métrique actionnable : combien de temps CPU le GC a volé. Pause moyenne/cycle.
  const gcOverhead = gc && liveMs ? (gc.pauseMs / liveMs) * 100 : 0;
  const gcAvgPerCycle = gc && gc.count ? gc.pauseMs / gc.count : 0;
  const gcOverheadColor =
    gcOverhead > 5 ? "red" : gcOverhead > 1 ? "orange" : "teal";
  const heapSpaces = stats?.heapSpaces ?? [];
  const handles = stats?.handles;
  // Type de handle dominant (pour l'aide ⓘ dynamique des ressources actives).
  const handlesTop = handles
    ? Object.entries(handles.byType).sort((a, b) => b[1] - a[1])[0]
    : undefined;

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

  // Flux ORM dérivé : connecteurs + requêtes lentes agrégées (les + récentes en
  // tête, tous connecteurs confondus, bornées). `flowOff` = sonde désactivée
  // (prod) → on l'explique au lieu d'afficher des zéros muets.
  const flowConns = ormFlow?.connectors ?? [];
  const flowOff = ormFlow != null && ormFlow.enabled === false;
  const slowQueries = flowConns
    .flatMap((c) => c.slow ?? [])
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);
  // Échelle des barres = pire latence visible ; colonne connecteur seulement si
  // plusieurs connecteurs ont des requêtes lentes (sinon redondant).
  const slowWorstMs = slowQueries.reduce((m, q) => Math.max(m, q.durationMs), 0);
  const slowMultiConn = new Set(slowQueries.map((q) => q.connector)).size > 1;
  const flowTotal = flowConns.reduce((a, c) => a + c.total, 0);
  // Connecteurs tracés sur la courbe multi-séries = ceux ayant eu ≥1 requête
  // (cache les connecteurs idle, ex. sequelize à 0). Ordre stable (registre).
  const flowSeriesConns = flowConns
    .filter((c) => c.total > 0)
    .map((c) => c.connector);
  // Débit total temps réel = somme des débits par connecteur (badge).
  const flowRateNow = Object.values(flowRates).reduce((a, v) => a + v, 0);
  // Vendor dominant du flux (pour le logo de la carte — Drizzle ici).
  const flowMainVendor =
    flowConns.find((c) => c.total > 0)?.vendor ?? flowConns[0]?.vendor;
  // Couleur d'un connecteur = même teinte que sur le graphe principal (cohérence
  // visuelle carte ↔ courbe) ; gris pour un connecteur idle (hors séries).
  const flowColorOf = (conn: string): string => {
    const idx = flowSeriesConns.indexOf(conn);
    return idx >= 0
      ? FLOW_PALETTE[idx % FLOW_PALETTE.length]!
      : "var(--mantine-color-gray-5)";
  };
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

  // Indice de santé composite (Derringer-Suich) : agrège toutes les sondes en UN
  // score 0-100. Seuils env-aware ; sondes live-only exclues en snapshot (null).
  const health = buildHealth([
    { label: "CPU", value: stats ? cpu : null, good: 70, crit: 100, weight: 1 },
    {
      label: "Saturation (ELU)",
      value: stats?.elu ? Math.round(stats.elu.utilization * 100) : null,
      good: 70,
      crit: 100,
      weight: 1.5,
    },
    {
      label: "Event-loop",
      value: stats ? loop : null,
      good: isDev ? 50 : 20,
      crit: isDev ? 120 : 50,
      weight: 1.5,
    },
    {
      label: "Mémoire (heap)",
      value: stats ? heapPct : null,
      good: 70,
      crit: 90,
      weight: 1,
    },
    {
      label: "GC overhead",
      value: gc ? gcOverhead : null,
      good: 1,
      crit: 10,
      weight: 0.8,
    },
    {
      label: "Erreurs",
      value: live ? errPerMin : null,
      good: 0,
      crit: 10,
      weight: 1.2,
    },
    {
      label: "Connecteurs",
      value: connectors.length ? connectors.length - connUp : null,
      good: 0,
      crit: Math.max(1, connectors.length),
      weight: 1,
    },
    {
      label: "Temps réel",
      value: live ? (realtimeStale ? 1 : 0) : null,
      good: 0,
      crit: 2,
      weight: 0.5,
    },
  ]);

  return (
    <Stack gap="lg">
      {live && (
        <SupervisionLive
          channel={statsChannel}
          ormChannel={ormChannel}
          flowChannel={flowChannel}
          onStats={onStats}
          onOrm={onOrm}
          onFlow={onFlow}
        />
      )}

      <PageHeader
        sticky
        title="Supervision"
        subtitle={
          /* Identité process — propre dans la top bar sticky (reste visible au scroll). */
          <Group gap="md" wrap="wrap" mt={4}>
            <Group gap={5} wrap="nowrap">
              {SRC_NODE}
              <Text size="sm" fw={600}>
                {stats?.proc?.nodeVersion ?? "Node.js"}
              </Text>
              {stats?.proc && (
                <Text size="xs" c="dimmed">
                  {stats.proc.platform}/{stats.proc.arch}
                </Text>
              )}
            </Group>
            <Group gap={5} wrap="nowrap">
              {SRC_NODEFONY}
              <Text size="sm">
                {info?.version ?? stats?.app?.version ?? "—"}
              </Text>
            </Group>
            <Badge size="sm" variant="light" color="gray">
              {info?.environment ?? stats?.app?.env ?? "—"}
            </Badge>
            {stats?.app?.branch && (
              <Badge size="sm" variant="light" color="brand">
                {stats.app.branch}
              </Badge>
            )}
            <Text
              size="xs"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              PID {stats?.proc?.pid ?? stats?.pid ?? info?.pid ?? "—"} · instance{" "}
              {stats?.instanceId ?? "—"}
              {stats ? ` · uptime ${uptimeStr(stats.uptime)}` : ""}
            </Text>
          </Group>
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
            {/* Env / instance / état realtime retirés : redondants (env → onglet
                Système, instance → ⓘ uptime, état realtime → point live + switch). */}
          </Group>
        }
      />

      {/* ── Indice de santé composite (Derringer-Suich) — état général en 1 chiffre ── */}
      <Card withBorder radius="md" p="lg">
        <Group wrap="nowrap" align="center" gap="xl">
          <RingProgress
            size={128}
            thickness={13}
            roundCaps
            sections={[{ value: health.score ?? 0, color: health.color }]}
            label={
              <Stack gap={0} align="center">
                <Text fw={800} size="28px" lh={1}>
                  {health.score ?? "—"}
                </Text>
                <Text size="xs" c="dimmed">
                  / 100
                </Text>
              </Stack>
            }
          />
          <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
            <Group gap={8} wrap="nowrap">
              <Title order={3} size="h4">
                Santé du framework
              </Title>
              <Badge color={health.color} size="lg" variant="light">
                {health.label}
              </Badge>
              <InfoHint
                text={`Indice composite 0-100 = moyenne géométrique pondérée des désirabilités de chaque sonde (méthode Derringer-Suich, NIST). Chaque métrique est normalisée 0→1 entre son seuil « bon » et « critique » (seuils adaptés à l'environnement ${isDev ? "DEV" : "PROD"}). La moyenne géométrique fait qu'UNE sonde critique tire l'indice à 0 (le maillon faible domine, pas de masquage). Sondes indisponibles (temps réel OFF) exclues du calcul. ${health.parts.length} sonde(s) prise(s) en compte.`}
              />
            </Group>
            <Text size="sm" c="dimmed">
              {health.score == null
                ? "En attente de mesures…"
                : health.worst && health.score < 100
                  ? `Limité par : ${health.worst}.`
                  : "Tous les indicateurs au vert."}
            </Text>
            {/* Échelle lisible (bandes) */}
            <Group gap="md" wrap="wrap">
              {(
                [
                  ["≥90 Excellent", "teal"],
                  ["≥75 Bon", "green"],
                  ["≥50 À surveiller", "yellow"],
                  ["≥25 Dégradé", "orange"],
                  ["<25 Critique", "red"],
                ] as [string, string][]
              ).map(([lbl, c]) => (
                <Group key={lbl} gap={4} wrap="nowrap">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: `var(--mantine-color-${c}-6)`,
                    }}
                  />
                  <Text size="xs" c="dimmed">
                    {lbl}
                  </Text>
                </Group>
              ))}
            </Group>
            {/* Sous-scores par sonde (le détail de l'agrégation) */}
            {health.parts.length > 0 && (
              <Group gap="xs" wrap="wrap">
                {health.parts.map((p) => (
                  <Badge
                    key={p.label}
                    size="sm"
                    variant="light"
                    color={
                      p.score >= 75
                        ? "teal"
                        : p.score >= 50
                          ? "yellow"
                          : p.score >= 25
                            ? "orange"
                            : "red"
                    }
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {p.label} {p.score}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        </Group>
      </Card>

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
          fullscreen
          icon={SRC_NODE}
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
          {({ fullscreen }) =>
            sysHist.length > 1 ? (
              <>
                <MiniChart
                  height={fullscreen ? 600 : 210}
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
                {/* Plein écran : détail chiffré (pics sur la fenêtre + sondes). */}
                {fullscreen && (
                  <Grid mt="lg" gutter="lg">
                    <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                      <Row k="CPU actuel" v={`${cpu}%`} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                      <Row
                        k="CPU pic"
                        v={`${Math.round(Math.max(0, ...sysHist.map((p) => p.cpu)))}%`}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                      <Row k="Heap actuel" v={`${heapPct}%`} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                      <Row
                        k="Heap pic"
                        v={`${Math.round(Math.max(0, ...sysHist.map((p) => p.heap)))}%`}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                      <Row k="Event-loop" v={`${loop.toFixed(1)} ms`} />
                    </Grid.Col>
                    {gc && (
                      <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                        <Row
                          k="GC / intervalle"
                          v={`${gc.pauseMs} ms (${gc.count})`}
                        />
                      </Grid.Col>
                    )}
                    {stats && (
                      <>
                        <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                          <Row
                            k="Heap utilisé"
                            v={bytes(stats.memory.heapUsed)}
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                          <Row k="RSS" v={bytes(stats.memory.rss)} />
                        </Grid.Col>
                      </>
                    )}
                    <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
                      <Row k="Mesures" v={`${sysHist.length}`} />
                    </Grid.Col>
                  </Grid>
                )}
              </>
            ) : (
              <Waiting msg={chartHint} />
            )
          }
        </ChartCard>
      )}

      {/* ── Débit ORM par connecteur (live-only) — au niveau racine, sous la
           Corrélation : débit DB ↔ pression CPU/mémoire/GC se lisent ensemble.
           1 ligne/connecteur + légende au débit temps réel. Détail (latence,
           requêtes lentes) → onglet Connecteurs. ── */}
      {live && flowHist.length > 1 && flowSeriesConns.length > 0 && (
        <ChartCard
          fullscreen
          icon={dbIcon(flowMainVendor)}
          title="Débit ORM par connecteur"
          badge={
            <Badge variant="light" color="yellow">
              {Math.round(flowRateNow)} req/s total
            </Badge>
          }
          caption="Requêtes/s par connecteur ORM (dérivé du delta de requêtes). Une ligne par connecteur ; la légende affiche le débit temps réel courant. Détail (latence, requêtes lentes) dans l'onglet Connecteurs."
        >
          {({ fullscreen }) => (
            <>
              <MiniChart
                height={fullscreen ? 600 : 190}
                format={(v) => `${Math.round(v)}/s`}
                series={flowSeriesConns.map((conn, i) => ({
                  data: flowHist.map((p) => p?.rates?.[conn] ?? 0),
                  color: FLOW_PALETTE[i % FLOW_PALETTE.length]!,
                  label: conn,
                }))}
              />
              <Group gap="lg" mt={fullscreen ? "md" : "xs"}>
                {flowSeriesConns.map((conn, i) => (
                  <Legend
                    key={conn}
                    size={fullscreen ? "md" : "xs"}
                    color={FLOW_PALETTE[i % FLOW_PALETTE.length]!}
                    label={`${conn} — ${Math.round(flowRates[conn] ?? 0)}/s`}
                  />
                ))}
              </Group>
              {/* Plein écran : détail chiffré par connecteur (police agrandie). */}
              {fullscreen && (
                <Stack gap="sm" mt="xl">
                  <Text fw={700} size="lg">
                    Détail par connecteur
                  </Text>
                  <Table
                    fz="md"
                    striped
                    withTableBorder
                    verticalSpacing="sm"
                    horizontalSpacing="lg"
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Connecteur</Table.Th>
                        <Table.Th>Débit</Table.Th>
                        <Table.Th>Latence EWMA</Table.Th>
                        <Table.Th>Moy / max</Table.Th>
                        <Table.Th>Requêtes</Table.Th>
                        <Table.Th>Lentes</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {flowConns.map((c) => (
                        <Table.Tr key={c.connector}>
                          <Table.Td>
                            <Group gap={8} wrap="nowrap">
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 2,
                                  background: flowColorOf(c.connector),
                                  flex: "none",
                                }}
                              />
                              {dbIcon(c.vendor, 22)}
                              <Text fw={600}>{c.connector}</Text>
                              <Badge size="sm" variant="light" color="gray">
                                {c.vendor || "—"}
                              </Badge>
                            </Group>
                          </Table.Td>
                          <Table.Td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {Math.round(flowRates[c.connector] ?? 0)} req/s
                          </Table.Td>
                          <Table.Td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {c.ewmaMs != null ? `${c.ewmaMs} ms` : "—"}
                          </Table.Td>
                          <Table.Td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {c.avgMs != null ? c.avgMs : "—"} / {c.maxMs} ms
                          </Table.Td>
                          <Table.Td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {c.total.toLocaleString()}
                          </Table.Td>
                          <Table.Td
                            style={{ fontVariantNumeric: "tabular-nums" }}
                            c={c.slowTotal > 0 ? "orange" : undefined}
                          >
                            {c.slowTotal.toLocaleString()}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Stack>
              )}
            </>
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
                  icon={SRC_NODE}
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
                  icon={SRC_NODE}
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
                  fullscreen
                  icon={SRC_NODE}
                  title="Garbage Collector"
                  badge={
                    gc ? (
                      <Badge variant="light" color={gcOverheadColor}>
                        {gcOverhead.toFixed(1)}% · {gc.pauseMs.toFixed(0)} ms/
                        {liveMs / 1000}s
                      </Badge>
                    ) : undefined
                  }
                  caption="Pause GC (stop-the-world) par intervalle. Mineurs = jeune génération (fréquents, rapides) ; majeurs = vieille génération (rares, coûteux) = source des pics de latence. Temps réel uniquement."
                >
                  {({ fullscreen }) =>
                    gcHist.length > 1 ? (
                      <>
                        <MiniChart
                          height={fullscreen ? 560 : 150}
                          threshold={50}
                          format={(v) => `${v.toFixed(1)} ms`}
                          series={[
                            {
                              data: gcHist,
                              color: "var(--mantine-color-orange-6)",
                              label: "Pause GC (ms)",
                            },
                          ]}
                        />
                        {gc && (
                          <Grid mt="md">
                            {(
                              [
                                {
                                  k: "overhead",
                                  label: "Overhead",
                                  value: `${gcOverhead.toFixed(1)}%`,
                                  color: gcOverheadColor,
                                  info: `Part de l'intervalle (${liveMs / 1000}s) passée en pause GC (monde arrêté) = temps CPU volé par le GC. >1% = pression notable, >5% = le GC dégrade la latence. Pause totale : ${gc.pauseMs.toFixed(1)} ms.`,
                                },
                                {
                                  k: "cycles",
                                  label: "Cycles",
                                  value: gc.count,
                                  info: "Nombre de collectes sur l'intervalle (majeurs + mineurs).",
                                },
                                {
                                  k: "major",
                                  label: "Majeurs (mark-sweep)",
                                  value: gc.major,
                                  color: gc.major > 0 ? "orange" : undefined,
                                  info: "Collecte de la VIEILLE génération : parcourt tout le tas, stop-the-world long → c'est elle qui crée les pics de latence. Idéalement rare ; beaucoup = pression mémoire (objets promus).",
                                },
                                {
                                  k: "minor",
                                  label: "Mineurs (scavenge)",
                                  value: gc.minor,
                                  info: "Collecte de la JEUNE génération (objets éphémères) : très rapide et fréquente — normal d'en avoir beaucoup, peu coûteux.",
                                },
                                {
                                  k: "avg",
                                  label: "Pause / cycle",
                                  value: `${gcAvgPerCycle.toFixed(1)} ms`,
                                  info: "Durée moyenne d'une pause GC sur l'intervalle (pause totale ÷ cycles).",
                                },
                              ] as {
                                k: string;
                                label: string;
                                value: string | number;
                                color?: string;
                                info: string;
                              }[]
                            ).map((t) => (
                              <Grid.Col
                                key={t.k}
                                span={{ base: 6, sm: 4, md: 3 }}
                              >
                                <Card withBorder radius="sm" p="sm" h="100%">
                                  <Group
                                    justify="space-between"
                                    wrap="nowrap"
                                    align="flex-start"
                                  >
                                    <Text
                                      fw={700}
                                      size="xl"
                                      c={t.color}
                                      style={{
                                        fontVariantNumeric: "tabular-nums",
                                      }}
                                    >
                                      <FlashValue value={t.value}>
                                        {t.value}
                                      </FlashValue>
                                    </Text>
                                    <InfoHint text={t.info} />
                                  </Group>
                                  <Text size="sm" fw={500} truncate>
                                    {t.label}
                                  </Text>
                                </Card>
                              </Grid.Col>
                            ))}
                          </Grid>
                        )}
                      </>
                    ) : (
                      <Waiting msg={chartHint} />
                    )
                  }
                </ChartCard>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="memoire">
          <Stack gap="lg">
            {live && (
              <ChartCard
                icon={SRC_NODE}
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
                {SRC_NODE}
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
                {SRC_NODE}
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
              {SRC_ORM}
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
                          {dbIcon(c.driver || c.vendor, 18)}
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

          {/* Flux ORM — débit (queries/s, dérivé du delta), latence EWMA, slow.
              Distinct de la santé (état/ping) : ici on observe le DÉBIT réel vers
              la base (sonde process-wide, indépendante de l'ALS). Live-only pour
              le débit/s (besoin de deltas) ; total/latence/slow dispo en snapshot. */}
          <Card withBorder radius="md" p="lg" mt="md">
            <Group gap={6} mb="md">
              <IconBolt size={20} stroke={1.5} />
              {dbIcon(flowMainVendor)}
              <Title order={4}>Flux ORM</Title>
              <Text size="xs" c="dimmed">
                {flowTotal.toLocaleString()} requête(s) cumulée(s)
              </Text>
              <InfoHint
                text={`Débit réel des requêtes vers la base (sonde process-wide, ${flowConns.length} connecteur(s)). Le débit/s se dérive du delta de requêtes entre deux mesures (comme le CPU%) → temps réel requis. Latence EWMA = moyenne lissée par requête ; une requête est « lente » au-delà de ${ormFlow?.slowMs ?? 50} ms (capturée avec son SQL paramétré, sans valeur). ${flowOff ? "Sonde désactivée (production) : coût nul sur le hot path." : live ? "Débit/s en temps réel." : "Activez le temps réel pour le débit/s."}`}
              />
            </Group>

            {flowOff ? (
              <Alert
                variant="light"
                color="gray"
                icon={<IconBolt size={16} />}
                title="Sonde de flux désactivée"
              >
                La sonde de flux ORM est OFF (environnement de production) pour ne
                rien coûter sur le chemin des requêtes. Réactivable via la variable
                d'environnement <Text span fw={600}>NODEFONY_ORM_FLOW=1</Text>.
              </Alert>
            ) : !flowConns.length ? (
              <Text size="sm" c="dimmed">
                Aucune requête observée pour l'instant.
              </Text>
            ) : (
              <>
                <Grid>
                  {flowConns.map((c) => {
                    const rate = flowRates[c.connector];
                    return (
                      <Grid.Col
                        key={c.connector}
                        span={{ base: 12, sm: 6, lg: 4 }}
                      >
                        <Card withBorder radius="sm" p="md" h="100%">
                          <Group justify="space-between" wrap="nowrap" mb={6}>
                            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                              {dbIcon(c.vendor, 18)}
                              <Text fw={600} truncate>
                                {c.connector}
                              </Text>
                            </Group>
                            <Badge size="xs" variant="light" color="gray">
                              {c.vendor || "—"}
                            </Badge>
                          </Group>
                          <Stack gap={4}>
                            <Row
                              k="Débit"
                              v={
                                live && rate != null ? (
                                  <FlashValue value={Math.round(rate)}>
                                    {Math.round(rate).toLocaleString()} req/s
                                  </FlashValue>
                                ) : (
                                  <Text inherit c="dimmed">
                                    {live ? "…" : "temps réel requis"}
                                  </Text>
                                )
                              }
                            />
                            <Row
                              k="Latence (EWMA)"
                              v={
                                <FlashValue value={c.ewmaMs ?? 0}>
                                  {c.ewmaMs != null ? `${c.ewmaMs} ms` : "—"}
                                </FlashValue>
                              }
                            />
                            <Row
                              k="Moyenne / max"
                              v={`${c.avgMs != null ? `${c.avgMs}` : "—"} / ${c.maxMs} ms`}
                            />
                            <Row k="Requêtes" v={c.total.toLocaleString()} />
                            <Row
                              k="Lentes"
                              v={
                                <Text
                                  inherit
                                  c={c.slowTotal > 0 ? "orange" : undefined}
                                >
                                  {c.slowTotal.toLocaleString()}
                                </Text>
                              }
                            />
                          </Stack>
                          {/* Sparkline débit du connecteur (live-only) — même
                              couleur que la courbe principale. */}
                          {live && flowHist.length > 1 && (
                            <MiniChart
                              height={42}
                              format={(v) => `${Math.round(v)}/s`}
                              series={[
                                {
                                  data: flowHist.map(
                                    (p) => p?.rates?.[c.connector] ?? 0,
                                  ),
                                  color: flowColorOf(c.connector),
                                  label: `${c.connector} req/s`,
                                },
                              ]}
                            />
                          )}
                        </Card>
                      </Grid.Col>
                    );
                  })}
                </Grid>

                {slowQueries.length > 0 && (
                  <Stack gap={6} mt="md">
                    <Group gap={6}>
                      <Text fw={600} size="sm">
                        Requêtes lentes récentes
                      </Text>
                      <InfoHint
                        text={`Les ${slowQueries.length} requêtes les plus récentes au-delà de ${ormFlow?.slowMs ?? 50} ms, triées par fraîcheur. Opération color-codée, table cible extraite, barre = durée relative à la pire (${Math.round(slowWorstMs)} ms). SQL complet au survol — paramétré (0 valeur, 0 credential).`}
                      />
                    </Group>
                    <Table.ScrollContainer minWidth={520}>
                      <Table
                        striped
                        highlightOnHover
                        withTableBorder
                        verticalSpacing={6}
                        horizontalSpacing="sm"
                        fz="xs"
                      >
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th w={70}>Quand</Table.Th>
                            <Table.Th w={84}>Op.</Table.Th>
                            <Table.Th>Table</Table.Th>
                            <Table.Th w={170}>Durée</Table.Th>
                            {slowMultiConn && <Table.Th>Connecteur</Table.Th>}
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {slowQueries.map((q, i) => {
                            const { op, table } = parseSql(q.sql);
                            const ms = Math.round(q.durationMs);
                            const pct = Math.min(
                              100,
                              slowWorstMs > 0
                                ? (q.durationMs / slowWorstMs) * 100
                                : 0,
                            );
                            return (
                              <Table.Tr key={`${q.ts}-${i}`}>
                                <Table.Td c="dimmed">{relTime(q.ts)}</Table.Td>
                                <Table.Td>
                                  <Badge
                                    size="xs"
                                    variant="light"
                                    color={SQL_OP_COLOR[op] ?? "gray"}
                                  >
                                    {op}
                                  </Badge>
                                </Table.Td>
                                <Table.Td>
                                  <Tooltip
                                    label={q.sql ?? "<requête>"}
                                    multiline
                                    w={420}
                                    withArrow
                                    events={{
                                      hover: true,
                                      focus: true,
                                      touch: true,
                                    }}
                                  >
                                    <Code style={{ cursor: "help" }}>
                                      {table}
                                    </Code>
                                  </Tooltip>
                                </Table.Td>
                                <Table.Td>
                                  <Group gap={6} wrap="nowrap">
                                    <Text
                                      fw={600}
                                      style={{
                                        fontVariantNumeric: "tabular-nums",
                                        minWidth: 52,
                                      }}
                                    >
                                      {ms} ms
                                    </Text>
                                    <Progress
                                      value={pct}
                                      color={durColor(q.durationMs)}
                                      size="sm"
                                      radius="xl"
                                      style={{ flex: 1 }}
                                      aria-label={`Durée ${ms} ms`}
                                    />
                                  </Group>
                                </Table.Td>
                                {slowMultiConn && (
                                  <Table.Td>
                                    <Badge
                                      size="xs"
                                      variant="light"
                                      color="gray"
                                    >
                                      {q.connector}
                                    </Badge>
                                  </Table.Td>
                                )}
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Stack>
                )}
              </>
            )}
          </Card>
        </Tabs.Panel>

        {live && (
          <Tabs.Panel value="erreurs">
            <ChartCard
              icon={SRC_NODEFONY}
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
            {/* Process — identité runtime (Node/OS) + sondes saturation (ELU) et
                changements de contexte (l'instrument pour la contention CPU). */}
            <Card withBorder radius="md" p="lg">
              <Group justify="space-between" mb="md">
                <Group gap={6} wrap="nowrap">
                  {SRC_NODE}
                  <Title order={4}>Process</Title>
                </Group>
                <Badge variant="light" color="gray" size="sm">
                  PID {stats?.proc?.pid ?? stats?.pid ?? info?.pid ?? "—"}
                </Badge>
              </Group>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Stack gap={6}>
                    <Row k="Node.js" v={stats?.proc?.nodeVersion ?? "—"} mono />
                    <Row
                      k="Plateforme"
                      v={
                        stats?.proc
                          ? `${stats.proc.platform}/${stats.proc.arch}`
                          : "—"
                      }
                      mono
                    />
                    <Row
                      k="PID / parent"
                      v={
                        stats?.proc
                          ? `${stats.proc.pid} / ${stats.proc.ppid}`
                          : "—"
                      }
                      mono
                    />
                    <Row k="Instance" v={stats?.instanceId ?? "—"} mono />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Stack gap={6}>
                    <Row
                      k="Environnement"
                      v={info?.environment ?? stats?.app?.env ?? "—"}
                      mono
                    />
                    <Row
                      k="Framework"
                      v={info?.version ?? stats?.app?.version ?? "—"}
                      mono
                    />
                    <Row k="Branche git" v={stats?.app?.branch || "—"} mono />
                    <Row
                      k="Uptime"
                      v={stats ? uptimeStr(stats.uptime) : "—"}
                      mono
                    />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 12, md: 4 }}>
                  <Stack gap={6}>
                    <Row
                      k={
                        <Group gap={4} wrap="nowrap">
                          Saturation (ELU)
                          <InfoHint text="Event Loop Utilization : fraction du temps où la boucle est ACTIVE (vs idle). ~100% = thread mono saturé (CPU-bound) — la vraie jauge de saturation, ≠ le lag. Temps réel uniquement." />
                        </Group>
                      }
                      v={
                        stats?.elu ? (
                          <FlashValue value={Math.round(stats.elu.utilization * 100)}>
                            <Text
                              inherit
                              c={
                                stats.elu.utilization > 0.9
                                  ? "red"
                                  : stats.elu.utilization > 0.7
                                    ? "orange"
                                    : undefined
                              }
                            >
                              {Math.round(stats.elu.utilization * 100)}%
                            </Text>
                          </FlashValue>
                        ) : (
                          <Text inherit c="dimmed">
                            {live ? "…" : "temps réel"}
                          </Text>
                        )
                      }
                    />
                    <Row
                      k={
                        <Group gap={4} wrap="nowrap">
                          Ctx switch invol.
                          <InfoHint text="Changements de contexte INVOLONTAIRES sur l'intervalle = l'OS a PRÉEMPTÉ le process (contention CPU, cœurs sur-souscrits). C'est LE « switch de contexte » : s'il explose sous charge, le CPU est le goulot (pas le code). Temps réel uniquement." />
                        </Group>
                      }
                      v={
                        stats?.ctx ? (
                          <FlashValue value={stats.ctx.involuntary}>
                            <Text
                              inherit
                              c={
                                stats.ctx.involuntary > stats.ctx.voluntary
                                  ? "orange"
                                  : undefined
                              }
                            >
                              {stats.ctx.involuntary} /{liveMs / 1000}s
                            </Text>
                          </FlashValue>
                        ) : (
                          <Text inherit c="dimmed">
                            {live ? "…" : "temps réel"}
                          </Text>
                        )
                      }
                    />
                    <Row
                      k={
                        <Group gap={4} wrap="nowrap">
                          Ctx switch vol.
                          <InfoHint text="Changements de contexte VOLONTAIRES = le process a cédé le CPU lui-même (attente I/O, lock, syscall bloquant). Normal ; à comparer aux involontaires." />
                        </Group>
                      }
                      v={
                        stats?.ctx ? (
                          <FlashValue value={stats.ctx.voluntary}>
                            {stats.ctx.voluntary} /{liveMs / 1000}s
                          </FlashValue>
                        ) : (
                          <Text inherit c="dimmed">
                            {live ? "…" : "temps réel"}
                          </Text>
                        )
                      }
                    />
                  </Stack>
                </Grid.Col>
              </Grid>
            </Card>

            <Card withBorder radius="md" p="lg">
              <Group justify="space-between" mb="md">
                <Group gap={6} wrap="nowrap">
                  {SRC_NODEFONY}
                  <Title order={4}>Système</Title>
                </Group>
                <IconServer size={20} stroke={1.4} />
              </Group>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Row
                      k={
                        <Group gap={4} wrap="nowrap">
                          Load average
                          <InfoHint text="Charge moyenne de l'HÔTE (tous process confondus) sur 1 / 5 / 15 min, en nombre de tâches prêtes. À comparer au nombre de cœurs : > cœurs = machine surchargée → préemptions (cf ctx switch involontaires)." />
                        </Group>
                      }
                      v={
                        stats
                          ? stats.loadavg.map((l) => l.toFixed(2)).join(" / ")
                          : "—"
                      }
                      mono
                    />
                    <Row k="Cœurs CPU" v={String(stats?.cpuCount ?? "—")} mono />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Row
                      k={
                        <Group gap={4} wrap="nowrap">
                          Charge / cœur
                          <InfoHint text="Load average 1 min ÷ nombre de cœurs. < 1 = la machine suit ; > 1 = saturée (les tâches attendent un cœur → préemptions, latence)." />
                        </Group>
                      }
                      v={
                        stats && stats.cpuCount
                          ? ((stats.loadavg[0] ?? 0) / stats.cpuCount).toFixed(2)
                          : "—"
                      }
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
                {SRC_NODE}
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
                <InfoHint
                  text={
                    handles
                      ? `${handles.total} ressource(s) en ${Object.keys(handles.byType).length} type(s)${handlesTop ? ` — dominant : ${describeHandle(handlesTop[0]).label} (×${handlesTop[1]})` : ""}. Chaque tuile a son ⓘ. Une croissance continue d'un type entre deux ticks = fuite potentielle.`
                      : "Ressources qui maintiennent la boucle d'événements active. Activez le temps réel pour le détail par type."
                  }
                />
              </Group>
              {waiting ? (
                <Skeleton h={100} />
              ) : handles && Object.keys(handles.byType).length ? (
                <Grid>
                  {Object.entries(handles.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, n]) => {
                      const d = describeHandle(type);
                      return (
                        <Grid.Col key={type} span={{ base: 6, sm: 4, md: 3 }}>
                          <Card withBorder radius="sm" p="sm" h="100%">
                            <Group
                              justify="space-between"
                              wrap="nowrap"
                              align="flex-start"
                            >
                              <Text
                                fw={700}
                                size="xl"
                                style={{ fontVariantNumeric: "tabular-nums" }}
                              >
                                <FlashValue value={n}>{n}</FlashValue>
                              </Text>
                              <InfoHint text={`${d.label} — ${d.desc}`} />
                            </Group>
                            <Text size="sm" fw={500} truncate>
                              {d.label}
                            </Text>
                            <Text size="xs" c="dimmed" ff="monospace" truncate>
                              {type}
                            </Text>
                          </Card>
                        </Grid.Col>
                      );
                    })}
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

export default DashboardSupervision;
