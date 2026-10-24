/**
 * **ProfilingTab** — onglet « Profiling » de la console Logs : **où part le temps
 * de l'application**. Les requêtes que le profileur a mesurées (data plane
 * `/nodefony/profiler/api/summary`, dev-only), regroupées PAR ROUTE : appels,
 * médiane, p95, SQL par appel, erreurs — puis les boucles N+1, les requêtes SQL
 * les plus coûteuses et les erreurs, chacune menant à son Suivi de requête.
 *
 * L'onglet Journaux montre chaque requête, une par une ; celui-ci les mêmes,
 * regroupées. Le rapport est calculé par `aggregateProfiles` (`@nodefony/http`),
 * la règle qu'emploie aussi l'outil `nodefony_profile_route` de l'agent.
 */
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Alert,
  Badge,
  Button,
  Code,
  Collapse,
  Grid,
  Group,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBolt,
  IconChevronDown,
  IconChevronRight,
  IconInfoCircle,
  IconListSearch,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useProfiler } from "../../stores";
import type {
  ErrorSample,
  NPlusOne,
  ProfileReport,
  RouteStats,
  SqlShapeStats,
} from "../../stores/ProfilerStore";
import { DataGrid, DocHint, StatCard } from "../../components/ui";
import type { DataGridColumn } from "../../components/ui/DataGrid";
import { fmtMs } from "./profileVisuals";
import { statusColor } from "./logFormat";

const traceUrl = (requestId: string): string =>
  `/nodefony/logs/trace/${encodeURIComponent(requestId)}`;

const routeKey = (r: { kind?: string; route: string }): string =>
  `${r.kind ?? ""}:${r.route}`;

/** Le « controller.action » d'une route, quand le profil le connaît. */
const handlerOf = (r: { controller: string | null; action: string | null }) =>
  r.controller && r.action ? `${r.controller}.${r.action}` : null;

/** Colonnes du tableau par route ; `nPlusOne` = nombre de N+1 par route. */
function routeColumns(
  nPlusOne: Map<string, number>,
): DataGridColumn<RouteStats>[] {
  return [
    {
      key: "route",
      header: "Route",
      size: 300,
      sortable: true,
      value: (r) => r.route,
      render: (r) => {
        const handler = handlerOf(r);
        return (
          <Group gap={6} wrap="nowrap">
            <Badge
              size="xs"
              variant="light"
              color={r.kind === "ws" ? "grape" : "blue"}
            >
              {r.kind === "ws" ? "WS" : "HTTP"}
            </Badge>
            <div style={{ minWidth: 0 }}>
              <Text size="xs" lineClamp={1}>
                {r.route}
              </Text>
              {handler && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {handler}
                </Text>
              )}
            </div>
          </Group>
        );
      },
    },
    {
      key: "count",
      header: "Appels",
      size: 100,
      align: "right",
      sortable: true,
      value: (r) => r.count,
    },
    {
      key: "p50",
      header: "Médiane",
      size: 90,
      align: "right",
      sortable: true,
      hint: "La moitié des appels servis sont plus rapides.",
      value: (r) => r.p50Ms ?? -1,
      render: (r) => fmtMs(r.p50Ms),
    },
    {
      key: "p95",
      header: "p95",
      size: 90,
      align: "right",
      sortable: true,
      hint: "95 appels servis sur 100 sont plus rapides : le temps que ressentent les utilisateurs les moins bien servis.",
      value: (r) => r.p95Ms ?? -1,
      render: (r) => (
        <Text size="xs" fw={600}>
          {fmtMs(r.p95Ms)}
        </Text>
      ),
    },
    {
      key: "max",
      header: "Max",
      size: 90,
      align: "right",
      sortable: true,
      value: (r) => r.maxMs ?? -1,
      render: (r) => fmtMs(r.maxMs),
    },
    {
      key: "sql",
      header: "SQL max",
      size: 125,
      align: "right",
      sortable: true,
      hint: "Le plus grand nombre de requêtes SQL émises par un seul appel servi.",
      value: (r) => r.queries.perRequestMax,
    },
    {
      key: "nplusone",
      header: "N+1",
      size: 85,
      align: "right",
      sortable: true,
      hint: "Boucles N+1 détectées sur cette route : détail sous le tableau.",
      value: (r) => nPlusOne.get(r.route) ?? 0,
      render: (r) => {
        const n = nPlusOne.get(r.route) ?? 0;
        return n > 0 ? (
          <Badge size="sm" color="orange" variant="light">
            {n}
          </Badge>
        ) : (
          <Text size="xs" c="dimmed">
            —
          </Text>
        );
      },
    },
    {
      key: "errors",
      header: "Erreurs",
      size: 100,
      align: "right",
      sortable: true,
      hint: "Appels en erreur : statut ≥ 500 ou exception levée.",
      value: (r) => r.errors,
      render: (r) =>
        r.errors > 0 ? (
          <Badge size="sm" color="red" variant="light">
            {r.errors}
          </Badge>
        ) : (
          <Text size="xs" c="dimmed">
            0
          </Text>
        ),
    },
    {
      key: "refused",
      header: "Refus",
      size: 90,
      align: "right",
      sortable: true,
      hint: "Appels refusés (4xx), dont 401 et 403 : une garde a dit non.",
      value: (r) => r.status.s4xx,
      render: (r) => (
        <Tooltip
          label={`401 : ${r.status.unauthorized} · 403 : ${r.status.forbidden}`}
          openDelay={300}
          disabled={r.status.s4xx === 0}
        >
          <Text size="xs" c={r.status.s4xx > 0 ? undefined : "dimmed"}>
            {r.status.s4xx}
          </Text>
        </Tooltip>
      ),
    },
  ];
}

