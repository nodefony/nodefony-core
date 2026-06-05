import { Alert, Badge, Code, Group, Stack, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconBolt,
  IconBroadcast,
  IconCircleCheck,
  IconClock,
  IconGitBranch,
  IconTerminal2,
} from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import {
  normalize,
  type HealthPayload,
  type NormalizedHealth,
} from "../../utils/realtimeHealth";
import { BigMetric, Metric, fmtUptime } from "./_kit";
import type { KernelInfo } from "./RuntimeWidget";

const KERNEL_INFO = "/nodefony/kernel/api/info";
const HEALTH_SOURCE = {
  kind: "hybrid",
  endpoint: "/nodefony/realtime/api/health",
  channel: "realtime:health",
} as const;

// ─────────────────────────── runtime.modes ─────────────────────────
const LAUNCH_MODES = [
  {
    id: "development",
    label: "Développement",
    cmd: "nodefony development",
    color: "teal",
  },
  {
    id: "production",
    label: "Production",
    cmd: "nodefony production",
    color: "blue",
  },
  {
    id: "cluster",
    label: "Cluster",
    cmd: "nodefony cluster -w N",
    color: "grape",
  },
] as const;
function ModesBody({ source, ctx }: WidgetRenderProps<KernelInfo>) {
  const info = source.data;
  if (!info) return null;
  const cur = ctx.cluster
    ? "cluster"
    : info.environment === "development"
      ? "development"
      : "production";
  return (
    <Stack gap={6}>
      {LAUNCH_MODES.map((m) => (
        <Group
          key={m.id}
          justify="space-between"
          wrap="nowrap"
          p="xs"
          style={{
            border: `1px solid ${
              m.id === cur
                ? `var(--mantine-color-${m.color}-5)`
                : "var(--mantine-color-default-border)"
            }`,
            borderRadius: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Text fw={600} size="sm">
              {m.label}
            </Text>
            <Code>{m.cmd}</Code>
          </div>
          {m.id === cur ? (
            <Badge color={m.color} variant="filled">
              actuel
            </Badge>
          ) : null}
        </Group>
      ))}
    </Stack>
  );
}

// ──────────────────────────── runtime.vite ─────────────────────────
interface ViteInstanceView {
  state: string;
  port: number | null;
  https: boolean;
}
interface FrontendStatusView {
  available: boolean;
  vite?: string;
  primary: ViteInstanceView;
  bundles: unknown[];
}
function ViteBody({ source }: WidgetRenderProps<FrontendStatusView>) {
  const v = source.data;
  if (!v) return null;
  if (!v.available)
    return (
      <Stack gap="xs">
        <Badge color="gray" variant="light" size="lg">
          Bundle figé
        </Badge>
        <Text size="xs" c="dimmed">
          Vite ne tourne pas (prod / cluster) — l'UI vient du bundle compilé.
        </Text>
      </Stack>
    );
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge color="teal" variant="filled" size="lg">
          Vite / HMR actif
        </Badge>
        <Text size="sm" c="dimmed">
          v{v.vite ?? "—"}
        </Text>
      </Group>
      <Group gap="xl">
        <Metric label="Port" value={v.primary.port ?? "—"} />
        <Metric label="Bundles" value={v.bundles.length} />
        <Metric label="Protocole" value={v.primary.https ? "https" : "http"} />
      </Group>
    </Stack>
  );
}

// ───────────────────────────── system.git ──────────────────────────
function GitBody({ source }: WidgetRenderProps<KernelInfo>) {
  const info = source.data;
  if (!info) return null;
  const g = info.git;
  if (!g?.branch)
    return (
      <Text size="sm" c="dimmed">
        Hors dépôt git (ou worktree non détecté).
      </Text>
    );
  return (
    <Stack gap={6}>
      <Group gap="xs">
        <IconGitBranch size={18} />
        <Text fw={700} ff="monospace">
          {g.branch}
        </Text>
      </Group>
      <Group gap={6}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          Commit
        </Text>
        <Code>{g.commit ?? "—"}</Code>
      </Group>
    </Stack>
  );
}

// ──────────────────────────── system.uptime ────────────────────────
function UptimeBody({ source }: WidgetRenderProps<KernelInfo>) {
  const info = source.data;
  if (!info) return null;
  return (
    <Stack gap="xs">
      <BigMetric label="Uptime" value={fmtUptime(info.uptime)} color="teal" />
      <Group gap="xs">
        <Badge variant="light" color="gray">
          {info.environment}
        </Badge>
        {info.debug ? (
          <Badge variant="light" color="orange">
            debug
          </Badge>
        ) : null}
      </Group>
    </Stack>
  );
}

// ────────────────────────── realtime.channels ──────────────────────
function aggChannels(
  n: NormalizedHealth,
): { channel: string; sub: number; msg: number }[] {
  const map = new Map<string, { sub: number; msg: number }>();
  for (const inst of n.instances) {
    for (const c of inst.channels) {
      const e = map.get(c.channel) ?? { sub: 0, msg: 0 };
      e.sub += c.subscribers;
      e.msg += c.messages;
      map.set(c.channel, e);
    }
  }
  return [...map.entries()]
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.msg - a.msg);
}
function ChannelsBody({ source }: WidgetRenderProps<HealthPayload>) {
  const n = normalize(source.data);
  if (!n) return null;
  const chans = aggChannels(n);
  if (chans.length === 0)
    return (
      <Text size="sm" c="dimmed">
        Aucun canal actif.
      </Text>
    );
  return (
    <Stack gap={2}>
      {chans.slice(0, 8).map((c) => (
        <Group key={c.channel} justify="space-between" wrap="nowrap" gap="xs">
          <Text size="xs" ff="monospace" truncate style={{ minWidth: 0 }}>
            {c.channel}
          </Text>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Badge size="xs" variant="light" color="blue">
              {c.sub} abo
            </Badge>
            <Text
              size="xs"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {c.msg} msg
            </Text>
          </Group>
        </Group>
      ))}
    </Stack>
  );
}

