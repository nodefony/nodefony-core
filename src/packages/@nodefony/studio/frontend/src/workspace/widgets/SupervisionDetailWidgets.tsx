/**
 * Widgets de détail SYSTÈME / ERREURS — reproduisent les onglets « Mémoire »,
 * « Système » (ressources actives) et « Erreurs » de la page Supervision, à partir
 * de la sonde riche `nodefony:supervision` (`heapSpaces`, `handles`, `errCount` —
 * live-only, null en snapshot comme `gc`). MONO pour l'instant.
 *
 *  • `supervision.memory`  — espaces du heap V8 (new/old/code…), barres used/size ;
 *  • `supervision.handles` — ressources actives Node (sockets, timers, fichiers…) ;
 *  • `supervision.errors`  — erreurs/min (ERROR + CRITIC) + courbe.
 */
import { useEffect, useRef, useState } from "react";
import { Badge, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconBoxMultiple,
  IconBug,
  IconPlugConnected,
} from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { MiniChart } from "../../components/ui";
import { Metric, useLiveSeries } from "./_kit";
import { PLATFORM_CHANNELS } from "nodefony";

/* ───────────────────────── Types miroir (sonde riche) ───────────────────────── */

interface HeapSpace {
  name: string;
  used: number;
  size: number;
}
interface Handles {
  total: number;
  byType: Record<string, number>;
}
interface StatsPayload {
  ts: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  heapSpaces?: HeapSpace[];
  handles?: Handles;
  errCount?: number;
}

const MB = 1024 ** 2;
const fmtMB = (n: number) => `${(n / MB).toFixed(1)} Mo`;

/* ───────────────────────────── Espaces du heap V8 ────────────────────────────── */

/** Libellés clairs des espaces du heap V8 (noms internes cryptiques). */
const SPACE_LABEL: Record<string, string> = {
  new_space: "Jeune génération",
  old_space: "Vieille génération",
  code_space: "Code compilé",
  map_space: "Maps (formes d'objets)",
  large_object_space: "Gros objets",
  code_large_object_space: "Gros code",
  new_large_object_space: "Gros objets jeunes",
  read_only_space: "Lecture seule",
  shared_space: "Partagé",
};
function spaceLabel(name: string): string {
  return SPACE_LABEL[name] ?? name.replace(/_/g, " ");
}

function MemoryBody({ source }: WidgetRenderProps<StatsPayload>) {
  const stats = source.data;
  const spaces = (stats?.heapSpaces ?? [])
    .filter((s) => s.size > 0)
    .sort((a, b) => b.used - a.used);
  if (!spaces.length)
    return (
      <Text size="sm" c="dimmed">
        Espaces V8 non remontés (active le temps réel ; sonde process riche).
      </Text>
    );
  return (
    <Stack gap="sm">
      {stats ? (
        <Group gap="xl">
          <Metric label="Heap utilisé" value={fmtMB(stats.memory.heapUsed)} />
          <Metric label="RSS" value={fmtMB(stats.memory.rss)} />
        </Group>
      ) : null}
      <Stack gap={8}>
        {spaces.map((s) => {
          const pct = s.size > 0 ? Math.round((s.used / s.size) * 100) : 0;
          return (
            <div key={s.name}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" truncate>
                  {spaceLabel(s.name)}
                </Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtMB(s.used)} / {fmtMB(s.size)}
                </Text>
              </Group>
              <Progress
                value={pct}
                color={pct >= 90 ? "red" : pct >= 70 ? "orange" : "teal"}
                size="sm"
              />
            </div>
          );
        })}
      </Stack>
    </Stack>
  );
}

/* ─────────────────────────── Ressources actives (handles) ────────────────────── */

/** Libellé + explication des types de ressources actives Node (`getActiveResourcesInfo`). */
const HANDLE_INFO: Record<string, { label: string; desc: string }> = {
  TTYWrap: {
    label: "Terminal",
    desc: "Flux terminal (stdout / stderr / stdin).",
  },
  TCPSocketWrap: {
    label: "Socket TCP",
    desc: "Connexion TCP active (HTTP entrant, WebSocket, client sortant…).",
  },
  TCPServerWrap: {
    label: "Serveur TCP",
    desc: "Serveur TCP en écoute (serveurs HTTP/WS de Nodefony).",
  },
  PipeWrap: {
    label: "Pipe / IPC",
    desc: "Tube nommé ou canal IPC inter-process.",
  },
  Timeout: {
    label: "Timer",
    desc: "setTimeout / setInterval programmé (non unref).",
  },
  Immediate: {
    label: "Immediate",
    desc: "setImmediate en attente au prochain tick.",
  },
  FSReqCallback: {
    label: "I/O fichier",
    desc: "Opération fichier asynchrone en cours.",
  },
  FSEvent: {
    label: "Watch FS",
    desc: "Surveillance d'un fichier/dossier (fs.watch).",
  },
  MessagePort: {
    label: "MessagePort",
    desc: "Canal worker_threads / MessageChannel.",
  },
  Worker: { label: "Worker", desc: "Thread worker (worker_threads) actif." },
  ChildProcess: {
    label: "Process enfant",
    desc: "Process fils (spawn / fork).",
  },
  SignalWrap: {
    label: "Signal POSIX",
    desc: "Écoute d'un signal (SIGINT, SIGTERM…).",
  },
  HTTPParser: {
    label: "Parser HTTP",
    desc: "Analyseur de message HTTP en cours.",
  },
  TLSWrap: { label: "TLS", desc: "Connexion chiffrée TLS/SSL (HTTPS, WSS)." },
  UDPWrap: { label: "Socket UDP", desc: "Socket UDP active (datagrammes)." },
  ZlibStream: {
    label: "Compression",
    desc: "Flux (dé)compression zlib / gzip / brotli.",
  },
};
function handleInfo(type: string): { label: string; desc: string } {
  return (
    HANDLE_INFO[type] ?? {
      label: type,
      desc: `Ressource interne Node.js « ${type} » maintenant la boucle active.`,
    }
  );
}

