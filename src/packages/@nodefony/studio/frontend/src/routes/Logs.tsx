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
import { useConnection } from "../stores";

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITIC";

interface LogEntry {
  id: string;
  ts: number;
  severity: Severity;
  moduleName: string;
  message: string;
  requestId: string | null;
}

const SEVERITIES: Severity[] = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITIC"];

const SEVERITY_COLOR: Record<Severity, string> = {
  DEBUG: "gray",
  INFO: "blue",
  WARNING: "yellow",
  ERROR: "red",
  CRITIC: "red",
};

const MAX_ENTRIES = 200;

// Pool de mocks utilisé tant que P13.4 RealtimeService n'est pas prêt.
const MOCK_MODULES = [
  "http",
  "framework",
  "security",
  "kernel",
  "studio",
  "syslog",
  "container",
];
const MOCK_TEMPLATES: { sev: Severity; tpl: string }[] = [
  { sev: "INFO", tpl: "Request matched route {route}" },
  { sev: "INFO", tpl: "Service {svc} initialized in {ms}ms" },
  { sev: "DEBUG", tpl: "Cache hit for key '{key}'" },
  { sev: "DEBUG", tpl: "DI Container resolved {svc}" },
  { sev: "WARNING", tpl: "Slow query: {ms}ms on table {svc}" },
  { sev: "WARNING", tpl: "Deprecated config key '{key}' — see migration guide" },
  { sev: "ERROR", tpl: "Connection refused to {svc}: ECONNREFUSED" },
  { sev: "ERROR", tpl: "Failed to parse JSON body: unexpected token at pos {ms}" },
  { sev: "CRITIC", tpl: "Out of memory: heap > 1.5GB" },
];
const MOCK_ROUTES = ["/api/users", "/api/sessions", "/health", "/nodefony", "/api/auth/login"];
const MOCK_KEYS = ["user:42", "session:abc123", "route:home", "config:env"];

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function mockLog(): LogEntry {
  const { sev, tpl } = rand(MOCK_TEMPLATES);
  const message = tpl
    .replace("{route}", rand(MOCK_ROUTES))
    .replace("{svc}", rand(MOCK_MODULES))
    .replace("{ms}", String(Math.floor(Math.random() * 500)))
    .replace("{key}", rand(MOCK_KEYS));
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    severity: sev,
    moduleName: rand(MOCK_MODULES),
    message,
    requestId: Math.random() < 0.7 ? Math.random().toString(36).slice(2, 10) : null,
  };
}

/**
 * Logs streaming — page beta-testeur de l'archi realtime P14.11.
 *
 * Pattern :
 *  - Subscribe au canal `syslog:tick` via `conn.subscribe()` au mount
 *  - useEffect cleanup → unsubscribe automatique au unmount
 *  - Le chip topbar reflète la souscription (badge "1 sub")
 *
 * MOCK : tant que P13.4 RealtimeService + P3.10 NCSA transport ne sont pas
 * en place, on simule des logs via `conn.simulateMessage()` toutes les ~600ms.
 * Le backend remplacera cette stub par de vrais events syslog server-pushed.
 */
export const Logs = observer(() => {
  const conn = useConnection();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity[]>([]);
  const [moduleFilter, setModuleFilter] = useState("");
  const [requestIdFilter, setRequestIdFilter] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // ── Subscription au hub realtime ────────────────────────────────────
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const payload = args[0] as LogEntry | undefined;
      if (!payload) return;
      if (pausedRef.current) return;
      setEntries((prev) => {
        const next = [...prev, payload];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    };
    const dispose = conn.subscribe("syslog:tick", handler);
    return () => dispose();
  }, [conn]);

  // ── Mock emitter (dev only — à supprimer en P13.4) ──────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current) return;
      conn.simulateMessage("syslog:tick", mockLog());
    }, 600 + Math.random() * 400);
    return () => clearInterval(id);
  }, [conn]);

  // ── Autoscroll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoscroll || !viewportRef.current) return;
    viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [entries, autoscroll]);

  // ── Filters ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (severityFilter.length > 0 && !severityFilter.includes(e.severity))
        return false;
      if (moduleFilter && !e.moduleName.toLowerCase().includes(moduleFilter.toLowerCase()))
        return false;
      if (
        requestIdFilter &&
        (!e.requestId || !e.requestId.toLowerCase().includes(requestIdFilter.toLowerCase()))
      )
        return false;
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
        color="blue"
        icon={<IconInfoCircle size={16} />}
        variant="light"
        title="Mock dev — backend WS arrivera en P13.4"
      >
        Cette page démo le pattern realtime cible : subscribe au mount via{" "}
        <Code>conn.subscribe(&quot;syslog:tick&quot;, handler)</Code>, dispose au unmount.
        Le compteur de subscriptions sur le chip topbar reflète l&apos;abonnement actif.
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
              {filtered.map((e) => {
                const time = new Date(e.ts);
                const hh = time.toTimeString().slice(0, 8);
                const ms = String(time.getMilliseconds()).padStart(3, "0");
                return (
                  <Group key={e.id} gap={6} wrap="nowrap" align="flex-start">
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {hh}.{ms}
                    </Text>
                    <Badge
                      size="xs"
                      color={SEVERITY_COLOR[e.severity]}
                      variant={e.severity === "CRITIC" ? "filled" : "light"}
                      style={{ flexShrink: 0, minWidth: 70, textAlign: "center" }}
                    >
                      {e.severity}
                    </Badge>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ flexShrink: 0, minWidth: 80 }}
                    >
                      {e.moduleName}
                    </Text>
                    {e.requestId && (
                      <Code style={{ flexShrink: 0, fontSize: 10 }}>
                        {e.requestId}
                      </Code>
                    )}
                    <Text size="xs" style={{ wordBreak: "break-word" }}>
                      {e.message}
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
