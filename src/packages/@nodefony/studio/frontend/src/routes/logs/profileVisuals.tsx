/**
 * **profileVisuals** — briques de rendu du **profil serveur** (data plane
 * `/nodefony/profiler/api/*`), partagées par la page « Suivi de requête »
 * (`TraceView`, onglets Timing/ORM) et l'onglet « Profiling » de la console Logs.
 *
 * Le profil par requête (phases, requêtes SQL, méta) remplace l'ancienne page
 * Profiler autonome : son contenu est désormais surfacé PAR requestId dans le
 * Suivi de requête. Rendu 100 % TEXTE (aucun HTML injecté). Le waterfall réutilise
 * `computeWaterfall` du Core isomorphe (`nodefony/debugbar`) — même fonction pure
 * que la debug bar par-page (0 duplication).
 */
import {
  Badge,
  Box,
  Code,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { computeWaterfall } from "nodefony/debugbar";
import { useMemo } from "react";
import { DataGrid } from "../../components/ui/DataGrid";
import type { DataGridColumn } from "../../components/ui/DataGrid";
import type { ProfileEntry, ProfileQuery } from "../../stores/ProfilerStore";

/** Couleur de badge par méthode HTTP. */
export const METHOD_COLORS: Record<string, string> = {
  GET: "blue",
  POST: "green",
  PUT: "orange",
  PATCH: "orange",
  DELETE: "red",
};

/** Couleur de phase (alignée sur la debug bar par-page). */
const PHASE_COLORS: Record<string, string> = {
  parse: "#4c9aff",
  resolve: "#3aa0ff",
  firewall: "#ff8a3d",
  // Porte socket : re-validation d'identité par frame (lecture du store de
  // session) — famille sécurité, distincte du firewall (couleurs de la debugbar).
  identity: "#ff5c8a",
  init: "#a06bff",
  action: "#36b37e",
  render: "#ffab00",
  send: "#00b8d9",
  sql: "#c56bff",
  other: "#8a9099",
};

/** Couleur de badge selon la famille de status HTTP. */
export function statusColor(status: number | null | undefined): string {
  if (status === null || status === undefined) return "gray";
  if (status >= 500) return "red";
  if (status >= 400) return "yellow";
  if (status >= 300) return "blue";
  return "green";
}

/** Durée serveur lisible (sub-ms → ms → s). */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Âge relatif compact d'un timestamp. */
export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Une ligne du waterfall serveur (barre proportionnelle colorée). */
function WaterfallRow({
  name,
  leftPct,
  widthPct,
  tier,
  durationMs,
}: {
  name: string;
  leftPct: number;
  widthPct: number;
  tier: string;
  durationMs: number;
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Text size="xs" w={88} ta="right" c="dimmed" style={{ flex: "none" }}>
        {name}
      </Text>
      <Box
        style={{
          flex: 1,
          position: "relative",
          height: 16,
          background: "rgba(128,128,128,.12)",
          borderRadius: 4,
        }}
      >
        <Box
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: 2,
            borderRadius: 4,
            background: PHASE_COLORS[tier] ?? PHASE_COLORS.other,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
          }}
        />
      </Box>
      <Text
        size="xs"
        w={70}
        ta="right"
        c="dimmed"
        style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}
      >
        {durationMs}ms
      </Text>
    </Group>
  );
}

/**
 * Waterfall des phases serveur (parse → resolve → firewall → action → render →
 * send). Vide si le timing est désactivé (prod sans profiler).
 *
 * `withQueries` place EN PLUS chaque requête ORM sur le même axe de temps : le
 * SQL apparaît **dans** la barre `action` (on voit le temps de base de données
 * à l'intérieur du controller) au lieu de flotter dans un tableau à côté. Les
 * requêtes sans `startMs` (adapter qui ne l'émet pas) sont ignorées ici — elles
 * restent listées par {@link QueryTable}, jamais placées au hasard.
 */
export function PhaseWaterfall({
  profile,
  withQueries = false,
}: {
  profile: ProfileEntry;
  withQueries?: boolean;
}) {
  const placeable = withQueries
    ? (profile.queries ?? []).filter((q) => typeof q.startMs === "number")
    : [];
  // UN SEUL appel à computeWaterfall (phases + SQL) → même échelle, donc les
  // barres SQL tombent réellement à l'intérieur de la barre `action`.
  const bars = computeWaterfall([
    ...profile.phases,
    ...placeable.map((q, i) => ({
      name: `sql ${i + 1}`,
      startMs: q.startMs as number,
      durationMs: q.durationMs,
    })),
  ]);
  if (bars.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Aucune phase mesurée (timing désactivé ou requête non profilée).
      </Text>
    );
  }
  const firstSql = profile.phases.length;
  return (
    <Stack gap={4}>
      {bars.map((b, i) => (
        <WaterfallRow
          key={b.name}
          {...b}
          tier={i >= firstSql ? "sql" : b.tier}
        />
      ))}
    </Stack>
  );
}

