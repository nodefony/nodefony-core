/**
 * **FileReplay** — « magnétoscope » d'un fichier de log : parse les lignes (JSON
 * Pdu OU texte console) puis les **rejoue dans l'ordre chronologique** avec
 * play / pause / vitesse / scrub, comme un enregistrement.
 *
 * Pourquoi : un `tail -f` montre le présent ; le rejeu permet de **revivre** un
 * incident passé à son propre rythme (ou accéléré), de s'arrêter sur une étape,
 * de reculer. Le rythme respecte les **écarts de temps réels** entre logs (borné
 * pour ne pas attendre des minutes), divisés par la vitesse choisie.
 *
 * Front-only (HMR) : lit le data plane `/nodefony/syslog/api/files` + `/files/{name}`
 * (mêmes endpoints que le suivi). Réutilise `SeverityBadge`, la colonne « Étape »
 * (`describeFlow`) et `ansiToReact` → cohérent avec l'Explorer.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconInfoCircle,
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipForward,
  IconPlayerTrackPrev,
  IconRefresh,
  IconRoute2,
  IconX,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { ansiToReact } from "../../utils/ansiToReact";
import { DocHint } from "../../components/ui";
import type { LogRecord } from "./logsTypes";
import { LOGS_DOC, fmtClock, fmtMillis, recordMessage } from "./logFormat";
import { SeverityBadge } from "./LogVisuals";
import { describeFlow } from "./eventFlow";
import { PduDetailDrawer } from "./PduDetailDrawer";

/** Métadonnée d'un fichier (réponse `/files`). */
interface LogFileMeta {
  name: string;
  size: number;
}
interface FilesResponse {
  enabled: boolean;
  reason?: string;
  files: LogFileMeta[];
}
interface TailResponse {
  lines: string[];
}

/** Une ligne parsée prête à rejouer. */
interface ReplayLine {
  /** Rang dans le fichier (= ordre de rejeu). */
  index: number;
  /** Horodatage epoch ms si on a pu l'extraire (sinon `null` → cadence fixe). */
  ts: number | null;
  /** Enregistrement normalisé (badge sévérité, étape, message). */
  record: LogRecord;
}

/** Écart max respecté entre 2 logs (ms) — au-delà on n'attend pas (saut). */
const MAX_GAP_MS = 2500;
/** Cadence par défaut quand les timestamps manquent (texte sans heure). */
const FALLBACK_GAP_MS = 120;
/** Fenêtre de lignes rendues (perf) — on n'affiche que la queue révélée. */
const RENDER_WINDOW = 300;
/** Vitesses de rejeu proposées. */
const SPEEDS = [1, 2, 5, 10] as const;

const SEVERITY_NUM: Record<string, number> = {
  EMERGENCY: 0,
  ALERT: 1,
  CRITIC: 2,
  ERROR: 3,
  WARNING: 4,
  NOTICE: 5,
  INFO: 6,
  DEBUG: 7,
};

/** Retire les codes ANSI (parse texte uniquement ; l'affichage garde l'ANSI). */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Construit un epoch ms à partir d'une heure `HH:MM:SS.mmm` du jour courant —
 * suffisant pour les ÉCARTS (le rejeu ne se sert que des deltas). La date réelle
 * est inconnue dans le format texte ; seul le rythme compte.
 */
function clockToTs(h: number, m: number, s: number, ms: number): number {
  const d = new Date();
  d.setHours(h, m, s, ms);
  return d.getTime();
}

/**
 * Parse une ligne de fichier en {@link ReplayLine}. Tente le **JSON** (Pdu
 * sérialisé par le FileTransport) puis le **format texte** console
 * (`HH:MM:SS.mmm SEV …`), sinon ligne brute (ts inconnu).
 */
