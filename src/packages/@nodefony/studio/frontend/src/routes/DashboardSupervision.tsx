import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import {
  Grid,
  Stack,
  Card,
  Group,
  Text,
  Title,
  Badge,
  Alert,
  ThemeIcon,
  RingProgress,
  Tabs,
  Skeleton,
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
} from "@tabler/icons-react";
import { useStore, useAuth } from "../stores";
import { useNodefonyState, useNodefonyChannel } from "nodefony/react";
import {
  PageHeader,
  StatCard as Kpi,
  ChartCard,
  MiniChart,
  KeyValue as Row,
  Legend,
} from "../components/ui";

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
    heapLimit?: number;
    external: number;
  };
}

interface KernelInfo {
  version: string;
  environment: string;
  pid: number;
}

const HISTORY = 60;
const MB = 1024 ** 2;

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
 * Dashboard SUPERVISION — vue ops « est-ce que ça va ». Mêmes flux que le board
 * dev (`dashboard:stats` + `syslog:stream`) mais présentés en indicateurs de
 * santé seuillés + bandeau d'alertes, pas en courbes brutes. Per-instance (le
 * process qui tient le WS) ; vue cluster = Redis P13.
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
  const errSec = useRef(0);

  const cap = (arr: number[], v: number): number[] => {
    const n = [...arr, v];
    return n.length > HISTORY ? n.slice(-HISTORY) : n;
  };

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

  // Tick stats (1/s) → met à jour les jauges + bascule le compteur d'erreurs
  // de la seconde écoulée dans l'historique (erreurs/min = somme sur 60 s).
  useNodefonyChannel("dashboard:stats", (payload: unknown) => {
    const s = payload as StatsPayload;
    if (!s || typeof s !== "object" || !s.memory) return;
    setStats(s);
    setCpuHist((prev) => cap(prev, s.cpuPercent));
    setLoopHist((prev) => cap(prev, s.eventLoopMs));
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
  });

  // Canal partagé (ref-compté) : on ne compte QUE les ERROR/CRITIC pour le taux
  // d'erreurs. Frame coalescée { logs[], dropped }.
  useNodefonyChannel("syslog:stream", (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const rec = data as { logs?: Array<{ severityName?: string }> };
    if (!Array.isArray(rec.logs)) return;
    for (const log of rec.logs) {
      if (log?.severityName === "ERROR" || log?.severityName === "CRITIC") {
        errSec.current += 1;
      }
    }
  });

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
  const mb = (v: number) => `${v.toFixed(0)} MB`;
  const ms = (v: number) => `${v.toFixed(1)} ms`;

  const cpuH = level(cpu, 50, 80);
  const memH = level(heapPct, 60, 80);
  const loopH = level(loop, 20, 50);
  const errH = level(errPerMin, 1, 10);

  // Bandeau d'alertes : tout indicateur hors-OK. Couleur + libellé (jamais la
  // couleur seule — WCAG 2.2).
  const alerts: { color: string; msg: string }[] = [];
  if (!rtOnline)
    alerts.push({ color: "red", msg: `Temps réel ${rtState} — métriques figées` });
  if (cpuH.color !== "teal")
    alerts.push({ color: cpuH.color, msg: `CPU ${cpu}% (${cpuH.label})` });
  if (memH.color !== "teal")
    alerts.push({ color: memH.color, msg: `Mémoire heap ${heapPct}% (${memH.label})` });
  if (loopH.color !== "teal")
    alerts.push({
      color: loopH.color,
      msg: `Event-loop ${loop.toFixed(1)} ms (${loopH.label})`,
    });
  if (errH.color !== "teal")
    alerts.push({ color: errH.color, msg: `${errPerMin} erreur(s)/min (${errH.label})` });

  const up = rtOnline && !!stats && alerts.length === 0;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Supervision"
        subtitle={
          <>
            Santé applicative en temps réel — {auth.user?.username}. Vue
            per-instance.
          </>
        }
        actions={
          <>
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
              color={rtOnline ? "teal" : rtState === "reconnecting" ? "yellow" : "gray"}
              variant="light"
              size="lg"
            >
              {rtOnline ? "Realtime online" : rtState}
            </Badge>
          </>
        }
      />

      {/* ── Bandeau état global / alertes ── */}
      {waiting ? (
        <Skeleton h={56} radius="md" />
      ) : up ? (
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
          color={alerts.some((a) => a.color === "red") ? "red" : "yellow"}
          icon={<IconAlertTriangle size={18} />}
          title={`${alerts.length} alerte(s) active(s)`}
          role="alert"
        >
          <Stack gap={4}>
            {alerts.map((a, i) => (
              <Group key={i} gap={8}>
                <Badge size="xs" color={a.color} variant="filled" circle>
                  {" "}
                </Badge>
                <Text size="sm">{a.msg}</Text>
              </Group>
            ))}
          </Stack>
        </Alert>
      )}

      {/* ── Indicateurs de santé ── */}
      <Grid>
        <Kpi
          label="État"
          icon={<IconActivityHeartbeat size={30} stroke={1.4} />}
          hint="Synthèse : temps réel connecté + métriques reçues + aucune alerte."
        >
          {waiting ? (
            <Skeleton h={28} w={120} />
          ) : (
            <Text fw={700} size="xl" c={up ? "teal" : "red"}>
              {up ? "Opérationnel" : "Dégradé"}
            </Text>
          )}
        </Kpi>

        <Kpi
          label="Uptime"
          icon={<IconClock size={30} stroke={1.4} />}
          hint="Durée depuis le démarrage du process (per-instance)."
        >
          {waiting ? (
            <Skeleton h={28} w={90} />
          ) : (
            <Text fw={700} size="xl">
              {uptimeStr(stats!.uptime)}
            </Text>
          )}
        </Kpi>

        <Kpi
          label="CPU"
          icon={<IconCpu size={30} stroke={1.4} />}
          hint="% d'un cœur consommé par le process. Élevé >50%, critique >80%."
        >
          {waiting ? (
            <Skeleton h={28} w={70} />
          ) : (
            <>
              <Text fw={700} size="xl" c={cpuH.color}>
                {cpu}%
              </Text>
              <Text size="xs" c="dimmed">
                {cpuH.label}
              </Text>
            </>
          )}
        </Kpi>

        <Kpi
          label="Erreurs / min"
          icon={<IconBug size={30} stroke={1.4} />}
          hint="ERROR + CRITIC sur les 60 dernières secondes (canal syslog:stream)."
        >
          {waiting ? (
            <Skeleton h={28} w={50} />
          ) : (
            <>
              <Text fw={700} size="xl" c={errH.color}>
                {errPerMin}
              </Text>
              <Text size="xs" c="dimmed">
                {errH.label}
              </Text>
            </>
          )}
        </Kpi>

        <Kpi
          label="Mémoire heap"
          icon={<IconDatabase size={30} stroke={1.4} />}
          hint="Heap utilisé / plafond V8. Élevé >60%, critique >80% (proche OOM)."
        >
          {waiting ? (
            <Skeleton h={28} w={70} />
          ) : (
            <>
              <Text fw={700} size="xl" c={memH.color}>
                {heapPct}%
              </Text>
              <Text size="xs" c="dimmed">
                {memH.label}
              </Text>
            </>
          )}
        </Kpi>

        <Kpi
          label="Event-loop"
          icon={<IconActivityHeartbeat size={30} stroke={1.4} />}
          hint="Retard de la boucle Node. Élevé >20ms, critique >50ms."
        >
          {waiting ? (
            <Skeleton h={28} w={80} />
          ) : (
            <>
              <Text fw={700} size="xl" c={loopH.color}>
                {loop.toFixed(1)} ms
              </Text>
              <Text size="xs" c="dimmed">
                {loopH.label}
              </Text>
            </>
          )}
        </Kpi>
      </Grid>

      {/* ── Détail en onglets (« tablettes ») ── */}
      <Tabs defaultValue="performance" keepMounted={false} variant="outline" radius="md">
        <Tabs.List mb="md">
          <Tabs.Tab value="performance" leftSection={<IconCpu size={15} />}>
            Performance
          </Tabs.Tab>
          <Tabs.Tab value="memoire" leftSection={<IconDatabase size={15} />}>
            Mémoire
          </Tabs.Tab>
          <Tabs.Tab value="erreurs" leftSection={<IconBug size={15} />}>
            Erreurs
          </Tabs.Tab>
          <Tabs.Tab value="systeme" leftSection={<IconServer size={15} />}>
            Système
          </Tabs.Tab>
        </Tabs.List>

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
              <Waiting />
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
              <Waiting />
            )}
          </ChartCard>
        </Grid.Col>
      </Grid>
      </Tabs.Panel>

      <Tabs.Panel value="memoire">
      <Stack gap="lg">
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
              format={mb}
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
              <Legend color="var(--mantine-color-blue-6)" label="Heap (objets JS)" />
              <Legend color="var(--mantine-color-grape-6)" label="RSS (process)" />
            </Group>
          </>
        ) : (
          <Waiting />
        )}
      </ChartCard>

      {/* Heap V8 — onglet Mémoire */}
      <Card withBorder radius="md" p="lg">
            <Group gap={6} mb="md">
              <IconDatabase size={20} stroke={1.5} />
              <Title order={4}>Heap V8</Title>
              <Text size="xs" c="dimmed">
                % du plafond
              </Text>
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
      </Stack>
      </Tabs.Panel>

      <Tabs.Panel value="erreurs">
          <ChartCard
            title="Erreurs / s"
            badge={
              <Badge variant="light" color={errH.color}>
                {errPerMin}/min
              </Badge>
            }
            caption="Nombre d'ERROR+CRITIC par seconde. Toute barre rouge = incident à investiguer."
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
              <Waiting />
            )}
          </ChartCard>
      </Tabs.Panel>

      <Tabs.Panel value="systeme">
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
              <Row k="PID" v={String(stats?.pid ?? info?.pid ?? "—")} mono />
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Stack gap={6}>
              <Row
                k="Load avg"
                v={
                  stats ? stats.loadavg.map((l) => l.toFixed(2)).join(" / ") : "—"
                }
                mono
              />
              <Row k="Cœurs" v={String(stats?.cpuCount ?? "—")} mono />
              <Row k="Uptime" v={stats ? uptimeStr(stats.uptime) : "—"} mono />
            </Stack>
          </Grid.Col>
        </Grid>
      </Card>
      </Tabs.Panel>
      </Tabs>
    </Stack>
  );
});

function Waiting() {
  return (
    <Stack align="center" justify="center" h={180} gap={4}>
      <Skeleton h={140} w="100%" />
      <Text size="xs" c="dimmed">
        En attente des premières mesures…
      </Text>
    </Stack>
  );
}

export default DashboardSupervision;
