/**
 * `<ProcessGraphGrid>` — vue d'accueil **multi-process orientée GRAPHS** de la
 * supervision (≠ page Cluster, orientée KPIs/socket). Une **card par process** du
 * pod, chacune avec ses **courbes CPU + Heap en direct** (live), **cliquable** pour
 * drill vers le détail complet d'UN worker (`/nodefony/supervision?pid=<pid>`).
 *
 * « En visu direct » : la grille s'abonne au snapshot pod `realtime:health` tant
 * qu'elle est montée (le master le diffuse déjà → coût marginal nul) et trace les
 * séries CPU/Heap par pid. 1ᵉʳ paint = fetch HTTP one-shot (cartes peuplées avant
 * la 1ʳᵉ frame). Purge la série d'un pid au respawn (pid disparu).
 *
 * Perf/calme : `MiniChart` SVG (jamais recharts), `contain: content` par card,
 * `tabular-nums`, séries bornées (0 mutation in-place).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Card,
  Group,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronRight, IconCpu } from "@tabler/icons-react";
import { useNodefonyChannelData } from "nodefony/react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { DataState, FlashValue, MiniChart, ensureLiveStyles } from "./ui";
import {
  buildHealth,
  loadHealthWeights,
  type HealthResult,
} from "../utils/health";
import { HealthWeightsPopover } from "./HealthWeightsPopover";

const HISTORY = 60;
const MB = 1024 ** 2;

/** Sondes pondérables au niveau POD (snapshot lean : 4 sondes process). */
const POD_WEIGHT_LABELS = [
  "CPU",
  "Saturation (ELU)",
  "Event-loop",
  "Mémoire (heap)",
];

/** Sous-ensemble process du snapshot santé (miroir isomorphe, base lean). */
interface ProcHealth {
  pid: number;
  cpuPercent: number;
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  eventLoopMs: number;
  eluUtilization: number;
  rss: number;
  uptime: number;
}
interface Inst {
  instanceId: string;
  process?: ProcHealth;
}
interface ClusterH {
  cluster: true;
  instances: Inst[];
}
type Health = ClusterH | (Inst & { cluster?: undefined });

/** Ramène la réponse santé (pod OU per-instance) à une liste d'instances. */
function instancesOf(h: Health | null): Inst[] {
  if (!h) return [];
  if ((h as ClusterH).cluster) return (h as ClusterH).instances ?? [];
  return [h as Inst];
}

/** Série bornée FIFO (cap `HISTORY`) — 0 mutation in-place. */
function cap(arr: number[], v: number): number[] {
  const n =
    arr.length >= HISTORY ? arr.slice(arr.length - HISTORY + 1) : arr.slice();
  n.push(v);
  return n;
}

/** Couleur d'un % CPU (1 cœur : ~100 = saturé). */
function cpuColor(p: number): string {
  if (p >= 90) return "var(--mantine-color-red-6)";
  if (p >= 70) return "var(--mantine-color-orange-6)";
  return "var(--mantine-color-teal-6)";
}

/** Octets → unité lisible. */
function niceBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

/** Uptime → paliers entiers (0 churn ms↔s). */
function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}

/** Couleur event-loop lag (seuils relâchés dev). */
function loopColor(ms: number): string {
  if (ms >= 120) return "red";
  if (ms >= 50) return "orange";
  return "teal";
}

/** Couleur d'un % mémoire heap (utilisé / alloué). */
function memColor(pct: number): string {
  if (pct >= 90) return "var(--mantine-color-red-6)";
  if (pct >= 75) return "var(--mantine-color-orange-6)";
  return "var(--mantine-color-blue-6)";
}

// ── Santé du framework AGRÉGÉE (pod) ─────────────────────────────────────────
// Réutilise EXACTEMENT la logique pondérée Derringer-Suich de la page Supervision
// (util partagé `health.ts`) → la **pondération réglée par l'utilisateur** (sliders,
// persistée) s'applique aussi à la santé pod. Sondes disponibles dans le snapshot
// pod lean : CPU, ELU, event-loop, heap (mêmes seuils/floors/critical que le mono).
// ROLLUP POD = pire worker (règle figée). GC/ORM/erreurs par worker = backend plus tard.