function HandlesBody({ source }: WidgetRenderProps<StatsPayload>) {
  const h = source.data?.handles;
  if (!h)
    return (
      <Text size="sm" c="dimmed">
        Ressources actives non remontées (active le temps réel).
      </Text>
    );
  const rows = Object.entries(h.byType).sort((a, b) => b[1] - a[1]);
  return (
    <Stack gap="sm">
      <Metric label="Ressources actives" value={h.total} />
      <Stack gap={4}>
        {rows.map(([type, count]) => {
          const info = handleInfo(type);
          return (
            <Group key={type} justify="space-between" gap="xs" wrap="nowrap">
              <Tooltip label={info.desc} withArrow multiline w={260}>
                <Text size="xs" style={{ cursor: "help" }} truncate>
                  {info.label}
                </Text>
              </Tooltip>
              <Badge
                size="sm"
                variant="light"
                color="gray"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {count}
              </Badge>
            </Group>
          );
        })}
      </Stack>
    </Stack>
  );
}

/* ─────────────────────────────────── Erreurs ─────────────────────────────────── */

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

function ErrorsBody({ source, ctx }: WidgetRenderProps<StatsPayload>) {
  const stats = source.data;
  const perMin = useErrWindow(stats?.errCount, stats?.ts);
  const series = useLiveSeries(ctx.live ? (stats?.errCount ?? 0) : null, 60);
  if (!ctx.live)
    return (
      <Text size="sm" c="dimmed">
        Active le temps réel pour compter les erreurs (ERROR + CRITIC).
      </Text>
    );
  const color = perMin >= 10 ? "red" : perMin > 0 ? "orange" : "teal";
  return (
    <Stack gap="sm">
      <Group gap="xl" align="flex-end">
        <Metric label="Erreurs / min" value={perMin} />
        <Badge variant="light" color={color}>
          {perMin === 0
            ? "aucune erreur"
            : perMin >= 10
              ? "élevé"
              : "à surveiller"}
        </Badge>
      </Group>
      {series.length >= 2 ? (
        <MiniChart
          height={130}
          format={(v) => String(Math.round(v))}
          series={[
            {
              data: series,
              color: `var(--mantine-color-${color}-6)`,
              label: "Erreurs/intervalle",
            },
          ]}
        />
      ) : (
        <Text size="xs" c="dimmed">
          En attente des premières mesures…
        </Text>
      )}
      <Text size="xs" c="dimmed">
        ERROR + CRITIC sur ~60 s (comptés serveur). Détail des messages : bloc «
        Logs (live) ».
      </Text>
    </Stack>
  );
}

/* ─────────────────────────────── registrations ──────────────────────────────── */

const SRC = {
  kind: "hybrid",
  endpoint: "/nodefony/studio/api/stats",
  channel: PLATFORM_CHANNELS.supervision,
} as const;

registerWidget<StatsPayload>({
  id: "supervision.memory",
  title: "Mémoire (espaces V8)",
  description:
    "Répartition du heap V8 par espace (jeune/vieille génération, code…) — barres used/size.",
  category: "system",
  icon: IconBoxMultiple,
  tags: ["systeme", "memoire", "panneau"],
  source: SRC,
  defaultSpan: 6,
  minSpan: 4,
  defaultH: 6,
  minH: 4,
  render: MemoryBody,
});

registerWidget<StatsPayload>({
  id: "supervision.handles",
  title: "Ressources actives",
  description:
    "Handles Node qui maintiennent la boucle active (sockets, timers, fichiers…), par type.",
  category: "system",
  icon: IconPlugConnected,
  tags: ["systeme", "handles", "liste"],
  source: SRC,
  defaultSpan: 6,
  minSpan: 4,
  defaultH: 6,
  minH: 4,
  render: HandlesBody,
});

registerWidget<StatsPayload>({
  id: "supervision.errors",
  title: "Erreurs",
  description:
    "Erreurs/min (ERROR + CRITIC) comptées serveur + courbe. Messages : bloc Logs.",
  category: "system",
  icon: IconBug,
  tags: ["erreurs", "graphe"],
  source: SRC,
  defaultSpan: 6,
  minSpan: 4,
  defaultH: 5,
  minH: 3,
  render: ErrorsBody,
});
