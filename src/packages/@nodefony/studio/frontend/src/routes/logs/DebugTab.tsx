/**
 * **DebugTab** — onglet « Debug » de la page Logs : CONTRÔLE du debug runtime
 * (par module OU global `*`, à chaud, sans redéploiement). Consomme le data-plane
 * `/nodefony/kernel/api/log/level` (GET état · PATCH set/clear).
 *
 * Conçu en ZONE DANGER (vrais contrôles, pas un badge « live » sans bouton) :
 * activer élève la verbosité jusqu'à un niveau, avec **auto-extinction** imposée
 * (countdown) — y compris pour « tous les modules » (`*`), qui réutilise le même
 * TTL → un « debug tout » reste borné. Éteindre = un clic.
 *
 * Sélection du module : Autocomplete (saisie libre + suggestions = les `msgid`
 * réellement émis dans les logs récents + les overrides actifs) → on n'a pas à
 * connaître le nom exact par cœur. Case « Tous les modules » = wildcard `*`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useStore } from "../../stores";
import { useResource } from "../../hooks";

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
/** Libellé d'un module dans l'UI (`*` = tous). */
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

/** Cadence de re-synchro (calme) : capte l'expiration TTL + un toggle externe. */
const POLL_MS = 10_000;

/** Réponse minimale de la relecture de logs (pour suggérer les msgid connus). */
interface LogsSearchLite {
  rows?: { msgid?: string }[];
}

/**
 * Compte à rebours calme — tick 1 s ISOLÉ dans ce sous-composant (le reste de
 * l'onglet ne re-render pas), `tabular-nums` (0 jitter de largeur).
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

export function DebugTab({ onGoLive }: { onGoLive?: () => void }) {
  const store = useStore();
  const fetcher = useCallback(
    () => store.api.getAbsolute<DebugState>("/nodefony/kernel/api/log/level"),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);

  // Suggestions de modules = msgid réellement émis (best-effort : si la relecture
  // échoue, l'Autocomplete garde la saisie libre).
  const sugFetcher = useCallback(
    () =>
      store.api.getAbsolute<LogsSearchLite>(
        "/nodefony/syslog/api/logs/search?limit=300",
      ),
    [store],
  );
  const { data: sug } = useResource(sugFetcher);

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

  const target = allModules ? "*" : moduleName.trim();

  const activate = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      await store.api.patchAbsolute("/nodefony/kernel/api/log/level", {
        module: target,
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
  }, [store, target, allModules, level, ttl, reload]);

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
        title="Ce panneau CONTRÔLE le debug — le flux de logs est dans « Live »"
      >
        Ici tu allumes / éteins la verbosité. Le <b>flux des logs</b> s'affiche
        dans l'onglet{" "}
        <Anchor component="button" type="button" onClick={onGoLive} fw={600}>
          Live
        </Anchor>
        . ⚠️ En <b>développement</b>, tout est déjà en DEBUG → activer un module
        ne change la visibilité qu'en <b>production</b> (où les logs sont filtrés
        à INFO). L'effet est donc surtout visible en prod / sur un incident réel.
      </Alert>
      <Alert
        variant="light"
        color="red"
        icon={<IconAlertTriangle size={18} />}
        title="Debug runtime — ce n'est pas anodin"
      >
        Élever la verbosité À CHAUD (sans redéploiement) est précieux pour
        diagnostiquer un incident — mais coûteux : volume de logs, données métier
        exposées au flux, pression I/O, et bruit qui noie les vraies erreurs.{" "}
        <b>Auto-extinction imposée</b> (le serveur éteint seul), même pour « tous
        les modules ». À réserver à une fenêtre de diagnostic.
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
            disabled={!target}
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

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm">
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
            Aucun debug ciblé. Tout suit le seuil global.
          </Text>
        ) : (
          <Stack gap="xs">
            {modules.map((m) => (
              <Group key={m} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge color="red" variant="filled" tt="none">
                    {moduleLabel(m)}
                  </Badge>
                  <Text size="sm">→ {sevName(overrides[m])}</Text>
                  <Countdown at={expiresAt[m]} />
                </Group>
                <Tooltip label={`Éteindre ${moduleLabel(m)}`}>
                  <ActionIcon
                    variant="light"
                    color="red"
                    aria-label={`Éteindre le debug de ${moduleLabel(m)}`}
                    onClick={() => turnOff(m)}
                    loading={busy}
                  >
                    <IconPower size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