/** Santé d'UN worker via le moteur partagé, avec les poids persistés. */
function workerHealth(
  p: ProcHealth,
  weights: Record<string, number>,
): HealthResult {
  // heapUsed/heapLimit (plafond V8) = % avant OOM, actionnable. PAS heapUsed/heapTotal
  // (V8 colle heapTotal à heapUsed → ~95 % au repos = faux « Critique »). Idem mono.
  const heapPct = p.heapLimit > 0 ? (p.heapUsed / p.heapLimit) * 100 : 0;
  return buildHealth([
    {
      label: "CPU",
      value: p.cpuPercent,
      good: 70,
      crit: 100,
      weight: weights.CPU ?? 1,
      floor: 0.2,
    },
    {
      label: "Saturation (ELU)",
      value: p.eluUtilization * 100,
      good: 70,
      crit: 100,
      weight: weights["Saturation (ELU)"] ?? 1.5,
      floor: 0.2,
    },
    {
      label: "Event-loop",
      value: p.eventLoopMs,
      good: 50,
      crit: 120,
      weight: weights["Event-loop"] ?? 1.5,
      floor: 0.2,
    },
    {
      label: "Mémoire (heap)",
      value: heapPct,
      good: 70,
      crit: 95,
      weight: weights["Mémoire (heap)"] ?? 1,
      critical: true,
    },
  ]);
}

interface ProcessSeries {
  cpu: number[];
  heap: number[];
}

export interface ProcessGraphGridProps {
  /** Drill : clic d'une card → détail du worker `pid`. */
  onSelect: (pid: number) => void;
  /** Poids de l'indice (réglés par les sliders). Défaut = poids persistés. */
  weights?: Record<string, number>;
  /** Réglage de la pondération SUR la card pod (sliders). Absent → bouton masqué. */
  onWeightsChange?: (next: Record<string, number>) => void;
}

