import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Center,
  Group,
  Progress,
  RingProgress,
  Stack,
  Text,
} from "@mantine/core";
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
  WorkerTile,
  fmtMB,
  fmtMs,
  levelColor,
  useLiveSeries,
} from "./_kit";
import type { KernelInfo } from "./RuntimeWidget";
import { PLATFORM_CHANNELS } from "nodefony";

// Source commune des widgets système cluster-aware : la sonde santé agrégée master.
const HEALTH_SOURCE = {
  kind: "hybrid",
  endpoint: "/nodefony/realtime/api/health",
  channel: PLATFORM_CHANNELS.socket,
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
/**
 * Taux d'erreurs/min PAR worker, dérivé du cumul monotone `errors.{errorTotal,
 * criticTotal}` (delta entre 2 ticks `nodefony:socket`). Un cumul brut ne dit rien
 * (un serveur ancien a un gros total) → seul le TAUX est une sonde de santé. Garde
 * le dernier point par worker (Map pid → {ts,total}).
 */
function usePerWorkerErrRate(
  instances: InstanceHealth[],
  ts: number | null | undefined,
): Record<string, number> {
  const prev = useRef<Map<string, { ts: number; total: number }>>(new Map());
  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => {
    if (ts == null) return;
    const next: Record<string, number> = {};
    for (const inst of instances) {
      const e = inst.errors;
      if (!e) continue;
      const total = e.errorTotal + e.criticTotal;
      const p = prev.current.get(inst.instanceId);
      if (p && ts > p.ts) {
        const dtMin = (ts - p.ts) / 60000;
        if (dtMin > 0)
          next[inst.instanceId] = Math.max(0, (total - p.total) / dtMin);
      }
      prev.current.set(inst.instanceId, { ts, total });
    }
    setRates(next);
    // `ts` = horodatage du tick : 1 dérivation par tick (instances changent avec lui).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts]);
  return rates;
}

/**
 * Indice composite COMPLET d'UN worker (Derringer-Suich, brique partagée `buildHealth`,
 * MÊMES poids que la page Supervision via `loadHealthWeights`). 6 sondes disponibles dans
 * la sonde cluster `nodefony:socket` : CPU, Saturation (ELU), Event-loop, Mémoire (heap),
 * Connecteurs (ORM), Erreurs (taux/min). `errRate` = taux dérivé du worker (null tant que
 * < 2 ticks → sonde exclue, pas de faux « critique »). GC overhead + Temps réel = absents
 * de la sonde lean (≠ page mono qui lit `nodefony:supervision`) → non comptés ici.
 */
function instHealth(inst: InstanceHealth, errRate?: number): HealthResult {
  const p = inst.process;
  if (!p) return buildHealth([]);
  const w = loadHealthWeights();
  const heapPct = p.heapTotal ? (p.heapUsed / p.heapTotal) * 100 : null;
  const orm = inst.orm;
  return buildHealth([
    {
      label: "CPU",
      value: p.cpuPercent,
      good: 70,
      crit: 100,
      weight: w.CPU,
      floor: 0.2,
    },
    {
      label: "Saturation (ELU)",
      value: p.eluUtilization * 100,
      good: 70,
      crit: 100,
      weight: w["Saturation (ELU)"],
      floor: 0.2,
    },
    {
      // Seuils tolérants (dev : Vite partage l'event-loop) ; la page applique le
      // strict par-env. Saturation → planché « Dégradé », jamais « Critique » seul.
      label: "Event-loop",
      value: p.eventLoopMs,
      good: 50,
      crit: 120,
      weight: w["Event-loop"],
      floor: 0.2,
    },
    {
      // Heap proche du plafond = risque OOM → PANNE (peut tirer l'indice à 0).
      label: "Mémoire (heap)",
      value: heapPct,
      good: 70,
      crit: 95,
      weight: w["Mémoire (heap)"],
      critical: true,
    },
    {
      // Connecteur ORM coupé = PANNE (DB down). `null` si aucun driver sondé (exclu).
      label: "Connecteurs",
      value: orm ? orm.connectors - orm.connected : null,
      good: 0,
      crit: orm ? Math.max(1, orm.connectors) : 1,
      weight: w.Connecteurs,
      critical: true,
    },
    {
      // Erreurs = PANNE réelle (taux/min). `null` avant le 2e tick (taux indérivable).
      label: "Erreurs",
      value: errRate ?? null,
      good: 0,
      crit: 10,
      weight: w.Erreurs,
      critical: true,
    },
  ]);
}
function worstOf(
  insts: InstanceHealth[],
  rates: Record<string, number>,
): HealthResult {
  let worst: HealthResult | null = null;
  for (const inst of insts) {
    const r = instHealth(inst, rates[inst.instanceId]);
    if (!worst || (r.score ?? 101) < (worst.score ?? 101)) worst = r;
  }
  return worst ?? buildHealth([]);
}

/** Couleur d'un sous-score (mêmes paliers que le verdict global). */
function partColor(score: number): string {
  if (score >= 90) return "teal";
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  if (score >= 25) return "orange";
  return "red";
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

/**
 * Détail PAR sonde (sous-score en barre + part de pondération) — c'est ce qui rend
 * l'indice « entier » : on voit quelle sonde tire le score, pas juste le total.
 */
function HealthBreakdown({ r }: { r: HealthResult }) {
  if (!r.parts.length) return null;
  const total = r.parts.reduce((a, p) => a + p.weight, 0) || 1;
  return (
    <Stack gap={6}>
      {r.parts.map((p) => (
        <div key={p.label}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs">
              {p.label}
              {p.kind === "fail" ? (
                <Text span size="xs" c="dimmed">
                  {" "}
                  · panne
                </Text>
              ) : null}
            </Text>
            <Text
              size="xs"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {p.score} · {Math.round((p.weight / total) * 100)} %
            </Text>
          </Group>
          <Progress value={p.score} color={partColor(p.score)} size="sm" />
        </div>
      ))}
    </Stack>
  );
}

/** Sondes absentes de la sonde cluster lean (présentes seulement sur la page mono). */
function HealthFootnote() {
  return (
    <Text size="xs" c="dimmed">
      GC & Temps réel non remontés par la sonde cluster — détail complet sur la
      page Supervision.
    </Text>
  );
}

function HealthBody({ source }: WidgetRenderProps<HealthPayload>) {
  const norm = normalize(source.data);
  const rates = usePerWorkerErrRate(norm?.instances ?? [], norm?.ts);
  return (
    <ClusterView
      normalized={norm}
      renderSummary={(_t, insts) => {
        const r = worstOf(insts, rates);
        return (
          <Stack gap="sm">
            <ScoreRing r={r} />
            {insts.length > 1 ? (
              <Text size="xs" c="dimmed">
                pod = pire des {insts.length} workers
              </Text>
            ) : null}
            <HealthBreakdown r={r} />
            <HealthFootnote />
          </Stack>
        );
      }}
      renderInstance={(inst, { grid }) => {
        const r = instHealth(inst, rates[inst.instanceId]);
        return grid ? (
          <WorkerTile pid={inst.process?.pid}>
            <Group gap="xs">
              <Badge color={r.color} variant="light">
                {r.label}
              </Badge>
              <Text fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                {r.score ?? "—"}
              </Text>
            </Group>
          </WorkerTile>
        ) : (
          <Stack gap="sm">
            <ScoreRing r={r} />
            <HealthBreakdown r={r} />
            <HealthFootnote />
          </Stack>
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
  tags: ["systeme", "cpu", "kpi"],
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
  tags: ["systeme", "memoire", "kpi"],
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
  tags: ["systeme", "event-loop", "kpi"],
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
  tags: ["systeme", "sante", "indice"],
  title: "Santé du framework (cluster)",
  description:
    "Indice composite cluster-aware 0-100 (6 sondes : CPU/ELU/loop/heap/connecteurs/erreurs) — pod = pire worker. Version mono détaillée + GC : widget « Santé du framework ».",
  category: "system",
  icon: IconHeartRateMonitor,
  source: HEALTH_SOURCE,
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  defaultH: 7,
  minH: 4,
  render: HealthBody,
});

registerWidget<KernelInfo>({
  id: "system.info",
  tags: ["systeme", "identite", "config", "panneau"],
  title: "Identité du serveur",
  description: "Version, Node, plateforme, domaine, git (snapshot).",
  category: "system",
  icon: IconInfoCircle,
  source: { kind: "snapshot", endpoint: "/nodefony/kernel/api/info" },
  defaultSpan: 6,
  minSpan: 4,
  render: InfoBody,
});
