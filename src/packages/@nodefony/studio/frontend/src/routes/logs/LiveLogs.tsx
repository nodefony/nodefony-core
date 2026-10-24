/**
 * **LiveLogs** — onglet « flux temps réel » de la page Log Backplane.
 *
 * Amorce avec un snapshot REST du ring (`/syslog/api/logs`) puis suit le canal WS
 * `nodefony:syslog` (Pdu live, coalescés `{logs,dropped}`). Le bus live est
 * **indépendant du driver** de relecture : il marche même si le driver actif
 * n'est pas queryable.
 *
 * Ergonomie (« temps réel calme » + réflexes d'un tail moderne) :
 *  - **les plus récentes en haut** : la vue suit le haut tant qu'on y est ;
 *    dès qu'on descend lire, elle ne bouge plus et un bouton « ↑ N nouveaux »
 *    apparaît ;
 *  - **chips de sévérité cliquables** = filtre + santé en un coup d'œil ;
 *  - lignes ERROR/CRITIC **surlignées** ; clic sur une ligne → détail Pdu ;
 *  - `tabular-nums`, `contain`, badges à style stable → aucun clignotement.
 */
import { observer } from "mobx-react-lite";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  IconArrowUp,
  IconBroadcast,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useConnection, useStore } from "../../stores";
import { ansiToReact } from "../../utils/ansiToReact";
import { DocHint } from "../../components/ui";
import type {
  ClusterTopology,
  ILogViewFilters,
  LogRecord,
  Severity,
} from "./logsTypes";
import { DEFAULT_SEVERITIES } from "./logsTypes";
import { SeverityFilter } from "./SeverityFilter";
import { ViewFilterSwitches } from "./ViewFilterSwitches";
import {
  LOGS_DOC,
  applyViewFilters,
  countBySeverity,
  fmtClock,
  fmtMillis,
  isAlertSeverity,
  recordMessage,
  toRecord,
} from "./logFormat";
import { ClusterScopeNotice, SeverityBadge } from "./LogVisuals";
import { PLATFORM_CHANNELS, consoleRequestIds } from "nodefony";

/** Plafond d'entrées conservées côté client (croissance bornée). */
const MAX_ENTRIES = 500;
/** Distance au haut (px) en dessous de laquelle on considère « collé en haut ». */
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
  cluster?: ClusterTopology | null | undefined;
  /** Filtres d'affichage communs avec l'onglet Journaux. */
  viewFilters: ILogViewFilters;
  onViewFiltersChange: (next: ILogViewFilters) => void;
}

