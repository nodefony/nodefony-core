import { Badge, Center, Group, RingProgress, Text } from "@mantine/core";
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
  type NormalizedHealth,
} from "../../utils/realtimeHealth";
import {
  buildHealth,
  loadHealthWeights,
  type HealthResult,
} from "../../utils/health";
import { DefinitionList, KeyValue } from "../../components/ui";
import {
  BigMetric,
  Metric,
  WorkerTile,
  fmtMB,
  fmtMs,
  levelColor,
  useLiveSeries,
} from "./_kit";
import type { KernelInfo } from "./RuntimeWidget";

// Source commune des widgets système cluster-aware : la sonde santé agrégée master.
const HEALTH_SOURCE = {
  kind: "hybrid",
  endpoint: "/nodefony/realtime/api/health",
  channel: "realtime:health",
} as const;

// ─────────────────────────────── CPU ───────────────────────────────
function cpuRep(norm: NormalizedHealth | null): number | null {
  if (!norm) return null;
  const vals = norm.instances
    .map((i) => i.process?.cpuPercent)
    .filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function CpuBody({ source }: WidgetRenderProps<HealthPayload>) {
  const norm = normalize(source.data);
  const rep = cpuRep(norm);
  const series = useLiveSeries(rep);
  const color = levelColor(rep, 60, 85);
  return (
    <ClusterView
      normalized={norm}
      renderSummary={(_t, insts) => (
        <BigMetric
          label="CPU moyen"
          value={rep != null ? Math.round(rep) : null}
          unit="%"
          color={color}
          series={series}
          sub={`${insts.length} workers`}
        />
      )}
      renderInstance={(inst, { grid }) => {
        const v = inst.process?.cpuPercent;
        const val = v != null ? Math.round(v) : null;
        return grid ? (
          <WorkerTile pid={inst.process?.pid}>
            <BigMetric value={val} unit="%" color={levelColor(v, 60, 85)} />
          </WorkerTile>
        ) : (
          <BigMetric
            label="CPU"
            value={val}
            unit="%"
            color={color}
            series={series}
          />
        );
      }}
      drillTo={() => "/nodefony/cluster"}
    />
  );
}

// ─────────────────────────────── Heap ──────────────────────────────
function heapRep(norm: NormalizedHealth | null): number | null {
  if (!norm || !norm.instances.some((i) => i.process)) return null;
  return fmtMB(
    norm.instances.reduce((s, i) => s + (i.process?.heapUsed ?? 0), 0),
  );
}
function HeapBody({ source }: WidgetRenderProps<HealthPayload>) {
  const norm = normalize(source.data);
  const rep = heapRep(norm);
  const series = useLiveSeries(rep);
  return (
    <ClusterView
      normalized={norm}
      renderSummary={(_t, insts) => {
        const total = insts.reduce(
          (s, i) => s + (i.process?.heapTotal ?? 0),
          0,
        );
        return (
          <BigMetric
            label="Heap pod"
            value={rep}
            unit="Mo"
            color="blue"
            series={series}
            sub={`réservé ${fmtMB(total)} Mo · ${insts.length} workers`}
          />
        );
      }}
      renderInstance={(inst, { grid }) => {
        const p = inst.process;
        return grid ? (
          <WorkerTile pid={p?.pid}>
            <BigMetric
              value={p ? fmtMB(p.heapUsed) : null}
              unit="Mo"
              color="blue"
            />
          </WorkerTile>
        ) : (
          <BigMetric
            label="Heap"
            value={p ? fmtMB(p.heapUsed) : null}
            unit="Mo"
            color="blue"
            series={series}
            sub={p ? `réservé ${fmtMB(p.heapTotal)} Mo` : undefined}
          />
        );
      }}
      drillTo={() => "/nodefony/cluster"}
    />
  );
}

// ──────────────────────────── Event-loop ───────────────────────────
function loopRep(norm: NormalizedHealth | null): number | null {
  if (!norm) return null;
  const vals = norm.instances
    .map((i) => i.process?.eventLoopMs)
    .filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}
function LoopBody({ source }: WidgetRenderProps<HealthPayload>) {
  const norm = normalize(source.data);
  const rep = loopRep(norm);
  const series = useLiveSeries(rep);
  const color = levelColor(rep, 30, 80);
  return (
    <ClusterView
      normalized={norm}
      renderSummary={(_t, insts) => (
        <BigMetric
          label="Event-loop max"
          value={rep != null ? fmtMs(rep) : null}
          unit="ms"
          color={color}
          series={series}
          sub={`${insts.length} workers`}
        />
      )}
      renderInstance={(inst, { grid }) => {
        const ms = inst.process?.eventLoopMs;
        return grid ? (
          <WorkerTile pid={inst.process?.pid}>
            <BigMetric
              value={ms != null ? fmtMs(ms) : null}
              unit="ms"
              color={levelColor(ms, 30, 80)}
            />
          </WorkerTile>
        ) : (
          <BigMetric
            label="Event-loop"
            value={ms != null ? fmtMs(ms) : null}
            unit="ms"
            color={color}
            series={series}
          />
        );
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
function worstOf(insts: InstanceHealth[]): HealthResult {
  let worst: HealthResult | null = null;
  for (const inst of insts) {
    const r = instHealth(inst);
    if (!worst || (r.score ?? 101) < (worst.score ?? 101)) worst = r;
  }
  return worst ?? buildHealth([]);
}
function ScoreRing({ r }: { r: HealthResult }) {
  return (
    <Group gap="md" wrap="nowrap">
      <RingProgress
        size={84}
        thickness={9}
        roundCaps
        sections={[{ value: r.score ?? 0, color: r.color }]}
        label={
          <Center>
            <Text
              fw={800}
              fz="lg"
              c={r.color}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {r.score ?? "—"}
            </Text>
          </Center>
        }
      />
      <div>
        <Badge color={r.color} variant="light" size="lg">
          {r.label}
        </Badge>
        {r.worst ? (
          <Text size="xs" c="dimmed" mt={6}>
            facteur limitant : <b>{r.worst}</b>
          </Text>
        ) : null}
      </div>
    </Group>
  );
}
function WorkerHealthLine({ inst }: { inst: InstanceHealth }) {
  const r = instHealth(inst);
  return (
    <Group gap="xs">
      <Badge color={r.color} variant="light">
        {r.label}
      </Badge>
      <Text fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
        {r.score ?? "—"}
      </Text>
    </Group>
  );
}
function HealthBody({ source }: WidgetRenderProps<HealthPayload>) {
  return (
    <ClusterView
      normalized={normalize(source.data)}
      renderSummary={(_t, insts) => (
        <div>
          <ScoreRing r={worstOf(insts)} />
          {insts.length > 1 ? (
            <Text size="xs" c="dimmed" mt={6}>
              pod = pire des {insts.length} workers
            </Text>
          ) : null}
        </div>
      )}
      renderInstance={(inst, { grid }) =>
        grid ? (
          <WorkerTile pid={inst.process?.pid}>
            <WorkerHealthLine inst={inst} />
          </WorkerTile>
        ) : (
          <ScoreRing r={instHealth(inst)} />
        )
      }
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
  description: "Charge CPU live + courbe (moyenne/max pod en cluster).",
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
  description: "Heap utilisé live + courbe (somme pod en cluster).",
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
  description:
    "Latence de la boucle d'événements live (pire worker en cluster).",
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
