import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  Title,
  Badge,
  ScrollArea,
  Stack,
  TextInput,
  MultiSelect,
  Switch,
  ActionIcon,
  Tooltip,
  Code,
  Text,
  Paper,
  Alert,
} from "@mantine/core";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
  IconFilter,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Pdu } from "nodefony";
import { useConnection } from "../stores";
import { ansiToReact } from "../utils/ansiToReact";

const SEVERITIES = [
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARNING",
  "ERROR",
  "CRITIC",
  "ALERT",
  "EMERGENCY",
] as const;
type Severity = (typeof SEVERITIES)[number];

const SEVERITY_COLOR: Record<string, string> = {
  DEBUG: "gray",
  INFO: "blue",
  NOTICE: "cyan",
  WARNING: "yellow",
  ERROR: "red",
  CRITIC: "red",
  ALERT: "red",
  EMERGENCY: "red",
};

const MAX_ENTRIES = 500;

interface PduView {
  /** Pdu instance hydratée côté browser via le Core isomorphe. */
  pdu: Pdu;
  /** id local pour React key (uid Pdu peut collisionner sur reconnect). */
  key: string;
}

/**
 * Logs streaming — page beta-testeur de l'archi realtime P14.11.
 *
 * Vision isomorphe :
 *  - Backend (StudioController) attache un listener sur `kernel.syslog.on("onLog", pdu)`
 *    et stream chaque Pdu en JSON via SSE (`/nodefony/api/logs/stream`).
 *  - Frontend rehydrate chaque event en `new Pdu()` via le Core isomorphe
 *    (`import { Pdu } from "nodefony"` → exports.browser).
 *  - La même classe Pdu est utilisée des deux côtés — 1 seule source de vérité.
 *
 * Le hub `ConnectionStore` track la subscription (chip topbar "1 sub").
 * Sera migré vers WS pub/sub en P13.4.
 */
export const Logs = observer(() => {
  const conn = useConnection();
  const [entries, setEntries] = useState<PduView[]>([]);
  const [paused, setPaused] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity[]>([]);
  const [moduleFilter, setModuleFilter] = useState("");
  const [requestIdFilter, setRequestIdFilter] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const keyCounter = useRef(0);

  // ── Subscription SSE au syslog kernel via le hub realtime ───────────
  useEffect(() => {
    const handler = (data: unknown) => {
      if (pausedRef.current) return;
      if (!data || typeof data !== "object") return;
      // Hydratation isomorphe : new Pdu() vide + Object.assign — la même
      // classe Pdu est utilisée côté serveur pour sérialiser.
      const pdu = Object.assign(new Pdu(""), data) as Pdu;
      const view: PduView = {
        pdu,
        key: `${pdu.uid}-${keyCounter.current++}`,
      };
      setEntries((prev) => {
        const next = [...prev, view];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    };
    const dispose = conn.subscribeSSE(
      "syslog:stream",
      "/nodefony/api/logs/stream",
      handler,
    );
    return () => dispose();
  }, [conn]);

  // ── Autoscroll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoscroll || !viewportRef.current) return;
    viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [entries, autoscroll]);

  // ── Filters ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const sev = e.pdu.severityName as Severity;
      if (severityFilter.length > 0 && !severityFilter.includes(sev))
        return false;
      if (
        moduleFilter &&
        !e.pdu.moduleName.toLowerCase().includes(moduleFilter.toLowerCase())
      )
        return false;
      if (requestIdFilter) {
        const msgid = String(e.pdu.msgid ?? "");
        if (!msgid.toLowerCase().includes(requestIdFilter.toLowerCase()))
          return false;
      }
      return true;
    });
  }, [entries, severityFilter, moduleFilter, requestIdFilter]);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={2}>Logs streaming</Title>
          <Badge size="md" variant="light" color="orange">
            P14.11 beta
          </Badge>
          <Badge size="sm" variant="dot" color={paused ? "yellow" : "teal"}>
            {paused ? "Pause" : "Live"}
          </Badge>
          <Text size="sm" c="dimmed">
            {filtered.length} / {entries.length} entrées
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label={paused ? "Reprendre" : "Pause"}>
            <ActionIcon
              variant="default"
              onClick={() => setPaused((p) => !p)}
              aria-label="toggle pause"
            >
              {paused ? <IconPlayerPlay size={16} /> : <IconPlayerPause size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Effacer">
            <ActionIcon
              variant="default"
              onClick={() => setEntries([])}
              aria-label="clear"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Alert
        color="teal"
        icon={<IconInfoCircle size={16} />}
        variant="light"
        title="Streaming réel — Pdu du syslog kernel"
      >
        Vrais logs du <Code>kernel.syslog</Code> serveur, sérialisés en JSON
        via SSE (<Code>/nodefony/api/logs/stream</Code>) et rehydratés en{" "}
        <Code>new Pdu()</Code> côté browser via le Core isomorphe
        (<Code>import &#123; Pdu &#125; from &quot;nodefony&quot;</Code>).
        Migration vers WS pub/sub en P13.4.
      </Alert>

      <Paper p="xs" withBorder>
        <Group gap="xs" wrap="wrap">
          <IconFilter size={16} />
          <MultiSelect
            data={SEVERITIES}
            value={severityFilter}
            onChange={(v) => setSeverityFilter(v as Severity[])}
            placeholder="Sévérités"
            clearable
            size="xs"
            style={{ minWidth: 240 }}
          />
          <TextInput
            placeholder="module..."
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.currentTarget.value)}
            size="xs"
            style={{ width: 160 }}
          />
          <TextInput
            placeholder="requestId..."
            value={requestIdFilter}
            onChange={(e) => setRequestIdFilter(e.currentTarget.value)}
            size="xs"
            style={{ width: 200 }}
          />
          <Switch
            label="Autoscroll"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.currentTarget.checked)}
            size="xs"
          />
        </Group>
      </Paper>

      <Paper withBorder>
        <ScrollArea
          h={500}
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
          {filtered.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              En attente de logs…
            </Text>
          ) : (
            <Stack gap={0} p="xs">
              {filtered.map(({ pdu, key }) => {
                const time = new Date(pdu.timeStamp);
                const hh = time.toTimeString().slice(0, 8);
                const ms = String(time.getMilliseconds()).padStart(3, "0");
                const sev = pdu.severityName;
                const msg =
                  typeof pdu.payload === "string"
                    ? pdu.payload
                    : pdu.msg ||
                      (() => {
                        try {
                          return JSON.stringify(pdu.payload);
                        } catch {
                          return String(pdu.payload);
                        }
                      })();
                return (
                  <Group key={key} gap={6} wrap="nowrap" align="flex-start">
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {hh}.{ms}
                    </Text>
                    <Badge
                      size="xs"
                      color={SEVERITY_COLOR[sev] ?? "gray"}
                      variant={
                        sev === "CRITIC" ||
                        sev === "ALERT" ||
                        sev === "EMERGENCY"
                          ? "filled"
                          : "light"
                      }
                      style={{
                        flexShrink: 0,
                        minWidth: 70,
                        textAlign: "center",
                      }}
                    >
                      {sev}
                    </Badge>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ flexShrink: 0, minWidth: 80 }}
                    >
                      {pdu.moduleName}
                    </Text>
                    {pdu.msgid && (
                      <Code style={{ flexShrink: 0, fontSize: 10 }}>
                        {String(pdu.msgid)}
                      </Code>
                    )}
                    <Text size="xs" style={{ wordBreak: "break-word" }}>
                      {ansiToReact(msg)}
                    </Text>
                  </Group>
                );
              })}
            </Stack>
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
});
