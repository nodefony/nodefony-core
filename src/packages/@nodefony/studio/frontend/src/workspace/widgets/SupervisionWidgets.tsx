/**
 * Widgets « Supervision » du bureau — reproduction FIDÈLE des panneaux de la page
 * Supervision (`routes/DashboardSupervision.tsx`), source = canal **riche**
 * `nodefony:supervision` (sonde process per-instance : CPU, ELU, event-loop, mémoire,
 * **GC**, errCount). MONO pour l'instant (le multi-cluster = sonde lean `nodefony:socket`,
 * à câbler plus tard). Les mêmes seuils / couleurs / formats que la page.
 *
 *  • `supervision.health` — Santé du framework (indice composite + sliders de poids) ;
 *  • `supervision.correlation` — Corrélation CPU % / Mémoire % (même échelle 0-100) ;
 *  • `supervision.cpu` — Charge CPU (courbe) ;
 *  • `supervision.loop` — Event-loop lag (courbe) ;
 *  • `supervision.gc` — Garbage Collector (pause + cycles) ;
 *  • `orm.flow` — Débit ORM/s PAR connecteur (canal `nodefony:orm:flow`).
 *
 * Respecte « temps réel calme » : courbes SVG (compositor), `tabular-nums`, valeurs
 * en paliers entiers, abonnement nodefony:orm:health gaté sur le temps réel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Group,
  Popover,
  RingProgress,
  Slider,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconChartHistogram,
  IconChartLine,
  IconHeartRateMonitor,
  IconRecycle,
} from "@tabler/icons-react";
import { useNodefonyChannelData } from "nodefony/react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import {
  DEFAULT_WEIGHTS,
  HEALTH_WEIGHTS_KEY,
  buildHealth,
  loadHealthWeights,
  type HealthResult,
} from "../../utils/health";
import { Legend, MiniChart } from "../../components/ui";
import { Metric, useLiveSeries } from "./_kit";
import { PLATFORM_CHANNELS } from "nodefony";

/* ───────────────────────── Types miroir (sonde riche) ───────────────────────── */

/** GC de l'intervalle (miroir de `StatsPayload.gc`). */
interface StatsGc {
  count: number;
  pauseMs: number;
  major: number;
  minor: number;
}
/** Sonde process riche poussée sur `nodefony:supervision` (sous-ensemble consommé). */
interface StatsPayload {
  ts: number;
  cpuPercent: number;
  eventLoopMs: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    heapLimit?: number;
    external: number;
  };
  gc?: StatsGc | null;
  elu?: { utilization: number; active: number; idle: number } | null;
  errCount?: number;
}
/** Santé ORM live (`nodefony:orm:health`) — sous-ensemble pour la sonde « Connecteurs ». */
interface OrmHealthEntry {
  name: string;
  connected: boolean;
}

/** Heap % du plafond V8 (heapLimit si dispo, sinon heapTotal) — comme la page. */
function heapPctOf(s: StatsPayload | null): number | null {
  if (!s) return null;
  const ceil =
    s.memory.heapLimit && s.memory.heapLimit > 0
      ? s.memory.heapLimit
      : s.memory.heapTotal;
  return ceil > 0 ? Math.round((s.memory.heapUsed / ceil) * 100) : null;
}

/* ───────────────────────── Poids (sliders) partagés page ─────────────────────── */