const SHAPE_RENDER = (shape: string) => (
  <Tooltip label={shape} openDelay={400} multiline maw={560}>
    <Code fz="xs" style={{ whiteSpace: "nowrap" }}>
      {shape}
    </Code>
  </Tooltip>
);

const N_PLUS_ONE_COLUMNS: DataGridColumn<NPlusOne>[] = [
  {
    key: "route",
    header: "Route",
    size: 220,
    sortable: true,
    value: (r) => r.route,
  },
  {
    key: "shape",
    header: "Requête répétée",
    size: 360,
    value: (r) => r.shape,
    render: (r) => SHAPE_RENDER(r.shape),
  },
  {
    key: "repeats",
    header: "Répétitions",
    size: 100,
    align: "right",
    sortable: true,
    hint: "Le plus grand nombre de fois où elle a été émise dans UN appel.",
    value: (r) => r.maxRepeats,
  },
  {
    key: "requests",
    header: "Appels touchés",
    size: 110,
    align: "right",
    sortable: true,
    value: (r) => r.requests,
  },
  {
    key: "total",
    header: "Temps cumulé",
    size: 110,
    align: "right",
    sortable: true,
    value: (r) => r.totalMs,
    render: (r) => fmtMs(r.totalMs),
  },
];

const SQL_COLUMNS: DataGridColumn<SqlShapeStats>[] = [
  {
    key: "shape",
    header: "Requête",
    size: 380,
    value: (r) => r.shape,
    render: (r) => SHAPE_RENDER(r.shape),
  },
  {
    key: "count",
    header: "Fois",
    size: 70,
    align: "right",
    sortable: true,
    value: (r) => r.count,
  },
  {
    key: "total",
    header: "Temps cumulé",
    size: 110,
    align: "right",
    sortable: true,
    value: (r) => r.totalMs,
    render: (r) => fmtMs(r.totalMs),
  },
  {
    key: "max",
    header: "Max",
    size: 90,
    align: "right",
    sortable: true,
    value: (r) => r.maxMs,
    render: (r) => fmtMs(r.maxMs),
  },
  {
    key: "routes",
    header: "Routes",
    size: 220,
    value: (r) => r.routes.join(", "),
    render: (r) => (
      <Text size="xs" c="dimmed" lineClamp={1}>
        {r.routes.join(", ")}
      </Text>
    ),
  },
];

const ERROR_COLUMNS: DataGridColumn<ErrorSample>[] = [
  {
    key: "route",
    header: "Route",
    size: 220,
    sortable: true,
    value: (r) => r.route,
  },
  {
    key: "status",
    header: "Statut",
    size: 80,
    sortable: true,
    value: (r) => r.status ?? 0,
    render: (r) => (
      <Badge size="sm" variant="light" color={statusColor(r.status)}>
        {r.status ?? "ERR"}
      </Badge>
    ),
  },
  {
    key: "error",
    header: "Motif",
    size: 420,
    value: (r) => r.error ?? "",
    render: (r) => (
      <Text size="xs" lineClamp={1}>
        {r.error ?? "—"}
      </Text>
    ),
  },
];

