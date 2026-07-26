/**
 * **LiveLogs** — onglet « flux temps réel » de la page Log Backplane.
 *
 * Amorce avec un snapshot REST du ring (`/syslog/api/logs`) puis suit le canal WS
 * `nodefony:syslog` (Pdu live, coalescés `{logs,dropped}`). Le bus live est
 * **indépendant du driver** de relecture : il marche même si le driver actif
 * n'est pas queryable.
 *
 * Ergonomie (« temps réel calme » + réflexes d'un tail moderne) :
 *  - **autoscroll intelligent** : suit le bas tant qu'on y est ; dès qu'on
 *    remonte lire, le suivi se suspend et un bouton « ↓ N nouveaux » apparaît ;
 *  - **chips de sévérité cliquables** = filtre + santé en un coup d'œil ;
 *  - lignes ERROR/CRITIC **surlignées** ; clic sur une ligne → détail Pdu ;
 *  - `tabular-nums`, `contain`, badges à style stable → aucun clignotement.
 */
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowDown,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useConnection, useStore } from "../../stores";
import { ansiToReact } from "../../utils/ansiToReact";
import { DocHint } from "../../components/ui";
import type { ClusterTopology, LogRecord, Severity } from "./logsTypes";
import {
  LOGS_DOC,
  countBySeverity,
  fmtClock,
  fmtMillis,
  isAlertSeverity,
  recordMessage,
  toRecord,
} from "./logFormat";
import {
  ClusterScopeNotice,
  SeverityBadge,
  SeverityCountChips,
} from "./LogVisuals";
import { PLATFORM_CHANNELS } from "nodefony";

/** Plafond d'entrées conservées côté client (croissance bornée). */
const MAX_ENTRIES = 500;
/** Distance au bas (px) en-dessous de laquelle on considère « collé en bas ». */
const STICK_THRESHOLD = 48;

/** Entrée affichée : enregistrement + clé React stable (uid peut se répéter). */
interface Entry {
  rec: LogRecord;
  key: string;
}

export interface LiveLogsProps {
  /** Clic sur une ligne → détail (drawer géré par l'orchestrateur). */
  onSelect: (rec: LogRecord) => void;
  /** Topologie cluster (méta backplane) → note « flux d'un seul worker ». */
  cluster?: ClusterTopology | null;
}

