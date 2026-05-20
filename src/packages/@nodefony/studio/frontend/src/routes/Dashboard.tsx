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
} from "@mantine/core";
import {
  IconCpu,
  IconUsers,
  IconRoute,
  IconActivityHeartbeat,
  IconClock,
  IconServer,
  IconList,
  IconBug,
} from "@tabler/icons-react";
import { useStore, useAuth, useConnection } from "../stores";

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
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
}

/** Point de la série temporelle pour les graphes. */
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
  const conn = useConnection();
  const store = useStore();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [logRate, setLogRate] = useState(0);
  const logCount = useRef(0);
  const lastLogCount = useRef(0);
  const sampleIdx = useRef(0);

  // ── Statique : GET /info une seule fois ──
  useEffect(() => {
    let cancelled = false;
    store.api
      .get<ServerInfo>("/info")
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        /* backend non joignable — les stats WS prennent le relais */
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  // ── Live : canal WS `dashboard:stats` (push 1/s) ──
  useEffect(() => {
    const dispose = conn.subscribe("dashboard:stats", (payload: unknown) => {
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
    return () => dispose();
  }, [conn]);

  // ── Live : canal `syslog:stream` (uniquement pour le débit logs/s) ──
  useEffect(() => {
    const dispose = conn.subscribe("syslog:stream", () => {
      logCount.current++;
    });
    return () => dispose();
  }, [conn]);

  const heapPct =
    stats && stats.memory.heapTotal > 0
      ? Math.round((stats.memory.heapUsed / stats.memory.heapTotal) * 100)
      : 0;
  const cpu = stats?.cpuPercent ?? 0;
  const loop = stats?.eventLoopMs ?? 0;
  const loopColor = loop > 50 ? "red" : loop > 20 ? "yellow" : "teal";
  const cpuColor = cpu > 80 ? "red" : cpu > 50 ? "yellow" : "teal";
  const waiting = !stats;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={2}>Dashboard</Title>
          <Text c="dimmed" size="sm">
            Vue d'ensemble runtime — bienvenue {auth.user?.username}.
          </Text>
        </Stack>
        <Group gap="xs">
          {info && (
            <Badge variant="light" color="gray" size="lg" tt="lowercase">
              {info.env}
            </Badge>
          )}
          {info?.debug && (
            <Badge variant="filled" color="orange" size="lg" leftSection={<IconBug size={14} />}>
              DEBUG
            </Badge>
          )}
          {stats && (
            <Badge variant="outline" color="gray" size="lg" title="instance courante (1 process)">
              instance {stats.instanceId}
            </Badge>
          )}
          <Badge
            color={conn.isConnected ? "teal" : conn.state === "reconnecting" ? "yellow" : "gray"}
            variant="light"
            size="lg"
          >
            {conn.isConnected ? "Realtime online" : conn.state}
          </Badge>
        </Group>
      </Group>

      {/* ── Row 1 : 4 KPIs live ── */}
      <Grid>
        <KpiCard label="Environnement" icon={<IconServer size={30} stroke={1.4} />}>
          {info ? (
            <Group gap="xs" align="center">
              <Text fw={700} size="xl">{info.env}</Text>
              {info.debug && (
                <Badge color="orange" variant="filled" size="sm" leftSection={<IconBug size={12} />}>
                  debug
                </Badge>
              )}
            </Group>
          ) : (
            <Skeleton h={28} w={120} />
          )}
        </KpiCard>

        <KpiCard label="CPU process" icon={<IconCpu size={30} stroke={1.4} />}>
          {waiting ? <Skeleton h={28} w={60} /> : (
            <>
              <Text fw={700} size="xl" c={cpuColor}>{cpu}%</Text>
              <Text size="xs" c="dimmed">{stats!.cpuCount} cœurs</Text>
            </>
          )}
        </KpiCard>

        <KpiCard label="Event-loop lag" icon={<IconActivityHeartbeat size={30} stroke={1.4} />}>
          {waiting ? <Skeleton h={28} w={70} /> : (
            <>
              <Text fw={700} size="xl" c={loopColor}>{loop.toFixed(2)} ms</Text>
              <Text size="xs" c="dimmed">moyenne / s</Text>
            </>
          )}
        </KpiCard>

        <KpiCard label="Logs / s" icon={<IconList size={30} stroke={1.4} />}>
          {waiting ? <Skeleton h={28} w={50} /> : (
            <>
              <Text fw={700} size="xl">{logRate}</Text>
              <Text size="xs" c="dimmed">canal syslog:stream</Text>
            </>
          )}
        </KpiCard>
      </Grid>

      {/* ── Row 2 : graphes time-series CPU + mémoire ── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <Title order={4}>CPU %</Title>
              <Badge variant="light" color={cpuColor}>{cpu}%</Badge>
            </Group>
            {history.length > 1 ? (
              <MiniChart
                height={200}
                max={100}
                series={[
                  { data: history.map((h) => h.cpu), color: "var(--mantine-color-orange-6)" },
                ]}
              />
            ) : (
              <Skeleton h={200} />
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <Title order={4}>Mémoire</Title>
              {stats && (
                <Badge variant="light" color="blue">
                  {bytes(stats.memory.heapUsed)} / {bytes(stats.memory.rss)}
                </Badge>
              )}
            </Group>
            {history.length > 1 ? (
              <>
                <MiniChart
                  height={200}
                  series={[
                    { data: history.map((h) => h.heap), color: "var(--mantine-color-blue-6)" },
                    { data: history.map((h) => h.rss), color: "var(--mantine-color-grape-6)" },
                  ]}
                />
                <Group gap="lg" mt="xs">
                  <Legend color="var(--mantine-color-blue-6)" label="Heap" />
                  <Legend color="var(--mantine-color-grape-6)" label="RSS" />
                </Group>
              </>
            ) : (
              <Skeleton h={200} />
            )}
          </Card>
        </Grid.Col>
      </Grid>

      {/* ── Row 3 : Heap detail + Système ── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <Title order={4}>Heap V8</Title>
              <IconActivityHeartbeat size={20} stroke={1.4} />
            </Group>
            {waiting ? (
              <Skeleton h={120} />
            ) : (
              <Group align="center" gap="xl" wrap="nowrap">
                <RingProgress
                  size={110}
                  thickness={12}
                  sections={[
                    { value: heapPct, color: heapPct > 80 ? "red" : heapPct > 60 ? "yellow" : "teal" },
                  ]}
                  label={<Text ta="center" size="xs" fw={700}>{heapPct}%</Text>}
                />
                <Stack gap={4} style={{ flex: 1 }}>
                  <Row k="Heap used" v={bytes(stats!.memory.heapUsed)} />
                  <Row k="Heap total" v={bytes(stats!.memory.heapTotal)} />
                  <Row k="RSS" v={bytes(stats!.memory.rss)} />
                  <Row k="External" v={bytes(stats!.memory.external)} />
                </Stack>
              </Group>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <Stack gap={0}>
                <Title order={4}>Système</Title>
                <Text size="xs" c="dimmed">vue per-instance (1 process) — cluster = Phase 13 Redis</Text>
              </Stack>
              <IconServer size={20} stroke={1.4} />
            </Group>
            <Grid>
              <Grid.Col span={6}>
                <Stack gap={6}>
                  <Row k="Node" v={info?.node ?? "—"} mono />
                  <Row k="Platform" v={info?.platform ?? "—"} mono />
                  <Row k="Version" v={info?.version ?? "—"} mono />
                </Stack>
              </Grid.Col>
              <Grid.Col span={6}>
                <Stack gap={6}>
                  <Row k="PID" v={String(stats?.pid ?? info?.pid ?? "—")} mono />
                  <Row k="Uptime" v={stats ? uptimeStr(stats.uptime) : "—"} mono />
                  <Row k="Debug" v={info ? (info.debug ? "on" : "off") : "—"} mono />
                  <Row
                    k="Load avg"
                    v={stats ? stats.loadavg.map((l) => l.toFixed(2)).join(" / ") : "—"}
                    mono
                  />
                </Stack>
              </Grid.Col>
            </Grid>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ── Row 4 : stubs gated ── */}
      <Grid>
        <KpiCard label="Sessions" icon={<IconUsers size={30} stroke={1.4} />} span={{ base: 12, sm: 6 }}>
          <Text fw={700} size="xl">—</Text>
          <Text size="xs" c="dimmed">P10.3 IAdminApi</Text>
        </KpiCard>
        <KpiCard label="Routes" icon={<IconRoute size={30} stroke={1.4} />} span={{ base: 12, sm: 6 }}>
          <Text fw={700} size="xl">—</Text>
          <Text size="xs" c="dimmed">P11.2 http:routes:list</Text>
        </KpiCard>
      </Grid>
    </Stack>
  );
});

/**
 * Mini-graphe SVG temps-réel — zéro dépendance (recharts 2.x est cassé sous
 * React 19 : il s'appuie sur `defaultProps` des composants fonction, supprimés
 * par React 19 → les séries Area ne se rendent pas). SVG natif = robuste +
 * léger, adapté à un framework. `preserveAspectRatio="none"` étire en largeur,
 * `vectorEffect="non-scaling-stroke"` garde l'épaisseur de trait constante.
 */
function MiniChart({
  series,
  height = 200,
  max,
}: {
  series: { data: number[]; color: string }[];
  height?: number;
  max?: number;
}) {
  const W = 600;
  const H = 200;
  const pad = 6;
  const n = Math.max(0, ...series.map((s) => s.data.length));
  if (n < 2) return null;
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.data)) * 1.1;
  const project = (data: number[]) =>
    data.map((v, i) => {
      const x = (i / (n - 1)) * (W - pad * 2) + pad;
      const y = H - pad - (Math.min(v, top) / top) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
    >
      {series.map((s, si) => {
        const pts = project(s.data);
        const line = pts.join(" ");
        const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
        return (
          <g key={si}>
            <polygon points={area} fill={s.color} opacity={0.12} />
            <polyline
              points={line}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span style={{ width: 12, height: 3, background: color, borderRadius: 2 }} />
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
}

function KpiCard({
  label,
  icon,
  children,
  span = { base: 12, sm: 6, lg: 3 },
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  span?: Record<string, number>;
}) {
  return (
    <Grid.Col span={span}>
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
            {children}
          </Stack>
          {icon}
        </Group>
      </Card>
    </Grid.Col>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" c="dimmed">{k}</Text>
      <Text size="sm" fw={600} ff={mono ? "monospace" : undefined}>{v}</Text>
    </Group>
  );
}