// ───────────────────────── supervision.alerts ──────────────────────
interface HealthAlert {
  level: "warning" | "critical";
  text: string;
}
function deriveAlerts(n: NormalizedHealth): HealthAlert[] {
  const out: HealthAlert[] = [];
  for (const inst of n.instances) {
    const p = inst.process;
    const tag = inst.process?.pid ? ` (PID ${inst.process.pid})` : "";
    if (p) {
      if (p.cpuPercent >= 90)
        out.push({
          level: "critical",
          text: `CPU ${Math.round(p.cpuPercent)} %${tag}`,
        });
      else if (p.cpuPercent >= 70)
        out.push({
          level: "warning",
          text: `CPU élevé ${Math.round(p.cpuPercent)} %${tag}`,
        });
      if (p.eventLoopMs >= 100)
        out.push({
          level: "critical",
          text: `Event-loop ${Math.round(p.eventLoopMs)} ms${tag}`,
        });
      else if (p.eventLoopMs >= 50)
        out.push({
          level: "warning",
          text: `Event-loop ${Math.round(p.eventLoopMs)} ms${tag}`,
        });
      const heapPct = p.heapTotal ? (p.heapUsed / p.heapTotal) * 100 : 0;
      if (heapPct >= 90)
        out.push({
          level: "critical",
          text: `Heap ${Math.round(heapPct)} %${tag}`,
        });
      else if (heapPct >= 75)
        out.push({
          level: "warning",
          text: `Heap ${Math.round(heapPct)} %${tag}`,
        });
    }
    if (inst.orm && inst.orm.connected < inst.orm.connectors)
      out.push({ level: "warning", text: `Connecteur ORM déconnecté${tag}` });
  }
  if (n.totals.backpressure.slowConsumers > 0)
    out.push({
      level: "warning",
      text: `${n.totals.backpressure.slowConsumers} consommateur(s) lent(s)`,
    });
  return out;
}
function AlertsBody({ source }: WidgetRenderProps<HealthPayload>) {
  const n = normalize(source.data);
  if (!n) return null;
  const alerts = deriveAlerts(n);
  if (alerts.length === 0)
    return (
      <Group gap="xs">
        <IconCircleCheck size={20} color="var(--mantine-color-teal-6)" />
        <Text fw={600}>Tout va bien</Text>
        <Text size="sm" c="dimmed">
          Aucune alerte active.
        </Text>
      </Group>
    );
  return (
    <Stack gap={6}>
      {alerts.map((a, i) => (
        <Alert
          key={i}
          variant="light"
          color={a.level === "critical" ? "red" : "orange"}
          icon={<IconAlertTriangle size={16} />}
          p="xs"
        >
          {a.text}
        </Alert>
      ))}
    </Stack>
  );
}

// ─────────────────────────── registrations ─────────────────────────
registerWidget<KernelInfo>({
  id: "runtime.modes",
  title: "Modes de lancement",
  description: "Les 3 modes CLI (dev / prod / cluster), le courant surligné.",
  category: "runtime",
  icon: IconTerminal2,
  source: { kind: "snapshot", endpoint: KERNEL_INFO },
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  render: ModesBody,
});

registerWidget<FrontendStatusView>({
  id: "runtime.vite",
  title: "Vite / HMR",
  description: "État du serveur Vite (dev) ou bundle figé (prod/cluster).",
  category: "runtime",
  icon: IconBolt,
  source: { kind: "snapshot", endpoint: "/nodefony/frontend/api/vite" },
  defaultSpan: 4,
  minSpan: 3,
  render: ViteBody,
});

registerWidget<KernelInfo>({
  id: "system.git",
  title: "Git",
  description: "Branche et commit courant (GitService core, sans spawn).",
  category: "system",
  icon: IconGitBranch,
  source: { kind: "snapshot", endpoint: KERNEL_INFO },
  defaultSpan: 4,
  minSpan: 3,
  render: GitBody,
});

registerWidget<KernelInfo>({
  id: "system.uptime",
  title: "Uptime",
  description: "Durée de fonctionnement + environnement + mode debug.",
  category: "system",
  icon: IconClock,
  source: { kind: "snapshot", endpoint: KERNEL_INFO },
  defaultSpan: 4,
  minSpan: 3,
  render: UptimeBody,
});

registerWidget<HealthPayload>({
  id: "realtime.channels",
  title: "Canaux temps réel",
  description: "Canaux actifs du hub : abonnés et messages (agrégé pod).",
  category: "realtime",
  icon: IconBroadcast,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  render: ChannelsBody,
});

registerWidget<HealthPayload>({
  id: "supervision.alerts",
  title: "Alertes",
  description: "Alertes santé live (CPU/event-loop/heap/ORM/backpressure).",
  category: "system",
  icon: IconAlertTriangle,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  render: AlertsBody,
});
