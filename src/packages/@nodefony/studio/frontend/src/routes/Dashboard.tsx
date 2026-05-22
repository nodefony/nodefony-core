import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import {
  Card,
  Group,
  Grid,
  Stack,
  Text,
  Title,
  Badge,
  RingProgress,
  Skeleton,
  Tooltip,
} from "@mantine/core";
import {
  IconCpu,
  IconUsers,
  IconRoute,
  IconActivityHeartbeat,
  IconServer,
  IconList,
  IconBug,
  IconBrandNodejs,
} from "@tabler/icons-react";
import { useStore, useAuth } from "../stores";
import { useNodefonyState, useNodefonyChannel } from "nodefony/react";
import {
  PageHeader,
  StatCard as Kpi,
  InfoHint as Info,
  KeyValue as Row,
  MiniChart,
  ChartCard,
  Legend,
} from "../components/ui";

/** Infos statiques (one-shot GET /info). */
interface ServerInfo {
  name: string;
  version: string;
  env: string;
  debug: boolean;
  pid: number;
  node: string;
  platform: string;
}

/** Stats live poussées sur le canal WS `dashboard:stats` (1/s). */
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
    /** Plafond V8 (heap_size_limit). Absent des anciens payloads → fallback heapTotal. */
    heapLimit?: number;
    external: number;
  };
}

interface Sample {
  i: number;
  cpu: number;
  heap: number;
  rss: number;
  loop: number;
}

const HISTORY = 60;
const MB = 1024 ** 2;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
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
  return d > 0 ? `${d}j ${p(h)}:${p(m)}:${p(sec)}` : `${p(h)}:${p(m)}:${p(sec)}`;
}

