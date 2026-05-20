import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  IconStack2,
  IconBox,
  IconRoute,
  IconAffiliate,
  IconPackages,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { useStore } from "../stores";

/** Catégorie d'un module — pour distinguer core / framework / app / module. */
type CatId = "app" | "core" | "framework" | "module";
const CATS: Record<CatId, { label: string; color: string; Icon: Icon; order: number }> = {
  app: { label: "Application", color: "orange", Icon: IconAppWindow, order: 0 },
  core: { label: "Core", color: "grape", Icon: IconStack2, order: 1 },
  framework: { label: "Framework", color: "blue", Icon: IconBox, order: 2 },
  module: { label: "Module", color: "teal", Icon: IconPuzzle, order: 3 },
};
function categoryOf(m: { key: string; isApp: boolean; name: string; path: string | null }): CatId {
  if (m.key === "core") return "core";
  if (m.isApp) return "app";
  const p = m.path ?? "";
  if (p.includes("/src/packages/@nodefony/")) return "framework";
  if (p.includes("/src/modules/")) return "module";
  return m.name.startsWith("@nodefony/") ? "framework" : "module";
}

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
  services?: { name: string; class: string | null }[];
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
  const navigate = useNavigate();
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [details, setDetails] = useState<Record<string, ModuleDetail>>({});
  const [routeCounts, setRouteCounts] = useState<Record<string, number>>({});
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
      // Compteurs de routes par module (1 seul fetch, groupé par route.module).
      store.api
        .getAbsolute<{ module: string | null }[]>("/nodefony/framework/api/routes")
        .then((routes) => {
          const rc: Record<string, number> = {};
          (routes ?? []).forEach((r) => {
            if (r.module) rc[r.module] = (rc[r.module] ?? 0) + 1;
          });
          setRouteCounts(rc);
        })
        .catch(() => setRouteCounts({}));
      // Détails (dépendances + services) en parallèle — peu de modules, appels légers.
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

  const counts = useMemo(() => {
    const c: Record<CatId, number> = { app: 0, core: 0, framework: 0, module: 0 };
    rows.forEach((r) => (c[categoryOf(r)] += 1));
    return c;
  }, [rows]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>Modules</Title>
          <Text c="dimmed" size="sm">
            {rows.length} chargé(s) · {counts.framework} framework · {counts.module} module(s) · {counts.app} app · {counts.core} core
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

      {loading && rows.length === 0 ? (
        <Grid>
          {Array.from({ length: 6 }).map((_, i) => (
            <Grid.Col key={i} span={{ base: 12, sm: 6, lg: 4 }}>
              <Skeleton h={190} radius="md" />
            </Grid.Col>
          ))}
        </Grid>
      ) : (
        <>
          {/* Application + Core sur la même ligne (cartes auto-labellisées) */}
          {(() => {
            const top = filtered
              .filter((m) => {
                const c = categoryOf(m);
                return c === "app" || c === "core";
              })
              .sort((a, b) => CATS[categoryOf(a)].order - CATS[categoryOf(b)].order);
            if (!top.length) return null;
            return (
              <Grid>
                {top.map((m) => (
                  <Grid.Col key={m.key} span={{ base: 12, sm: 6 }}>
                    <ModuleCard
                      m={m}
                      cat={categoryOf(m)}
                      detail={details[m.key]}
                      routeCount={routeCounts[m.key] ?? 0}
                      onOpen={() => navigate(`/nodefony/modules/${encodeURIComponent(m.key)}`)}
                    />
                  </Grid.Col>
                ))}
              </Grid>
            );
          })()}

          {/* Framework + Modules applicatifs en sections */}
          {(["framework", "module"] as CatId[]).map((cat) => {
            const items = filtered.filter((m) => categoryOf(m) === cat);
            if (!items.length) return null;
            return (
              <Stack gap="sm" key={cat}>
                <Group gap="xs">
                  <ThemeIcon variant="light" color={CATS[cat].color} size="sm" radius="sm">
                    <CatIcon cat={cat} size={14} />
                  </ThemeIcon>
                  <Text size="sm" fw={700}>{CATS[cat].label}</Text>
                  <Badge size="sm" variant="light" color={CATS[cat].color}>{items.length}</Badge>
                </Group>
                <Grid>
                  {items.map((m) => (
                    <Grid.Col key={m.key} span={{ base: 12, sm: 6, lg: 4 }}>
                      <ModuleCard
                        m={m}
                        cat={cat}
                        detail={details[m.key]}
                        routeCount={routeCounts[m.key] ?? 0}
                        onOpen={() => navigate(`/nodefony/modules/${encodeURIComponent(m.key)}`)}
                      />
                    </Grid.Col>
                  ))}
                </Grid>
              </Stack>
            );
          })}
        </>
      )}

      {!loading && filtered.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Aucun module ne correspond à « {filter} ».
        </Text>
      )}
    </Stack>
  );
});

/** Icône de catégorie (composant Tabler résolu depuis CATS). */
function CatIcon({ cat, size }: { cat: CatId; size: number }) {
  const I = CATS[cat].Icon;
  return <I size={size} />;
}

function ModuleCard({
  m,
  cat,
  detail,
  routeCount,
  onOpen,
}: {
  m: ModuleRow;
  cat: CatId;
  detail?: ModuleDetail;
  routeCount: number;
  onOpen: () => void;
}) {
  const deps = detail?.dependencies ?? [];
  const shown = deps.slice(0, DEP_PREVIEW);
  const rest = deps.length - shown.length;
  const color = CATS[cat].color;
  // Le core est le socle du framework, pas un module : nom + sous-titre dédiés.
  const displayName = cat === "core" ? "Nodefony Core" : m.name;
  const subtitle = cat === "core" ? "socle du framework" : CATS[cat].label;

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      h="100%"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        borderLeft: `4px solid var(--mantine-color-${color}-6)`,
        transition: "border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `var(--mantine-color-${color}-5)`;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "var(--mantine-shadow-sm)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "";
        e.currentTarget.style.boxShadow = "";
        e.currentTarget.style.transform = "";
      }}
    >
      <Card.Section
        withBorder
        inheritPadding
        py="sm"
        style={{ background: "var(--mantine-color-default-hover)" }}
      >
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" color={color} size="lg" radius="md">
              <CatIcon cat={cat} size={20} />
            </ThemeIcon>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={600} truncate title={m.name}>
                {displayName}
              </Text>
              <Text size="xs" c={color} fw={600}>
                {subtitle}
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

        <Group gap="lg" wrap="nowrap">
          <Group gap={5} wrap="nowrap">
            <IconRoute size={13} style={{ opacity: 0.6 }} />
            <Text size="sm" fw={700}>{routeCount}</Text>
            <Text size="xs" c="dimmed">routes</Text>
          </Group>
          <Group gap={5} wrap="nowrap">
            <IconAffiliate size={13} style={{ opacity: 0.6 }} />
            <Text size="sm" fw={700}>{detail ? (detail.services?.length ?? 0) : "…"}</Text>
            <Text size="xs" c="dimmed">services</Text>
          </Group>
          <Group gap={5} wrap="nowrap">
            <IconPackages size={13} style={{ opacity: 0.6 }} />
            <Text size="sm" fw={700}>{detail ? deps.length : "…"}</Text>
            <Text size="xs" c="dimmed">deps</Text>
          </Group>
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
