import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  HoverCard,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconActivity,
  IconBolt,
  IconChevronRight,
  IconCpu,
  IconInfoCircle,
  IconPlugConnected,
  IconRefresh,
  IconServer,
  IconStack3,
  IconBroadcast,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useNodefonyAdaptiveChannelData } from "nodefony/react";
import { useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import {
  PageHeader,
  DataState,
  KpiCard,
  FlashValue,
  ensureLiveStyles,
  DocHint,
  GraphHint,
  MiniChart,
} from "../components/ui";

/** Version de la doc des fiches d'aide (`DocHint`) de la vue Cluster. */
const CLUSTER_DOC = "v1.0";

/** Points d'historique gardés par worker pour les sparklines (≈ 40 ticks). */
const HISTORY = 40;
const MB = 1024 ** 2;

/** Séries temporelles dérivées (live) d'UN worker — clé = pid (`instanceId`). */
interface WorkerSeries {
  /** % CPU d'un cœur sur l'intervalle. */
  cpu: number[];
  /** Heap V8 utilisé (Mo). */
  heap: number[];
  /** Lag event-loop (ms). */
  loop: number[];
}

/** Ajoute une valeur à une série bornée (FIFO, cap `HISTORY`) — 0 mutation in-place. */
function cap(arr: number[], v: number): number[] {
  const n =
    arr.length >= HISTORY ? arr.slice(arr.length - HISTORY + 1) : arr.slice();
  n.push(v);
  return n;
}

// ───────────────────────────────────────────────────────────────────────────
// Types MIROIR (frontière isomorphe : ne JAMAIS importer le runtime serveur
// @nodefony/framework dans le bundle client). Sous-ensemble des contrats
// `IRealtimeProbe.ts` (process + santé socket) servis par le data plane
// `/nodefony/realtime/api/health` ET poussés sur le canal `realtime:health`.
// ───────────────────────────────────────────────────────────────────────────

/** Santé PROCESS d'un worker (miroir de `IProcessHealth`, core). */
interface ProcessHealth {
  pid: number;
  uptime: number;
  cpuPercent: number;
  eventLoopMs: number;
  eluUtilization: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  ts: number;
}

/** Backpressure agrégée d'une connexion/instance (risque mémoire #1). */
interface Backpressure {
  maxBufferedAmount: number;
  totalBufferedAmount: number;
  slowConsumers: number;
}

/** Stat per-canal (fan-out). */
interface ChannelStat {
  channel: string;
  subscribers: number;
  messages: number;
}

/** Santé per-instance d'UN worker (miroir de `IRealtimeHealth`). */
interface InstanceHealth {
  instanceId: string;
  ts: number;
  channels: ChannelStat[];
  channelCount: number;
  publishTotal: number;
  fanoutTotal: number;
  inboundTotal: number;
  connectionCount: number;
  bytesSentTotal: number;
  messagesSentTotal: number;
  backpressure: Backpressure;
  /** Optionnel : absent si la sonde process est coupée. */
  process?: ProcessHealth;
}

/** Totaux pod (miroir de `IRealtimeClusterHealth.totals`). */
interface PodTotals {
  channelCount: number;
  publishTotal: number;
  fanoutTotal: number;
  inboundTotal: number;
  connectionCount: number;
  bytesSentTotal: number;
  messagesSentTotal: number;
  backpressure: Backpressure;
}

/** Vue POD agrégée (miroir de `IRealtimeClusterHealth`). */
interface ClusterHealth {
  cluster: true;
  ts: number;
  instanceCount: number;
  instances: InstanceHealth[];
  totals: PodTotals;
}

/** Réponse de l'endpoint santé : vue pod OU snapshot per-instance. */
type HealthPayload = ClusterHealth | InstanceHealth;

/** Vue normalisée commune (mono-process et cluster ramenés au même modèle). */
interface NormalizedHealth {
  cluster: boolean;
  ts: number;
  instances: InstanceHealth[];
  totals: PodTotals;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers — format STABLE (paliers, entiers) pour un live « calme » (0 jitter).
// ───────────────────────────────────────────────────────────────────────────

/** Discriminant cluster (vs per-instance). */
function isCluster(h: HealthPayload): h is ClusterHealth {
  return (h as ClusterHealth).cluster === true;
}

/** Octets → unité lisible (tabular-nums côté rendu). */
function niceBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

/** Uptime → paliers entiers (pas de churn ms↔s, cf « temps réel calme »). */
function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}

/** Couleur d'un % CPU (1 cœur : ~100 = saturé). */
function cpuColor(p: number): string {
  if (p >= 90) return "red";
  if (p >= 70) return "orange";
  return "teal";
}

/**
 * Couleur de l'event-loop lag — seuils RELÂCHÉS (dev partage le process avec
 * Vite/HMR : 15-25 ms normal). À durcir en prod via `info.environment` (futur).
 */
function loopColor(ms: number): string {
  if (ms >= 120) return "red";
  if (ms >= 50) return "orange";
  return "teal";
}

/** Ramène n'importe quelle réponse santé au modèle normalisé. */
function normalize(h: HealthPayload | null): NormalizedHealth | null {
  if (!h) return null;
  if (isCluster(h)) {
    return {
      cluster: true,
      ts: h.ts,
      instances: h.instances,
      totals: h.totals,
    };
  }
  // Per-instance : 1 worker, totaux = ses propres scalaires.
  return {
    cluster: false,
    ts: h.ts,
    instances: [h],
    totals: {
      channelCount: h.channelCount,
      publishTotal: h.publishTotal,
      fanoutTotal: h.fanoutTotal,
      inboundTotal: h.inboundTotal,
      connectionCount: h.connectionCount,
      bytesSentTotal: h.bytesSentTotal,
      messagesSentTotal: h.messagesSentTotal,
      backpressure: h.backpressure,
    },
  };
}

/**
 * Abonné à la SOCKET Nodefony, canal `realtime:health` — monté UNIQUEMENT quand
 * « Temps réel » est ON (abonnement ref-compté → démonter désabonne → le serveur
 * arrête le ticker). Suit le réglage AIMD global (`adaptive`). Pousse le dernier
 * snapshot pod (ou per-instance) à `onData`.
 */
function ClusterHealthLive({
  intervalMs,
  adaptive,
  onData,
  onRate,
}: {
  intervalMs: number;
  adaptive: boolean;
  onData: (h: HealthPayload) => void;
  onRate?: (ms: number) => void;
}) {
  const { data, intervalMs: effectiveMs } =
    useNodefonyAdaptiveChannelData<HealthPayload>(
      "realtime:health",
      intervalMs,
      {
        defaultMs: 5000,
        enabled: adaptive,
      },
    );
  useEffect(() => {
    if (data) onData(data);
    // onData = setState (stable) → hors deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    onRate?.(effectiveMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMs]);
  return null;
}

/** Une métrique de carte worker : label + valeur (tabular-nums) + flash live. */
function Metric({
  label,
  value,
  color,
  info,
}: {
  label: string;
  value: string | number;
  color?: string;
  info?: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" truncate>
          {label}
        </Text>
        {info}
      </Group>
      <Text fw={600} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
        <FlashValue value={value}>{value}</FlashValue>
      </Text>
    </div>
  );
}

/**
 * Mini-courbe live d'UNE métrique d'un worker (SVG, jamais recharts) — en-tête
 * label + dernière valeur (tabular-nums), tracé borné. Rendue UNIQUEMENT en temps
 * réel quand ≥ 2 points (l'historique se dérive des snapshots pod, 0 backend).
 */
function Sparkline({
  label,
  data,
  color,
  unit,
  max,
  threshold,
}: {
  label: string;
  data: number[];
  color: string;
  unit: string;
  max?: number;
  threshold?: number;
}) {
  const last = data.length ? data[data.length - 1]! : 0;
  return (
    <div style={{ minWidth: 0 }}>
      <Group gap={4} justify="space-between" wrap="nowrap">
        <Text size="xs" c="dimmed" truncate>
          {label}
        </Text>
        <Text size="xs" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
          {last}
          {unit}
        </Text>
      </Group>
      <MiniChart
        series={[{ data, color, label }]}
        height={34}
        max={max}
        threshold={threshold}
      />
    </div>
  );
}

/**
 * Carte « salle des machines » d'UN worker — process (CPU/event-loop/ELU/mém) +
 * socket (canaux, connexions, fan-out, backpressure). `contain: content` isole
 * le repaint au tick à cette carte (cf « ⚡ CSS & perf »).
 */
function WorkerCard({
  inst,
  live,
  index,
  series,
  onSelect,
}: {
  inst: InstanceHealth;
  live: boolean;
  index: number;
  series?: WorkerSeries;
  /** Drill-down → page détail `/nodefony/cluster/:pid`. */
  onSelect: () => void;
}) {
  const p = inst.process;
  const channels = inst.channels.map((c) => c.channel).join(", ") || "aucun";
  // Sparklines visibles seulement en live avec ≥ 2 points (sinon rien à tracer).
  const hasGraphs = live && !!series && series.cpu.length > 1;
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      className={live ? "nf-live-card" : undefined}
      style={{ contain: "content" }}
    >
      <Group justify="space-between" wrap="nowrap" mb="sm">
        {/* Affordance de drill = UN bouton focusable (pas la carte entière, qui
            contient déjà des ⓘ interactifs → pas de nested-interactive a11y). */}
        <UnstyledButton
          onClick={onSelect}
          aria-label={`Voir le détail du worker ${index + 1} (pid ${inst.instanceId})`}
          style={{ flex: 1, minWidth: 0, borderRadius: 8 }}
        >
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon variant="light" color="brand" radius="md">
              <IconCpu size={18} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Group gap={4} wrap="nowrap">
                <Text fw={600}>worker {index + 1}</Text>
                <IconChevronRight size={14} style={{ opacity: 0.5 }} />
              </Group>
              <Text
                size="xs"
                c="dimmed"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                pid {inst.instanceId}
              </Text>
            </div>
          </Group>
        </UnstyledButton>
        {p ? (
          <Badge variant="light" color="gray">
            <FlashValue value={fmtUptime(p.uptime)}>
              {fmtUptime(p.uptime)}
            </FlashValue>
          </Badge>
        ) : null}
      </Group>

      <Divider
        label={
          <Group gap={4} wrap="nowrap">
            <Text inherit>Process</Text>
            {hasGraphs ? (
              <GraphHint
                title="Courbes live du worker"
                version={CLUSTER_DOC}
                summary="CPU, heap et event-loop sur les dernières mesures — séries dérivées des snapshots pod (par pid), 0 état serveur."
                sections={[
                  {
                    label: "Lecture",
                    body: "CPU = % d'un cœur (≈100 = saturé). Event-loop > 50 ms = blocage synchrone (seuil orange).",
                  },
                ]}
              />
            ) : null}
          </Group>
        }
        labelPosition="left"
        mb="xs"
        styles={{ label: { fontSize: 11 } }}
      />
      {hasGraphs && series ? (
        <SimpleGrid cols={3} spacing="xs" mb="sm">
          <Sparkline
            label="CPU"
            data={series.cpu}
            color="var(--mantine-color-teal-6)"
            unit="%"
            max={100}
          />
          <Sparkline
            label="Heap"
            data={series.heap}
            color="var(--mantine-color-blue-6)"
            unit=" Mo"
          />
          <Sparkline
            label="Event-loop"
            data={series.loop}
            color="var(--mantine-color-grape-6)"
            unit=" ms"
            threshold={50}
          />
        </SimpleGrid>
      ) : null}
      {p ? (
        <SimpleGrid cols={3} spacing="xs" mb="sm">
          <Metric
            label="CPU"
            value={`${p.cpuPercent}%`}
            color={cpuColor(p.cpuPercent)}
          />
          <Metric
            label="Event-loop"
            value={`${p.eventLoopMs} ms`}
            color={loopColor(p.eventLoopMs)}
            info={
              <DocHint
                title="Event-loop lag"
                version={CLUSTER_DOC}
                summary="Retard moyen de la boucle d'événements sur l'intervalle (blocage synchrone)."
                sections={[
                  {
                    label: "À surveiller",
                    body: "En dev, le process partage la boucle avec Vite/HMR (15-25 ms normal). Seuils relâchés : orange ≥ 50 ms, rouge ≥ 120 ms.",
                  },
                ]}
              />
            }
          />
          <Metric
            label="ELU"
            value={p.eluUtilization.toFixed(2)}
            color={loopColor(p.eventLoopMs)}
          />
          <Metric label="RSS" value={niceBytes(p.rss)} />
          <Metric label="Heap" value={niceBytes(p.heapUsed)} />
          <Metric label="Hors-heap" value={niceBytes(p.external)} />
        </SimpleGrid>
      ) : (
        <Text size="xs" c="dimmed" mb="sm">
          Sonde process désactivée.
        </Text>
      )}

      <Divider
        label="Socket"
        labelPosition="left"
        mb="xs"
        styles={{ label: { fontSize: 11 } }}
      />
      <SimpleGrid cols={3} spacing="xs">
        <Metric
          label="Canaux"
          value={inst.channelCount}
          info={
            <DocHint
              title="Canaux actifs"
              version={CLUSTER_DOC}
              summary={`Canaux avec ≥ 1 abonné sur ce worker : ${channels}.`}
            />
          }
        />
        <Metric label="Connexions" value={inst.connectionCount} />
        <Metric
          label="Fan-out"
          value={inst.fanoutTotal}
          info={
            <DocHint
              title="Fan-out cumulé"
              version={CLUSTER_DOC}
              summary="Livraisons cumulées (publish × abonnés) depuis le boot du worker — vrai coût de diffusion."
            />
          }
        />
        <Metric
          label="Backpressure"
          value={niceBytes(inst.backpressure.totalBufferedAmount)}
          color={
            inst.backpressure.totalBufferedAmount > 0 ? "orange" : undefined
          }
          info={
            <DocHint
              title="Backpressure (bufferedAmount)"
              version={CLUSTER_DOC}
              summary="Octets en file d'envoi non drainés vers le réseau. > 0 durablement = consommateur lent → la file grossit → pression mémoire (blocker #1 du multiplexing)."
              sections={[
                {
                  label: "Si > 0",
                  body: `${inst.backpressure.slowConsumers} connexion(s) lente(s) ; pire file ${niceBytes(inst.backpressure.maxBufferedAmount)}.`,
                },
              ]}
            />
          }
        />
        <Metric label="Octets envoyés" value={niceBytes(inst.bytesSentTotal)} />
        <Metric label="Frames" value={inst.messagesSentTotal} />
      </SimpleGrid>
    </Card>
  );
}

/**
 * **Vue Cluster** (`/nodefony/cluster`) — la « salle des machines » du pod : une
 * carte par worker (santé process + socket), totaux pod en tête. Lit le data plane
 * `/nodefony/realtime/api/health` (1ᵉʳ paint) puis suit le canal `realtime:health`
 * (push WS) quand « Temps réel » est ON. En mono-process, affiche un seul worker.
 */
export const Cluster = observer(() => {
  const store = useStore();
  const ui = useUi();
  const navigate = useNavigate();
  useEffect(ensureLiveStyles, []);

  // 1ᵉʳ paint : snapshot HTTP one-shot (pas de flux WS si « Temps réel » OFF).
  const fetcher = useCallback(
    () => store.api.getAbsolute<HealthPayload>("/nodefony/realtime/api/health"),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);

  // Temps réel : interrupteur GLOBAL partagé (UiStore) — le même sur toutes les
  // pages realtime. OFF au (re)chargement (perf). La granularité reste locale.
  const live = ui.realtimeLive;
  const [liveMs, setLiveMs] = useState(5000);
  const auto = ui.adaptiveCadence;
  const [effectiveMs, setEffectiveMs] = useState(liveMs);
  // Dernier snapshot live (écrase le snapshot HTTP tant que ON).
  const [liveHealth, setLiveHealth] = useState<HealthPayload | null>(null);
  // Séries temporelles PAR worker (pid → cpu/heap/loop), dérivées des snapshots
  // pod successifs. 0 backend : l'historique se reconstitue côté front.
  const [series, setSeries] = useState<Map<string, WorkerSeries>>(new Map());
  useEffect(() => {
    if (!live) {
      setLiveHealth(null);
      setSeries(new Map());
    }
  }, [live]);

  // À chaque snapshot live, empile les métriques process de chaque worker (clé pid)
  // et PURGE les pid disparus (respawn → nouveau pid = nouvelle série, l'ancienne tombe).
  useEffect(() => {
    if (!live || !liveHealth) return;
    const n = normalize(liveHealth);
    if (!n) return;
    setSeries((prev) => {
      const next = new Map(prev);
      const seen = new Set<string>();
      for (const inst of n.instances) {
        seen.add(inst.instanceId);
        const p = inst.process;
        if (!p) continue;
        const cur = next.get(inst.instanceId) ?? {
          cpu: [],
          heap: [],
          loop: [],
        };
        next.set(inst.instanceId, {
          cpu: cap(cur.cpu, p.cpuPercent),
          heap: cap(cur.heap, Math.round(p.heapUsed / MB)),
          loop: cap(cur.loop, p.eventLoopMs),
        });
      }
      for (const id of next.keys()) if (!seen.has(id)) next.delete(id);
      return next;
    });
  }, [liveHealth, live]);

  const norm = normalize(live ? (liveHealth ?? data) : data);
  const workers = norm?.instances ?? [];
  const totals = norm?.totals;

  return (
    <Stack gap="lg">
      <PageHeader
        sticky
        title="Cluster"
        subtitle={
          norm
            ? norm.cluster
              ? `${workers.length} worker(s) — vue pod agrégée`
              : "Mono-process — 1 worker"
            : "Salle des machines du pod"
        }
        actions={
          <Group gap="sm">
            {auto && live ? (
              <Badge
                variant="light"
                color="grape"
                leftSection={<IconBolt size={12} />}
              >
                AIMD ~{Math.round(effectiveMs / 1000)}s
              </Badge>
            ) : null}
            <HoverCard
              width={300}
              shadow="md"
              position="bottom-end"
              openDelay={120}
              closeDelay={120}
            >
              <HoverCard.Target>
                <div>
                  <Switch
                    size="sm"
                    checked={live}
                    onChange={(e) => ui.setRealtimeLive(e.currentTarget.checked)}
                    label="Temps réel"
                    aria-label="abonnement temps réel (socket Nodefony) de la vue cluster"
                  />
                </div>
              </HoverCard.Target>
              <HoverCard.Dropdown>
                <Group gap={6} mb={6}>
                  <IconBolt size={14} />
                  <Text size="xs" fw={600}>
                    {auto
                      ? "Cadence désirée (plancher)"
                      : "Granularité du canal"}
                  </Text>
                </Group>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={String(liveMs)}
                  onChange={(v) => setLiveMs(Number(v))}
                  data={[
                    { label: "2 s", value: "2000" },
                    { label: "5 s", value: "5000" },
                    { label: "10 s", value: "10000" },
                    { label: "30 s", value: "30000" },
                  ]}
                />
                <Text size="xs" c="dimmed" mt={6}>
                  {auto
                    ? "Cadence auto (AIMD) ACTIVE — réglée globalement dans le Hub. Cette valeur sert de plancher."
                    : "Cadence des pushes de la socket (santé cluster). Cadence auto réglable dans le Hub."}
                </Text>
              </HoverCard.Dropdown>
            </HoverCard>
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              loading={loading}
              onClick={reload}
            >
              Recharger
            </Button>
          </Group>
        }
      />

      {/* Abonné live monté conditionnellement (ref-compté → 0 ticker serveur OFF). */}
      {live ? (
        <ClusterHealthLive
          intervalMs={liveMs}
          adaptive={auto}
          onData={setLiveHealth}
          onRate={setEffectiveMs}
        />
      ) : null}

      {norm && !norm.cluster ? (
        <Alert
          variant="light"
          color="blue"
          icon={<IconInfoCircle size={18} />}
          title="Mode mono-process"
        >
          Ce process tourne seul (pas de cluster). Pour la vue pod agrégée,
          lancer{" "}
          <Text span ff="monospace" fz="sm">
            nodefony cluster -w N
          </Text>{" "}
          (N workers). Chaque worker remonte alors sa santé au master.
        </Alert>
      ) : null}

      <DataState
        loading={loading && !norm}
        error={error}
        empty={!workers.length}
        onRetry={reload}
        emptyMessage="Aucune santé worker disponible."
      >
        {totals ? (
          <Grid>
            <KpiCard
              icon={<IconServer size={20} />}
              label="Workers"
              accent="brand"
              pulse={live}
              value={
                <FlashValue value={workers.length}>{workers.length}</FlashValue>
              }
              info={
                <DocHint
                  title="Workers"
                  version={CLUSTER_DOC}
                  summary={
                    norm?.cluster
                      ? `${workers.length} worker(s) dans le pod (snapshot agrégé poussé par le master).`
                      : "Mono-process : 1 seul worker (pas de cluster)."
                  }
                />
              }
            />
            <KpiCard
              icon={<IconPlugConnected size={20} />}
              label="Connexions"
              accent="teal"
              pulse={live}
              value={
                <FlashValue value={totals.connectionCount}>
                  {totals.connectionCount}
                </FlashValue>
              }
              info={
                <DocHint
                  title="Connexions realtime"
                  version={CLUSTER_DOC}
                  summary="Connexions WebSocket vivantes, tous workers du pod confondus."
                />
              }
            />
            <KpiCard
              icon={<IconBroadcast size={20} />}
              label="Fan-out"
              accent="grape"
              pulse={live}
              value={
                <FlashValue value={totals.fanoutTotal}>
                  {totals.fanoutTotal}
                </FlashValue>
              }
              info={
                <DocHint
                  title="Fan-out cumulé (pod)"
                  version={CLUSTER_DOC}
                  summary="Livraisons cumulées (publish × abonnés) sur l'ensemble des workers depuis leur boot."
                />
              }
            />
            <KpiCard
              icon={<IconActivity size={20} />}
              label="Backpressure"
              accent={
                totals.backpressure.totalBufferedAmount > 0 ? "orange" : "gray"
              }
              pulse={live}
              value={
                <FlashValue value={totals.backpressure.totalBufferedAmount}>
                  {niceBytes(totals.backpressure.totalBufferedAmount)}
                </FlashValue>
              }
              info={
                <DocHint
                  title="Backpressure pod"
                  version={CLUSTER_DOC}
                  summary="Somme des octets en file d'envoi non drainés, tous workers — risque mémoire #1 du multiplexing."
                  sections={[
                    {
                      label: "Si > 0",
                      body: `${totals.backpressure.slowConsumers} connexion(s) lente(s) dans le pod ; pire file ${niceBytes(totals.backpressure.maxBufferedAmount)}.`,
                    },
                  ]}
                />
              }
            />
          </Grid>
        ) : null}

        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md" mt="md">
          {workers.map((inst, i) => (
            <WorkerCard
              key={inst.instanceId}
              inst={inst}
              live={live}
              index={i}
              series={series.get(inst.instanceId)}
              onSelect={() =>
                navigate(`/nodefony/supervision?pid=${inst.instanceId}`)
              }
            />
          ))}
        </SimpleGrid>
      </DataState>
    </Stack>
  );
});

export default Cluster;
