/**
 * **TraceView** — page **pleine** « Suivi de requête » : reconstitue le cycle de
 * vie complet d'UNE requête / connexion à partir de tous ses logs corrélés par
 * `requestId` (ALS). Layout console standard (topbar de mode + onglets, Accueil
 * d'abord) — même ergonomie que Logs / ORM / Cluster.
 *
 * Onglets ORM / Sécurité = **préparés pour la vision** (cf mémoire
 * `project_request_tracking_page_vision`) : aujourd'hui ils surfacent les logs
 * corrélés qui s'y rapportent ; demain, les requêtes SQL du profiler ALS et les
 * décisions du firewall y seront enrichies.
 *
 * Données : `GET /nodefony/syslog/api/logs/search?requestId=…&order=asc`. Rendu
 * 100 % TEXTE (aucun HTML injecté). La classification d'étape vient du core
 * (`pduFlowStep` via `describeFlow`) → identique au filtre back.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Grid,
  Group,
  ScrollArea,
  Stack,
  Text,
  Timeline,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowsLeftRight,
  IconClock,
  IconCode,
  IconDatabase,
  IconHome,
  IconInfoCircle,
  IconListDetails,
  IconRefresh,
  IconRoute2,
  IconShieldLock,
  IconTimeline,
  IconWorld,
} from "@tabler/icons-react";
import { pduProtocol } from "nodefony";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import {
  TabbedPage,
  StatusBar,
  StatCard,
  DataState,
  JsonViewer,
  DocHint,
  KeyValue,
  DefinitionList,
  type StatusSegment,
} from "../components/ui";
import { ansiToReact } from "../utils/ansiToReact";
import type { LogRecord, LogQueryResult } from "./logs/logsTypes";
import { describeFlow } from "./logs/eventFlow";
import {
  fmtClock,
  fmtDateTime,
  fmtMillis,
  recordMessage,
} from "./logs/logFormat";
import { SeverityBadge } from "./logs/LogVisuals";
import { WsTracePanel } from "./logs/wsTrace";
import {
  PhaseWaterfall,
  ProfileMeta,
  QueryTable,
  fmtMs,
} from "./logs/profileVisuals";
import type { ProfileEntry } from "../stores/ProfilerStore";
import { CategoryBadge, OutcomeBadge } from "./audit/auditFormat";
import type { AuditPage } from "./audit/auditModel";

const TRACE_DOC = "v1.0";

/** Accent (bordure gauche) d'un événement d'audit selon son issue. */
const OUTCOME_ACCENT: Record<string, string> = {
  success: "teal",
  failure: "orange",
  denied: "red",
};

/** Infos extraites de la ligne-bilan `req` (`METHOD  STATUS URL DURÉE IP [id]`). */
interface ReqInfo {
  method?: string;
  status?: number;
  url?: string;
  path?: string;
  durationMs?: string;
  ip?: string;
}

/** Parse défensif de la ligne `req` — chaque champ est best-effort. */
function parseReqLine(line: string): ReqInfo {
  const out: ReqInfo = {};
  const method = line.match(/^\s*([A-Z]{3,7})\b/);
  if (method) out.method = method[1];
  // Statut = 1er nombre à 3 chiffres APRÈS la méthode (évite de matcher l'IP).
  const status = line.match(/^\s*[A-Z]+\s+(\d{3})\b/);
  if (status) out.status = Number(status[1]);
  const url = line.match(/(https?:\/\/[^\s]+)/i);
  if (url) {
    out.url = url[1];
    try {
      out.path = new URL(url[1]).pathname;
    } catch {
      /* url non parsable — on garde l'URL brute */
    }
  }
  const dur = line.match(/(\d+(?:\.\d+)?\s?m?s)\b/);
  if (dur) out.durationMs = dur[1];
  const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (ip) out.ip = ip[1];
  return out;
}

/** Couleur de statut HTTP (2xx ok, 3xx info, 4xx warn, 5xx danger). */
function statusColor(status?: number): string {
  if (!status) return "gray";
  if (status < 300) return "teal";
  if (status < 400) return "blue";
  if (status < 500) return "yellow";
  return "red";
}

