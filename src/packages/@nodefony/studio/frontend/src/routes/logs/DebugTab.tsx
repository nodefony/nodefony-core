/**
 * **DebugTab** — onglet « Debug » de la page Logs : CONTRÔLE du debug runtime
 * (par module OU global `*`, à chaud, sans redéploiement) + OBSERVATION couplée.
 * Consomme `/nodefony/kernel/api/log/level` (GET état · PATCH set/clear) et le
 * canal WS `syslog:stream` (flux live).
 *
 * Conçu en ZONE DANGER (vrais contrôles) avec **couplage action↔observation** :
 * chaque debug actif = une **carte autonome** (module · niveau · countdown ·
 * éteindre) qui affiche **son propre flux de logs filtré par `msgid`** qui défile
 * dedans → on voit l'effet sans changer d'onglet. Auto-extinction imposée (même
 * pour `*`). Calme : flux borné + `contain` par carte + tail auto-scrollé.
 *
 * Sélection du module : Autocomplete (saisie libre + suggestions = `msgid` réels
 * des logs récents). Case « Tous les modules » = wildcard `*`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBolt,
  IconBug,
  IconInfoCircle,
  IconPower,
} from "@tabler/icons-react";
import { useConnection, useStore } from "../../stores";
import { useResource } from "../../hooks";
import { fmtClock, recordMessage, toRecord } from "./logFormat";
import { SeverityBadge } from "./LogVisuals";
import type { LogRecord } from "./logsTypes";

/** État du debug runtime (miroir local de `GET /kernel/api/log/level`). */
interface DebugState {
  globalDebug: boolean;
  overrides: Record<string, number>;
  expiresAt: Record<string, number>;
}

/** Noms RFC 5424 par index (miroir local — l'override stocke un numéro). */
const SEVERITY_NAMES = [
  "EMERGENCY",
  "ALERT",
  "CRITIC",
  "ERROR",
  "WARNING",
  "NOTICE",
  "INFO",
  "DEBUG",
] as const;
const sevName = (n: number): string => SEVERITY_NAMES[n] ?? String(n);
const moduleLabel = (m: string): string =>
  m === "*" ? "Tous les modules (*)" : m;

const LEVEL_OPTIONS = [
  { value: "DEBUG", label: "DEBUG (tout)" },
  { value: "INFO", label: "INFO" },
  { value: "NOTICE", label: "NOTICE" },
  { value: "WARNING", label: "WARNING" },
  { value: "ERROR", label: "ERROR" },
];
const TTL_OPTIONS = [
  { value: "300000", label: "5 minutes" },
  { value: "900000", label: "15 minutes" },
  { value: "1800000", label: "30 minutes" },
  { value: "3600000", label: "60 minutes" },
];

/** Cadence de re-synchro de l'état (calme). */
const POLL_MS = 10_000;
/** Plafond du flux live conservé côté client (croissance bornée). */
const MAX_ENTRIES = 400;
/** Lignes affichées par carte (tail). */
const TAIL = 60;

/** Réponse minimale de la relecture de logs (pour suggérer les msgid connus). */
interface LogsSearchLite {
  rows?: { msgid?: string }[];
}

/**
 * Compte à rebours calme — tick 1 s ISOLÉ (le reste ne re-render pas),
 * `tabular-nums`.
 */
