import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import {
  Stack,
  Grid,
  Card,
  Group,
  Text,
  Title,
  Badge,
  Button,
  Table,
  ScrollArea,
  SegmentedControl,
  Switch,
  Collapse,
  Code,
} from "@mantine/core";
import {
  IconArrowUp,
  IconArrowDown,
  IconTrash,
  IconActivityHeartbeat,
  IconClock,
  IconStack2,
  IconArrowsExchange,
  IconReload,
} from "@tabler/icons-react";
import {
  useNodefony,
  useNodefonyState,
  useNodefonyChannel,
} from "nodefony/react";
import type { RealtimeFrame } from "nodefony";
import { useConnection } from "../stores";
import { PageHeader, StatCard as Kpi, MiniChart } from "../components/ui";

const MAX = 300;

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function uptimeStr(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

/** Couleur d'une frame selon le sens / la nature (a11y : jamais la couleur seule). */
function frameColor(f: RealtimeFrame): string {
  if (f.kind === "error") return "red";
  return f.dir === "out" ? "blue" : "teal";
}

/**
 * RealtimeConsole — LA console temps réel de Studio (le différenciateur HTTP+WS
 * co-citoyens). Connexion + abonnements + **log protocole** (frames JSON-RPC
 * live). S'abonner à `__frame__` ACTIVE l'enregistrement côté client (lazy) →
 * la capture n'a lieu que quand cette page est ouverte.
 */
export const RealtimeConsole = observer(() => {
  const client = useNodefony();
  const state = useNodefonyState();
  const conn = useConnection();

  const [frames, setFrames] = useState<RealtimeFrame[]>([]);
  const [paused, setPaused] = useState(false);
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [, setNow] = useState(Date.now());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // La console S'ABONNE elle-même aux canaux standard tant qu'elle est ouverte
  // → on voit TOUJOURS l'activité realtime (frames + abonnements + débit), même
  // après avoir quitté un dashboard (les abonnements sont par page). Ref-compté
  // → coexiste sans couper les autres consommateurs. Handlers no-op : le client
  // capture déjà frames (`__frame__`) + stats par canal.
  useNodefonyChannel("dashboard:stats", () => {});
  useNodefonyChannel("syslog:stream", () => {});

  // Capture des frames : l'abonnement à `__frame__` enclenche le ring côté client.
  useEffect(() => {
    setFrames([...client.frameLog]);
    const off = client.on("__frame__", (f) => {
      if (pausedRef.current) return;
      const frame = f as RealtimeFrame;
      setFrames((prev) => {
        const next = [...prev, frame];
        return next.length > MAX ? next.slice(-MAX) : next;
      });
    });
    return off;
  }, [client]);

  // Tick 1s pour l'uptime de session affiché en live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const online = state === "connected";
  const subs = [...conn.activeSubscriptions.values()];
  const shown = dir === "all" ? frames : frames.filter((f) => f.dir === dir);
  const uptime = conn.connectedAt ? uptimeStr(Date.now() - conn.connectedAt) : "—";

  return (
    <Stack gap="lg">
      <PageHeader
        title="Realtime"
        subtitle="Hub temps réel — connexion, abonnements & protocole de la socket"
        actions={
          <>
            <Badge variant="outline" color="gray" size="lg" tt="none">
              {conn.endpointUrl || "—"}
            </Badge>
            <Badge
              size="lg"
              variant="light"
              color={
                online
                  ? "teal"
                  : state === "reconnecting" || state === "connecting"
                    ? "yellow"
                    : state === "error"
                      ? "red"
                      : "gray"
              }
            >
              {online ? "connecté" : state}
            </Badge>
          </>
        }
      />

      {/* ── KPIs connexion ── */}
      <Grid>
        <Kpi
          label="État"
          icon={<IconActivityHeartbeat size={28} stroke={1.4} />}
          hint="État de la socket WebSocket partagée (Studio + debug bar)."
        >
          <Text fw={700} size="xl" c={online ? "teal" : "red"}>
            {online ? "Connecté" : state}
          </Text>
        </Kpi>
        <Kpi
          label="Uptime session"
          icon={<IconClock size={28} stroke={1.4} />}
          hint="Durée depuis la dernière connexion réussie."
        >
          <Text fw={700} size="xl">
            {uptime}
          </Text>
        </Kpi>
        <Kpi
          label="Abonnements"
          icon={<IconStack2 size={28} stroke={1.4} />}
          hint="Canaux pub/sub actifs (ref-comptés, partagés entre pages)."
        >
          <Text fw={700} size="xl">
            {conn.subscriptionCount}
          </Text>
        </Kpi>
        <Kpi
          label="Frames capturées"
          icon={<IconArrowsExchange size={28} stroke={1.4} />}
          hint="Frames du protocole enregistrées tant que cette console est ouverte."
        >
          <Text fw={700} size="xl">
            {frames.length}
          </Text>
        </Kpi>
      </Grid>

      {/* ── Abonnements ── */}
      <Card withBorder radius="md" p="lg">
        <Group gap={6} mb="md">
          <IconStack2 size={20} stroke={1.5} />
          <Title order={4}>Abonnements</Title>
        </Group>
        {subs.length === 0 ? (
          <Text c="dimmed" size="sm">
            Aucun canal actif. Ouvre un dashboard ou les logs pour t'abonner.
          </Text>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Canal</Table.Th>
                <Table.Th>Pile</Table.Th>
                <Table.Th>Messages</Table.Th>
                <Table.Th>Débit</Table.Th>
                <Table.Th w={140}>Activité</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {subs.map((s) => (
                <Table.Tr key={s.channel}>
                  <Table.Td>
                    <Code>{s.channel}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color="gray">
                      {s.protocol ?? "json-rpc"} / {s.transport ?? "ws"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{s.msgCount}</Table.Td>
                  <Table.Td>{s.rate}/s</Table.Td>
                  <Table.Td>
                    {s.series.length > 1 ? (
                      <MiniChart
                        height={32}
                        series={[
                          {
                            data: s.series,
                            color: "var(--mantine-color-teal-6)",
                            label: s.channel,
                          },
                        ]}
                      />
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {/* ── Log protocole ── */}
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md" wrap="wrap">
          <Group gap={6}>
            <IconArrowsExchange size={20} stroke={1.5} />
            <Title order={4}>Log protocole</Title>
            <Text size="xs" c="dimmed">
              JSON-RPC 2.0 — secrets redactés
            </Text>
          </Group>
          <Group gap="sm">
            <SegmentedControl
              size="xs"
              value={dir}
              onChange={(v) => setDir(v as "all" | "in" | "out")}
              data={[
                { label: "Tout", value: "all" },
                { label: "↓ in", value: "in" },
                { label: "↑ out", value: "out" },
              ]}
            />
            <Switch
              size="xs"
              label="Pause"
              checked={paused}
              onChange={(e) => setPaused(e.currentTarget.checked)}
            />
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconTrash size={14} />}
              onClick={() => {
                client.clearFrameLog();
                setFrames([]);
                setOpen(null);
              }}
            >
              Vider
            </Button>
          </Group>
        </Group>

        {shown.length === 0 ? (
          <Group justify="center" py="xl" gap="xs">
            <IconReload size={16} opacity={0.5} />
            <Text c="dimmed" size="sm">
              En attente de frames… (l'activité réseau apparaît ici en direct)
            </Text>
          </Group>
        ) : (
          <ScrollArea h={420} type="auto" offsetScrollbars>
            <Stack gap={0}>
              {shown
                .slice()
                .reverse()
                .map((f, i) => {
                  const idx = shown.length - 1 - i;
                  const isOpen = open === idx;
                  return (
                    <div key={`${f.ts}-${idx}`}>
                      <Group
                        gap="xs"
                        wrap="nowrap"
                        onClick={() => setOpen(isOpen ? null : idx)}
                        style={{
                          cursor: "pointer",
                          padding: "3px 4px",
                          borderBottom: "1px solid var(--mantine-color-default-border)",
                        }}
                      >
                        <Text
                          size="xs"
                          c="dimmed"
                          ff="monospace"
                          w={96}
                          style={{ flexShrink: 0 }}
                        >
                          {clock(f.ts)}
                        </Text>
                        {f.dir === "out" ? (
                          <IconArrowUp size={14} color="var(--mantine-color-blue-6)" />
                        ) : (
                          <IconArrowDown size={14} color="var(--mantine-color-teal-6)" />
                        )}
                        <Badge
                          size="xs"
                          variant="light"
                          color={frameColor(f)}
                          style={{ flexShrink: 0 }}
                        >
                          {f.kind}
                        </Badge>
                        {f.channel && (
                          <Code style={{ flexShrink: 0 }}>{f.channel}</Code>
                        )}
                        {f.id !== undefined && (
                          <Text size="xs" c="dimmed">
                            #{f.id}
                          </Text>
                        )}
                      </Group>
                      <Collapse in={isOpen}>
                        <Code
                          block
                          style={{ fontSize: 11, margin: "2px 0 6px" }}
                        >
                          {JSON.stringify(f.payload, null, 2)}
                        </Code>
                      </Collapse>
                    </div>
                  );
                })}
            </Stack>
          </ScrollArea>
        )}
      </Card>
    </Stack>
  );
});

export default RealtimeConsole;