/** Durée lisible entre deux timestamps (ms → ms/s). */
function fmtDelta(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Une ligne compacte de log (réutilisée par Chronologie / ORM / Sécurité). */
function LogLine({ row, baseTs }: { row: LogRecord; baseTs: number }) {
  const flow = describeFlow(row);
  return (
    <Group
      gap={6}
      wrap="nowrap"
      align="flex-start"
      style={{ padding: "1px 4px" }}
    >
      <Text
        size="xs"
        c="dimmed"
        ff="monospace"
        style={{ flexShrink: 0, opacity: 0.6, minWidth: 46 }}
      >
        #{row.uid}
      </Text>
      <Text
        size="xs"
        c="dimmed"
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {fmtClock(row.timeStamp)}.{fmtMillis(row.timeStamp)}
      </Text>
      <Text
        size="xs"
        c="dimmed"
        style={{
          flexShrink: 0,
          minWidth: 56,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        +{row.timeStamp - baseTs}ms
      </Text>
      <SeverityBadge severity={row.severityName} size="xs" />
      {flow && (
        <Badge
          size="xs"
          variant="light"
          color={flow.color}
          style={{ flexShrink: 0 }}
        >
          {flow.label}
        </Badge>
      )}
      <Text size="xs" style={{ wordBreak: "break-word" }}>
        {ansiToReact(recordMessage(row))}
      </Text>
    </Group>
  );
}

/** Liste scrollable de logs (mono). */
function LogList({ rows, baseTs }: { rows: LogRecord[]; baseTs: number }) {
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 6,
      }}
    >
      <ScrollArea.Autosize
        mah={520}
        styles={{
          viewport: {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          },
        }}
      >
        <Stack gap={0} p={6}>
          {rows.map((r) => (
            <LogLine key={`${r.uid}-${r.timeStamp}`} row={r} baseTs={baseTs} />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}

export const TraceView = observer(() => {
  const store = useStore();
  const { requestId = "" } = useParams<{ requestId: string }>();
  const [tab, setTab] = useState("accueil");

  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<LogQueryResult>(
        // `scope=trace` → le backend relit le driver à rétention LONGUE (JSONL
        // persistant en dev, driver persistant actif en prod) au lieu du ring
        // mémoire volatile : sinon la trace d'une requête vue il y a quelques
        // minutes est souvent évincée par le trafic data-plane de Studio.
        `/nodefony/syslog/api/logs/search?requestId=${encodeURIComponent(
          requestId,
        )}&order=asc&limit=300&scope=trace`,
      ),
    [store, requestId],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const logs = useMemo(() => data?.rows ?? [], [data]);

  // Profil serveur corrélé (phases + requêtes SQL mesurées par le profiler ALS).
  // BEST-EFFORT : 404 si la requête n'a pas été profilée (prod) ou a été évincée
  // du ring buffer → on ignore l'erreur, les onglets dégradent proprement.
  const profileFetcher = useCallback(
    () =>
      store.api.getAbsolute<ProfileEntry>(
        `/nodefony/profiler/api/${encodeURIComponent(requestId)}`,
      ),
    [store, requestId],
  );
  const { data: profile, reload: reloadProfile } = useResource(profileFetcher);
  const queries = useMemo(() => profile?.queries ?? [], [profile]);

  // Événements d'audit de sécurité corrélés à CETTE requête (par requestId) —
  // best-effort : 401/403 si Studio non habilité, ou journal indisponible → on
  // dégrade silencieusement sur les logs heuristiques (comme le profil ORM).
  const auditFetcher = useCallback(
    () =>
      store.api.getAbsolute<AuditPage>(
        `/nodefony/security/api/audit/events?requestId=${encodeURIComponent(
          requestId,
        )}&limit=100`,
      ),
    [store, requestId],
  );
  const { data: auditData } = useResource(auditFetcher);
  // Ordre chronologique (asc) pour coller à la timeline de la trace.
  const auditEvents = useMemo(
    () => [...(auditData?.items ?? [])].sort((a, b) => a.ts - b.ts),
    [auditData],
  );

  // ── Synthèse dérivée de la trace ──
  const summary = useMemo(() => {
    if (!logs.length) return null;
    const first = logs[0]!;
    const last = logs[logs.length - 1]!;
    const isWs = logs.some((l) => pduProtocol(l) === "ws");
    const reqLog = logs.find((l) => l.msgid === "req");
    const req = reqLog ? parseReqLine(recordMessage(reqLog)) : {};
    const milestones = logs.filter((l) => describeFlow(l) !== null);
    return {
      baseTs: first.timeStamp,
      durationMs: last.timeStamp - first.timeStamp,
      isWs,
      req,
      milestones,
      pid: first.pid,
    };
  }, [logs]);

  // Logs corrélés se rapportant à l'ORM / la sécurité (heuristique — vision).
  const ormLogs = useMemo(
    () =>
      logs.filter((l) =>
        /orm|sql|query|drizzle|mongoose|database|\bdb\b/i.test(
          `${l.moduleName} ${l.msgid} ${recordMessage(l)}`,
        ),
      ),
    [logs],
  );
  const securityLogs = useMemo(
    () =>
      logs.filter((l) =>
        /firewall|security|auth|csrf|cors|jwt|cookie|session|granted|denied/i.test(
          `${l.moduleName} ${l.msgid} ${recordMessage(l)}`,
        ),
      ),
    [logs],
  );
  // Messages WS au fil de l'eau (loggés par le seam http en dev) — pour le badge.
  const wsMessageCount = useMemo(
    () =>
      logs.filter((l) => /\bWS (RECEIVE|SEND|BROADCAST)\b/.test(l.msgid))
        .length,
    [logs],
  );

  const shortId = requestId ? requestId.slice(0, 8) : "—";

  // ── StatusBar (topbar de mode) ──
  const segments: StatusSegment[] = summary
    ? [
        {
          id: "proto",
          label: "Protocole",
          icon: summary.isWs ? (
            <IconArrowsLeftRight size={16} />
          ) : (
            <IconWorld size={16} />
          ),
          tone: "active",
          value: (
            <Badge
              variant="light"
              color={summary.isWs ? "cyan" : "blue"}
              tt="none"
            >
              {summary.isWs ? "WebSocket" : "HTTP"}
            </Badge>
          ),
        },
        {
          id: "req",
          label: summary.isWs ? "Connexion" : "Requête",
          value: (
            <Text
              size="sm"
              fw={600}
              ff="monospace"
              style={{ wordBreak: "break-all" }}
            >
              {summary.req.method ? `${summary.req.method} ` : ""}
              {summary.req.path ?? (summary.isWs ? "WebSocket" : "—")}
            </Text>
          ),
        },
        {
          id: "status",
          label: "Statut",
          tone:
            summary.req.status && summary.req.status >= 400 ? "danger" : "ok",
          value: summary.req.status ? (
            <Badge variant="light" color={statusColor(summary.req.status)}>
              {summary.req.status}
            </Badge>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          ),
        },
        {
          id: "duration",
          label: "Durée",
          icon: <IconClock size={16} />,
          value: (
            <Text
              size="sm"
              fw={600}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {summary.req.durationMs ?? fmtDelta(summary.durationMs)}
            </Text>
          ),
        },
        {
          id: "events",
          label: "Événements",
          value: (
            <Text
              size="sm"
              fw={600}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {logs.length}
            </Text>
          ),
        },
        {
          id: "worker",
          label: "Worker",
          value: (
            <Text size="sm" ff="monospace" c="dimmed">
              pid {summary.pid}
            </Text>
          ),
        },
      ]
    : [];

  // ── Onglet ACCUEIL ──
  const accueil = (
    <Stack gap="md">
      <Grid>
        <StatCard
          label="Protocole"
          icon={
            summary?.isWs ? (
              <IconArrowsLeftRight size={18} />
            ) : (
              <IconWorld size={18} />
            )
          }
        >
          {summary ? (summary.isWs ? "WebSocket" : "HTTP") : "—"}
        </StatCard>
        <StatCard label="Statut" hint="Code HTTP de la réponse (bilan req).">
          {summary?.req.status ?? "—"}
        </StatCard>
        <StatCard
          label="Durée totale"
          icon={<IconClock size={18} />}
          hint="Écart entre le 1ᵉʳ et le dernier log corrélé."
        >
          {summary
            ? (summary.req.durationMs ?? fmtDelta(summary.durationMs))
            : "—"}
        </StatCard>
        <StatCard
          label="Jalons / Événements"
          hint="Étapes du cycle de vie / total de logs corrélés."
        >
          {summary ? `${summary.milestones.length} / ${logs.length}` : "—"}
        </StatCard>
      </Grid>

      <DefinitionList>
        <KeyValue k="requestId" v={<Code>{requestId}</Code>} />
        {summary?.req.method && (
          <KeyValue k="Méthode" v={summary.req.method} mono />
        )}
        {summary?.req.url && <KeyValue k="URL" v={summary.req.url} mono />}
        {summary?.req.ip && <KeyValue k="IP client" v={summary.req.ip} mono />}
        <KeyValue
          k="Worker (pid)"
          v={summary ? String(summary.pid) : "—"}
          mono
        />
        {summary && (
          <KeyValue k="Début" v={`${fmtDateTime(summary.baseTs)}`} mono />
        )}
        {profile?.route && <KeyValue k="Route" v={profile.route} mono />}
        {profile?.controller && (
          <KeyValue
            k="Controller"
            v={`${profile.controller}.${profile.action ?? "?"}`}
            mono
          />
        )}
        {profile && (
          <KeyValue k="Durée serveur" v={fmtMs(profile.durationMs)} mono />
        )}
      </DefinitionList>

      {/* Timeline verticale des JALONS du cycle de vie. */}
      <Stack gap={6}>
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Cycle de vie
          </Text>
          <Badge size="sm" variant="light" color="brand">
            {summary?.milestones.length ?? 0} jalon
            {(summary?.milestones.length ?? 0) > 1 ? "s" : ""}
          </Badge>
          <DocHint
            title="Cycle de vie de la requête"
            version={TRACE_DOC}
            summary="Les jalons notables (requête entrante, route trouvée, réponse, ouverture/fermeture WebSocket) dans l'ordre chronologique, avec le délai écoulé depuis le début."
            sections={[
              {
                label: "Δt",
                body: "Le décalage (+Xms) est mesuré depuis le tout premier log de la requête → on voit où le temps passe.",
              },
              {
                label: "Étapes techniques",
                body: "Les events de bas niveau (corps reçu, dispatch, message…) sont dans l'onglet Chronologie ; ici on ne garde que les jalons.",
              },
            ]}
          />
        </Group>
        {summary && summary.milestones.length > 0 ? (
          <Timeline
            active={summary.milestones.length}
            bulletSize={18}
            lineWidth={2}
          >
            {summary.milestones.map((m) => {
              const flow = describeFlow(m)!;
              return (
                <Timeline.Item
                  key={`${m.uid}-${m.timeStamp}`}
                  title={
                    <Group gap={6} wrap="nowrap">
                      <Badge size="sm" variant="light" color={flow.color}>
                        {flow.label}
                      </Badge>
                      <SeverityBadge severity={m.severityName} size="xs" />
                    </Group>
                  }
                >
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {fmtClock(m.timeStamp)}.{fmtMillis(m.timeStamp)} · +
                    {m.timeStamp - summary.baseTs}ms
                  </Text>
                  <Text size="xs" style={{ wordBreak: "break-word" }}>
                    {ansiToReact(recordMessage(m))}
                  </Text>
                </Timeline.Item>
              );
            })}
          </Timeline>
        ) : (
          <Text size="sm" c="dimmed">
            Aucun jalon identifié (logs hors cycle, ou expirés du buffer).
          </Text>
        )}
      </Stack>
    </Stack>
  );

  // ── Onglet vision (ORM / Sécurité) ──
  const visionTab = (
    kind: "orm" | "security",
    rows: LogRecord[],
  ): React.ReactNode => {
    const isOrm = kind === "orm";
    return (
      <Stack gap="sm">
        <Alert
          color="grape"
          variant="light"
          icon={<IconInfoCircle size={16} />}
        >
          <Text size="xs">
            {isOrm ? (
              <>
                Onglet <b>préparé</b> : il affiche les logs de cette requête
                liés à l'<b>ORM</b>. À terme, les <b>requêtes SQL</b> mesurées
                par le profiler (ALS) y seront enrichies (durée, lignes,
                connecteur).
              </>
            ) : (
              <>
                Onglet <b>préparé</b> : il affiche les logs de cette requête
                liés à la <b>sécurité</b> (firewall, session, auth). À terme,
                les <b>décisions du firewall</b> (allow/deny, rôle requis) y
                seront détaillées.
              </>
            )}
          </Text>
        </Alert>
        {rows.length > 0 && summary ? (
          <LogList rows={rows} baseTs={summary.baseTs} />
        ) : (
          <Text size="sm" c="dimmed">
            Aucun log {isOrm ? "ORM" : "de sécurité"} dans cette requête.
          </Text>
        )}
      </Stack>
    );
  };

  // ── Onglet TIMING (profil serveur : phases mesurées par le profiler ALS) ──
  const timingPanel = profile ? (
    <Stack gap="md">
      <ProfileMeta profile={profile} />
      <Stack gap={6}>
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Timeline des phases (serveur)
          </Text>
          <DocHint
            title="Timing serveur (waterfall des phases)"
            version={TRACE_DOC}
            summary="Décomposition du temps passé côté serveur pour traiter la requête : parse du corps, résolution de route, firewall, action du controller, rendu, envoi."
            sections={[
              {
                label: "Source",
                body: "Mesuré par le profiler (AsyncLocalStorage) — les mêmes phases que la debug bar par-page. Plus précis que la durée déduite des logs.",
              },
              {
                label: "Si vide",
                body: "Requête non profilée (profiler dev-only) ou profil évincé du ring buffer.",
              },
            ]}
          />
        </Group>
        <PhaseWaterfall profile={profile} />
      </Stack>
    </Stack>
  ) : (
    <Alert color="grape" variant="light" icon={<IconInfoCircle size={16} />}>
      <Text size="xs">
        Aucun profil serveur pour cette requête — elle n'a pas été{" "}
        <b>profilée</b> (le profiler est dev-only) ou son profil a été évincé du
        ring buffer.
      </Text>
    </Alert>
  );

  // ── Onglet ORM : vraies requêtes SQL du profiler si dispo, sinon logs corrélés ──
  const ormPanel =
    queries.length > 0 ? (
      <QueryTable queries={queries} />
    ) : (
      visionTab("orm", ormLogs)
    );

  // ── Onglet Sécurité : VRAIS événements d'audit (corrélés par requestId) si
  // disponibles, sinon repli sur les logs heuristiques (vision préparée). ──
  const securityPanel =
    auditEvents.length > 0 ? (
      <Stack gap="sm">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Décisions de sécurité (journal d'audit)
          </Text>
          <DocHint
            title="Événements d'audit de cette requête"
            version={TRACE_DOC}
            summary="Les vrais événements du journal d'audit de sécurité (@nodefony/security) corrélés à cette requête par requestId — décisions autoritatives du firewall et des authenticators, pas une heuristique sur les logs."
            sections={[
              {
                label: "Lecture",
                body: "« Refus » = une politique a refusé un acteur valide (Zero Trust, RBAC, CSRF). « Échec » = preuve ratée (mot de passe, signature). « Succès » = action de sécurité aboutie.",
              },
              {
                label: "Si vide",
                body: "Aucun événement de sécurité n'a été émis pour cette requête (le chemin de succès reste muet), ou le journal est inaccessible.",
              },
            ]}
          />
        </Group>
        <Stack gap={6}>
          {auditEvents.map((ev) => {
            const accent = OUTCOME_ACCENT[ev.outcome] ?? "gray";
            return (
              <Box
                key={ev.id}
                p="xs"
                style={{
                  borderInlineStart: `3px solid var(--mantine-color-${accent}-6)`,
                  borderRadius: "var(--mantine-radius-sm)",
                  background: "var(--mantine-color-default-hover)",
                }}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Group gap="xs" wrap="wrap">
                    <OutcomeBadge outcome={ev.outcome} />
                    <Code>{ev.action}</Code>
                    <CategoryBadge category={ev.category} />
                    {ev.reason && <Code>{ev.reason}</Code>}
                  </Group>
                  {summary && (
                    <Text
                      size="xs"
                      c="dimmed"
                      ff="monospace"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      +{ev.ts - summary.baseTs}ms
                    </Text>
                  )}
                </Group>
                {(ev.actor || ev.resource) && (
                  <Text size="xs" c="dimmed" mt={4}>
                    {ev.actor ? `acteur : ${ev.actor}` : "anonyme"}
                    {ev.resource ? ` · ${ev.resource}` : ""}
                  </Text>
                )}
              </Box>
            );
          })}
        </Stack>
        {securityLogs.length > 0 && summary && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Logs corrélés (contexte)
            </Text>
            <LogList rows={securityLogs} baseTs={summary.baseTs} />
          </Stack>
        )}
      </Stack>
    ) : (
      visionTab("security", securityLogs)
    );

  const tabs = [
    {
      value: "accueil",
      label: "Accueil",
      icon: <IconHome size={15} />,
      panel: accueil,
    },
    ...(summary?.isWs
      ? [
          {
            value: "ws",
            label: "WebSocket",
            icon: <IconArrowsLeftRight size={15} />,
            badge: wsMessageCount ? (
              <Badge size="xs" variant="light" color="cyan">
                {wsMessageCount}
              </Badge>
            ) : undefined,
            panel: summary ? (
              <WsTracePanel logs={logs} baseTs={summary.baseTs} />
            ) : null,
          },
        ]
      : []),
    {
      value: "chrono",
      label: "Chronologie",
      icon: <IconListDetails size={15} />,
      badge: (
        <Badge size="xs" variant="light" color="gray">
          {logs.length}
        </Badge>
      ),
      panel: summary ? <LogList rows={logs} baseTs={summary.baseTs} /> : null,
    },
    {
      value: "timing",
      label: "Timing",
      icon: <IconTimeline size={15} />,
      badge: profile ? (
        <Badge size="xs" variant="light" color="blue">
          {fmtMs(profile.durationMs)}
        </Badge>
      ) : undefined,
      panel: timingPanel,
    },
    {
      value: "orm",
      label: "ORM",
      icon: <IconDatabase size={15} />,
      badge: queries.length ? (
        <Badge size="xs" variant="light" color="grape">
          {queries.length}
        </Badge>
      ) : ormLogs.length ? (
        <Badge size="xs" variant="light" color="gray">
          {ormLogs.length}
        </Badge>
      ) : undefined,
      panel: ormPanel,
    },
    {
      value: "security",
      label: "Sécurité",
      icon: <IconShieldLock size={15} />,
      // Priorité aux VRAIS événements d'audit ; rouge si un refus est présent.
      badge: auditEvents.length ? (
        <Badge
          size="xs"
          variant="light"
          color={
            auditEvents.some((e) => e.outcome === "denied")
              ? "red"
              : auditEvents.some((e) => e.outcome === "failure")
                ? "orange"
                : "teal"
          }
        >
          {auditEvents.length}
        </Badge>
      ) : securityLogs.length ? (
        <Badge size="xs" variant="light" color="gray">
          {securityLogs.length}
        </Badge>
      ) : undefined,
      panel: securityPanel,
    },
    {
      value: "raw",
      label: "Brut (JSON)",
      icon: <IconCode size={15} />,
      panel: <JsonViewer value={logs} maxHeight={560} />,
    },
  ];

  return (
    <DataState
      loading={loading && !logs.length}
      error={error}
      // Vide SEULEMENT si AUCUNE source n'a de données (ni logs, ni profil, ni
      // audit) : un requestId dont les logs ont rotaté mais qui garde un profil
      // ou des événements d'audit reste exploitable → on rend la page.
      empty={!loading && !logs.length && !profile && !auditEvents.length}
      onRetry={reload}
      emptyMessage={`Aucun log pour ${shortId}. La trace lit le journal PERSISTANT du worker courant — un requestId d'un run précédent (redémarrage serveur = nouveau pid), purgé du JSONL, ou inconnu n'y figure pas.`}
    >
      <TabbedPage
        icon={<IconRoute2 size={22} />}
        title="Suivi de requête"
        subtitle={
          <Text span ff="monospace" size="sm">
            {shortId}
          </Text>
        }
        actions={
          <Group gap="xs">
            <Button
              component={Link}
              to="/nodefony/logs"
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconArrowLeft size={15} />}
            >
              Logs
            </Button>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconRefresh size={15} />}
              loading={loading}
              onClick={() => {
                reload();
                reloadProfile();
              }}
            >
              Rafraîchir
            </Button>
          </Group>
        }
        statusBar={<StatusBar segments={segments} />}
        tabs={tabs}
        value={tab}
        onChange={setTab}
      />
    </DataState>
  );
});
