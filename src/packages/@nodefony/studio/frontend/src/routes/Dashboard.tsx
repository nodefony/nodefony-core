import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import {
  Grid,
  Stack,
  Card,
  Group,
  Text,
  Title,
  Badge,
  Button,
  Table,
  ThemeIcon,
} from "@mantine/core";
import { Link } from "react-router-dom";
import {
  IconGitBranch,
  IconSettings,
  IconServer,
  IconDatabase,
  IconBox,
  IconRoute,
  IconAffiliate,
  IconChartBar,
  IconFileText,
  IconBug,
  IconBrandNodejs,
} from "@tabler/icons-react";
import { useStore, useAuth } from "../stores";
import { useResource } from "../hooks";
import {
  PageHeader,
  StatCard as Kpi,
  KeyValue as Row,
  DefinitionList,
  DataState,
} from "../components/ui";

/** Identité runtime statique (one-shot GET kernel/info). */
interface KernelInfo {
  version: string;
  environment: string;
  debug: boolean;
  domain: string;
  pid: number;
  node: string;
  platform: string;
  uptime: number;
  /** Identité git (branche + commit court) — fournie par le GitService core. */
  git?: { branch: string; commit: string };
}

/** Connecteur ORM exposé par /nodefony/orm/api/orms. */
interface OrmConn {
  name: string;
  /** Vendor (`drizzle`, `sequelize`, `mongoose`…) pour l'icône. */
  vendor?: string;
  default: boolean;
  connected: boolean;
  entityCount: number;
}

/** Couleur de marque + libellé par vendor ORM (icône colorée, a11y = couleur+texte). */
const VENDORS: Record<string, { color: string; label: string }> = {
  drizzle: { color: "#C5F74F", label: "Drizzle" },
  sequelize: { color: "#52B0E7", label: "Sequelize" },
  mongoose: { color: "#880000", label: "Mongoose" },
  mikroorm: { color: "#864342", label: "MikroORM" },
};