/** Grille « accueil supervision » multi-process orientée graphs. */
export function ProcessGraphGrid({
  onSelect,
  weights: weightsProp,
  onWeightsChange,
}: ProcessGraphGridProps) {
  const store = useStore();
  useEffect(ensureLiveStyles, []);

  // 1ᵉʳ paint HTTP (cartes peuplées avant la 1ʳᵉ frame WS).
  const fetcher = useCallback(
    () => store.api.getAbsolute<Health>("/nodefony/realtime/api/health"),
    [store],
  );
  const { data: snap, loading, error, reload } = useResource(fetcher);

  // Live « visu direct » : abonné au snapshot pod tant que la grille est montée.
  const live = useNodefonyChannelData<Health>("realtime:health");
  const health = live ?? snap;
  const insts = instancesOf(health);

  // Santé du framework AGRÉGÉE pod = pire worker (poids réglés, ou persistés).
  const weights = weightsProp ?? loadHealthWeights();
  const scored = insts
    .filter((i): i is Inst & { process: ProcHealth } => !!i.process)
    .map((i) => ({ pid: i.instanceId, h: workerHealth(i.process, weights) }));
  const worst =
    scored.length > 0
      ? scored.reduce((a, b) =>
          (b.h.score ?? 100) < (a.h.score ?? 100) ? b : a,
        )
      : null;
  const podScore = worst?.h.score ?? null;

  // Agrégats process pod (sondes lean). CPU/loop/ELU = par-worker → moyenne + pic
  // (jamais une somme : ça n'a pas de sens pour un %) ; heap/rss = somme (mémoire
  // réellement occupée par le pod) ; uptime min = worker le plus jeune (respawn ?).
  const procs = insts.map((i) => i.process).filter((p): p is ProcHealth => !!p);
  const agg =
    procs.length > 0
      ? {
          cpuAvg: Math.round(
            procs.reduce((a, p) => a + p.cpuPercent, 0) / procs.length,
          ),
          loopMax: Math.max(...procs.map((p) => p.eventLoopMs)),
          eluMax: Math.round(
            Math.max(...procs.map((p) => p.eluUtilization)) * 100,
          ),
          heapSum: procs.reduce((a, p) => a + p.heapUsed, 0),
          rssSum: procs.reduce((a, p) => a + p.rss, 0),
          uptimeMin: Math.min(...procs.map((p) => p.uptime)),
        }
      : null;

  // Séries CPU/Heap par pid, dérivées des snapshots successifs (0 backend).
  const [series, setSeries] = useState<Map<string, ProcessSeries>>(new Map());
  useEffect(() => {
    if (!live) return;
    const list = instancesOf(live);
    setSeries((prev) => {
      const next = new Map(prev);
      const seen = new Set<string>();
      for (const inst of list) {
        seen.add(inst.instanceId);
        const p = inst.process;
        if (!p) continue;
        const cur = next.get(inst.instanceId) ?? { cpu: [], heap: [] };
        next.set(inst.instanceId, {
          cpu: cap(cur.cpu, p.cpuPercent),
          heap: cap(cur.heap, Math.round(p.heapUsed / MB)),
        });
      }
      for (const id of next.keys()) if (!seen.has(id)) next.delete(id);
      return next;
    });
  }, [live]);

  return (
    <DataState
      loading={loading && !insts.length}
      error={error}
      empty={!insts.length}
      onRetry={reload}
      emptyMessage="Aucun process à superviser."
    >
      <Stack gap="md">
        {/* Santé du framework AGRÉGÉE pod (rollup = pire worker). */}
        {podScore != null && worst ? (
          <Card withBorder radius="md" p="md" style={{ contain: "content" }}>
            <Group wrap="nowrap" align="center" gap="lg">
              <RingProgress
                size={92}
                thickness={10}
                roundCaps
                sections={[{ value: podScore, color: worst.h.color }]}
                label={
                  <Text
                    ta="center"
                    fw={800}
                    fz={22}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {podScore}
                  </Text>
                }
              />
              <div style={{ minWidth: 0 }}>
                <Group gap="xs" mb={4}>
                  <Text fw={700}>Santé du framework</Text>
                  <Badge color={worst.h.color} variant="light">
                    {worst.h.label}
                  </Badge>
                  {/* Réglage SUR la card, à côté du titre + état (⚙, comme le mono). */}
                  {onWeightsChange ? (
                    <HealthWeightsPopover
                      weights={weights}
                      onChange={onWeightsChange}
                      labels={POD_WEIGHT_LABELS}
                      summary="Poids ×N de chaque sonde dans l'indice pod (rollup pire worker). Persisté, partagé avec la page mono."
                    />
                  ) : null}
                </Group>
                <Text size="sm" c="dimmed">
                  Pod de {scored.length} workers — rollup = <b>pire worker</b>{" "}
                  (pid {worst.pid}, score {worst.h.score}). Pondération via ⚙.
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  Agrégation partielle (CPU · ELU · event-loop · heap). GC / ORM
                  / erreurs par worker = agrégation backend à venir.
                </Text>
              </div>
              {/* Agrégats process pod (CPU moyen, pic event-loop/ELU, mémoire totale). */}
              {agg ? (
                <Group gap="xl" ml="auto" wrap="wrap" visibleFrom="sm">
                  <PodStat label="CPU moyen" value={`${agg.cpuAvg}%`} />
                  <PodStat
                    label="Event-loop max"
                    value={`${Math.round(agg.loopMax)} ms`}
                    color={loopColor(agg.loopMax)}
                  />
                  <PodStat label="ELU max" value={`${agg.eluMax}%`} />
                  <PodStat label="Heap pod" value={niceBytes(agg.heapSum)} />
                  <PodStat label="RSS pod" value={niceBytes(agg.rssSum)} />
                </Group>
              ) : null}
            </Group>
          </Card>
        ) : null}

        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
          {insts.map((inst, i) => {
            const p = inst.process;
            const s = series.get(inst.instanceId);
            const cpuData = s?.cpu ?? (p ? [p.cpuPercent] : []);
            const heapData =
              s?.heap ?? (p ? [Math.round(p.heapUsed / MB)] : []);
            const heapMo = p ? Math.round(p.heapUsed / MB) : 0;
            // % mémoire = heap utilisé / heap alloué (V8) — lecture directe.
            const memPct =
              p && p.heapTotal > 0
                ? Math.round((p.heapUsed / p.heapTotal) * 100)
                : null;
            const wh = p ? workerHealth(p, weights) : null;
            const score = wh?.score ?? null;
            return (
              <UnstyledButton
                key={inst.instanceId}
                onClick={() => onSelect(Number(inst.instanceId))}
                aria-label={`détail supervision du worker ${i + 1} (pid ${inst.instanceId})`}
                style={{ display: "block" }}
              >
                <Card
                  withBorder
                  radius="md"
                  p="md"
                  h="100%"
                  className="nf-live-card"
                  style={{ contain: "content" }}
                >
                  <Group justify="space-between" wrap="nowrap" mb="sm">
                    <Group gap="xs" wrap="nowrap">
                      <ThemeIcon variant="light" color="brand" radius="md">
                        <IconCpu size={18} />
                      </ThemeIcon>
                      <div>
                        <Group gap={4} wrap="nowrap">
                          <Text fw={600}>worker {i + 1}</Text>
                          <IconChevronRight
                            size={14}
                            style={{ opacity: 0.5 }}
                          />
                        </Group>
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          pid {inst.instanceId}
                          {p ? ` · ${fmtUptime(p.uptime)}` : ""}
                        </Text>
                      </div>
                    </Group>
                    {/* Badge santé du worker (triage d'un coup d'œil). */}
                    {wh && score != null ? (
                      <Badge
                        variant="light"
                        color={wh.color}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {score}
                      </Badge>
                    ) : null}
                  </Group>

                  {/* % CPU + % mémoire EN GRAND, en haut de card (visu direct). */}
                  <Group grow mb="sm" gap="xs">
                    <div style={{ textAlign: "center" }}>
                      <Text size="xs" c="dimmed">
                        CPU
                      </Text>
                      <Text
                        fw={800}
                        fz={28}
                        lh={1.1}
                        c={p ? cpuColor(p.cpuPercent) : undefined}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {p ? (
                          <FlashValue value={p.cpuPercent}>
                            {p.cpuPercent}%
                          </FlashValue>
                        ) : (
                          "—"
                        )}
                      </Text>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <Text size="xs" c="dimmed">
                        Mémoire
                      </Text>
                      <Text
                        fw={800}
                        fz={28}
                        lh={1.1}
                        c={memPct != null ? memColor(memPct) : undefined}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {memPct != null ? (
                          <FlashValue value={memPct}>{memPct}%</FlashValue>
                        ) : (
                          "—"
                        )}
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {p ? `${heapMo} Mo` : ""}
                      </Text>
                    </div>
                  </Group>

                  {/* CPU — courbe en grand (page orientée graphs). */}
                  <Text size="xs" c="dimmed" mb={2}>
                    CPU
                  </Text>
                  <MiniChart
                    series={[
                      {
                        data: cpuData,
                        color: p
                          ? cpuColor(p.cpuPercent)
                          : "var(--mantine-color-teal-6)",
                        label: "CPU %",
                      },
                    ]}
                    height={72}
                    max={100}
                  />

                  {/* Heap — courbe en grand. */}
                  <Group justify="space-between" mt="sm" mb={2}>
                    <Text size="xs" c="dimmed">
                      Heap
                    </Text>
                    <Text
                      size="xs"
                      fw={600}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {p ? `${heapMo} Mo` : "—"}
                    </Text>
                  </Group>
                  <MiniChart
                    series={[
                      {
                        data: heapData,
                        color: "var(--mantine-color-blue-6)",
                        label: "Heap Mo",
                      },
                    ]}
                    height={72}
                  />

                  {/* Saturation : event-loop + ELU (le vrai signal « à fond » Node). */}
                  {p ? (
                    <Group justify="space-between" mt="sm" gap="xs">
                      <Text
                        size="xs"
                        c={loopColor(p.eventLoopMs)}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        loop {Math.round(p.eventLoopMs)} ms
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        ELU {Math.round(p.eluUtilization * 100)}% · RSS{" "}
                        {niceBytes(p.rss)}
                      </Text>
                    </Group>
                  ) : null}
                </Card>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      </Stack>
    </DataState>
  );
}

/** Petite stat d'agrégat pod (label + valeur tabular-nums). */
function PodStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </div>
  );
}

export default ProcessGraphGrid;
