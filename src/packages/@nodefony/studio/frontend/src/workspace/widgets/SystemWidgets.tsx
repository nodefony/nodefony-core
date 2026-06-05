import { Badge, Group, Text } from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconCpu,
  IconHeartRateMonitor,
  IconInfoCircle,
  IconStack2,
} from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { ClusterView } from "../ClusterView";
import {
  normalize,
  type HealthPayload,
  type InstanceHealth,
} from "../../utils/realtimeHealth";
import {
  buildHealth,
  loadHealthWeights,
  type HealthResult,
} from "../../utils/health";
import { DefinitionList, KeyValue } from "../../components/ui";
import { Metric, WorkerTile, fmtMB, fmtMs } from "./_kit";
import type { KernelInfo } from "./RuntimeWidget";

// Source commune des widgets système cluster-aware : la sonde santé agrégée master.
const HEALTH_SOURCE = {
  kind: "hybrid",
  endpoint: "/nodefony/realtime/api/health",
  channel: "realtime:health",
} as const;

// ─────────────────────────────── CPU ───────────────────────────────
function CpuInstance({ inst }: { inst: InstanceHealth }) {
  const cpu = inst.process?.cpuPercent;
  return (
    <WorkerTile pid={inst.process?.pid}>
      <Metric label="CPU" value={cpu != null ? cpu.toFixed(0) : "—"} unit="%" />
    </WorkerTile>
  );
}
function CpuBody({ source }: WidgetRenderProps<HealthPayload>) {
  return (
    <ClusterView
      normalized={normalize(source.data)}
      renderInstance={(inst) => <CpuInstance inst={inst} />}
      renderSummary={(_t, insts) => {
        const vals = insts.map((i) => i.process?.cpuPercent ?? 0);
        const avg = vals.length
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : 0;
        const max = vals.length ? Math.max(...vals) : 0;
        return (
          <Group gap="xl">
            <Metric label="CPU moyen" value={avg.toFixed(0)} unit="%" />
            <Metric label="CPU max" value={max.toFixed(0)} unit="%" />
          </Group>
        );
      }}
      drillTo={() => "/nodefony/cluster"}
    />
  );
}

// ─────────────────────────────── Heap ──────────────────────────────
function HeapInstance({ inst }: { inst: InstanceHealth }) {
  const p = inst.process;
  return (
    <WorkerTile pid={p?.pid}>
      <Metric label="Heap" value={p ? fmtMB(p.heapUsed) : "—"} unit="Mo" />
    </WorkerTile>
  );
}
function HeapBody({ source }: WidgetRenderProps<HealthPayload>) {
  return (
    <ClusterView
      normalized={normalize(source.data)}
      renderInstance={(inst) => <HeapInstance inst={inst} />}
      renderSummary={(_t, insts) => {
        const used = insts.reduce((s, i) => s + (i.process?.heapUsed ?? 0), 0);
        const total = insts.reduce(
          (s, i) => s + (i.process?.heapTotal ?? 0),
          0,
        );
        return (
          <Group gap="xl">
            <Metric label="Heap pod" value={fmtMB(used)} unit="Mo" />
            <Metric label="Réservé" value={fmtMB(total)} unit="Mo" />
          </Group>
        );
      }}
      drillTo={() => "/nodefony/cluster"}
    />
  );
}

// ──────────────────────────── Event-loop ───────────────────────────
function LoopInstance({ inst }: { inst: InstanceHealth }) {
  const ms = inst.process?.eventLoopMs;
  return (
    <WorkerTile pid={inst.process?.pid}>
      <Metric
        label="Event-loop"
        value={ms != null ? fmtMs(ms) : "—"}
        unit="ms"
      />
    </WorkerTile>
  );
}
function LoopBody({ source }: WidgetRenderProps<HealthPayload>) {
  return (
    <ClusterView
      normalized={normalize(source.data)}
      renderInstance={(inst) => <LoopInstance inst={inst} />}
      renderSummary={(_t, insts) => {
        const max = insts.reduce(
          (m, i) => Math.max(m, i.process?.eventLoopMs ?? 0),
          0,
        );
        return <Metric label="Event-loop max" value={fmtMs(max)} unit="ms" />;
      }}
      drillTo={() => "/nodefony/supervision"}
    />
  );
}