/** Méta serveur d'un profil (méthode, status, route, controller, total, user, trace). */
export function ProfileMeta({ profile }: { profile: ProfileEntry }) {
  const traceId = profile.traceparent?.split("-")[1] ?? null;
  const kv = (label: string, value: React.ReactNode) => (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" w={100} style={{ flex: "none" }}>
        {label}
      </Text>
      <Text size="xs" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </Text>
    </Group>
  );
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge
          color={METHOD_COLORS[profile.method ?? ""] ?? "gray"}
          variant="filled"
        >
          {profile.method ?? profile.kind}
        </Badge>
        <Badge color={statusColor(profile.status)} variant="light">
          {profile.status ?? "—"}
        </Badge>
        <Text size="sm" fw={600} style={{ wordBreak: "break-all" }}>
          {profile.url}
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
        {kv("route", profile.route ?? "—")}
        {kv(
          "controller",
          profile.controller
            ? `${profile.controller}.${profile.action ?? "?"}`
            : "—",
        )}
        {kv("total serveur", fmtMs(profile.durationMs))}
        {kv("user", profile.user ?? "anonyme")}
        {kv(
          "trace-id (W3C)",
          traceId ? <Code>{traceId.slice(0, 16)}…</Code> : "—",
        )}
        {profile.error &&
          kv(
            "erreur",
            <Text c="red" size="xs">
              {profile.error}
            </Text>,
          )}
      </SimpleGrid>
    </Stack>
  );
}

/**
 * Colonnes des requêtes ORM d'une trace. Hors composant : une définition
 * recréée à chaque rendu ferait remonter un tableau neuf au grid, qui
 * réinitialiserait tri et filtres à la moindre mise à jour du profil.
 */
/** Requête + son rang dans la trace, qui lui sert d'identité (cf `QueryTable`). */
type IndexedQuery = ProfileQuery & { readonly rank: number };

const QUERY_COLUMNS: DataGridColumn<IndexedQuery>[] = [
  {
    key: "sql",
    header: "SQL",
    sortable: true,
    filterable: true,
    value: (q) => q.sql,
    render: (q) => (
      <Text
        size="xs"
        style={{
          wordBreak: "break-word",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {q.sql}
      </Text>
    ),
    hint: "Requête telle qu'exécutée. Filtrer sur un nom de table isole les accès à une entité — c'est ainsi qu'on reconnaît un N+1 : la même requête répétée.",
  },
  {
    key: "connector",
    header: "Connecteur",
    sortable: true,
    filterable: true,
    filterType: "select",
    value: (q) => q.connector ?? "",
    render: (q) =>
      q.connector ? (
        <Badge size="xs" variant="light">
          {q.connector}
        </Badge>
      ) : (
        "—"
      ),
    size: 130,
  },
  {
    key: "rows",
    header: "Lignes",
    align: "right",
    sortable: true,
    // `null` et non 0 : une requête qui ne rapporte pas son nombre de lignes
    // n'en a pas ramené zéro — le tri doit les distinguer.
    value: (q) => q.rows ?? null,
    render: (q) => (
      <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        {q.rows ?? "—"}
      </Text>
    ),
    size: 90,
  },
  {
    key: "durationMs",
    header: "Durée",
    align: "right",
    sortable: true,
    value: (q) => q.durationMs,
    render: (q) => (
      <Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
        {q.durationMs}ms
      </Text>
    ),
    hint: "Temps passé dans le pilote. Trié décroissant par défaut : la requête à corriger est en haut.",
    size: 100,
  },
];

/**
 * Tableau des requêtes ORM mesurées par le profiler (vraies SQL + durée).
 *
 * Trié par durée décroissante d'entrée de jeu : sur une trace lente, ce qu'on
 * cherche est la requête la plus coûteuse, et la lire ne doit demander aucun
 * geste. Le tri par SQL, lui, regroupe les requêtes identiques — la signature
 * visuelle d'un N+1.
 */
export function QueryTable({ queries }: { queries: ProfileQuery[] }) {
  const total = queries.reduce((s, q) => s + (q.durationMs || 0), 0);
  // Le profiler ne donne pas d'identifiant de requête : le rang dans la trace
  // EST l'identité (deux requêtes identiques restent distinctes). Calculé UNE
  // fois — le chercher par `indexOf` dans `getRowId` coûterait un balayage par
  // ligne, soit un coût quadratique sur les traces les plus chargées, celles
  // qu'on ouvre précisément parce qu'elles vont mal.
  const rows = useMemo<IndexedQuery[]>(
    () => queries.map((q, rank) => ({ ...q, rank })),
    [queries],
  );
  return (
    <Stack gap={6}>
      <Group gap="xs">
        <Badge variant="light" color="grape">
          {queries.length} requête{queries.length > 1 ? "s" : ""}
        </Badge>
        <Text size="xs" c="dimmed">
          cumul {fmtMs(total)}
        </Text>
      </Group>
      <DataGrid
        mode="client"
        data={rows}
        columns={QUERY_COLUMNS}
        getRowId={(q) => String(q.rank)}
        initialSort={{ key: "durationMs", dir: "desc" }}
        searchable
        searchPlaceholder="Rechercher dans les requêtes…"
        emptyMessage="Aucune requête ORM sur cette trace."
        pageSize={25}
      />
    </Stack>
  );
}