function parseReplayLine(line: string, index: number): ReplayLine | null {
  if (line.trim() === "") return null;

  // 1) JSON Pdu (présence de severityName).
  try {
    const o: unknown = JSON.parse(line);
    if (o && typeof o === "object" && "severityName" in o) {
      const r = o as Record<string, unknown>;
      const ts = typeof r.timeStamp === "number" ? r.timeStamp : null;
      const record: LogRecord = {
        uid: typeof r.uid === "number" ? r.uid : index,
        severity: typeof r.severity === "number" ? r.severity : 6,
        severityName: String(r.severityName),
        moduleName: typeof r.moduleName === "string" ? r.moduleName : "",
        msgid: typeof r.msgid === "string" ? r.msgid : "",
        msg: typeof r.msg === "string" ? r.msg : undefined,
        timeStamp: ts ?? Date.now(),
        pid: typeof r.pid === "number" ? r.pid : 0,
        payload: r.payload,
        requestId: typeof r.requestId === "string" ? r.requestId : undefined,
      };
      return { index, ts, record };
    }
  } catch {
    /* pas du JSON — format texte */
  }

  // 2) Format texte console : `HH:MM:SS.mmm SEV  MSGID : payload`.
  const plain = stripAnsi(line);
  const m = plain.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+([A-Z]+)\s+(.*)$/);
  if (m) {
    const ts = clockToTs(+m[1], +m[2], +m[3], +m[4]);
    const sev = m[5];
    let rest = m[6];
    let msgid = "";
    const sep = rest.indexOf(" : ");
    if (sep !== -1) {
      msgid = rest.slice(0, sep).trim();
      rest = rest.slice(sep + 3);
    }
    // requestId si présent dans le texte (ex. ligne `req … [615dad21]`). Le
    // format pretty ne l'expose que sur certaines lignes → suivi best-effort
    // en texte (complet en JSON où chaque Pdu porte son requestId).
    const ridM = plain.match(/\[([0-9a-fA-F]{8,})\]/);
    return {
      index,
      ts,
      record: {
        uid: index,
        severity: SEVERITY_NUM[sev] ?? 6,
        severityName: sev,
        moduleName: "",
        msgid,
        timeStamp: ts,
        pid: 0,
        payload: line, // garde l'ANSI d'origine pour l'affichage
        requestId: ridM ? ridM[1] : undefined,
      },
    };
  }

  // 3) Ligne brute non datée.
  return {
    index,
    ts: null,
    record: {
      uid: index,
      severity: 6,
      severityName: "INFO",
      moduleName: "",
      msgid: "",
      timeStamp: Date.now(),
      pid: 0,
      payload: line,
    },
  };
}