export const LiveLogs = observer(
  ({ onSelect, cluster, viewFilters, onViewFiltersChange }: LiveLogsProps) => {
    const conn = useConnection();
    const store = useStore();

    const [entries, setEntries] = useState<Entry[]>([]);
    const [paused, setPaused] = useState(false);
    const [search, setSearch] = useState("");
    // Même vue d'ouverture que les Journaux : INFO et plus grave, DEBUG à un
    // clic (la puce DEBUG garde son compte).
    const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(
      () => new Set(DEFAULT_SEVERITIES),
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

    // Filtres d'affichage appliqués DÈS LA RÉCEPTION : une ligne masquée ne doit
    // pas occuper l'une des MAX_ENTRIES places (une page de l'application charge
    // des centaines de fichiers par /_vite/ — ils chassaient la requête qu'on
    // cherche). Les requestId de la console sont retenus d'un lot à l'autre.
    const viewRef = useRef(viewFilters);
    viewRef.current = viewFilters;
    const consoleIds = useRef<Set<string> | null>(null);
    const admit = (views: Entry[]): Entry[] => {
      const f = viewRef.current;
      if (f.hideConsole) {
        const seen = consoleRequestIds(views.map((v) => v.rec));
        if (seen) {
          // Borné : au-delà, on repart du lot courant (croissance bornée).
          if (consoleIds.current === null || consoleIds.current.size > 2_000) {
            consoleIds.current = seen;
          } else {
            for (const id of seen) consoleIds.current.add(id);
          }
        }
      }
      return applyViewFilters(views, (v) => v.rec, f, consoleIds.current);
    };
    const admitRef = useRef(admit);
    admitRef.current = admit;

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
          const kept = admitRef.current(views);
          setEntries((prev) => (prev.length === 0 ? kept : prev));
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
        const lost = rec.dropped;
        if (lost) setDropped((n) => n + lost);
        const views: Entry[] = [];
        for (const d of items) {
          const r = toRecord(d);
          if (r)
            views.push({ rec: r, key: `${r.uid}-${keyCounter.current++}` });
        }
        const kept = admitRef.current(views);
        if (kept.length === 0) return;
        setEntries((prev) => {
          const next = [...prev, ...kept];
          return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
        });
        // Si on n'est pas collé en haut, compter les nouveaux non-lus.
        if (!stickRef.current) setUnseen((n) => n + kept.length);
      };
      const dispose = conn.subscribe(PLATFORM_CHANNELS.syslog, handler);
      return () => dispose();
    }, [conn]);

    // ── Les plus récentes EN HAUT ────────────────────────────────────────────
    // Collée en haut, la vue montre chaque nouvelle ligne sans rien faire.
    // Défilée plus bas pour lire, elle ne doit pas bouger sous l'œil : la
    // hauteur ajoutée au-dessus est rendue au défilement, avant la peinture.
    const prevHeightRef = useRef(0);
    useLayoutEffect(() => {
      const v = viewportRef.current;
      if (!v) return;
      const grown = v.scrollHeight - prevHeightRef.current;
      prevHeightRef.current = v.scrollHeight;
      if (stickRef.current) {
        v.scrollTop = 0;
      } else if (grown > 0) {
        v.scrollTop += grown;
      }
    }, [entries]);

    // Met à jour « collé en haut » à chaque scroll utilisateur.
    const onScrollPositionChange = () => {
      const v = viewportRef.current;
      if (!v) return;
      const atTop = v.scrollTop < STICK_THRESHOLD;
      setStick(atTop);
      if (atTop) setUnseen(0);
    };

    const jumpToTop = () => {
      const v = viewportRef.current;
      if (v) v.scrollTo({ top: 0, behavior: "smooth" });
      setStick(true);
      setUnseen(0);
    };

    // Filtres communs encore une fois à l'affichage : une requête de la console
    // se reconnaît parfois APRÈS ses premières lignes (sa ligne d'accès arrive
    // à la fin), et un filtre rallumé doit masquer ce qui est déjà là.
    const visible = useMemo(
      () =>
        applyViewFilters(
          entries,
          (e) => e.rec,
          viewFilters,
          consoleIds.current,
        ),
      [entries, viewFilters],
    );
    const counts = useMemo(
      () => countBySeverity(visible.map((e) => e.rec)),
      [visible],
    );

    // ── Filtrage (sévérités cochées + recherche texte) ──────────────────────
    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase();
      const hasSev = severityFilter.size > 0;
      if (!hasSev && !q) return visible;
      return visible.filter((e) => {
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
    }, [visible, severityFilter, search]);
    // Affichage : la plus récente en haut (le tampon, lui, reste chronologique).
    const newestFirst = useMemo(() => [...filtered].reverse(), [filtered]);

    return (
      <Stack gap="sm">
        {/* Honnêteté cluster : le live ne provient que du worker portant la socket WS. */}
        <ClusterScopeNotice
          cluster={cluster}
          driverName={null}
          context="live"
        />
        {/* En-tête : ce que montre cet onglet, par opposition aux Journaux. */}
        <Paper
          withBorder
          radius="md"
          p="sm"
          bg="var(--mantine-color-default-hover)"
        >
          <Group gap="sm" wrap="nowrap">
            <IconBroadcast size={22} aria-hidden />
            <div>
              <Text fw={700}>Direct — ce processus</Text>
              <Text size="sm" c="dimmed">
                Les lignes de ce processus, au fil de l'eau : elles s'affichent
                dès qu'elles sont écrites, rien n'est relu. Les {MAX_ENTRIES}{" "}
                plus récentes restent à l'écran ; l'historique est dans l'onglet
                Journaux.
              </Text>
            </div>
          </Group>
        </Paper>
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
              <SeverityFilter
                value={severityFilter}
                onChange={setSeverityFilter}
                counts={counts}
              />
              <ViewFilterSwitches
                value={viewFilters}
                onChange={onViewFiltersChange}
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
                {newestFirst.map(({ rec, key }) => {
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
                        {/* Retrait porté par `c="dimmed"` seul — une `opacity`
                          par-dessus repassait sous le seuil de contraste. */}
                        <Text span size="xs" c="dimmed">
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
              leftSection={<IconArrowUp size={14} />}
              onClick={jumpToTop}
              style={{
                position: "absolute",
                top: 12,
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
  },
);
