import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  Title,
} from "@mantine/core";
import {
  IconRefresh,
  IconAlertTriangle,
  IconSearch,
  IconAppWindow,
  IconPuzzle,
  IconFolder,
} from "@tabler/icons-react";
import { useStore } from "../stores";

/** Entrée de la liste `/nodefony/kernel/api/modules`. */
interface ModuleRow {
  key: string;
  name: string;
  version: string | null;
  isApp: boolean;
  path: string | null;
}
interface ModuleDetail extends ModuleRow {
  dependencies: string[];
}

const DEP_PREVIEW = 6;

/**
 * Modules — administration des modules Nodefony chargés (ex-bundles).
 * Inspirée de la vue legacy `monitoring-bundle/views/bundles/Bundle.vue`
 * (une carte par bundle : nom, version, dépendances). Branchée sur le data
 * plane réel : liste `/api/modules`, détails (deps) `/api/module/{name}`.
 */
export const Modules = observer(() => {
  const store = useStore();
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [details, setDetails] = useState<Record<string, ModuleDetail>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await store.api.getAbsolute<ModuleRow[]>(
        "/nodefony/kernel/api/modules",
      );
      setRows(Array.isArray(list) ? list : []);
      // Détails (dépendances) en parallèle — peu de modules, appels légers.
      const entries = await Promise.all(
        (list ?? []).map(async (m) => {
          try {
            const d = await store.api.getAbsolute<ModuleDetail>(
              `/nodefony/kernel/api/module/${encodeURIComponent(m.key)}`,
            );
            return [m.key, d] as const;
          } catch {
            return null;
          }
        }),
      );
      setDetails(Object.fromEntries(entries.filter((e): e is readonly [string, ModuleDetail] => e !== null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? rows.filter((r) => r.key.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      : rows;
  }, [rows, filter]);

  const appCount = rows.filter((r) => r.isApp).length;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>Modules</Title>
          <Text c="dimmed" size="sm">
            {rows.length} chargé(s) · {appCount} app · {rows.length - appCount} package(s)
          </Text>
        </Stack>
        <Group gap="sm">
          <TextInput
            placeholder="Filtrer…"
            leftSection={<IconSearch size={16} />}
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            w={220}
          />
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={loading} onClick={() => void load()}>
            Recharger
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Erreur">
          {error}
        </Alert>
      )}

      <Grid>
        {loading && rows.length === 0
          ? Array.from({ length: 6 }).map((_, i) => (
              <Grid.Col key={i} span={{ base: 12, sm: 6, lg: 4 }}>
                <Skeleton h={190} radius="md" />
              </Grid.Col>
            ))
          : filtered.map((m) => (
              <Grid.Col key={m.key} span={{ base: 12, sm: 6, lg: 4 }}>
                <ModuleCard m={m} detail={details[m.key]} />
              </Grid.Col>
            ))}
      </Grid>

      {!loading && filtered.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Aucun module ne correspond à « {filter} ».
        </Text>
      )}
    </Stack>
  );
});

function ModuleCard({ m, detail }: { m: ModuleRow; detail?: ModuleDetail }) {
  const deps = detail?.dependencies ?? [];
  const shown = deps.slice(0, DEP_PREVIEW);
  const rest = deps.length - shown.length;

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Card.Section
        withBorder
        inheritPadding
        py="sm"
        style={{ background: "var(--mantine-color-default-hover)" }}
      >
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" color={m.isApp ? "orange" : "gray"} size="lg" radius="md">
              {m.isApp ? <IconAppWindow size={20} /> : <IconPuzzle size={20} />}
            </ThemeIcon>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={600} truncate title={m.name}>
                {m.name}
              </Text>
              <Text size="xs" c="dimmed">
                {m.isApp ? "application" : "package"}
              </Text>
            </Stack>
          </Group>
          {m.version && (
            <Badge variant="default" size="sm" style={{ flexShrink: 0 }}>
              v{m.version}
            </Badge>
          )}
        </Group>
      </Card.Section>

      <Stack gap="sm" mt="md" style={{ flex: 1 }}>
        <Group gap={6} wrap="nowrap" c="dimmed">
          <IconFolder size={14} style={{ flexShrink: 0 }} />
          <Tooltip label={m.path ?? "—"} disabled={!m.path} multiline w={360}>
            <Text size="xs" ff="monospace" truncate>
              {m.path ?? "—"}
            </Text>
          </Tooltip>
        </Group>

        <div style={{ marginTop: "auto" }}>
          <Group justify="space-between" mb={6}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Dépendances
            </Text>
            {detail && (
              <Badge size="xs" variant="light" color="gray">
                {deps.length}
              </Badge>
            )}
          </Group>
          {!detail ? (
            <Group gap={6}>
              <Loader size="xs" />
              <Text size="xs" c="dimmed">chargement…</Text>
            </Group>
          ) : deps.length === 0 ? (
            <Text size="xs" c="dimmed">aucune</Text>
          ) : (
            <Group gap={6}>
              {shown.map((d) => (
                <Badge
                  key={d}
                  variant="outline"
                  size="sm"
                  color={d === "nodefony" || d.startsWith("@nodefony/") ? "orange" : "gray"}
                >
                  {d}
                </Badge>
              ))}
              {rest > 0 && (
                <Tooltip label={deps.slice(DEP_PREVIEW).join(", ")} multiline w={300}>
                  <Badge variant="light" size="sm" color="gray">
                    +{rest}
                  </Badge>
                </Tooltip>
              )}
            </Group>
          )}
        </div>
      </Stack>
    </Card>
  );
}

export default Modules;