function uptimeStr(s: number): string {
  s = Math.floor(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}j ${p(h)}:${p(m)}` : `${p(h)}:${p(m)}:${p(s % 60)}`;
}

/**
 * Dashboard DEV — vue « comprendre le projet » : configuration, environnement,
 * git, ORM, modules. Données STATIQUES (data plane, `useResource`), pas de
 * realtime — le runtime/perf vit dans le board Supervision.
 */
export const Dashboard = observer(() => {
  const store = useStore();
  const auth = useAuth();

  const info = useResource(
    useCallback(
      () => store.api.getAbsolute<KernelInfo>("/nodefony/kernel/api/info"),
      [store],
    ),
  );
  const orms = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmConn[]>("/nodefony/orm/api/orms"),
      [store],
    ),
  );
  const mods = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<unknown[]>("/nodefony/kernel/api/modules"),
      [store],
    ),
  );
  const routes = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<{ routesTotal: number }>(
          "/nodefony/framework/api/info",
        ),
      [store],
    ),
  );

  const i = info.data;
  const moduleCount = Array.isArray(mods.data) ? mods.data.length : 0;
  const ormList = orms.data ?? [];
  const entityTotal = ormList.reduce((a, o) => a + (o.entityCount || 0), 0);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Dashboard Dev"
        subtitle={
          <>Configuration & introspection du projet — {auth.user?.username}.</>
        }
        actions={
          <>
            {i && (
              <Badge variant="light" color="gray" size="lg">
                {i.environment}
              </Badge>
            )}
            {i?.debug && (
              <Badge
                color="orange"
                variant="filled"
                size="lg"
                leftSection={<IconBug size={14} />}
              >
                debug
              </Badge>
            )}
            {i?.git?.branch && (
              <Badge
                variant="light"
                color="brand"
                size="lg"
                leftSection={<IconGitBranch size={14} />}
              >
                {i.git.branch}
              </Badge>
            )}
          </>
        }
      />

      {/* ── KPIs config ── */}
      <Grid>
        <Kpi
          label="Environnement"
          icon={<IconServer size={30} stroke={1.4} />}
          hint="Mode de lancement (development / production / staging)."
        >
          <Text fw={700} size="xl">
            {i?.environment ?? "—"}
          </Text>
        </Kpi>
        <Kpi
          label="Node"
          icon={<IconBrandNodejs size={30} stroke={1.4} />}
          hint="Version du runtime Node.js du process."
        >
          <Text fw={700} size="xl">
            {i?.node ?? "—"}
          </Text>
        </Kpi>
        <Kpi
          label="Modules"
          icon={<IconBox size={30} stroke={1.4} />}
          hint="Modules Nodefony chargés (core inclus)."
        >
          <Text fw={700} size="xl">
            {moduleCount || "—"}
          </Text>
        </Kpi>
        <Kpi
          label="Entités ORM"
          icon={<IconDatabase size={30} stroke={1.4} />}
          hint="Total des entités mappées sur tous les connecteurs."
        >
          <Text fw={700} size="xl">
            {entityTotal || "—"}
          </Text>
        </Kpi>
      </Grid>

      {/* ── Config générale + Git ── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="lg">
            <Group gap={6} mb="md">
              <IconSettings size={20} stroke={1.5} />
              <Title order={4}>Configuration générale</Title>
            </Group>
            <DataState
              loading={info.loading && !i}
              error={info.error}
              onRetry={info.reload}
            >
              <DefinitionList>
                <Row k="Environnement" v={i?.environment ?? "—"} />
                <Row k="Debug" v={i ? (i.debug ? "on" : "off") : "—"} />
                <Row k="Domaine" v={i?.domain ?? "—"} mono />
                <Row k="Version framework" v={i?.version ?? "—"} mono />
                <Row k="Node" v={i?.node ?? "—"} mono />
                <Row k="Plateforme" v={i?.platform ?? "—"} mono />
                <Row k="PID" v={String(i?.pid ?? "—")} mono />
                <Row k="Uptime" v={i ? uptimeStr(i.uptime) : "—"} mono />
              </DefinitionList>
            </DataState>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="lg">
            <Group gap={6} mb="md">
              <IconGitBranch size={20} stroke={1.5} />
              <Title order={4}>Git</Title>
            </Group>
            <DataState
              loading={info.loading && !i}
              error={info.error}
              onRetry={info.reload}
            >
              <DefinitionList>
                <Row k="Branche" v={i?.git?.branch || "—"} mono />
                <Row k="Commit" v={i?.git?.commit || "—"} mono />
              </DefinitionList>
              {i && !i.git?.branch && (
                <Text size="xs" c="dimmed" mt="xs">
                  Hors dépôt git (ou worktree non détecté).
                </Text>
              )}
            </DataState>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ── ORM ── */}
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Group gap={6}>
            <IconDatabase size={20} stroke={1.5} />
            <Title order={4}>ORM & connecteurs</Title>
          </Group>
          <Button
            component={Link}
            to="/nodefony/databases"
            variant="light"
            size="xs"
          >
            Détails
          </Button>
        </Group>
        <DataState
          loading={orms.loading && !ormList.length}
          error={orms.error}
          empty={!ormList.length}
          onRetry={orms.reload}
          emptyMessage="Aucun connecteur ORM enregistré."
        >
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Connecteur</Table.Th>
                <Table.Th>Défaut</Table.Th>
                <Table.Th>État</Table.Th>
                <Table.Th>Entités</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ormList.map((o) => {
                const v = o.vendor ? VENDORS[o.vendor] : undefined;
                return (
                <Table.Tr key={o.name}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <ThemeIcon
                        size="sm"
                        radius="sm"
                        variant="light"
                        color={v?.color ?? "gray"}
                        aria-label={v?.label ?? o.vendor ?? "ORM"}
                      >
                        <IconDatabase size={14} />
                      </ThemeIcon>
                      <div>
                        <Text fw={600}>{o.name}</Text>
                        {o.vendor && (
                          <Text size="xs" c="dimmed">
                            {v?.label ?? o.vendor}
                          </Text>
                        )}
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {o.default ? (
                      <Badge size="xs" color="brand" variant="light">
                        défaut
                      </Badge>
                    ) : (
                      <Text c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="xs"
                      color={o.connected ? "teal" : "red"}
                      variant="light"
                    >
                      {o.connected ? "connecté" : "déconnecté"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{o.entityCount}</Table.Td>
                </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </DataState>
      </Card>

      {/* ── Outils dev (accès rapide) ── */}
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" mb="xs">
          <Title order={5}>Outils dev</Title>
          <Text size="xs" c="dimmed">
            Introspection du framework
            {routes.data ? ` — ${routes.data.routesTotal} routes` : ""}
          </Text>
        </Group>
        <Group gap="xs">
          <Button
            component={Link}
            to="/nodefony/routes"
            variant="light"
            size="xs"
            leftSection={<IconRoute size={15} />}
          >
            Routes
          </Button>
          <Button
            component={Link}
            to="/nodefony/modules"
            variant="light"
            size="xs"
            leftSection={<IconBox size={15} />}
          >
            Modules
          </Button>
          <Button
            component={Link}
            to="/nodefony/services"
            variant="light"
            size="xs"
            leftSection={<IconAffiliate size={15} />}
          >
            Services
          </Button>
          <Button
            component={Link}
            to="/nodefony/databases"
            variant="light"
            size="xs"
            leftSection={<IconDatabase size={15} />}
          >
            Database
          </Button>
          <Button
            component={Link}
            to="/nodefony/profiling"
            variant="light"
            size="xs"
            leftSection={<IconChartBar size={15} />}
          >
            Profiling
          </Button>
          <Button
            component={Link}
            to="/nodefony/logs"
            variant="light"
            size="xs"
            leftSection={<IconFileText size={15} />}
          >
            Logs
          </Button>
        </Group>
      </Card>
    </Stack>
  );
});