/** Somme des erreurs de toutes les routes (les exemples sont capés, pas elles). */
const errorCount = (report: ProfileReport): number =>
  report.routes.reduce((sum, r) => sum + r.errors, 0);

export const ProfilingTab = observer(
  ({
    onGoDebug,
    onGoLogs,
  }: {
    onGoDebug?: () => void;
    onGoLogs?: () => void;
  }) => {
    const store = useProfiler();
    const navigate = useNavigate();
    const [sqlOpen, setSqlOpen] = useState(false);

    useEffect(() => {
      void store.loadSummary();
      return () => store.dispose();
    }, [store]);

    const report = store.summary;
    // N+1 par route : la colonne du tableau et son tri le lisent.
    const nPlusOneByRoute = useMemo(() => {
      const m = new Map<string, number>();
      for (const n of report?.nPlusOne ?? [])
        m.set(n.route, (m.get(n.route) ?? 0) + 1);
      return m;
    }, [report]);
    const columns = useMemo(
      () => routeColumns(nPlusOneByRoute),
      [nPlusOneByRoute],
    );

    // Prod : le data plane profiler renvoie 404 (dev-only, non monté). On n'affiche
    // PAS d'erreur brute → encart clair qui renvoie vers le debug runtime (onglet Debug),
    // le bon outil d'observation EN PRODUCTION.
    if (store.unavailable) {
      return (
        <Alert
          color="blue"
          variant="light"
          icon={<IconInfoCircle size={18} />}
          title="Profiler désactivé en production"
        >
          <Text size="sm" mb="xs">
            Le profiling <b>par requête</b> (timing des phases + requêtes SQL)
            est <b>dev-only</b> : il ajoute un coût à chaque requête et
            exposerait des détails internes. Il n'est donc pas monté en
            production.
          </Text>
          <Text size="sm" mb="sm">
            Pour observer <b>en production</b>, utilise le{" "}
            <b>debug runtime ciblé</b> : niveau DEBUG par module, activé à chaud
            sans redémarrage, auto-expirant et audité — sur l'onglet Debug.
          </Text>
          {onGoDebug && (
            <Button
              size="xs"
              color="blue"
              leftSection={<IconBolt size={16} />}
              onClick={onGoDebug}
            >
              Aller à l'onglet Debug
            </Button>
          )}
        </Alert>
      );
    }

    const requests = report?.requests ?? 0;
    const errors = report ? errorCount(report) : 0;

    return (
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Text size="sm" fw={600}>
              Où part le temps de l'application
            </Text>
            <Text size="sm" c="dimmed">
              — les requêtes mesurées, regroupées par route.
            </Text>
            <DocHint
              title="Profiling par route"
              version="v2.0"
              summary={`Les ${requests} requête${requests > 1 ? "s" : ""} que le profileur garde en mémoire, regroupée${requests > 1 ? "s" : ""} par route : combien d'appels, à quelle vitesse, combien de SQL — et les boucles N+1. Chaque requête, une par une, se lit dans l'onglet Journaux.`}
              sections={[
                {
                  label: "Médiane et p95",
                  body: "La médiane : la moitié des appels sont plus rapides. Le p95 : 95 appels sur 100 le sont — c'est le temps que ressentent les utilisateurs les moins bien servis. Tous deux portent sur les appels SERVIS (statut < 400) : refus et erreurs se comptent à part.",
                },
                {
                  label: "N+1",
                  body: "La même requête SQL répétée dans un seul appel : en général une boucle qui interroge la base à chaque élément au lieu d'une seule fois pour tous. Le temps se perd en allers-retours, pas dans la base.",
                },
                {
                  label: "Fenêtre",
                  body: `Le profileur garde les requêtes les plus récentes, en développement seulement. L'outillage (console, journaux, Vite) n'est pas mesuré${report && report.filteredTooling > 0 ? ` (${report.filteredTooling} écartée${report.filteredTooling > 1 ? "s" : ""})` : ""}. « Vider » repart de zéro : de quoi mesurer l'effet d'une modification sur les seules requêtes qui la suivent.`,
                },
                {
                  label: "Si vide",
                  body: "Naviguez dans l'application ou lancez vos tests : chaque requête servie s'ajoute ici.",
                },
              ]}
            />
          </Group>
          <Group gap="xs">
            {onGoLogs && (
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconListSearch size={14} />}
                onClick={onGoLogs}
              >
                Chaque requête → Journaux
              </Button>
            )}
            <Switch
              label="Auto-refresh"
              size="sm"
              checked={store.autoRefresh}
              onChange={(e) => store.setAutoRefresh(e.currentTarget.checked)}
            />
            <Button
              variant="light"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              loading={store.loading}
              onClick={() => void store.loadSummary()}
            >
              Rafraîchir
            </Button>
            <Button
              variant="subtle"
              color="red"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={() => void store.clear()}
            >
              Vider
            </Button>
          </Group>
        </Group>

        {store.error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {store.error}
          </Alert>
        )}

        <Grid>
          <StatCard
            label="Requêtes mesurées"
            hint={
              report
                ? `${report.http} HTTP · ${report.ws} WebSocket${report.untimed > 0 ? ` · ${report.untimed} sans durée` : ""}`
                : undefined
            }
          >
            {requests}
          </StatCard>
          <StatCard
            label="Routes"
            hint={
              report
                ? `${report.routes.filter((r) => r.kind === "ws").length} appelée(s) par WebSocket`
                : undefined
            }
          >
            {report?.routes.length ?? 0}
          </StatCard>
          <StatCard
            label="Boucles N+1"
            hint={
              report && report.nPlusOne.length > 0
                ? "détail sous le tableau"
                : "aucune requête SQL répétée"
            }
          >
            <Text
              span
              inherit
              c={report && report.nPlusOne.length > 0 ? "orange" : undefined}
            >
              {report?.nPlusOne.length ?? 0}
            </Text>
          </StatCard>
          <StatCard label="Erreurs" hint="statut ≥ 500 ou exception levée">
            <Text span inherit c={errors > 0 ? "red" : undefined}>
              {errors}
            </Text>
          </StatCard>
        </Grid>

        <DataGrid
          mode="client"
          data={report?.routes ?? []}
          columns={columns}
          getRowId={routeKey}
          initialSort={{ key: "p95", dir: "desc" }}
          pageSize={25}
          searchable
          searchPlaceholder="Recherche : route…"
          emptyMessage="Aucune requête mesurée. Naviguez dans l'application ou lancez vos tests — puis Rafraîchir (ou Auto-refresh)."
          persist={{ key: "studio.logs.profiling.routes", storage: "session" }}
        />

        {report && report.nPlusOne.length > 0 && (
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Boucles N+1 — la même requête SQL répétée dans un seul appel
            </Text>
            <Text size="xs" c="dimmed">
              Une ligne ouvre le Suivi d'un appel touché : la requête y apparaît
              autant de fois qu'elle a été émise.
            </Text>
            <DataGrid
              mode="client"
              data={report.nPlusOne}
              columns={N_PLUS_ONE_COLUMNS}
              getRowId={(r) => `${r.route}|${r.shape}`}
              onRowClick={(r) => void navigate(traceUrl(r.sampleRequestId))}
              initialSort={{ key: "total", dir: "desc" }}
              pageSize={10}
              height={260}
            />
          </Stack>
        )}

        {report && report.errors.length > 0 && (
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Erreurs — les dernières, une ligne ouvre son Suivi de requête
            </Text>
            <DataGrid
              mode="client"
              data={report.errors}
              columns={ERROR_COLUMNS}
              getRowId={(r) => r.requestId}
              onRowClick={(r) => void navigate(traceUrl(r.requestId))}
              pageSize={10}
              height={220}
            />
          </Stack>
        )}

        {report && report.slowQueries.length > 0 && (
          <Stack gap={6}>
            <Button
              variant="subtle"
              size="xs"
              w="fit-content"
              leftSection={
                sqlOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )
              }
              aria-expanded={sqlOpen}
              aria-controls="profiling-slow-sql"
              onClick={() => setSqlOpen((o) => !o)}
            >
              Requêtes SQL les plus coûteuses ({report.slowQueries.length})
            </Button>
            <Collapse expanded={sqlOpen} id="profiling-slow-sql">
              <DataGrid
                mode="client"
                data={report.slowQueries}
                columns={SQL_COLUMNS}
                getRowId={(r) => `${r.connector ?? ""}|${r.shape}`}
                initialSort={{ key: "total", dir: "desc" }}
                pageSize={10}
                height={260}
              />
            </Collapse>
          </Stack>
        )}
      </Stack>
    );
  },
);