export const Dashboard = observer(() => {
  const auth = useAuth();
  const store = useStore();
  // 100 % via le binding publié `nodefony/react` — plus de dépendance au store
  // pour le realtime (état + abonnements ref-comptés par le client).
  const rtState = useNodefonyState();
  const rtOnline = rtState === "connected";
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [routesTotal, setRoutesTotal] = useState<number | null>(null);
  const [sessions, setSessions] = useState<{
    active: number | null;
    storage: string;
    deprecated: boolean;
  } | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [logRate, setLogRate] = useState(0);
  const logCount = useRef(0);
  const lastLogCount = useRef(0);
  const sampleIdx = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Endpoints RÉELS du data plane (plus de mock /nodefony/studio/api/info) :
    // identité runtime via le producteur kernel, total routes via framework.
    store.api
      .getAbsolute<{
        version: string;
        environment: string;
        debug: boolean;
        pid: number;
        node: string;
        platform: string;
      }>("/nodefony/kernel/api/info")
      .then((d) => {
        if (cancelled) return;
        setInfo({
          name: "nodefony",
          version: d.version,
          env: d.environment,
          debug: !!d.debug,
          pid: d.pid,
          node: d.node,
          platform: d.platform,
        });
      })
      .catch(() => {});
    store.api
      .getAbsolute<{ routesTotal: number }>("/nodefony/framework/api/info")
      .then((d) => {
        if (!cancelled) setRoutesTotal(d.routesTotal);
      })
      .catch(() => {});
    store.api
      .getAbsolute<{ active: number | null; storage: string; deprecated: boolean }>(
        "/nodefony/http/api/sessions",
      )
      .then((d) => {
        if (!cancelled) setSessions(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store]);

  // Stats live via le binding publié `nodefony/react` (le client ref-compte
  // l'abonnement → cohabite avec le store/les autres pages sur le même canal).
  useNodefonyChannel("dashboard:stats", (payload: unknown) => {
    const s = payload as StatsPayload;
    if (!s || typeof s !== "object" || !s.memory) return;
    setStats(s);
    setHistory((prev) => {
      const next = [
        ...prev,
        {
          i: sampleIdx.current++,
          cpu: s.cpuPercent,
          heap: Math.round((s.memory.heapUsed / MB) * 10) / 10,
          rss: Math.round((s.memory.rss / MB) * 10) / 10,
          loop: s.eventLoopMs,
        },
      ];
      return next.length > HISTORY ? next.slice(-HISTORY) : next;
    });
    setLogRate(logCount.current - lastLogCount.current);
    lastLogCount.current = logCount.current;
  });

  // Canal PARTAGÉ avec la page Logs : sûr car le client ref-compte (démonter le
  // Dashboard ne coupe pas le flux pour Logs). Frame coalescée { logs[], dropped }.
  useNodefonyChannel("syslog:stream", (data: unknown) => {
    const rec = data as { logs?: unknown[]; dropped?: number } | null;
    const n =
      rec && Array.isArray(rec.logs) ? rec.logs.length + (rec.dropped ?? 0) : 1;
    logCount.current += n;
  });

  // Jauge Heap V8 = heapUsed / plafond V8 (heap_size_limit), PAS / heapTotal.
  // heapUsed/heapTotal vaut ~99% en permanence (V8 garde heapTotal collé au
  // heapUsed → grow/GC), donc trompeur. Contre le plafond réel (~2-4 Go), le %
  // est bas et devient actionnable (>80% = vraiment proche de l'OOM).
  const heapCeiling =
    stats?.memory.heapLimit && stats.memory.heapLimit > 0
      ? stats.memory.heapLimit
      : (stats?.memory.heapTotal ?? 0);
  const heapPct =
    stats && heapCeiling > 0
      ? Math.round((stats.memory.heapUsed / heapCeiling) * 100)
      : 0;
  // Taux de remplissage du tas actuellement réservé (heapUsed/heapTotal) —
  // affiché à part, pour info : normal qu'il soit proche de 100%.
  const heapFillPct =
    stats && stats.memory.heapTotal > 0
      ? Math.round((stats.memory.heapUsed / stats.memory.heapTotal) * 100)
      : 0;
  const cpu = stats?.cpuPercent ?? 0;
  const loop = stats?.eventLoopMs ?? 0;
  const loopColor = loop > 50 ? "red" : loop > 20 ? "yellow" : "teal";
  const cpuColor = cpu > 80 ? "red" : cpu > 50 ? "yellow" : "teal";
  const waiting = !stats;
  const pct = (v: number) => `${Math.round(v)}%`;
  const mb = (v: number) => `${v.toFixed(0)} MB`;
  const ms = (v: number) => `${v.toFixed(2)} ms`;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            Métriques runtime en temps réel (WebSocket, 1 mesure/s) — bienvenue{" "}
            {auth.user?.username}.
          </>
        }
        actions={
          <>
            {info && (
              <Badge variant="light" color="gray" size="lg">
                {info.env}
              </Badge>
            )}
            {info?.debug && (
              <Tooltip label="Serveur lancé avec --debug (logs DEBUG verbeux)" withArrow>
                <Badge variant="filled" color="orange" size="lg" leftSection={<IconBug size={14} />}>
                  DEBUG
                </Badge>
              </Tooltip>
            )}
            {stats && (
              <Tooltip
                label="Instance (process) qui te sert. En multi-process tu n'en vois qu'une — la vue cluster arrivera avec Redis (Phase 13)."
                withArrow
                multiline
                w={260}
              >
                <Badge variant="outline" color="gray" size="lg">
                  instance {stats.instanceId}
                </Badge>
              </Tooltip>
            )}
            <Tooltip label="État du WebSocket temps réel permanent (reconnexion auto)." withArrow>
              <Badge
                color={rtOnline ? "teal" : rtState === "reconnecting" ? "yellow" : "gray"}
                variant="light"
                size="lg"
              >
                {rtOnline ? "Realtime online" : rtState}
              </Badge>
            </Tooltip>
          </>
        }
      />

      {/* ── KPIs ── */}
      <Grid>
        <Kpi label="Environnement" icon={<IconServer size={30} stroke={1.4} />}
          hint="Mode de lancement du serveur (development / production / staging).">
          {info ? (
            <Group gap="xs" align="center">
              <Text fw={700} size="xl">{info.env}</Text>
              {info.debug && <Badge color="orange" variant="filled" size="sm" leftSection={<IconBug size={12} />}>debug</Badge>}
            </Group>
          ) : <Skeleton h={28} w={120} />}
        </Kpi>

        <Kpi label="CPU process" icon={<IconCpu size={30} stroke={1.4} />}
          hint="Temps CPU consommé par CE process Node, en % d'UN cœur (comme `top`). Node étant mono-thread, ~100% = 1 cœur saturé. >80% = rouge.">
          {waiting ? <Skeleton h={28} w={60} /> : (
            <>
              <Text fw={700} size="xl" c={cpuColor}>{cpu}%</Text>
              <Text size="xs" c="dimmed">{stats!.cpuCount} cœurs dispo</Text>
            </>
          )}
        </Kpi>

        <Kpi label="Event-loop lag" icon={<IconActivityHeartbeat size={30} stroke={1.4} />}
          hint="Retard moyen de la boucle d'événements Node sur la dernière seconde. Bas = serveur réactif. >50ms = du code synchrone bloque la boucle (mauvais pour la latence p99).">
          {waiting ? <Skeleton h={28} w={70} /> : (
            <>
              <Text fw={700} size="xl" c={loopColor}>{loop.toFixed(2)} ms</Text>
              <Text size="xs" c="dimmed">moyenne / s</Text>
            </>
          )}
        </Kpi>

        <Kpi label="Logs / s" icon={<IconList size={30} stroke={1.4} />}
          hint="Nombre de logs kernel (Pdu syslog) reçus par seconde via le canal WS syslog:stream. Reflète l'activité du serveur (requêtes, erreurs...).">
          {waiting ? <Skeleton h={28} w={50} /> : (
            <>
              <Text fw={700} size="xl">{logRate}</Text>
              <Text size="xs" c="dimmed">canal syslog:stream</Text>
            </>
          )}
        </Kpi>
      </Grid>

      {/* ── Graphes CPU + Event-loop ── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <ChartCard title="CPU %" badge={<Badge variant="light" color={cpuColor}>{cpu}%</Badge>}
            caption="% d'un cœur consommé par le process. Zone rouge = >80% (saturation).">
            {history.length > 1 ? (
              <MiniChart height={190} max={100} threshold={80} format={pct}
                series={[{ data: history.map((h) => h.cpu), color: "var(--mantine-color-orange-6)", label: "CPU" }]} />
            ) : <Waiting />}
          </ChartCard>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <ChartCard title="Event-loop lag" badge={<Badge variant="light" color={loopColor}>{loop.toFixed(2)} ms</Badge>}
            caption="Retard de la boucle Node. Plus c'est bas, plus le serveur est réactif. Zone rouge = >50ms.">
            {history.length > 1 ? (
              <MiniChart height={190} threshold={50} format={ms}
                series={[{ data: history.map((h) => h.loop), color: "var(--mantine-color-grape-6)", label: "Lag" }]} />
            ) : <Waiting />}
          </ChartCard>
        </Grid.Col>
      </Grid>

      {/* ── Graphe mémoire (pleine largeur) ── */}
      <ChartCard
        title="Mémoire"
        badge={stats && <Badge variant="light" color="blue">{bytes(stats.memory.heapUsed)} / {bytes(stats.memory.rss)}</Badge>}
        caption="Heap (bleu) = mémoire des objets JavaScript gérée par V8. RSS (violet) = mémoire totale du process (heap + code natif + buffers). Une croissance continue du heap = fuite potentielle.">
        {history.length > 1 ? (
          <>
            <MiniChart height={200} format={mb}
              series={[
                { data: history.map((h) => h.heap), color: "var(--mantine-color-blue-6)", label: "Heap" },
                { data: history.map((h) => h.rss), color: "var(--mantine-color-grape-6)", label: "RSS" },
              ]} />
            <Group gap="lg" mt="xs">
              <Legend color="var(--mantine-color-blue-6)" label="Heap (objets JS)" />
              <Legend color="var(--mantine-color-grape-6)" label="RSS (process total)" />
            </Group>
          </>
        ) : <Waiting />}
      </ChartCard>

      {/* ── Heap detail + Système ── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <Group gap={6}><IconBrandNodejs size={20} stroke={1.6} color="var(--mantine-color-green-6)" /><Title order={4}>Heap V8</Title><Text size="xs" c="dimmed">% du plafond</Text><Info text="Heap utilisé / plafond V8 (heap_size_limit, ~2-4 Go ou --max-old-space-size). C'est le bon indicateur de saturation : >80% = vraiment proche de l'OOM. NE PAS confondre avec heapUsed/heapTotal (le « remplissage », ligne plus bas) qui reste ~99% en permanence car V8 garde heapTotal collé au heapUsed — c'est normal, pas un signe de fuite. La fuite se lit sur la COURBE heapUsed (au-dessus), pas ici." /></Group>
            </Group>
            {waiting ? <Skeleton h={120} /> : (
              <Group align="center" gap="xl" wrap="nowrap">
                <RingProgress size={110} thickness={12}
                  sections={[{ value: heapPct, color: heapPct > 80 ? "red" : heapPct > 60 ? "yellow" : "teal" }]}
                  label={<Text ta="center" size="lg" fw={700}>{heapPct}%</Text>} />
                <Stack gap={4} style={{ flex: 1 }}>
                  <Row k="Heap utilisé" v={bytes(stats!.memory.heapUsed)} />
                  <Row k="Heap alloué" v={bytes(stats!.memory.heapTotal)} />
                  <Row k="Plafond V8" v={bytes(heapCeiling)} />
                  <Row k="Remplissage" v={`${heapFillPct}% (normal ~99%)`} />
                  <Row k="RSS" v={bytes(stats!.memory.rss)} />
                  <Row k="Externe" v={bytes(stats!.memory.external)} />
                </Stack>
              </Group>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <Stack gap={0}>
                <Group gap={6}><Title order={4}>Système</Title><Info text="Infos du process courant. La vue est PER-INSTANCE (1 process) ; en multi-process, l'agrégat cluster viendra de Redis (Phase 13)." /></Group>
                <Text size="xs" c="dimmed">vue per-instance (1 process)</Text>
              </Stack>
              <IconServer size={20} stroke={1.4} />
            </Group>
            <Grid>
              <Grid.Col span={6}>
                <Stack gap={6}>
                  <Row k="Node" v={info?.node ?? "—"} mono />
                  <Row k="Plateforme" v={info?.platform ?? "—"} mono />
                  <Row k="Version" v={info?.version ?? "—"} mono />
                </Stack>
              </Grid.Col>
              <Grid.Col span={6}>
                <Stack gap={6}>
                  <Row k="PID" v={String(stats?.pid ?? info?.pid ?? "—")} mono />
                  <Row k="Uptime" v={stats ? uptimeStr(stats.uptime) : "—"} mono />
                  <Row k="Debug" v={info ? (info.debug ? "on" : "off") : "—"} mono />
                  <Row k="Load avg" v={stats ? stats.loadavg.map((l) => l.toFixed(2)).join(" / ") : "—"} mono />
                </Stack>
              </Grid.Col>
            </Grid>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ── Stubs gated ── */}
      <Grid>
        <Kpi label="Sessions" icon={<IconUsers size={30} stroke={1.4} />} span={{ base: 12, sm: 6 }}
          hint="Sessions serveur actives (storage fichier). DÉPRÉCIÉ : Nodefony 2026 vise le full stateless (JWT cookie) — ce sous-système sera retiré (cf cloud-native).">
          {sessions === null ? (
            <Skeleton h={28} w={60} />
          ) : (
            <Group gap="xs" align="center">
              <Text fw={700} size="xl">{sessions.active ?? "—"}</Text>
              <Stack gap={0}>
                <Text size="xs" c="dimmed">{sessions.storage}</Text>
                {sessions.deprecated && (
                  <Badge size="xs" color="yellow" variant="light">déprécié</Badge>
                )}
              </Stack>
            </Group>
          )}
        </Kpi>
        <Kpi label="Routes" icon={<IconRoute size={30} stroke={1.4} />} span={{ base: 12, sm: 6 }}
          hint="Nombre de routes HTTP+WS enregistrées dans le Router — réel via /nodefony/framework/api/info.">
          {routesTotal === null ? (
            <Skeleton h={28} w={60} />
          ) : (
            <>
              <Text fw={700} size="xl">{routesTotal}</Text>
              <Text size="xs" c="dimmed">/nodefony/framework/api</Text>
            </>
          )}
        </Kpi>
      </Grid>
    </Stack>
  );
});


function Waiting() {
  return (
    <Stack align="center" justify="center" h={190} gap={4}>
      <Skeleton h={150} w="100%" />
      <Text size="xs" c="dimmed">En attente des premières mesures…</Text>
    </Stack>
  );
}