function Countdown({ at }: { at: number | undefined }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (at === undefined) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [at]);
  if (at === undefined) {
    return (
      <Text size="xs" c="dimmed">
        permanent
      </Text>
    );
  }
  const total = Math.max(0, Math.floor((at - Date.now()) / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return (
    <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
      s'éteint dans {mm}:{String(ss).padStart(2, "0")}
    </Text>
  );
}

/**
 * Carte d'un debug actif = en-tête (module/niveau/countdown/éteindre) + son flux
 * filtré (`msgid`, ou tout pour `*`) qui défile. Le filtrage/slice est mémoïsé ;
 * `contain: content` isole le repaint à la carte.
 */
function DebugCard({
  module,
  level,
  expireAt,
  entries,
  onTurnOff,
  busy,
}: {
  module: string;
  level: number;
  expireAt: number | undefined;
  entries: LogRecord[];
  onTurnOff: (m: string) => void;
  busy: boolean;
}) {
  const tail = useMemo(() => {
    const matching =
      module === "*" ? entries : entries.filter((r) => r.msgid === module);
    return matching.slice(-TAIL);
  }, [entries, module]);

  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = viewportRef.current;
    if (v) v.scrollTo({ top: v.scrollHeight });
  }, [tail.length]);

  return (
    <Card
      withBorder
      padding="sm"
      style={{
        borderColor: "var(--mantine-color-red-4)",
        contain: "content",
      }}
    >
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge color="red" variant="filled" tt="none">
            {moduleLabel(module)}
          </Badge>
          <Text size="sm">→ {sevName(level)}</Text>
          <Countdown at={expireAt} />
        </Group>
        <Tooltip label={`Éteindre ${moduleLabel(module)}`}>
          <ActionIcon
            variant="light"
            color="red"
            aria-label={`Éteindre le debug de ${moduleLabel(module)}`}
            onClick={() => onTurnOff(module)}
            loading={busy}
          >
            <IconPower size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <ScrollArea
        h={150}
        viewportRef={viewportRef}
        type="auto"
        style={{
          background: "var(--mantine-color-dark-8)",
          borderRadius: 6,
          padding: "4px 8px",
        }}
      >
        {tail.length === 0 ? (
          <Text size="xs" c="dimmed" py="xs">
            En attente de logs de ce module…
          </Text>
        ) : (
          <Stack gap={1}>
            {tail.map((r, i) => (
              <Group
                key={`${r.uid}-${i}`}
                gap={6}
                wrap="nowrap"
                align="baseline"
              >
                <Text
                  size="xs"
                  c="dimmed"
                  ff="monospace"
                  style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                >
                  {fmtClock(r.timeStamp)}
                </Text>
                <SeverityBadge severity={r.severityName} />
                <Text size="xs" truncate ff="monospace">
                  {recordMessage(r)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Card>
  );
}

export function DebugTab({ onGoLive }: { onGoLive?: () => void }) {
  const store = useStore();
  const conn = useConnection();
  const fetcher = useCallback(
    () => store.api.getAbsolute<DebugState>("/nodefony/kernel/api/log/level"),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);

  // Suggestions de modules = msgid réellement émis (best-effort).
  const sugFetcher = useCallback(
    () =>
      store.api.getAbsolute<LogsSearchLite>(
        "/nodefony/syslog/api/logs/search?limit=300",
      ),
    [store],
  );
  const { data: sug } = useResource(sugFetcher);

  // Flux live partagé (1 abonnement) — chaque carte filtre par msgid.
  const [entries, setEntries] = useState<LogRecord[]>([]);
  useEffect(() => {
    const handler = (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const rec = raw as { logs?: unknown[]; dropped?: number };
      const items = Array.isArray(rec.logs) ? rec.logs : [raw];
      const views: LogRecord[] = [];
      for (const d of items) {
        const r = toRecord(d);
        if (r) views.push(r);
      }
      if (views.length === 0) return;
      setEntries((prev) => {
        const next = [...prev, ...views];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    };
    const dispose = conn.subscribe("syslog:stream", handler);
    return () => dispose();
  }, [conn]);

  const [allModules, setAllModules] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [level, setLevel] = useState<string | null>("DEBUG");
  const [ttl, setTtl] = useState<string | null>("900000");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const r of sug?.rows ?? []) if (r.msgid) set.add(r.msgid);
    for (const m of Object.keys(data?.overrides ?? {})) {
      if (m !== "*") set.add(m);
    }
    return [...set].sort();
  }, [sug, data]);

  const targetModule = allModules ? "*" : moduleName.trim();

  const activate = useCallback(async () => {
    if (!targetModule) return;
    setBusy(true);
    setActionError(null);
    try {
      await store.api.patchAbsolute("/nodefony/kernel/api/log/level", {
        module: targetModule,
        level: level ?? "DEBUG",
        ttlMs: Number(ttl ?? "900000"),
      });
      if (!allModules) setModuleName("");
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Échec de l'activation");
    } finally {
      setBusy(false);
    }
  }, [store, targetModule, allModules, level, ttl, reload]);

  const turnOff = useCallback(
    async (m: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await store.api.patchAbsolute("/nodefony/kernel/api/log/level", {
          module: m,
          level: "off",
        });
        reload();
      } catch (e) {
        setActionError(
          e instanceof Error ? e.message : "Échec de l'extinction",
        );
      } finally {
        setBusy(false);
      }
    },
    [store, reload],
  );

  const overrides = data?.overrides ?? {};
  const expiresAt = data?.expiresAt ?? {};
  const modules = Object.keys(overrides);

  return (
    <Stack gap="md">
      <Alert
        variant="light"
        color="blue"
        icon={<IconInfoCircle size={18} />}
        title="Active un debug ciblé — ses logs défilent dans sa carte ci-dessous"
      >
        Chaque debug actif crée une <b>carte avec son propre flux</b> (filtré sur
        son module). ⚠️ En <b>développement</b>, tout est déjà en DEBUG → activer
        un module ne change la visibilité qu'en <b>production</b> (logs filtrés à
        INFO). Le flux complet reste dans l'onglet{" "}
        <Anchor component="button" type="button" onClick={onGoLive} fw={600}>
          Live
        </Anchor>
        .
      </Alert>

      <Card
        withBorder
        padding="lg"
        style={{ borderColor: "var(--mantine-color-red-5)" }}
      >
        <Group gap="xs" mb="sm">
          <ThemeIcon variant="light" color="red" radius="md">
            <IconBolt size={18} />
          </ThemeIcon>
          <Title order={4} c="red">
            Zone danger — activer le debug
          </Title>
        </Group>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Autocomplete
            label="Module (msgid)"
            placeholder="ex : FIREWALL, SESSION, HTTP-KERNEL"
            data={suggestions}
            value={moduleName}
            onChange={setModuleName}
            disabled={allModules}
            description={allModules ? "Désactivé : tous les modules" : undefined}
            style={{ flex: "1 1 240px" }}
          />
          <Select
            label="Niveau"
            data={LEVEL_OPTIONS}
            value={level}
            onChange={setLevel}
            allowDeselect={false}
            style={{ width: 160 }}
          />
          <Select
            label="Auto-extinction"
            data={TTL_OPTIONS}
            value={ttl}
            onChange={setTtl}
            allowDeselect={false}
            style={{ width: 160 }}
          />
          <Button
            color="red"
            leftSection={<IconBug size={16} />}
            onClick={activate}
            loading={busy}
            disabled={!targetModule}
          >
            Activer le debug
          </Button>
        </Group>
        <Checkbox
          mt="sm"
          color="red"
          label="Tous les modules (*) — debug global temporisé"
          checked={allModules}
          onChange={(e) => setAllModules(e.currentTarget.checked)}
        />
        {actionError ? (
          <Text size="xs" c="red" mt="xs">
            {actionError}
          </Text>
        ) : null}
      </Card>

      <Group justify="space-between">
        <Title order={5}>Debug actif</Title>
        {data?.globalDebug ? (
          <Tooltip label="Seuil global = DEBUG (via -d / NF__DEBUG, réglé au boot)">
            <Badge color="orange" variant="light">
              DEBUG global actif
            </Badge>
          </Tooltip>
        ) : null}
      </Group>

      {loading && !data ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Chargement…
          </Text>
        </Group>
      ) : error ? (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      ) : modules.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun debug ciblé. Tout suit le seuil global — active un module
          ci-dessus pour voir son flux ici.
        </Text>
      ) : (
        <Stack gap="sm">
          {modules.map((m) => (
            <DebugCard
              key={m}
              module={m}
              level={overrides[m]}
              expireAt={expiresAt[m]}
              entries={entries}
              onTurnOff={turnOff}
              busy={busy}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
