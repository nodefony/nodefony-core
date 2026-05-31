import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  Title,
  Badge,
  ScrollArea,
  Stack,
  Select,
  Switch,
  ActionIcon,
  Tooltip,
  Code,
  Text,
  Paper,
  Alert,
} from "@mantine/core";
import {
  IconRefresh,
  IconPlayerPause,
  IconPlayerPlay,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconFileText,
} from "@tabler/icons-react";
import { useStore } from "../stores";
import { ansiToReact } from "../utils/ansiToReact";
import { SeverityBadge } from "./logs/LogVisuals";

/** Métadonnée d'un fichier de log (réponse `/nodefony/syslog/api/files`). */
interface LogFileMeta {
  name: string;
  size: number;
  mtime: number;
}

interface FilesResponse {
  enabled: boolean;
  reason?: string;
  files: LogFileMeta[];
}

/** Réponse d'un tail incrémental (`/nodefony/syslog/api/files/{name}`). */
interface TailResponse {
  name: string;
  size: number;
  from: number;
  to: number;
  reset: boolean;
  redacted: boolean;
  lines: string[];
}

/** Intervalle de polling « follow » (replace tail -f). */
const POLL_MS = 1500;
/** Plafond de lignes conservées côté client (évite la croissance infinie). */
const MAX_LINES = 5000;

/** Format octets lisible. */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Tente de parser une ligne JSON en Pdu (le `FileTransport` écrit du JSON par
 * défaut). Renvoie l'objet si c'est un Pdu (présence de `severityName`), sinon
 * `null` → la ligne sera rendue en texte brut.
 */
function parsePdu(line: string): Record<string, unknown> | null {
  try {
    const o: unknown = JSON.parse(line);
    if (o && typeof o === "object" && "severityName" in o) {
      return o as Record<string, unknown>;
    }
  } catch {
    /* pas du JSON — ligne texte */
  }
  return null;
}

/** Rend une ligne : Pdu structuré coloré si parseable, sinon texte ANSI brut. */
function LogLine({ line }: { line: string }) {
  const pdu = parsePdu(line);
  if (!pdu) {
    return (
      <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {ansiToReact(line)}
      </Text>
    );
  }
  const sev = String(pdu.severityName ?? "");
  const ts = pdu.timeStamp;
  const time =
    typeof ts === "number" || typeof ts === "string" ? new Date(ts) : null;
  const hhmmss = time ? time.toTimeString().slice(0, 8) : "";
  const ms = time ? String(time.getMilliseconds()).padStart(3, "0") : "";
  const moduleName = String(pdu.moduleName ?? "");
  const payload = pdu.payload;
  const msg =
    typeof payload === "string"
      ? payload
      : typeof pdu.msg === "string" && pdu.msg
        ? pdu.msg
        : (() => {
            try {
              return JSON.stringify(payload);
            } catch {
              return String(payload);
            }
          })();
  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      {time && (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {hhmmss}.{ms}
        </Text>
      )}
      <SeverityBadge severity={sev} />
      <Text size="xs" c="dimmed" style={{ flexShrink: 0, minWidth: 80 }}>
        {moduleName}
      </Text>
      <Text size="xs" style={{ wordBreak: "break-word" }}>
        {ansiToReact(msg)}
      </Text>
    </Group>
  );
}

/**
 * Viewer de **fichiers** de log (confort DEV — remplace `tail -f`).
 *
 * Lit les fichiers `*.log` du `kernel.tmpDir` via le data plane syslog
 * (`/nodefony/syslog/api/files` + `/files/{name}`). « Follow » = polling
 * incrémental par offset (`?from=<to>`) : ne re-télécharge que les octets
 * ajoutés depuis le dernier tick → équivalent `tail -f` sans `tail -f`.
 *
 * **DEV only** : en prod, l'endpoint renvoie `enabled:false` (cloud-native —
 * les logs vont sur stdout/stderr → collecteur ; la rotation n'est pas le rôle
 * de Nodefony). Les secrets sont **masqués côté serveur** par défaut (toggle
 * « brut » pour le debug local).
 */