export const LiveLogs = observer(({ onSelect, cluster }: LiveLogsProps) => {
  const conn = useConnection();
  const store = useStore();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(
    () => new Set(),
  );
  const [dropped, setDropped] = useState(0);

  // Autoscroll intelligent.
  const [stick, setStick] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Refs miroir pour lire l'état courant dans des handlers stables (WS/scroll).
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stickRef = useRef(stick);
  stickRef.current = stick;
  const keyCounter = useRef(0);

  // ── Snapshot initial (ring buffer) ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    store.api
      .getAbsolute<unknown[]>("/nodefony/syslog/api/logs?limit=200")
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        const views: Entry[] = [];
        // L'endpoint renvoie récent→ancien ; le flux live ajoute en bas → on
        // remet l'ordre ancien→récent pour une lecture chronologique.
        for (const d of [...rows].reverse()) {
          const rec = toRecord(d);
          if (rec) views.push({ rec, key: `snap-${keyCounter.current++}` });
        }
        setEntries((prev) => (prev.length === 0 ? views : prev));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store]);

  // ── Flux live (canal WS nodefony:syslog) ──────────────────────────────────
  useEffect(() => {
    const handler = (data: unknown) => {
      if (pausedRef.current) return;
      if (!data || typeof data !== "object") return;
      const rec = data as { logs?: unknown[]; dropped?: number };
      const items = Array.isArray(rec.logs) ? rec.logs : [data];
      if (rec.dropped) setDropped((n) => n + rec.dropped!);
      const views: Entry[] = [];
      for (const d of items) {
        const r = toRecord(d);
        if (r) views.push({ rec: r, key: `${r.uid}-${keyCounter.current++}` });
      }
      if (views.length === 0) return;
      setEntries((prev) => {
        const next = [...prev, ...views];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
      // Si on n'est pas collé en bas, compter les nouveaux non-lus.
      if (!stickRef.current) setUnseen((n) => n + views.length);
    };
    const dispose = conn.subscribe(PLATFORM_CHANNELS.syslog, handler);
    return () => dispose();
  }, [conn]);

  // ── Autoscroll : suit le bas uniquement si « collé » ────────────────────
  useEffect(() => {
    if (!stickRef.current) return;
    const v = viewportRef.current;
    if (v) v.scrollTo({ top: v.scrollHeight });
  }, [entries]);

  // Met à jour « collé en bas » à chaque scroll utilisateur.
  const onScrollPositionChange = () => {
    const v = viewportRef.current;
    if (!v) return;
    const atBottom =
      v.scrollHeight - v.scrollTop - v.clientHeight < STICK_THRESHOLD;
    setStick(atBottom);
    if (atBottom) setUnseen(0);
  };

  const jumpToBottom = () => {
    const v = viewportRef.current;
    if (v) v.scrollTo({ top: v.scrollHeight, behavior: "smooth" });
    setStick(true);
    setUnseen(0);
  };

  const toggleSeverity = (s: Severity) =>
    setSeverityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const counts = useMemo(
    () => countBySeverity(entries.map((e) => e.rec)),
    [entries],
  );

  // ── Filtrage (sévérités cochées + recherche texte) ──────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hasSev = severityFilter.size > 0;
    if (!hasSev && !q) return entries;
    return entries.filter((e) => {
      if (hasSev && !severityFilter.has(e.rec.severityName as Severity))
        return false;
      if (q) {
        const hay = `${e.rec.moduleName} ${e.rec.msgid} ${recordMessage(
          e.rec,
        )}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, severityFilter, search]);

  return (
    <Stack gap="sm">
      {/* Honnêteté cluster : le live ne provient que du worker portant la socket WS. */}
      <ClusterScopeNotice cluster={cluster} driverName={null} context="live" />
      {/* Barre d'état + contrôles. */}
      <Paper p="xs" withBorder radius="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm" wrap="wrap">
            <Badge size="sm" variant="dot" color={paused ? "yellow" : "teal"}>
              {paused ? "Pause" : "Live"}
            </Badge>
            <Text
              size="sm"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {filtered.length} / {entries.length} entrées
            </Text>
            {dropped > 0 && (
              <Tooltip label="Logs omis côté serveur sous surcharge (coalescing nodefony:syslog)">
                <Badge size="sm" variant="light" color="orange">
                  {dropped} omis
                </Badge>
              </Tooltip>
            )}
            <SeverityCountChips
              counts={counts}
              active={severityFilter}
              onToggle={toggleSeverity}
            />
            <DocHint
              title="Flux temps réel (bus nodefony:syslog)"
              version={LOGS_DOC}
              summary="Les Pdu du kernel poussés en direct via WebSocket. Indépendant du driver de relecture — marche même si le driver n'est pas queryable."
              sections={[
                {
                  label: "Chips de sévérité",
                  body: "Cliquables : filtrent l'affichage. Plusieurs sévérités = union.",
                },
                {
                  label: "omis",
                  body: "Sous forte charge, le serveur coalesce et peut sauter des lignes pour ne pas saturer la socket (observabilité ≠ impact prod).",
                },
              ]}
            />
          </Group>

          <Group gap={6} wrap="nowrap">
            <TextInput
              size="xs"
              leftSection={<IconSearch size={14} />}
              placeholder="Filtrer (message, module, msgid)…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              style={{ width: 240 }}
              aria-label="recherche plein-texte dans le flux"
            />
            <Tooltip label={paused ? "Reprendre" : "Pause"}>
              <ActionIcon
                variant="default"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? "reprendre le flux" : "mettre en pause"}
              >
                {paused ? (
                  <IconPlayerPlay size={16} />
                ) : (
                  <IconPlayerPause size={16} />
                )}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Effacer l'affichage">
              <ActionIcon
                variant="default"
                onClick={() => {
                  setEntries([]);
                  setDropped(0);
                  setUnseen(0);
                }}
                aria-label="effacer l'affichage"
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* Viewport des logs (+ bouton flottant « N nouveaux »). */}
      <Paper withBorder radius="md" style={{ position: "relative" }}>
        <ScrollArea
          h={520}
          viewportRef={viewportRef}
          onScrollPositionChange={onScrollPositionChange}
          type="auto"
          styles={{
            viewport: {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              contain: "content",
            },
          }}
        >
          {filtered.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {entries.length === 0
                ? "En attente de logs…"
                : "Aucune entrée ne correspond au filtre."}
            </Text>
          ) : (
            <Stack gap={0} p="xs">
              {filtered.map(({ rec, key }) => {
                const alert = isAlertSeverity(rec.severityName);
                return (
                  <Group
                    key={key}
                    gap={6}
                    wrap="nowrap"
                    align="flex-start"
                    onClick={() => onSelect(rec)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(rec);
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      padding: "1px 4px",
                      borderRadius: 4,
                      background: alert
                        ? "var(--mantine-color-red-light)"
                        : undefined,
                    }}
                  >
                    <Tooltip
                      label={`#${rec.uid} — n° de séquence (ordre d'émission exact)`}
                      openDelay={400}
                    >
                      <Text
                        size="xs"
                        c="dimmed"
                        ff="monospace"
                        style={{
                          flexShrink: 0,
                          opacity: 0.55,
                          minWidth: 52,
                        }}
                      >
                        #{rec.uid}
                      </Text>
                    </Tooltip>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtClock(rec.timeStamp)}
                      <Text span size="xs" c="dimmed" opacity={0.6}>
                        .{fmtMillis(rec.timeStamp)}
                      </Text>
                    </Text>
                    <SeverityBadge severity={rec.severityName} />
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ flexShrink: 0, minWidth: 88 }}
                      truncate
                    >
                      {rec.moduleName}
                    </Text>
                    {rec.requestId && (
                      <Tooltip label={`requestId ${rec.requestId}`}>
                        <Badge
                          size="xs"
                          variant="outline"
                          color="grape"
                          style={{ flexShrink: 0, fontFamily: "monospace" }}
                        >
                          {rec.requestId.slice(0, 8)}
                        </Badge>
                      </Tooltip>
                    )}
                    <Text size="xs" style={{ wordBreak: "break-word" }}>
                      {ansiToReact(recordMessage(rec))}
                    </Text>
                  </Group>
                );
              })}
            </Stack>
          )}
        </ScrollArea>

        {!stick && unseen > 0 && (
          <Button
            size="xs"
            radius="xl"
            color="brand"
            leftSection={<IconArrowDown size={14} />}
            onClick={jumpToBottom}
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              boxShadow: "var(--mantine-shadow-md)",
            }}
          >
            {unseen} nouveau{unseen > 1 ? "x" : ""}
          </Button>
        )}
      </Paper>
    </Stack>
  );
});
