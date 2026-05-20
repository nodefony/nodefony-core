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
  Paper,
  ThemeIcon,
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
  IconInfoCircle,
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
  const [routesTotal, setRoutesTotal] = useState<number | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, [store]);

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
  const pct = (v: number) => `${Math.round(v)}%`;
  const mb = (v: number) => `${v.toFixed(0)} MB`;
  const ms = (v: number) => `${v.toFixed(2)} ms`;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={2}>Dashboard</Title>
          <Text c="dimmed" size="sm">
            Métriques runtime en temps réel (WebSocket, 1 mesure/s) — bienvenue {auth.user?.username}.
          </Text>
        </Stack>
        <Group gap="xs">
          {info && (
            <Badge variant="light" color="gray" size="lg">{info.env}</Badge>
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
              <Badge variant="outline" color="gray" size="lg">instance {stats.instanceId}</Badge>
            </Tooltip>
          )}
          <Tooltip label="État du WebSocket temps réel permanent (reconnexion auto)." withArrow>
            <Badge
              color={conn.isConnected ? "teal" : conn.state === "reconnecting" ? "yellow" : "gray"}
              variant="light"
              size="lg"
            >
              {conn.isConnected ? "Realtime online" : conn.state}
            </Badge>
          </Tooltip>
        </Group>
      </Group>

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
              <Group gap={6}><Title order={4}>Heap V8</Title><Info text="Part du heap alloué actuellement utilisée. >80% = pression GC, le ramasse-miettes travaille beaucoup." /></Group>
            </Group>
            {waiting ? <Skeleton h={120} /> : (
              <Group align="center" gap="xl" wrap="nowrap">
                <RingProgress size={110} thickness={12}
                  sections={[{ value: heapPct, color: heapPct > 80 ? "red" : heapPct > 60 ? "yellow" : "teal" }]}
                  label={<Text ta="center" size="xs" fw={700}>{heapPct}%</Text>} />
                <Stack gap={4} style={{ flex: 1 }}>
                  <Row k="Heap utilisé" v={bytes(stats!.memory.heapUsed)} />
                  <Row k="Heap alloué" v={bytes(stats!.memory.heapTotal)} />
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
          hint="Sessions actives — branché quand l'API admin par module (IAdminApi) existera.">
          <Text fw={700} size="xl">—</Text>
          <Text size="xs" c="dimmed">à venir (P10.3 IAdminApi)</Text>
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

/**
 * Mini-graphe SVG temps-réel — zéro dépendance (recharts 2.x cassé sous React 19).
 * Survol : ligne-guide + point + tooltip valeur. Repères Y (0/max), pastille de la
 * dernière valeur, zone de seuil optionnelle.
 */
function MiniChart({
  series,
  height = 190,
  max,
  threshold,
  format = (v) => String(Math.round(v)),
}: {
  series: { data: number[]; color: string; label: string }[];
  height?: number;
  max?: number;
  threshold?: number;
  format?: (v: number) => string;
}) {
  const W = 600;
  const H = 200;
  const pad = 6;
  const [hover, setHover] = useState<{ idx: number; xPx: number; w: number } | null>(null);
  const n = Math.max(0, ...series.map((s) => s.data.length));
  if (n < 2) return null;
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.data)) * 1.15;
  const xOf = (i: number) => (i / (n - 1)) * (W - pad * 2) + pad;
  const yOf = (v: number) => H - pad - (Math.min(v, top) / top) * (H - pad * 2);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover({ idx: Math.round(frac * (n - 1)), xPx: frac * r.width, w: r.width });
  };

  const tipLeft = hover ? (hover.xPx > hover.w * 0.6 ? hover.xPx - 140 : hover.xPx + 12) : 0;

  return (
    <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}>
        {threshold != null && (
          <rect x={pad} y={yOf(top)} width={W - pad * 2} height={Math.max(0, yOf(threshold) - yOf(top))}
            fill="var(--mantine-color-red-6)" opacity={0.07} />
        )}
        <line x1={pad} y1={yOf(0)} x2={W - pad} y2={yOf(0)}
          stroke="var(--mantine-color-default-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} />
        {series.map((s, si) => {
          const line = s.data.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
          const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
          const last = s.data[s.data.length - 1];
          return (
            <g key={si}>
              <polygon points={area} fill={s.color} opacity={0.1} />
              <polyline points={line} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <circle cx={xOf(n - 1)} cy={yOf(last)} r={3} fill={s.color} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hover && (
          <>
            <line x1={xOf(hover.idx)} y1={pad} x2={xOf(hover.idx)} y2={H - pad}
              stroke="var(--mantine-color-dimmed)" strokeWidth={1} strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke" opacity={0.6} />
            {series.map((s, si) => (
              <circle key={si} cx={xOf(hover.idx)} cy={yOf(s.data[hover.idx] ?? 0)} r={3.5}
                fill={s.color} stroke="var(--mantine-color-body)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ))}
          </>
        )}
      </svg>
      <Text c="dimmed" style={{ position: "absolute", top: 0, left: 2, fontSize: 10 }}>{format(top)}</Text>
      <Text c="dimmed" style={{ position: "absolute", bottom: 0, left: 2, fontSize: 10 }}>0</Text>
      {hover && (
        <Paper shadow="sm" p={6} withBorder
          style={{ position: "absolute", top: 4, left: tipLeft, pointerEvents: "none", zIndex: 5 }}>
          <Stack gap={2}>
            {series.map((s, si) => (
              <Group key={si} gap={6} wrap="nowrap">
                <span style={{ width: 8, height: 8, background: s.color, borderRadius: 2 }} />
                <Text size="xs">{s.label} : <b>{format(s.data[hover.idx] ?? 0)}</b></Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </div>
  );
}

function ChartCard({
  title,
  caption,
  badge,
  children,
}: {
  title: string;
  caption: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb={2}>
        <Title order={4}>{title}</Title>
        {badge}
      </Group>
      <Text size="xs" c="dimmed" mb="sm">{caption}</Text>
      {children}
    </Card>
  );
}

function Kpi({
  label,
  icon,
  hint,
  children,
  span = { base: 12, sm: 6, lg: 3 },
}: {
  label: string;
  icon: React.ReactNode;
  hint: string;
  children: React.ReactNode;
  span?: Record<string, number>;
}) {
  return (
    <Grid.Col span={span}>
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between">
          <Stack gap={2}>
            <Group gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
              <Info text={hint} />
            </Group>
            {children}
          </Stack>
          {icon}
        </Group>
      </Card>
    </Grid.Col>
  );
}

function Info({ text }: { text: string }) {
  return (
    <Tooltip label={text} multiline w={280} withArrow position="top" events={{ hover: true, focus: true, touch: true }}>
      <ThemeIcon variant="subtle" color="gray" size="sm" style={{ cursor: "help" }}>
        <IconInfoCircle size={15} />
      </ThemeIcon>
    </Tooltip>
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

function Waiting() {
  return (
    <Stack align="center" justify="center" h={190} gap={4}>
      <Skeleton h={150} w="100%" />
      <Text size="xs" c="dimmed">En attente des premières mesures…</Text>
    </Stack>
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