export const FileReplay = observer(() => {
  const store = useStore();

  const [files, setFiles] = useState<LogFileMeta[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // État du magnétoscope.
  const [revealed, setRevealed] = useState(0); // nb de lignes jouées
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(2);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Suivi d'une requête (comme dans le Live) + détail (drawer).
  // `detail` = la LIGNE ouverte dans le drawer (≠ `selected` = le FICHIER choisi).
  const [detail, setDetail] = useState<LogRecord | null>(null);
  const [focusRid, setFocusRid] = useState<string>("");
  const [focusOnly, setFocusOnly] = useState(false);

  // ── Liste des fichiers ──────────────────────────────────────────────────
  const loadFiles = useCallback(() => {
    store.api
      .getAbsolute<FilesResponse>("/nodefony/syslog/api/files")
      .then((res) => {
        setEnabled(res.enabled);
        setReason(res.reason);
        setFiles(res.files ?? []);
        setSelected((prev) => prev ?? res.files?.[0]?.name ?? null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "liste fichiers échouée"),
      );
  }, [store]);
  useEffect(() => loadFiles(), [loadFiles]);

  // ── Chargement du fichier sélectionné (intégral, cap serveur 256 KB) ─────
  const loadFile = useCallback(() => {
    if (!selected) return;
    setPlaying(false);
    setRevealed(0);
    store.api
      .getAbsolute<TailResponse>(
        `/nodefony/syslog/api/files/${encodeURIComponent(selected)}?lines=5000`,
      )
      .then((res) => {
        setRawLines(res.lines ?? []);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "lecture fichier échouée"),
      );
  }, [selected, store]);
  useEffect(() => loadFile(), [loadFile]);

  // ── Parse + deltas chronologiques ───────────────────────────────────────
  const lines = useMemo(() => {
    const out: ReplayLine[] = [];
    rawLines.forEach((l, i) => {
      const p = parseReplayLine(l, i);
      if (p) out.push({ ...p, index: out.length });
    });
    return out;
  }, [rawLines]);

  const total = lines.length;

  // Tous les Pdu parsés (réf stable) → source LOCALE de la chronologie du drawer
  // (le fichier, pas le ring mémoire) + comptage des lignes d'une requête suivie.
  const allRecords = useMemo(() => lines.map((l) => l.record), [lines]);
  const focusCount = useMemo(
    () =>
      focusRid ? allRecords.filter((r) => r.requestId === focusRid).length : 0,
    [allRecords, focusRid],
  );

  /** Écart d'attente AVANT de révéler la ligne i (ms réelles, borné). */
  const deltas = useMemo(() => {
    const d = new Array<number>(total);
    for (let i = 0; i < total; i++) {
      if (i === 0) {
        d[i] = 0;
        continue;
      }
      const prev = lines[i - 1].ts;
      const cur = lines[i].ts;
      if (prev === null || cur === null) {
        d[i] = FALLBACK_GAP_MS;
      } else {
        d[i] = Math.min(Math.max(cur - prev, 0), MAX_GAP_MS);
      }
    }
    return d;
  }, [lines, total]);

  /** Temps simulé écoulé jusqu'à la ligne révélée (somme des deltas). */
  const elapsedMs = useMemo(() => {
    let sum = 0;
    for (let i = 1; i <= revealed && i < total; i++) sum += deltas[i];
    return sum;
  }, [revealed, deltas, total]);
  const totalMs = useMemo(() => deltas.reduce((a, b) => a + b, 0), [deltas]);

  // ── Moteur de rejeu : programme la révélation de la ligne suivante ───────
  useEffect(() => {
    if (!playing || revealed >= total) return;
    const gap = deltas[revealed] !== undefined ? deltas[revealed] / speed : 0;
    const id = window.setTimeout(
      () => setRevealed((r) => Math.min(r + 1, total)),
      gap,
    );
    return () => window.clearTimeout(id);
  }, [playing, revealed, speed, total, deltas]);

  // Stoppe à la fin.
  useEffect(() => {
    if (playing && revealed >= total && total > 0) setPlaying(false);
  }, [playing, revealed, total]);

  // Autoscroll en bas pendant la lecture.
  useEffect(() => {
    if (!playing) return;
    const v = viewportRef.current;
    if (v) v.scrollTo({ top: v.scrollHeight });
  }, [revealed, playing]);

  const togglePlay = () => {
    if (revealed >= total) setRevealed(0); // rejouer depuis le début
    setPlaying((p) => !p);
  };
  const restart = () => {
    setRevealed(0);
    setPlaying(true);
  };
  const showAll = () => {
    setPlaying(false);
    setRevealed(total);
  };

  const fileOptions = useMemo(
    () => files.map((f) => ({ value: f.name, label: f.name })),
    [files],
  );

  // Lignes effectivement rendues (queue révélée, fenêtre bornée). En mode
  // « cette requête seule », on filtre TOUTES les lignes révélées par le
  // requestId suivi (suivre une requête de bout en bout, comme dans le Live).
  const windowStart = Math.max(0, revealed - RENDER_WINDOW);
  const visible =
    focusOnly && focusRid
      ? lines
          .slice(0, revealed)
          .filter((l) => l.record.requestId === focusRid)
          .slice(-RENDER_WINDOW)
      : lines.slice(windowStart, revealed);

  if (!enabled) {
    return (
      <Alert
        color="blue"
        variant="light"
        icon={<IconInfoCircle size={16} />}
        title="Rejeu indisponible (production)"
      >
        {reason ??
          "En production, les logs vont sur stdout/stderr → collecteur. Pas de fichiers locaux à rejouer."}
      </Alert>
    );
  }

  return (
    <Stack gap="sm">
      {/* Sélection + transport. */}
      <Paper p="xs" withBorder radius="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="xs" wrap="nowrap">
            <Select
              size="xs"
              data={fileOptions}
              value={selected}
              onChange={setSelected}
              placeholder="Choisir un fichier…"
              searchable
              style={{ minWidth: 260 }}
              nothingFoundMessage="Aucun fichier .log"
            />
            <Tooltip label="Recharger le fichier">
              <ActionIcon
                variant="default"
                onClick={loadFile}
                aria-label="recharger"
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <DocHint
              title="Rejeu d'un fichier de log"
              version={LOGS_DOC}
              summary="Rejoue le fichier comme un enregistrement : le rythme respecte les écarts de temps réels entre logs (bornés à 2,5 s), divisés par la vitesse."
              sections={[
                {
                  label: "Formats",
                  body: "Comprend le JSON (driver d'écriture « fichier ») et le texte console. Le JSON donne le rythme le plus fidèle.",
                },
                {
                  label: "Si vide",
                  body: "Aucun fichier ? Le serveur écrit sur la console par défaut. Passe le driver d'écriture sur « fichier » (config.log.driver) pour générer des .log rejouables.",
                },
              ]}
            />
          </Group>

          <Group gap="xs" wrap="nowrap">
            <Tooltip
              label={
                playing ? "Pause" : revealed >= total ? "Rejouer" : "Lecture"
              }
            >
              <ActionIcon
                variant="filled"
                color="brand"
                onClick={togglePlay}
                disabled={total === 0}
                aria-label={playing ? "pause" : "lecture"}
              >
                {playing ? (
                  <IconPlayerPause size={16} />
                ) : (
                  <IconPlayerPlay size={16} />
                )}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Reprendre au début">
              <ActionIcon
                variant="default"
                onClick={restart}
                disabled={total === 0}
                aria-label="reprendre au début"
              >
                <IconPlayerTrackPrev size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Tout afficher (fin)">
              <ActionIcon
                variant="default"
                onClick={showAll}
                disabled={total === 0}
                aria-label="tout afficher"
              >
                <IconPlayerSkipForward size={16} />
              </ActionIcon>
            </Tooltip>
            <SegmentedControl
              size="xs"
              value={String(speed)}
              onChange={(v) => setSpeed(Number(v))}
              data={SPEEDS.map((s) => ({ value: String(s), label: `×${s}` }))}
              aria-label="vitesse de rejeu"
            />
          </Group>
        </Group>

        {/* Progression : scrub + position + temps simulé. */}
        <Group gap="sm" wrap="nowrap" mt="xs">
          <Text
            size="xs"
            c="dimmed"
            style={{ fontVariantNumeric: "tabular-nums", minWidth: 92 }}
          >
            {revealed} / {total}
          </Text>
          <Slider
            flex={1}
            size="sm"
            min={0}
            max={Math.max(total, 1)}
            value={revealed}
            onChange={(v) => {
              setPlaying(false);
              setRevealed(v);
            }}
            label={(v) => `${v} / ${total}`}
            disabled={total === 0}
            aria-label="position de rejeu"
          />
          <Text
            size="xs"
            c="dimmed"
            style={{ fontVariantNumeric: "tabular-nums", minWidth: 110 }}
          >
            {(elapsedMs / 1000).toFixed(1)}s / {(totalMs / 1000).toFixed(1)}s
          </Text>
        </Group>

        {/* Suivi d'une requête (clic sur un badge requestId d'une ligne). */}
        {focusRid && (
          <Group gap="xs" wrap="nowrap" mt="xs">
            <Badge
              variant="light"
              color="grape"
              leftSection={<IconRoute2 size={12} />}
              style={{ fontFamily: "monospace" }}
            >
              Suivi : {focusRid.slice(0, 8)} — {focusCount} ligne(s)
            </Badge>
            <Switch
              size="xs"
              label="Cette requête seule"
              checked={focusOnly}
              onChange={(e) => setFocusOnly(e.currentTarget.checked)}
            />
            <Tooltip label="Arrêter le suivi">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setFocusRid("");
                  setFocusOnly(false);
                }}
                aria-label="arrêter le suivi de requête"
              >
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Paper>

      {error && (
        <Alert color="red" variant="light" title="Erreur">
          {error}
        </Alert>
      )}

      {/* Viewport du rejeu. */}
      <Paper withBorder radius="md">
        <ScrollArea
          h={500}
          viewportRef={viewportRef}
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
          {total === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {selected
                ? "Fichier vide ou non daté."
                : "Sélectionne un fichier à rejouer."}
            </Text>
          ) : revealed === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              Prêt — appuie sur ▶ pour rejouer {total} ligne(s).
            </Text>
          ) : (
            <Stack gap={0} p="xs">
              {visible.map((l) => {
                const rec = l.record;
                const flow = describeFlow(rec);
                const isLast = l.index === revealed - 1;
                const isFocus = focusRid !== "" && rec.requestId === focusRid;
                return (
                  <Group
                    key={l.index}
                    gap={6}
                    wrap="nowrap"
                    align="flex-start"
                    onClick={() => setDetail(rec)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail(rec);
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      padding: "1px 4px",
                      borderRadius: 4,
                      // Tête de lecture (dernière révélée) = fond accentué ;
                      // ligne de la requête suivie = liseré gauche grape.
                      background: isLast
                        ? "var(--mantine-color-brand-light)"
                        : undefined,
                      borderLeft: isFocus
                        ? "2px solid var(--mantine-color-grape-6)"
                        : "2px solid transparent",
                    }}
                  >
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtClock(rec.timeStamp)}
                      <Text span size="xs" opacity={0.6}>
                        .{fmtMillis(rec.timeStamp)}
                      </Text>
                    </Text>
                    <SeverityBadge severity={rec.severityName} />
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
                    {rec.requestId && (
                      <Tooltip
                        label={
                          isFocus
                            ? "Arrêter de suivre cette requête"
                            : `Suivre la requête ${rec.requestId.slice(0, 8)}`
                        }
                      >
                        <Badge
                          size="xs"
                          variant={isFocus ? "filled" : "outline"}
                          color="grape"
                          style={{
                            flexShrink: 0,
                            fontFamily: "monospace",
                            cursor: "pointer",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocusRid(isFocus ? "" : rec.requestId!);
                          }}
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
      </Paper>

      {/* Détail d'une ligne — chronologie dérivée du FICHIER (source locale),
          pas du ring mémoire (les logs d'un fichier rejoué en sont absents). */}
      <PduDetailDrawer
        record={detail}
        onClose={() => setDetail(null)}
        localRecords={allRecords}
        onTrace={(rid) => {
          setDetail(null);
          setFocusRid(rid);
        }}
      />
    </Stack>
  );
});