// ─────────────────────────── Santé (composite) ─────────────────────
/** Indice composite d'UN worker (Derringer-Suich, brique partagée `buildHealth`). */
function instHealth(inst: InstanceHealth): HealthResult {
  const p = inst.process;
  if (!p) return buildHealth([]);
  const w = loadHealthWeights();
  const heapPct = p.heapTotal ? (p.heapUsed / p.heapTotal) * 100 : null;
  return buildHealth([
    {
      label: "CPU",
      value: p.cpuPercent,
      good: 60,
      crit: 95,
      weight: w.CPU,
      floor: 0.2,
    },
    {
      label: "Saturation (ELU)",
      value: p.eluUtilization * 100,
      good: 60,
      crit: 95,
      weight: w["Saturation (ELU)"],
      floor: 0.2,
    },
    {
      label: "Event-loop",
      value: p.eventLoopMs,
      good: 20,
      crit: 100,
      weight: w["Event-loop"],
      floor: 0.2,
    },
    {
      label: "Mémoire (heap)",
      value: heapPct,
      good: 70,
      crit: 95,
      weight: w["Mémoire (heap)"],
      critical: true,
    },
  ]);
}
function HealthChip({ r }: { r: HealthResult }) {
  return (
    <Badge color={r.color} variant="light" size="lg">
      {r.label}
      {r.score != null ? ` · ${r.score}` : ""}
    </Badge>
  );
}
function HealthBody({ source }: WidgetRenderProps<HealthPayload>) {
  return (
    <ClusterView
      normalized={normalize(source.data)}
      renderInstance={(inst) => (
        <WorkerTile pid={inst.process?.pid}>
          <HealthChip r={instHealth(inst)} />
        </WorkerTile>
      )}
      renderSummary={(_t, insts) => {
        // Rollup pod = PIRE worker (le maillon faible).
        let worst: HealthResult | null = null;
        for (const inst of insts) {
          const r = instHealth(inst);
          if (!worst || (r.score ?? 101) < (worst.score ?? 101)) worst = r;
        }
        return (
          <Group gap="sm">
            {worst ? <HealthChip r={worst} /> : null}
            <Text size="sm" c="dimmed">
              pire des {insts.length} workers
            </Text>
          </Group>
        );
      }}
      drillTo={() => "/nodefony/supervision"}
    />
  );
}

// ─────────────────────────── Identité (snapshot) ───────────────────
function InfoBody({ source }: WidgetRenderProps<KernelInfo>) {
  const info = source.data;
  if (!info) return null;
  return (
    <DefinitionList>
      <KeyValue k="Version" v={info.version} mono />
      <KeyValue k="Node.js" v={info.node} mono />
      <KeyValue k="Plateforme" v={info.platform} mono />
      <KeyValue k="PID" v={String(info.pid)} mono />
      <KeyValue k="Domaine" v={info.domain} mono />
      <KeyValue
        k="Git"
        v={`${info.git?.branch ?? "?"} @ ${info.git?.commit ?? "?"}`}
        mono
      />
    </DefinitionList>
  );
}

registerWidget<HealthPayload>({
  id: "system.cpu",
  title: "CPU",
  description: "Charge CPU du process (moyenne/max pod en cluster).",
  category: "system",
  icon: IconCpu,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 4,
  minSpan: 3,
  render: CpuBody,
});

registerWidget<HealthPayload>({
  id: "system.heap",
  title: "Mémoire (heap)",
  description: "Heap utilisé / réservé (somme pod en cluster).",
  category: "system",
  icon: IconStack2,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 4,
  minSpan: 3,
  render: HeapBody,
});

registerWidget<HealthPayload>({
  id: "system.eventloop",
  title: "Event-loop",
  description: "Latence de la boucle d'événements (pire worker en cluster).",
  category: "system",
  icon: IconActivityHeartbeat,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 4,
  minSpan: 3,
  render: LoopBody,
});

registerWidget<HealthPayload>({
  id: "system.health",
  title: "Santé du framework",
  description: "Indice composite 0-100 (CPU/ELU/loop/heap). Pod = pire worker.",
  category: "system",
  icon: IconHeartRateMonitor,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  render: HealthBody,
});

registerWidget<KernelInfo>({
  id: "system.info",
  title: "Identité du serveur",
  description: "Version, Node, plateforme, domaine, git (snapshot).",
  category: "system",
  icon: IconInfoCircle,
  source: { kind: "snapshot", endpoint: "/nodefony/kernel/api/info" },
  defaultSpan: 6,
  minSpan: 4,
  render: InfoBody,
});
