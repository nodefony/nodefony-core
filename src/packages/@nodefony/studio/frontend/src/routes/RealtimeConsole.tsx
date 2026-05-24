import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Code,
  Progress,
  Alert,
  Tabs,
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
  IconAlertTriangle,
  IconJson,
  IconBroadcast,
  IconUsers,
  IconPlugConnected,
  IconGauge,
  IconCircleCheck,
  IconChartLine,
  IconLayoutGrid,
} from "@tabler/icons-react";
import {
  useNodefony,
  useNodefonyState,
  useNodefonyChannel,
  useNodefonyAdaptiveChannelData,
} from "nodefony/react";
import type { RealtimeFrame, NoticeLevel } from "nodefony";
import type { ReactNode } from "react";
import { useConnection, useNotifications, useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import {
  PageHeader,
  KpiCard,
  ChartCard,
  MiniChart,
  DocHint,
  ensureLiveStyles,
} from "../components/ui";

/** Version de la doc des fiches d'aide du Hub (badge `DocHint`). */
const HUB_DOC = "v1.0";

/** Niveau de notice → couleur Mantine (incidents temps réel). */
const NOTICE_COLOR: Record<NoticeLevel, string> = {
  success: "teal",
  info: "blue",
  warning: "yellow",
  error: "red",
};

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

// ───────────────────────────────────────────────────────────────────────────
// Helpers sonde serveur (RealtimeHub.probe)
// ───────────────────────────────────────────────────────────────────────────

/** Seuil slow-consumer = miroir de `SLOW_CONSUMER_BYTES` serveur (1 MiB). */
const SLOW_CONSUMER_BYTES = 1024 * 1024;
/** Cadence désirée du canal `realtime:health` (= défaut du ticker serveur). */
const REALTIME_HEALTH_MS = 2000;
/** Profondeur d'historique des séries temporelles. */
const HEALTH_HISTORY = 40;

/**
 * Type MIROIR LOCAL de `IRealtimeHealth` (`@nodefony/framework`). NE PAS importer
 * le type serveur dans le bundle client (frontière isomorphe) → copie minimale du
 * sous-ensemble consommé. Cumuls monotones → débit dérivé côté lecteur.
 */
interface RtChannelStat {
  channel: string;
  subscribers: number;
  messages: number;
}
interface RealtimeHealth {
  ts: number;
  channels: RtChannelStat[];
  channelCount: number;
  publishTotal: number;
  fanoutTotal: number;
  inboundTotal: number;
  connectionCount: number;
  bytesSentTotal: number;
  messagesSentTotal: number;
  backpressure: {
    maxBufferedAmount: number;
    totalBufferedAmount: number;
    slowConsumers: number;
  };
}

/** Octets → texte lisible (o / Ko / Mo / Go), chasse stable (pas de churn). */
function fmtBytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${Math.round(n)} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

/** Débit : 1 décimale sous 10, entier au-delà (format stable = pas de jitter). */
function fmtRate(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

/** Cadence effective (ms) → badge lisible `~Xs` / `~Xms`. */
function fmtCadence(ms: number): string {
  if (ms >= 1000) {
    const s = ms / 1000;
    return `~${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  }
  return `~${ms}ms`;
}

/** Cadence (ms) → texte court pour l'axe du graphe AIMD. */
function fmtMs(v: number): string {
  return v >= 1000
    ? `${Number((v / 1000).toFixed(v % 1000 ? 1 : 0))}s`
    : `${Math.round(v)}ms`;
}

/**
 * Santé backpressure = 3 états (jamais binaire). Le `bufferedAmount` durablement
 * > 0 = slow-consumer → file `ws` qui grossit = risque mémoire #1. Rouge réservé
 * au vrai blocker (slow-consumers avérés) ; un buffer transitoire = « à surveiller ».
 */
function backpressureHealth(bp: RealtimeHealth["backpressure"]): {
  label: string;
  color: string;
} {
  if (bp.slowConsumers > 0) return { label: "Dégradé", color: "red" };
  if (bp.maxBufferedAmount > 0)
    return { label: "À surveiller", color: "yellow" };
  return { label: "Sain", color: "teal" };
}

/** Historiques (séries temporelles) du panneau Hub — bornés à {@link HEALTH_HISTORY}. */
interface HubHist {
  fanout: number[];
  bytes: number[];
  conn: number[];
  subs: number[];
  bpMax: number[];
  cadence: number[];
}
const EMPTY_HIST: HubHist = {
  fanout: [],
  bytes: [],
  conn: [],
  subs: [],
  bpMax: [],
  cadence: [],
};

/**
 * Petit graphe encadré (ChartCard) d'une série live — ≥ 2 points sinon placeholder
 * calme. Factorise les sparklines du Hub (fan-out, débit, cadence AIMD, connexions).
 */
function MiniSeries({
  title,
  caption,
  data,
  color,
  live,
  format,
  threshold,
  max,
  badge,
  height = 110,
}: {
  title: string;
  caption: string;
  data: number[];
  color: string;
  live: boolean;
  format?: (v: number) => string;
  threshold?: number;
  max?: number;
  badge?: ReactNode;
  height?: number;
}) {
  return (
    <ChartCard title={title} caption={caption} badge={badge}>
      {data.length > 1 ? (
        <MiniChart
          height={height}
          format={format}
          threshold={threshold}
          max={max}
          series={[{ data, color, label: title }]}
        />
      ) : (
        <Text
          c="dimmed"
          size="sm"
          py="xl"
          ta="center"
          style={{ minHeight: height }}
        >
          {live
            ? "Accumulation de l'historique…"
            : "Active la sonde temps réel pour tracer la courbe."}
        </Text>
      )}
    </ChartCard>
  );
}

/**
 * Enfant abonné au canal `realtime:health` — monté UNIQUEMENT quand la sonde est
 * ON (abonnement ref-compté → démonter désabonne → le ticker serveur s'arrête, coût
 * zéro quand OFF). Cadence suit le réglage global AIMD (`adaptive`). Remonte chaque
 * snapshot (`onSnap`) et la cadence effective (`onRate`) au parent.
 */
function HubHealthLive({
  adaptive,
  onSnap,
  onRate,
}: {
  adaptive: boolean;
  onSnap: (s: RealtimeHealth) => void;
  onRate: (ms: number) => void;
}) {
  const { data, intervalMs } = useNodefonyAdaptiveChannelData<RealtimeHealth>(
    "realtime:health",
    REALTIME_HEALTH_MS,
    { defaultMs: REALTIME_HEALTH_MS, enabled: adaptive },
  );
  useEffect(() => {
    if (data) onSnap(data);
    // onSnap stable (useCallback []) → hors deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    onRate(intervalMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
  return null;
}

/** Résultat du hook {@link useHubProbe}. */
interface HubProbe {
  snap: RealtimeHealth | null;
  rates: { fanout: number; bytes: number; publish: number };
  hist: HubHist;
  effectiveMs: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
  liveNode: ReactNode;
}

/**
 * Hook d'auto-observabilité de la Socket Nodefony côté SERVEUR (sonde
 * `RealtimeHub.probe`). `live=false` → instantané HTTP (`GET /realtime/api/health`,
 * coût zéro côté serveur) ; `live=true` → flux `realtime:health` (cadence AIMD).
 * Débit/fan-out/cadence **dérivés** du delta entre 2 snapshots à l'ARRIVÉE d'une
 * frame (jamais un `setInterval` React → 0 render parasite).
 */
function useHubProbe(live: boolean, adaptive: boolean): HubProbe {
  const store = useStore();

  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<RealtimeHealth>("/nodefony/realtime/api/health"),
    [store],
  );
  const http = useResource(fetcher);

  const [liveSnap, setLiveSnap] = useState<RealtimeHealth | null>(null);
  const [effectiveMs, setEffectiveMs] = useState(REALTIME_HEALTH_MS);
  const [rates, setRates] = useState({ fanout: 0, bytes: 0, publish: 0 });
  const [hist, setHist] = useState<HubHist>(EMPTY_HIST);
  const prevRef = useRef<{
    ts: number;
    bytes: number;
    fanout: number;
    publish: number;
  } | null>(null);
  const cadenceRef = useRef(REALTIME_HEALTH_MS);

  const onSnap = useCallback((s: RealtimeHealth) => {
    setLiveSnap(s);
    const prev = prevRef.current;
    prevRef.current = {
      ts: s.ts,
      bytes: s.bytesSentTotal,
      fanout: s.fanoutTotal,
      publish: s.publishTotal,
    };
    if (!prev) return;
    const dt = (s.ts - prev.ts) / 1000;
    if (dt <= 0) return;
    const fanout = Math.max(0, (s.fanoutTotal - prev.fanout) / dt);
    const bytes = Math.max(0, (s.bytesSentTotal - prev.bytes) / dt);
    const publish = Math.max(0, (s.publishTotal - prev.publish) / dt);
    setRates({ fanout, bytes, publish });
    const subs = s.channels.reduce((a, c) => a + c.subscribers, 0);
    setHist((h) => ({
      fanout: [...h.fanout, fanout].slice(-HEALTH_HISTORY),
      bytes: [...h.bytes, bytes].slice(-HEALTH_HISTORY),
      conn: [...h.conn, s.connectionCount].slice(-HEALTH_HISTORY),
      subs: [...h.subs, subs].slice(-HEALTH_HISTORY),
      bpMax: [...h.bpMax, s.backpressure.maxBufferedAmount].slice(
        -HEALTH_HISTORY,
      ),
      cadence: [...h.cadence, cadenceRef.current].slice(-HEALTH_HISTORY),
    }));
  }, []);

  const onRate = useCallback((ms: number) => {
    cadenceRef.current = ms;
    setEffectiveMs(ms);
  }, []);

  // Couper la sonde = reset des dérivées (pas de courbe figée trompeuse au ré-ON).
  useEffect(() => {
    if (!live) {
      prevRef.current = null;
      cadenceRef.current = REALTIME_HEALTH_MS;
      setRates({ fanout: 0, bytes: 0, publish: 0 });
      setHist(EMPTY_HIST);
      setEffectiveMs(REALTIME_HEALTH_MS);
    }
  }, [live]);

  return {
    snap: (live ? liveSnap : null) ?? http.data,
    rates,
    hist,
    effectiveMs,
    loading: http.loading,
    error: http.error,
    reload: http.reload,
    liveNode: live ? (
      <HubHealthLive adaptive={adaptive} onSnap={onSnap} onRate={onRate} />
    ) : null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// RealtimeConsole — console de supervision de la Socket Nodefony
// ───────────────────────────────────────────────────────────────────────────

/**
 * RealtimeConsole (`/nodefony/hub`) — console de **supervision** de la Socket
 * Nodefony (le différenciateur HTTP+WS co-citoyens). Organisée pour un superviseur
 * qui cherche un problème : zone TOUJOURS visible = **état global + congestion**
 * (backpressure + débit, le risque #1) ; le reste distillé en onglets (Activité /
 * Canaux / Protocole / Incidents) pour ne pas noyer l'information.
 */
export const RealtimeConsole = observer(() => {
  const client = useNodefony();
  const state = useNodefonyState();
  const conn = useConnection();
  const ui = useUi();
  const incidents = useNotifications().realtimeIncidents;

  useEffect(ensureLiveStyles, []);

  // Préférence persistée : sonde temps réel ON/OFF. ON par défaut (page de
  // SUPERVISION → on veut le live d'emblée) ; OFF seulement si choisi explicitement.
  const [live, setLiveState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("nf.hub.live") !== "0";
    } catch {
      return true;
    }
  });
  const setLive = (v: boolean) => {
    setLiveState(v);
    try {
      localStorage.setItem("nf.hub.live", v ? "1" : "0");
    } catch {
      /* quota / mode privé — préférence best-effort */
    }
  };

  const probe = useHubProbe(live, ui.adaptiveCadence);
  const { snap, rates, hist } = probe;

  // ── Protocole (frames JSON-RPC) — capture client tant que la console est ouverte.
  const [frames, setFrames] = useState<RealtimeFrame[]>([]);
  const [paused, setPaused] = useState(false);
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [open, setOpen] = useState<number | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Keepalive logs (ref-compté) → l'activité realtime reste visible même hors page.
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

  // Stats de protocole dérivées des frames (compteurs in/out + par type).
  const proto = useMemo(() => {
    const byKind: Record<string, number> = {};
    let inN = 0;
    let outN = 0;
    for (const f of frames) {
      byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      if (f.dir === "in") inN += 1;
      else outN += 1;
    }
    return {
      total: frames.length,
      inN,
      outN,
      byKind: Object.entries(byKind).sort((a, b) => b[1] - a[1]),
      last: frames.length ? frames[frames.length - 1].ts : 0,
    };
  }, [frames]);

  const online = state === "connected";
  const subs = [...conn.activeSubscriptions.values()];
  const shown = dir === "all" ? frames : frames.filter((f) => f.dir === dir);
  const recent = shown.slice(-150);

  // ── Dérivés sonde (avec gardes si pas encore de snapshot).
  const bp = snap?.backpressure ?? null;
  const bpHealth = bp ? backpressureHealth(bp) : { label: "—", color: "gray" };
  const bpPct = bp
    ? Math.min(100, (bp.maxBufferedAmount / SLOW_CONSUMER_BYTES) * 100)
    : 0;
  const bpColorVar = `var(--mantine-color-${bpHealth.color}-6)`;
  const totalSubs = snap
    ? snap.channels.reduce((a, c) => a + c.subscribers, 0)
    : 0;
  const channels = snap
    ? [...snap.channels].sort((a, b) => b.subscribers - a.subscribers)
    : [];

  const congestionMsg = bp
    ? bp.slowConsumers > 0
      ? `${bp.slowConsumers} consommateur(s) lent(s) : file d'envoi > ${fmtBytes(SLOW_CONSUMER_BYTES)} → la mémoire du process grimpe. Risque #1 du multiplexing (un client lent peut bloquer tous ses canaux).`
      : bp.maxBufferedAmount > 0
        ? `Début de congestion : ${fmtBytes(bp.maxBufferedAmount)} en attente d'envoi sur la connexion la plus lente (seuil ${fmtBytes(SLOW_CONSUMER_BYTES)}). À surveiller.`
        : `Aucune congestion : les ${snap?.connectionCount ?? 0} connexion(s) reçoivent en temps réel (0 octet en attente).`
    : "Sonde du Hub en lecture…";

  // ── État GLOBAL : la connexion d'observation prime (sans elle, pas de supervision).
  const overall = !online
    ? {
        color: state === "error" ? "red" : "yellow",
        label:
          state === "error"
            ? "Erreur"
            : state === "reconnecting"
              ? "Reconnexion…"
              : state === "connecting"
                ? "Connexion…"
                : "Hors ligne",
        Icon: IconAlertTriangle,
        msg: "La socket d'observation n'est pas connectée — supervision indisponible.",
      }
    : snap
      ? {
          color: bpHealth.color,
          label: bpHealth.label,
          Icon: bpHealth.color === "teal" ? IconCircleCheck : IconAlertTriangle,
          msg: `${congestionMsg} ${totalSubs} abonné(s) sur ${snap.channelCount} canal(aux)${live ? `, diffusion ${fmtRate(rates.fanout)}/s` : ""}.`,
        }
      : {
          color: "gray",
          label: "—",
          Icon: IconActivityHeartbeat,
          msg: "Lecture de la sonde du Hub…",
        };

  return (
    <Stack gap="lg">
      <PageHeader
        sticky
        title="Realtime Hub"
        subtitle="Supervision de la Socket Nodefony — congestion, canaux, protocole"
        actions={
          <>
            <Group gap={4} wrap="nowrap">
              <Switch
                size="sm"
                checked={ui.adaptiveCadence}
                onChange={(e) => ui.setAdaptiveCadence(e.currentTarget.checked)}
                label="Cadence auto (AIMD)"
                aria-label="cadence adaptative automatique globale de la socket Nodefony"
              />
              <DocHint
                title="Cadence auto (AIMD)"
                version={HUB_DOC}
                summary="Politique GLOBALE de cadence adaptative de la Socket, façon « ABR » des vidéos en streaming."
                sections={[
                  {
                    label: "Principe",
                    body: "La Socket surveille le rythme RÉEL d'arrivée sur chaque canal d'état ; si le serveur prend du retard (surcharge), elle RALENTIT seule la cadence (comme une vidéo qui baisse sa qualité), puis RÉACCÉLÈRE quand c'est fluide.",
                  },
                  {
                    label: "Algorithme",
                    body: "AIMD (Additive Increase / Multiplicative Decrease), client-driven — le même principe que le contrôle de congestion TCP.",
                  },
                  {
                    label: "Voir",
                    body: "Onglet Activité → graphe « Cadence (AIMD) » : la courbe monte sous charge puis redescend.",
                  },
                ]}
              />
            </Group>
            <Group gap={4} wrap="nowrap">
              <Switch
                size="sm"
                checked={live}
                onChange={(e) => setLive(e.currentTarget.checked)}
                label="Sonde temps réel"
                aria-label="activer la sonde temps réel du Hub"
              />
              <DocHint
                title="Sonde temps réel"
                version={HUB_DOC}
                summary="Active le flux live de la sonde du Hub (canal realtime:health) → les courbes deviennent vivantes."
                sections={[
                  {
                    label: "ON",
                    body: "Abonnement live ref-compté : congestion, débit, diffusion et cadence se tracent dans le temps.",
                  },
                  {
                    label: "OFF",
                    body: "Un instantané HTTP (bouton Actualiser), coût ZÉRO côté serveur (aucun ticker).",
                  },
                ]}
              />
            </Group>
            {!live && (
              <Button
                size="xs"
                variant="light"
                color="gray"
                leftSection={<IconReload size={14} />}
                loading={probe.loading}
                onClick={probe.reload}
              >
                Actualiser
              </Button>
            )}
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

      {/* Intro brandée : ce qu'EST « la Socket Nodefony » (le différenciateur). */}
      <Group gap={8} align="center" wrap="nowrap">
        <IconBroadcast
          size={18}
          stroke={1.6}
          color="var(--mantine-color-brand-filled)"
        />
        <Text size="sm" c="dimmed">
          <Text span fw={700} c="brand">
            La Socket Nodefony
          </Text>{" "}
          — une seule prise temps réel où HTTP et WebSocket sont co-citoyens. Le{" "}
          <b>Hub</b> y multiplexe N <b>canaux</b> et les <b>diffuse</b> à tous
          les clients abonnés. Ce panneau l'observe elle-même.
        </Text>
        <DocHint
          title="La Socket Nodefony"
          version={HUB_DOC}
          summary="Le différenciateur du framework : UNE prise temps réel, isomorphe (même API navigateur ET serveur), où HTTP et WebSocket cohabitent nativement."
          sections={[
            {
              label: "Le Hub",
              body: "« Le Hub » (RealtimeHub) est le central téléphonique : chaque client (ton navigateur, la debug bar, d'autres onglets ou pods) ouvre 1 socket et s'abonne à des CANAUX (syslog:stream = logs, realtime:health = cette sonde, dashboard:supervision = stats process…).",
            },
            {
              label: "Diffusion",
              body: "Quand quelque chose PUBLIE sur un canal, le Hub le DIFFUSE (fan-out) à tous ses abonnés — c'est le multiplexage de N canaux sur 1 socket.",
            },
            {
              label: "Pluggable",
              body: "Le tuyau de chaque canal est interchangeable : pub/sub, pont TCP/UDP, encapsulation SIP, fan-out Redis entre pods.",
            },
            {
              label: "Cloud-native",
              body: "Ce panneau = la Socket qui s'observe via sa propre sonde (clients / canaux / abonnés / débit / congestion). Vue par process-pod ; l'agrégat multi-pod = Prometheus / Redis (P13).",
            },
          ]}
        />
      </Group>

      {/* ═══ ZONE TOUJOURS VISIBLE — état + congestion (le 1er regard du superviseur) ═══ */}

      <Alert
        variant="light"
        color={overall.color}
        icon={<overall.Icon size={18} />}
        title={`État du Hub : ${overall.label}`}
      >
        {overall.msg}
      </Alert>

      {/* Sonde OFF → un SEUL message clair (au lieu de « — » éparpillés) :
          l'état/les compteurs viennent de l'instantané HTTP ; débits et courbes
          demandent le flux live. */}
      {!live && (
        <Alert
          variant="light"
          color="gray"
          icon={<IconActivityHeartbeat size={18} />}
          title="Vue instantanée — sonde temps réel désactivée"
        >
          Les compteurs ci-dessous (connexions, canaux, abonnés, congestion
          actuelle) viennent d'un <b>instantané HTTP</b>. Les <b>débits</b>{" "}
          (diffusion/s, octets/s) et les <b>courbes</b> ont besoin du flux live
          : active « Sonde temps réel » en haut à droite. Le bouton « Actualiser
          » rafraîchit l'instantané.
        </Alert>
      )}

      {/* KPIs essentiels */}
      <Grid>
        <KpiCard
          icon={<IconPlugConnected size={20} />}
          label="Connexions"
          value={snap?.connectionCount ?? "—"}
          pulse={live}
          accent="teal"
          info={
            <DocHint
              title="Connexions"
              version={HUB_DOC}
              summary="Sockets WebSocket vivantes connectées au Hub sur ce process — c'est à elles que le Hub envoie."
              sections={[
                {
                  label: "Maintenant",
                  body: snap
                    ? `${snap.connectionCount} client(s) connecté(s)${live ? `, débit sortant ${fmtBytes(rates.bytes)}/s` : ""}. ${fmtBytes(snap.bytesSentTotal)} envoyés depuis le démarrage.`
                    : "Lecture de la sonde…",
                },
                {
                  label: "Technique",
                  body: "1 client = 1 socket (navigateur, debug bar, autre onglet ou pod). Le « débit sortant » est la somme des octets/s poussés vers toutes ces connexions.",
                },
                {
                  label: "Si 0",
                  body: "Aucun client connecté → le Hub n'envoie rien (débit 0).",
                },
              ]}
            />
          }
          footer={
            <Badge size="sm" variant="light" color="teal">
              {live
                ? `${fmtBytes(rates.bytes)}/s`
                : snap
                  ? `${fmtBytes(snap.bytesSentTotal)} cumul`
                  : "—"}
            </Badge>
          }
        />
        <KpiCard
          icon={<IconUsers size={20} />}
          label="Abonnés"
          value={snap ? totalSubs : "—"}
          pulse={live}
          accent="grape"
          info={
            <DocHint
              title="Abonnés"
              version={HUB_DOC}
              summary="Nombre d'abonnements actifs, tous canaux et tous clients confondus."
              sections={[
                {
                  label: "Maintenant",
                  body: snap
                    ? `${totalSubs} abonnement(s) sur ${snap.channelCount} canal(aux).`
                    : "Lecture de la sonde…",
                },
                {
                  label: "Technique",
                  body: "Un client peut s'abonner à plusieurs canaux → abonnés ≥ connexions. Le détail par canal est dans l'onglet Canaux.",
                },
                {
                  label: "Si 0",
                  body: "Personne n'est abonné → aucun canal actif, donc aucune diffusion.",
                },
              ]}
            />
          }
          footer={
            <Badge size="sm" variant="light" color="grape">
              {snap?.channelCount ?? 0} canal(aux)
            </Badge>
          }
        />
        <KpiCard
          icon={<IconArrowsExchange size={20} />}
          label="Diffusion"
          value={live ? `${fmtRate(rates.fanout)}/s` : "—"}
          pulse={live}
          accent="blue"
          info={
            <DocHint
              title="Diffusion (fan-out)"
              version={HUB_DOC}
              summary="Livraisons par seconde = publications × abonnés. Le vrai coût du broker."
              sections={[
                {
                  label: "Maintenant",
                  body: live
                    ? rates.fanout === 0
                      ? "0 livraison/s : aucun canal ne publie, ou aucun abonné."
                      : `${fmtRate(rates.fanout)} livraison(s)/s = publications (${fmtRate(rates.publish)}/s) × abonnés (${totalSubs}).`
                    : `Sonde OFF — seul le cumul est connu${snap ? ` : ${snap.fanoutTotal.toLocaleString()} livraisons.` : "."}`,
                },
                {
                  label: "Technique",
                  body: "Dérivé du delta entre 2 snapshots (cumul monotone). « fan-out » = terme anglais. 1 publication sur un canal à N abonnés = N livraisons.",
                },
                {
                  label: "Mesure",
                  body: "Nécessite le flux live (sonde ON) : un débit se calcule entre 2 points dans le temps.",
                },
              ]}
            />
          }
          footer={
            live ? (
              <Badge size="sm" variant="light" color="blue">
                {fmtRate(rates.publish)} publish/s
              </Badge>
            ) : (
              <Badge size="sm" variant="light" color="gray">
                live requis
              </Badge>
            )
          }
        />
        <KpiCard
          icon={<IconGauge size={20} />}
          label="Backpressure"
          value={bp ? fmtBytes(bp.maxBufferedAmount) : "—"}
          pulse={live}
          accent={bpHealth.color}
          info={
            <DocHint
              title="Backpressure"
              version={HUB_DOC}
              summary="Octets en file d'attente d'ENVOI vers les clients (ws.bufferedAmount) — le signal #1 de congestion."
              sections={[
                {
                  label: "Maintenant",
                  body: bp
                    ? bp.slowConsumers > 0
                      ? `${bp.slowConsumers} client(s) trop lent(s), jusqu'à ${fmtBytes(bp.maxBufferedAmount)} coincés en mémoire.`
                      : bp.maxBufferedAmount > 0
                        ? `${fmtBytes(bp.maxBufferedAmount)} en attente (début de congestion).`
                        : "0 octet en attente — tout le monde reçoit en temps réel."
                    : "Lecture de la sonde…",
                },
                {
                  label: "Technique",
                  body: `Grossit quand un client lit moins vite que le Hub ne pousse : sa file s'accumule en mémoire → risque mémoire #1 (le multiplexing concentre : 1 client lent bloque tous ses canaux). Seuil consommateur lent = ${fmtBytes(SLOW_CONSUMER_BYTES)}.`,
                },
                {
                  label: "Si 0",
                  body: "Sain : sur réseau rapide avec des clients qui lisent, rien ne s'accumule. Ça bouge en prod (mobile / réseau lent).",
                },
              ]}
            />
          }
          footer={
            <Badge size="sm" variant="light" color={bpHealth.color}>
              {bp ? `${bp.slowConsumers} lent(s)` : "—"}
            </Badge>
          }
        />
      </Grid>

      {/* Graphes de CONGESTION (le cœur de la supervision) */}
      <Grid>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Card withBorder radius="md" p="lg" h="100%">
            <Group justify="space-between" mb="xs" wrap="nowrap">
              <Group gap={6}>
                <IconGauge size={20} stroke={1.5} />
                <Title order={5}>Backpressure — congestion d'envoi</Title>
                <DocHint
                  title="Backpressure — congestion d'envoi"
                  version={HUB_DOC}
                  summary="Octets en file d'attente d'ENVOI vers les clients (ws.bufferedAmount), pas encore partis sur le réseau."
                  sections={[
                    {
                      label: "Lecture",
                      body: `À 0 = tout le monde reçoit en temps réel. La courbe est à l'échelle du seuil (${fmtBytes(SLOW_CONSUMER_BYTES)}) ; la zone rouge = danger.`,
                    },
                    {
                      label: "Technique",
                      body: "Monte quand un client lit moins vite que le Hub ne pousse : sa file s'accumule en mémoire → SEUL vrai risque mémoire du temps réel.",
                    },
                    {
                      label: "En conditions réelles",
                      body: "Sur loopback rapide ça reste 0 ; ça bouge en prod (clients mobiles / réseau lent). Démo : skill nodefony-load-test, MODE=slow.",
                    },
                  ]}
                />
              </Group>
              <Badge variant="light" color={bpHealth.color} size="lg">
                {bpHealth.label}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mb="sm">
              {bp && bp.maxBufferedAmount === 0 && bp.slowConsumers === 0
                ? "File d'envoi à 0 sur toutes les connexions : aucune congestion. La courbe monterait vers la zone rouge si un client devenait trop lent à lire."
                : congestionMsg}
            </Text>
            {hist.bpMax.length > 1 ? (
              <MiniChart
                height={110}
                format={fmtBytes}
                max={SLOW_CONSUMER_BYTES}
                threshold={SLOW_CONSUMER_BYTES}
                series={[
                  {
                    data: hist.bpMax,
                    color: bpColorVar,
                    label: "pire file d'envoi",
                  },
                ]}
              />
            ) : (
              <Text
                c="dimmed"
                size="sm"
                py="lg"
                ta="center"
                style={{ minHeight: 110 }}
              >
                {live
                  ? "File d'envoi à 0 — rien à tracer (sain)."
                  : "Active la sonde temps réel pour suivre la file d'envoi dans le temps."}
              </Text>
            )}
            <Progress
              value={bpPct}
              color={bpHealth.color}
              size="lg"
              radius="sm"
              mt="sm"
              striped={!!bp && bp.slowConsumers > 0}
              animated={!!bp && bp.slowConsumers > 0}
              aria-label={`backpressure : ${Math.round(bpPct)} % du seuil consommateur lent`}
            />
            <Grid mt="md">
              <Grid.Col span={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Pire file
                </Text>
                <Text fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmtBytes(bp?.maxBufferedAmount)}
                </Text>
              </Grid.Col>
              <Grid.Col span={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Total en attente
                </Text>
                <Text fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmtBytes(bp?.totalBufferedAmount)}
                </Text>
              </Grid.Col>
              <Grid.Col span={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Slow-consumers
                </Text>
                <Text
                  fw={700}
                  c={bp && bp.slowConsumers > 0 ? "red" : undefined}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {bp?.slowConsumers ?? "—"}
                </Text>
              </Grid.Col>
            </Grid>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <ChartCard
            title="Débit sortant"
            caption={`Octets/s envoyés par le hub${live ? ` — actuel ${fmtBytes(rates.bytes)}/s` : " — active la sonde"}`}
            badge={
              <DocHint
                title="Débit sortant"
                version={HUB_DOC}
                summary={`Octets/s que le Hub envoie à ses ${snap?.connectionCount ?? 0} connexion(s) WS (la somme de tous les clients).`}
                sections={[
                  {
                    label: "Effet observateur",
                    body: "Au repos, c'est surtout TOI qui reçois : la sonde (realtime:health), la debug bar et les logs te poussent leurs flux.",
                  },
                  {
                    label: "Sous charge",
                    body: "Grimpe avec le nombre de clients abonnés (250 abonnés ⇒ ~250× le débit d'un seul).",
                  },
                  {
                    label: "Mesure",
                    body: "Dérivé du delta de bytesSentTotal entre 2 snapshots (sonde ON requise).",
                  },
                ]}
              />
            }
          >
            {hist.bytes.length > 1 ? (
              <MiniChart
                height={110}
                format={fmtBytes}
                series={[
                  {
                    data: hist.bytes,
                    color: "var(--mantine-color-teal-6)",
                    label: "octets/s",
                  },
                ]}
              />
            ) : (
              <Text
                c="dimmed"
                size="sm"
                py="xl"
                ta="center"
                style={{ minHeight: 110 }}
              >
                {live
                  ? "Accumulation de l'historique…"
                  : "Active la sonde temps réel pour le débit."}
              </Text>
            )}
          </ChartCard>
        </Grid.Col>
      </Grid>

      {/* ═══ DÉTAIL EN ONGLETS — rendus VISIBLES (intitulé + pills pleine largeur,
          variant segmented + couleur marque sur l'actif) ═══ */}
      <Stack gap="xs">
        <Group gap={6} align="center">
          <IconLayoutGrid size={18} stroke={1.6} />
          <Title order={5}>Détails du Hub</Title>
          <Text size="xs" c="dimmed">
            — 4 vues : clique un onglet
          </Text>
        </Group>
        <Tabs
          defaultValue="activite"
          variant="pills"
          color="brand"
          radius="md"
          keepMounted={false}
        >
          <Tabs.List grow mb="md">
            <Tabs.Tab
              value="activite"
              leftSection={<IconChartLine size={16} />}
            >
              Activité
            </Tabs.Tab>
            <Tabs.Tab
              value="canaux"
              leftSection={<IconStack2 size={16} />}
              rightSection={
                <Badge size="xs" variant="light" color="gray" circle>
                  {snap?.channelCount ?? 0}
                </Badge>
              }
            >
              Canaux
            </Tabs.Tab>
            <Tabs.Tab
              value="protocole"
              leftSection={<IconArrowsExchange size={16} />}
              rightSection={
                <Badge size="xs" variant="light" color="gray" circle>
                  {proto.total}
                </Badge>
              }
            >
              Protocole
            </Tabs.Tab>
            <Tabs.Tab
              value="incidents"
              leftSection={<IconAlertTriangle size={16} />}
              rightSection={
                incidents.length > 0 ? (
                  <Badge size="xs" variant="light" color="red" circle>
                    {incidents.length}
                  </Badge>
                ) : undefined
              }
            >
              Incidents
            </Tabs.Tab>
          </Tabs.List>

          {/* ── Activité : graphes secondaires + cadence AIMD ── */}
          <Tabs.Panel value="activite" pt="md">
            <Grid>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <MiniSeries
                  title="Diffusion"
                  caption={`Livraisons/s = publications × abonnés (« fan-out »)${live ? ` — actuel ${fmtRate(rates.fanout)}/s` : ""}`}
                  data={hist.fanout}
                  color="var(--mantine-color-blue-6)"
                  live={live}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <MiniSeries
                  title="Cadence (AIMD)"
                  caption={
                    ui.adaptiveCadence
                      ? "Cadence réelle du canal realtime:health. Cadence auto ON : elle RECULE sous charge (le serveur prend du retard) puis revient quand c'est fluide. Plus haut = plus lent."
                      : "Cadence réelle du canal realtime:health. Cadence auto OFF → courbe plate (cadence fixe). Active « Cadence auto (AIMD) » en tête de page pour la voir s'adapter sous charge."
                  }
                  badge={
                    <Badge
                      size="xs"
                      variant="light"
                      color={ui.adaptiveCadence ? "blue" : "gray"}
                    >
                      {ui.adaptiveCadence ? "auto" : "fixe"}
                    </Badge>
                  }
                  data={hist.cadence}
                  color="var(--mantine-color-grape-6)"
                  format={fmtMs}
                  live={live}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <MiniSeries
                  title="Connexions"
                  caption={`Connexions realtime vivantes (WS)${live ? ` — actuel ${snap?.connectionCount ?? 0}` : ""}`}
                  data={hist.conn}
                  color="var(--mantine-color-cyan-6)"
                  live={live}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <MiniSeries
                  title="Abonnés"
                  caption={`Abonnés cumulés tous canaux${live ? ` — actuel ${totalSubs}` : ""}`}
                  data={hist.subs}
                  color="var(--mantine-color-grape-6)"
                  live={live}
                />
              </Grid.Col>
            </Grid>
          </Tabs.Panel>

          {/* ── Canaux : vue serveur (hub) + abonnements de cette console ── */}
          <Tabs.Panel value="canaux" pt="md">
            <Stack gap="md">
              <Card withBorder radius="md" p="lg">
                <Group gap={6} mb="md">
                  <IconBroadcast size={20} stroke={1.5} />
                  <Title order={5}>Canaux du Hub</Title>
                  <Text size="xs" c="dimmed">
                    {snap && snap.channelCount > 0
                      ? `${snap.channelCount} actif(s) — tous clients de ce process`
                      : "aucun canal actif"}
                  </Text>
                  <DocHint
                    title="Canaux du Hub"
                    version={HUB_DOC}
                    summary="Vue SERVEUR : tous les canaux du hub avec leurs abonnés (tous clients confondus) et leurs publications cumulées."
                    sections={[
                      {
                        label: "≠ Mes abonnements",
                        body: "« Mes abonnements » (ci-dessous) = ce que cette console consomme ; ici = ce que voit le serveur pour tous les clients.",
                      },
                    ]}
                  />
                </Group>
                {channels.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    Aucun canal actif sur le hub (aucun abonné).
                  </Text>
                ) : (
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Canal</Table.Th>
                        <Table.Th w={120}>Abonnés</Table.Th>
                        <Table.Th w={160}>Publications</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {channels.map((c) => (
                        <Table.Tr key={c.channel}>
                          <Table.Td>
                            <Code>{c.channel}</Code>
                          </Table.Td>
                          <Table.Td
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {c.subscribers}
                          </Table.Td>
                          <Table.Td
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {c.messages.toLocaleString()}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>

              <Card withBorder radius="md" p="lg">
                <Group gap={6} mb="md">
                  <IconStack2 size={20} stroke={1.5} />
                  <Title order={5}>Mes abonnements</Title>
                  <Text size="xs" c="dimmed">
                    {subs.length > 0
                      ? `${subs.length} canal(aux) — ce que cette console consomme`
                      : "aucun canal actif"}
                  </Text>
                </Group>
                {subs.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    Aucun canal actif. Ouvre un dashboard ou les logs pour
                    t'abonner.
                  </Text>
                ) : (
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Canal</Table.Th>
                        <Table.Th>Protocole</Table.Th>
                        <Table.Th>Transport</Table.Th>
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
                            <Badge size="xs" variant="light" color="grape">
                              {s.protocol ?? "json-rpc-2.0"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <Badge size="xs" variant="light" color="gray">
                                {s.transport ?? "ws"}
                              </Badge>
                              {s.peer && (
                                <Text size="xs" c="dimmed">
                                  {s.peer}
                                </Text>
                              )}
                            </Group>
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
            </Stack>
          </Tabs.Panel>

          {/* ── Protocole : stats + log de frames JSON-RPC ── */}
          <Tabs.Panel value="protocole" pt="md">
            <Stack gap="md">
              {/* Stats de protocole */}
              <Grid>
                <KpiCard
                  icon={<IconJson size={20} />}
                  label="Frames capturées"
                  value={proto.total}
                  accent="grape"
                  hint="Frames du protocole JSON-RPC 2.0 enregistrées tant que cette console est ouverte (ring borné à 300)."
                  footer={
                    <Badge size="sm" variant="light" color="gray">
                      {proto.last
                        ? `dernière ${clock(proto.last)}`
                        : "en attente"}
                    </Badge>
                  }
                />
                <KpiCard
                  icon={<IconArrowDown size={20} />}
                  label="Entrantes (↓ in)"
                  value={proto.inN}
                  accent="teal"
                  hint="Frames reçues du serveur (réponses, notifications de canal, welcome, erreurs poussées)."
                />
                <KpiCard
                  icon={<IconArrowUp size={20} />}
                  label="Sortantes (↑ out)"
                  value={proto.outN}
                  accent="blue"
                  hint="Frames envoyées au serveur (subscribe/unsubscribe, requêtes RPC, ping)."
                />
                <KpiCard
                  icon={<IconClock size={20} />}
                  label="Session"
                  value={<SessionUptime connectedAt={conn.connectedAt} />}
                  accent="gray"
                  hint="Durée depuis la dernière connexion réussie de la socket."
                />
              </Grid>

              {/* Répartition par type de frame */}
              <Card withBorder radius="md" p="md">
                <Group gap={6} mb="xs">
                  <Text size="sm" fw={600}>
                    Par type
                  </Text>
                  <DocHint
                    title="Frames par type"
                    version={HUB_DOC}
                    summary="Répartition des frames JSON-RPC par nature."
                    sections={[
                      {
                        label: "Types",
                        body: "request (avec id, attend une réponse), response/result, notification (pub/sub, sans id), error, welcome (handshake).",
                      },
                    ]}
                  />
                </Group>
                {proto.byKind.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    Aucune frame encore capturée.
                  </Text>
                ) : (
                  <Group gap="xs">
                    {proto.byKind.map(([kind, count]) => (
                      <Badge
                        key={kind}
                        size="md"
                        variant="light"
                        color={kind === "error" ? "red" : "gray"}
                      >
                        {kind} : {count}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Card>

              {/* Log protocole (inspecteur de frames) */}
              <Card withBorder radius="md" p="lg">
                <Group justify="space-between" mb="md" wrap="wrap">
                  <Group gap={6}>
                    <IconArrowsExchange size={20} stroke={1.5} />
                    <Title order={5}>Log protocole</Title>
                    <Badge
                      size="sm"
                      variant="light"
                      color="gray"
                      leftSection={<IconJson size={12} />}
                      title="Protocole de la socket"
                    >
                      JSON-RPC 2.0
                    </Badge>
                    <Text size="xs" c="dimmed">
                      secrets redactés
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
                      En attente de frames… (l'activité réseau apparaît ici en
                      direct)
                    </Text>
                  </Group>
                ) : (
                  <ScrollArea h={420} type="auto" offsetScrollbars>
                    <Stack gap={0}>
                      {recent
                        .slice()
                        .reverse()
                        .map((f, i) => {
                          const idx = recent.length - 1 - i;
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
                                  borderBottom:
                                    "1px solid var(--mantine-color-default-border)",
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
                                  <IconArrowUp
                                    size={14}
                                    color="var(--mantine-color-blue-6)"
                                  />
                                ) : (
                                  <IconArrowDown
                                    size={14}
                                    color="var(--mantine-color-teal-6)"
                                  />
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
                                  <Code style={{ flexShrink: 0 }}>
                                    {f.channel}
                                  </Code>
                                )}
                                {f.id !== undefined && (
                                  <Text size="xs" c="dimmed">
                                    #{f.id}
                                  </Text>
                                )}
                              </Group>
                              {isOpen && (
                                <Code
                                  block
                                  style={{ fontSize: 11, margin: "2px 0 6px" }}
                                >
                                  {JSON.stringify(f.payload, null, 2)}
                                </Code>
                              )}
                            </div>
                          );
                        })}
                    </Stack>
                  </ScrollArea>
                )}
              </Card>
            </Stack>
          </Tabs.Panel>

          {/* ── Incidents : historique borné des notices normalisées ── */}
          <Tabs.Panel value="incidents" pt="md">
            <Card withBorder radius="md" p="lg">
              <Group gap={6} mb="md">
                <IconAlertTriangle size={20} stroke={1.5} />
                <Title order={5}>Incidents temps réel</Title>
                <Text size="xs" c="dimmed">
                  {incidents.length > 0
                    ? `${incidents.length} — criticités & erreurs serveur`
                    : "criticités & erreurs serveur"}
                </Text>
              </Group>
              {incidents.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Aucun incident. Apparaît ici sur coupure/erreur du temps réel
                  ou erreur serveur poussée (test dev :{" "}
                  <Code>nodefonyNotify("error", "test")</Code>).
                </Text>
              ) : (
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={90}>Niveau</Table.Th>
                      <Table.Th>Message</Table.Th>
                      <Table.Th w={90}>Source</Table.Th>
                      <Table.Th w={70}>Code</Table.Th>
                      <Table.Th w={110}>Heure</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {incidents.slice(0, 30).map((n, i) => (
                      <Table.Tr key={`${n.ts}-${i}`}>
                        <Table.Td>
                          <Badge
                            size="xs"
                            variant="light"
                            color={NOTICE_COLOR[n.level]}
                          >
                            {n.level}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{n.message}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="outline" color="gray">
                            {n.source}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{n.code ?? "—"}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {new Date(n.ts).toLocaleTimeString()}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
          </Tabs.Panel>
        </Tabs>
      </Stack>

      {probe.liveNode}
    </Stack>
  );
});

/** Uptime de session qui tique en interne (1s) — isolé pour ne PAS re-render le
 *  reste de la console chaque seconde (perf : seul ce petit composant se met à jour). */
function SessionUptime({ connectedAt }: { connectedAt: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text fw={700} size="xl" style={{ fontVariantNumeric: "tabular-nums" }}>
      {connectedAt ? uptimeStr(Date.now() - connectedAt) : "—"}
    </Text>
  );
}

export default RealtimeConsole;