export const LogFiles = observer(() => {
  const store = useStore();
  const [files, setFiles] = useState<LogFileMeta[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const nextFrom = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // ── Liste des fichiers (au montage) ─────────────────────────────────────
  const loadFiles = useCallback(() => {
    store.api
      .getAbsolute<FilesResponse>("/nodefony/syslog/api/files")
      .then((res) => {
        setEnabled(res.enabled);
        setReason(res.reason);
        setFiles(res.files ?? []);
        setSelected((prev) =>
          prev ?? (res.files?.length ? res.files[0].name : null),
        );
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "files list failed"),
      );
  }, [store]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // ── Tail initial (au changement de fichier / mode brut) ─────────────────
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLines([]);
    nextFrom.current = 0;
    const raw = showRaw ? "1" : "0";
    store.api
      .getAbsolute<TailResponse>(
        `/nodefony/syslog/api/files/${encodeURIComponent(selected)}?lines=500&raw=${raw}`,
      )
      .then((res) => {
        if (cancelled) return;
        setLines(res.lines);
        nextFrom.current = res.to;
        setSize(res.size);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "tail failed"),
      );
    return () => {
      cancelled = true;
    };
  }, [selected, showRaw, store]);

  // ── Follow : polling incrémental par offset ─────────────────────────────
  useEffect(() => {
    if (!follow || !selected) return;
    const raw = showRaw ? "1" : "0";
    const tick = () => {
      store.api
        .getAbsolute<TailResponse>(
          `/nodefony/syslog/api/files/${encodeURIComponent(selected)}?from=${nextFrom.current}&raw=${raw}`,
        )
        .then((res) => {
          nextFrom.current = res.to;
          setSize(res.size);
          if (res.reset) {
            // rotation/troncature externe → on repart de la fenêtre renvoyée
            setLines(res.lines);
            return;
          }
          if (res.lines.length === 0) return;
          setLines((prev) => {
            const next = [...prev, ...res.lines];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        })
        .catch(() => {
          /* tick raté — on retentera au prochain intervalle */
        });
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [follow, selected, showRaw, store]);

  // ── Autoscroll en bas quand on suit ─────────────────────────────────────
  useEffect(() => {
    if (!follow || !viewportRef.current) return;
    viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [lines, follow]);

  const fileOptions = useMemo(
    () =>
      files.map((f) => ({
        value: f.name,
        label: `${f.name}  ·  ${fmtBytes(f.size)}`,
      })),
    [files],
  );

  if (!enabled) {
    return (
      <Alert
        color="blue"
        icon={<IconInfoCircle size={16} />}
        variant="light"
        title="Fichiers de log indisponibles (production)"
      >
        {reason ??
          "En production, les logs vont sur stdout/stderr → collecteur. La rotation et la rétention sont gérées par la plateforme (cloud-native), pas par Nodefony."}
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <IconFileText size={18} />
          <Title order={3}>Fichiers de log</Title>
          <Badge size="sm" variant="dot" color={follow ? "teal" : "yellow"}>
            {follow ? "Follow" : "Pause"}
          </Badge>
          <Text size="sm" c="dimmed">
            {lines.length} lignes · {fmtBytes(size)}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label="Rafraîchir la liste">
            <ActionIcon
              variant="default"
              onClick={loadFiles}
              aria-label="refresh files"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={follow ? "Stopper le suivi" : "Suivre (tail -f)"}>
            <ActionIcon
              variant="default"
              onClick={() => setFollow((f) => !f)}
              aria-label="toggle follow"
            >
              {follow ? (
                <IconPlayerPause size={16} />
              ) : (
                <IconPlayerPlay size={16} />
              )}
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={
              showRaw
                ? "Masquer les secrets (recommandé)"
                : "Afficher le contenu brut (secrets visibles)"
            }
          >
            <ActionIcon
              variant={showRaw ? "filled" : "default"}
              color={showRaw ? "orange" : undefined}
              onClick={() => setShowRaw((r) => !r)}
              aria-label="toggle raw"
            >
              {showRaw ? <IconEye size={16} /> : <IconEyeOff size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Paper p="xs" withBorder>
        <Group gap="xs" wrap="wrap">
          <Select
            data={fileOptions}
            value={selected}
            onChange={setSelected}
            placeholder="Choisir un fichier…"
            searchable
            size="xs"
            style={{ minWidth: 320 }}
            nothingFoundMessage="Aucun fichier .log"
          />
          <Badge
            size="sm"
            variant="light"
            color={showRaw ? "orange" : "teal"}
          >
            {showRaw ? "brut (secrets visibles)" : "secrets masqués"}
          </Badge>
        </Group>
      </Paper>

      {error && (
        <Alert color="red" variant="light" title="Erreur">
          {error}
        </Alert>
      )}

      <Paper withBorder>
        <ScrollArea
          h={520}
          viewportRef={viewportRef}
          type="auto"
          styles={{
            viewport: {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              lineHeight: 1.5,
            },
          }}
        >
          {lines.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {selected ? "Fichier vide ou en attente…" : "Sélectionne un fichier."}
            </Text>
          ) : (
            <Stack gap={0} p="xs">
              {lines.map((line, i) => (
                <LogLine key={`${nextFrom.current}-${i}`} line={line} />
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Paper>

      <Text size="xs" c="dimmed">
        <Code>/nodefony/syslog/api/files</Code> (DEV) — tail incrémental par
        offset (<Code>?from=</Code>), redaction serveur des secrets. Confort dev
        : en prod, logs → stdout → collecteur.
      </Text>
    </Stack>
  );
});