/** État des poids synchronisé avec la clé localStorage PARTAGÉE avec la page Supervision. */
function useHealthWeights(): {
  weights: Record<string, number>;
  setWeight: (label: string, v: number) => void;
  reset: () => void;
} {
  const [weights, setW] = useState<Record<string, number>>(() =>
    loadHealthWeights(),
  );
  const persist = (next: Record<string, number>) => {
    try {
      localStorage.setItem(HEALTH_WEIGHTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const setWeight = (label: string, v: number) =>
    setW((w) => {
      const next = { ...w, [label]: v };
      persist(next);
      return next;
    });
  const reset = () => {
    persist({ ...DEFAULT_WEIGHTS });
    setW({ ...DEFAULT_WEIGHTS });
  };
  return { weights, setWeight, reset };
}
function wOf(weights: Record<string, number>, label: string): number {
  return weights[label] ?? DEFAULT_WEIGHTS[label] ?? 1;
}

/* ───────────────────────── Dérivations live (intervalle, erreurs, conn) ───────── */

/** Intervalle réel entre 2 ticks (ms) — pour l'overhead GC (% de l'intervalle). */
function useTickInterval(ts: number | null | undefined): number | null {
  const prev = useRef<number | null>(null);
  const [dt, setDt] = useState<number | null>(null);
  useEffect(() => {
    if (ts == null) return;
    if (prev.current != null && ts > prev.current) setDt(ts - prev.current);
    prev.current = ts;
  }, [ts]);
  return dt;
}

/** Somme glissante d'`errCount` sur ~`win` ticks ≈ erreurs/min (comme la page). */
function useErrWindow(
  errCount: number | undefined,
  ts: number | null | undefined,
  win = 60,
): number {
  const ring = useRef<number[]>([]);
  const last = useRef<number | null>(null);
  const [sum, setSum] = useState(0);
  useEffect(() => {
    if (ts == null || last.current === ts) return;
    last.current = ts;
    const r = [...ring.current, errCount ?? 0];
    ring.current = r.length > win ? r.slice(-win) : r;
    setSum(ring.current.reduce((a, b) => a + b, 0));
  }, [ts, errCount, win]);
  return sum;
}

/** Sonde « Connecteurs » (nodefony:orm:health) — montée seulement quand le temps réel est ON. */
function ConnSonde({
  onData,
}: {
  onData: (c: { up: number; total: number }) => void;
}) {
  const data = useNodefonyChannelData<OrmHealthEntry[]>(
    PLATFORM_CHANNELS.ormHealth,
  );
  useEffect(() => {
    if (Array.isArray(data))
      onData({
        up: data.filter((d) => d.connected).length,
        total: data.length,
      });
  }, [data, onData]);
  return null;
}

/* ─────────────────────────── Santé du framework (mono) ───────────────────────── */

/** Sondes affichées dans les sliders (les 8 de la page ; Temps réel = à venir ici). */
const SLIDER_LABELS = Object.keys(DEFAULT_WEIGHTS);

/** Couleur d'un sous-score (mêmes paliers que le verdict global). */
function partColor(score: number): string {
  if (score >= 75) return "teal";
  if (score >= 50) return "yellow";
  if (score >= 25) return "orange";
  return "red";
}

function ScoreRing({ r }: { r: HealthResult }) {
  return (
    <RingProgress
      size={120}
      thickness={12}
      roundCaps
      sections={[{ value: r.score ?? 0, color: r.color }]}
      label={
        <Center>
          <Stack gap={0} align="center">
            <Text
              fw={800}
              fz={26}
              lh={1}
              c={r.color}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {r.score ?? "—"}
            </Text>
            <Text size="xs" c="dimmed">
              / 100
            </Text>
          </Stack>
        </Center>
      }
    />
  );
}

/** Popover des sliders de pondération (partagés avec la page Supervision). */
function WeightsPopover({
  weights,
  setWeight,
  reset,
}: ReturnType<typeof useHealthWeights>) {
  const wsum = SLIDER_LABELS.reduce((a, l) => a + wOf(weights, l), 0) || 1;
  return (
    <Popover width={300} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Régler la pondération de l'indice"
        >
          <IconAdjustmentsHorizontal size={18} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={600}>
            Pondération de l'indice
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={reset}
          >
            Par défaut
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mb="sm">
          Glissez le poids de chaque sonde (0 = exclue). Partagé avec la page
          Supervision.
        </Text>
        <Stack gap="sm">
          {SLIDER_LABELS.map((label) => (
            <div key={label}>
              <Group justify="space-between" gap={4} mb={2}>
                <Text size="xs">{label}</Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  ×{wOf(weights, label).toFixed(1)} ·{" "}
                  {Math.round((wOf(weights, label) / wsum) * 100)}%
                </Text>
              </Group>
              <Slider
                size="sm"
                min={0}
                max={3}
                step={0.1}
                value={wOf(weights, label)}
                onChange={(v) => setWeight(label, v)}
                label={(v) => v.toFixed(1)}
              />
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

const HEALTH_SCALE: [string, string][] = [
  ["≥90 Excellent", "teal"],
  ["≥75 Bon", "green"],
  ["≥50 À surveiller", "yellow"],
  ["≥25 Dégradé", "orange"],
  ["<25 Critique", "red"],
];
function HealthScale() {
  return (
    <Group gap="md" wrap="wrap">
      {HEALTH_SCALE.map(([lbl, c]) => (
        <Group key={lbl} gap={4} wrap="nowrap">
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: `var(--mantine-color-${c}-6)`,
            }}
          />
          <Text size="xs" c="dimmed">
            {lbl}
          </Text>
        </Group>
      ))}
    </Group>
  );
}

/** Sous-scores par sonde (badges + tooltip poids + classe 🛡 saturation / ⚠ panne). */
function HealthParts({ r }: { r: HealthResult }) {
  if (!r.parts.length) return null;
  const total = r.parts.reduce((a, p) => a + p.weight, 0) || 1;
  return (
    <Group gap="xs" wrap="wrap">
      {r.parts.map((p) => (
        <Tooltip
          key={p.label}
          withArrow
          label={
            p.kind === "fail"
              ? `Panne possible (×${p.weight} · ${Math.round((p.weight / total) * 100)} %) : à son seuil critique, tire l'indice à 0.`
              : `Saturation (×${p.weight} · ${Math.round((p.weight / total) * 100)} %) : dégrade le score mais planchée — jamais « Critique » seule.`
          }
        >
          <Badge
            size="sm"
            variant="light"
            leftSection={p.kind === "fail" ? "⚠" : "🛡"}
            color={partColor(p.score)}
            style={{ cursor: "help", fontVariantNumeric: "tabular-nums" }}
          >
            {p.label} {p.score} · {Math.round((p.weight / total) * 100)}%
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

function SupervisionHealthBody({
  source,
  ctx,
}: WidgetRenderProps<StatsPayload>) {
  const stats = source.data;
  const wctl = useHealthWeights();
  const { weights } = wctl;
  const dt = useTickInterval(stats?.ts);
  const errPerMin = useErrWindow(stats?.errCount, stats?.ts);
  const [conn, setConn] = useState<{ up: number; total: number } | null>(null);
  const onConn = useCallback((c: { up: number; total: number }) => {
    setConn(c);
  }, []);

  const heapPct = heapPctOf(stats);
  const gc = stats?.gc ?? null;
  const gcOverhead = gc && dt ? (gc.pauseMs / dt) * 100 : null;
  const c = ctx.live ? conn : null;

  const r = buildHealth([
    {
      label: "CPU",
      value: stats?.cpuPercent ?? null,
      good: 70,
      crit: 100,
      weight: wOf(weights, "CPU"),
      floor: 0.2,
    },
    {
      label: "Saturation (ELU)",
      value: stats?.elu ? stats.elu.utilization * 100 : null,
      good: 70,
      crit: 100,
      weight: wOf(weights, "Saturation (ELU)"),
      floor: 0.2,
    },
    {
      // Seuils tolérants (dev : Vite partage l'event-loop) ; la page = strict par-env.
      label: "Event-loop",
      value: stats?.eventLoopMs ?? null,
      good: 50,
      crit: 120,
      weight: wOf(weights, "Event-loop"),
      floor: 0.2,
    },
    {
      label: "Mémoire (heap)",
      value: heapPct,
      good: 70,
      crit: 95,
      weight: wOf(weights, "Mémoire (heap)"),
      critical: true,
    },
    {
      label: "GC overhead",
      value: gcOverhead,
      good: 1,
      crit: 10,
      weight: wOf(weights, "GC overhead"),
      floor: 0.25,
    },
    {
      label: "Erreurs",
      value: ctx.live ? errPerMin : null,
      good: 0,
      crit: 10,
      weight: wOf(weights, "Erreurs"),
      critical: true,
    },
    {
      label: "Connecteurs",
      value: c ? c.total - c.up : null,
      good: 0,
      crit: c ? Math.max(1, c.total) : 1,
      weight: wOf(weights, "Connecteurs"),
      critical: true,
    },
  ]);

  return (
    <Group wrap="nowrap" align="flex-start" gap="xl">
      {ctx.live ? <ConnSonde onData={onConn} /> : null}
      <ScoreRing r={r} />
      <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="wrap">
          <Badge color={r.color} size="lg" variant="light">
            {r.label}
          </Badge>
          {r.score == null ? (
            <Text size="sm" c="dimmed">
              En attente de mesures…
            </Text>
          ) : r.worst && r.score < 100 ? (
            <Text size="sm" c="dimmed">
              limité par : <b>{r.worst}</b>
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              tous les indicateurs au vert.
            </Text>
          )}
          <WeightsPopover {...wctl} />
        </Group>
        <HealthScale />
        <HealthParts r={r} />
        <Text size="xs" c="dimmed">
          Indice mono-process (Derringer-Suich). Temps réel & multi-cluster : à
          venir.
        </Text>
      </Stack>
    </Group>
  );
}

/* ───────────────────────── Corrélation CPU / Mémoire ─────────────────────────── */

const CPU_COLOR = "var(--mantine-color-teal-6)";
const HEAP_COLOR = "var(--mantine-color-blue-6)";

/** Deux séries SYNCHRONISÉES (un point par tick `ts`) — corrélation visuelle. */
function usePairedSeries(
  key: number | null | undefined,
  a: number | null,
  b: number | null,
  max = 60,
): { a: number; b: number }[] {
  const [series, setSeries] = useState<{ a: number; b: number }[]>([]);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (key == null || a == null || b == null || last.current === key) return;
    last.current = key;
    setSeries((s) => {
      const n = [...s, { a, b }];
      return n.length > max ? n.slice(-max) : n;
    });
  }, [key, a, b, max]);
  return series;
}

function CorrelationBody({ source }: WidgetRenderProps<StatsPayload>) {
  const stats = source.data;
  const cpu = stats?.cpuPercent ?? null;
  const heap = heapPctOf(stats);
  const series = usePairedSeries(stats?.ts, cpu, heap);
  return (
    <Stack gap="sm">
      <Group gap="xl">
        <Metric
          label="CPU"
          value={cpu != null ? Math.round(cpu) : "—"}
          unit="%"
        />
        <Metric label="Mémoire" value={heap != null ? heap : "—"} unit="%" />
      </Group>
      {series.length >= 2 ? (
        <>
          <MiniChart
            height={150}
            max={100}
            threshold={80}
            format={(v) => `${Math.round(v)}%`}
            series={[
              {
                data: series.map((p) => p.a),
                color: CPU_COLOR,
                label: "CPU %",
              },
              {
                data: series.map((p) => p.b),
                color: HEAP_COLOR,
                label: "Heap %",
              },
            ]}
          />
          <Group gap="lg">
            <Legend color={CPU_COLOR} label="CPU (% d'un cœur)" />
            <Legend color={HEAP_COLOR} label="Heap (% du plafond V8)" />
          </Group>
        </>
      ) : (
        <Text size="xs" c="dimmed">
          Active le temps réel pour voir la corrélation CPU / mémoire.
        </Text>
      )}
    </Stack>
  );
}

/* ─────────────────────────────── Garbage Collector ──────────────────────────── */

function GcBody({ source }: WidgetRenderProps<StatsPayload>) {
  const stats = source.data;
  const dt = useTickInterval(stats?.ts);
  const gc = stats?.gc ?? null;
  const series = useLiveSeries(gc ? gc.pauseMs : null, 60);
  const overhead = gc && dt ? (gc.pauseMs / dt) * 100 : null;
  const avg = gc && gc.count ? gc.pauseMs / gc.count : null;
  const overColor =
    overhead == null
      ? "gray"
      : overhead > 5
        ? "red"
        : overhead > 1
          ? "orange"
          : "teal";
  if (!gc)
    return (
      <Text size="sm" c="dimmed">
        GC non remonté (active le temps réel ; nécessite la sonde process
        riche).
      </Text>
    );
  return (
    <Stack gap="sm">
      <Group gap="md">
        <Badge variant="light" color={overColor}>
          {overhead != null ? `${overhead.toFixed(1)} %` : "—"} overhead
        </Badge>
        <Text size="xs" c="dimmed">
          {gc.pauseMs.toFixed(0)} ms de pause / intervalle
        </Text>
      </Group>
      {series.length >= 2 ? (
        <MiniChart
          height={130}
          threshold={50}
          format={(v) => `${v.toFixed(1)} ms`}
          series={[
            {
              data: series,
              color: "var(--mantine-color-orange-6)",
              label: "Pause GC (ms)",
            },
          ]}
        />
      ) : (
        <Text size="xs" c="dimmed">
          Active le temps réel pour la courbe.
        </Text>
      )}
      <Group gap="xl" wrap="wrap">
        <Metric label="Cycles" value={gc.count} />
        <Metric label="Majeurs" value={gc.major} />
        <Metric label="Mineurs" value={gc.minor} />
        <Metric
          label="Pause / cycle"
          value={avg != null ? avg.toFixed(1) : "—"}
          unit="ms"
        />
      </Group>
    </Stack>
  );
}

/* ─────────────────────────── Débit ORM par connecteur ────────────────────────── */

/** Un connecteur du rapport de flux ORM (canal `nodefony:orm:flow`). Cumuls monotones. */
interface FlowConnector {
  connector: string;
  vendor: string;
  total: number;
  ewmaMs: number | null;
  maxMs: number;
  slowTotal: number;
}
/** Rapport de flux ORM per-instance (`nodefony:orm:flow` / `GET /orm/api/flow`). */
interface FlowReport {
  enabled: boolean;
  ts: number;
  instanceId: string;
  slowMs: number;
  connectors: FlowConnector[];
}

/** Palette stable des séries de débit par connecteur (assignée par index). */
const FLOW_PALETTE = [
  "var(--mantine-color-yellow-6)",
  "var(--mantine-color-blue-6)",
  "var(--mantine-color-teal-6)",
  "var(--mantine-color-grape-6)",
  "var(--mantine-color-orange-6)",
  "var(--mantine-color-cyan-6)",
];
function paletteAt(i: number): string {
  return FLOW_PALETTE[i % FLOW_PALETTE.length] as string;
}

/** Débit/s PAR connecteur dérivé du delta de `total` entre 2 rapports + historique. */
function useFlowSeries(
  report: FlowReport | null,
  max = 60,
): { rates: Record<string, number>; hist: Record<string, number>[] } {
  const prev = useRef<{ ts: number; totals: Record<string, number> } | null>(
    null,
  );
  const [rates, setRates] = useState<Record<string, number>>({});
  const [hist, setHist] = useState<Record<string, number>[]>([]);
  useEffect(() => {
    if (!report || !Array.isArray(report.connectors)) return;
    const totals: Record<string, number> = {};
    for (const cc of report.connectors) totals[cc.connector] = cc.total;
    const p = prev.current;
    if (p && report.ts > p.ts) {
      const dtS = (report.ts - p.ts) / 1000;
      const r: Record<string, number> = {};
      if (dtS > 0) {
        for (const cc of report.connectors) {
          const pv = p.totals[cc.connector];
          if (pv != null) r[cc.connector] = Math.max(0, (cc.total - pv) / dtS);
        }
      }
      setRates(r);
      setHist((h) => {
        const n = [...h, r];
        return n.length > max ? n.slice(-max) : n;
      });
    }
    prev.current = { ts: report.ts, totals };
  }, [report, max]);
  return { rates, hist };
}

function OrmFlowBody({ source }: WidgetRenderProps<FlowReport>) {
  const report = source.data;
  const { rates, hist } = useFlowSeries(report);
  if (report && report.enabled === false)
    return (
      <Text size="sm" c="dimmed">
        Flux ORM désactivé (sonde OFF). Activer avec NODEFONY_ORM_FLOW=1.
      </Text>
    );
  const conns = (report?.connectors ?? []).filter((cc) => cc.total > 0);
  if (conns.length === 0)
    return (
      <Text size="sm" c="dimmed">
        Aucune requête ORM observée.
      </Text>
    );
  const series = conns.map((cc, i) => ({
    data: hist.map((h) => h[cc.connector] ?? 0),
    color: paletteAt(i),
    label: cc.connector,
  }));
  const totalRate = Object.values(rates).reduce((a, v) => a + v, 0);
  return (
    <Stack gap="sm">
      <Metric label="Débit total" value={Math.round(totalRate)} unit="req/s" />
      {hist.length >= 2 ? (
        <MiniChart
          height={150}
          format={(v) => `${Math.round(v)}/s`}
          series={series}
        />
      ) : (
        <Text size="xs" c="dimmed">
          Active le temps réel pour la courbe par connecteur.
        </Text>
      )}
      <Group gap="lg" wrap="wrap">
        {conns.map((cc, i) => (
          <Group key={cc.connector} gap={6} wrap="nowrap">
            <Legend color={paletteAt(i)} label={cc.connector} />
            <Text
              size="xs"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(rates[cc.connector] ?? 0)}/s
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}

/* ─────────────────────────────── registrations ──────────────────────────────── */

const SUPERVISION_SRC = {
  kind: "hybrid",
  endpoint: "/nodefony/studio/api/stats",
  channel: PLATFORM_CHANNELS.supervision,
} as const;

registerWidget<StatsPayload>({
  id: "supervision.health",
  tags: ["systeme", "sante", "indice"],
  title: "Santé du framework",
  description:
    "Indice composite 0-100 (CPU/ELU/loop/heap/GC/erreurs/connecteurs) + détail par sonde + poids réglables. Mono-process (comme la page).",
  category: "system",
  icon: IconHeartRateMonitor,
  source: SUPERVISION_SRC,
  defaultSpan: 12,
  minSpan: 6,
  defaultH: 6,
  minH: 4,
  render: SupervisionHealthBody,
});

registerWidget<StatsPayload>({
  id: "supervision.correlation",
  tags: ["systeme", "cpu", "memoire", "graphe"],
  title: "Corrélation CPU / Mémoire",
  description:
    "CPU % et Mémoire % sur la même échelle 0-100 (un pic mémoire → pression GC → CPU).",
  category: "system",
  icon: IconChartLine,
  source: SUPERVISION_SRC,
  defaultSpan: 6,
  minSpan: 4,
  defaultH: 5,
  minH: 3,
  render: CorrelationBody,
});

registerWidget<StatsPayload>({
  id: "supervision.gc",
  tags: ["systeme", "gc", "graphe"],
  title: "Garbage Collector",
  description:
    "Pause GC (stop-the-world) par intervalle : overhead, cycles, majeurs/mineurs.",
  category: "system",
  icon: IconRecycle,
  source: SUPERVISION_SRC,
  defaultSpan: 12,
  minSpan: 6,
  defaultH: 6,
  minH: 4,
  render: GcBody,
});

registerWidget<FlowReport>({
  id: "orm.flow",
  tags: ["orm", "orm-debit", "graphe"],
  title: "Débit ORM par connecteur",
  description:
    "Requêtes/s dérivées PAR connecteur (courbe multi-séries). Per-instance (canal nodefony:orm:flow).",
  category: "orm",
  icon: IconChartHistogram,
  source: {
    kind: "hybrid",
    endpoint: "/nodefony/orm/api/flow",
    channel: PLATFORM_CHANNELS.ormFlow,
  },
  defaultSpan: 6,
  minSpan: 4,
  defaultH: 5,
  minH: 3,
  render: OrmFlowBody,
});
