/**
 * **Page d'un connecteur ORM** — `/nodefony/orm-connector?name=<nom>`.
 *
 * Tout ce que le data plane sait d'UNE base, réuni et lu : ce qu'elle porte
 * (briques des stores), ce qu'elle contient (entités, lignes), comment elle
 * répond (santé, latence, stockage), ce qui y passe (flux, requêtes lentes
 * avec leur SQL), où en est son schéma (migrations) — et, en tête, l'ANALYSE
 * qui transforme ces mesures en verdicts (`analyzeConnector`, fonction pure).
 *
 * 🔴 Deux natures de données, à ne jamais confondre à l'écran :
 *  - le SCHÉMA, les comptes, les briques et les migrations sont les mêmes vus
 *    de n'importe quel process ;
 *  - la santé et le flux sont des mesures PAR PROCESS. En cluster, le data
 *    plane répond depuis le worker que le répartiteur a choisi : la barre
 *    d'état nomme ce pid et renvoie à sa vue `/nodefony/orm/<pid>`, jamais un
 *    chiffre présenté comme celui du connecteur entier.
 *
 * Mono-segment + paramètre de requête (comme `orm-entity`) : le repli SPA
 * existant suffit, aucune route serveur à ajouter.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Anchor,
  Badge,
  Button,
  Code,
  Collapse,
  CopyButton,
  Grid,
  Group,
  Menu,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowLeft,
  IconBolt,
  IconBulb,
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconDatabase,
  IconDownload,
  IconGitMerge,
  IconHeartbeat,
  IconHeartRateMonitor,
  IconInfoCircle,
  IconPlugConnected,
  IconStack2,
  IconTable,
} from "@tabler/icons-react";
import { useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import {
  ChartCard,
  DataGrid,
  DataState,
  DefinitionList,
  DocHint,
  KeyValue,
  KpiCard,
  MiniChart,
  StatusBar,
  TabbedPage,
  type DataGridColumn,
  type StatusSegment,
  type TabbedPageTab,
} from "../components/ui";
import {
  OrmHealthLive,
  OrmFlowLive,
  OrmRealtimeControls,
  useOrmFlow,
} from "./orm/ConnectorCard";
import {
  connectorRole,
  entityCount,
  fmtBytes,
  fmtClock,
  fmtDuration,
  fmtMs,
  fmtNum,
  lsGet,
  lsSet,
  ORM_DOC,
} from "../utils/ormFormat";
import {
  analyzeConnector,
  attributeBricks,
  timeOutages,
  worstLevel,
  type ConnectorFinding,
  type ConnectorTab,
  type FindingLevel,
} from "../utils/ormConnectorInsights";
import { normalize, type HealthPayload } from "../utils/realtimeHealth";
import {
  isMigrationFailure,
  REL_LABEL,
  VENDOR_LABEL,
  type ConnHealth,
  type EntityNode,
  type FlowSnapshot,
  type MigrationEntry,
  type MigrationReply,
  type OrmGraph,
  type OrmSummary,
  type StoreBrick,
} from "../types/orm";

/** Apparence de chaque gravité — une seule table, lue partout. */
const LEVEL_UI: Record<
  FindingLevel,
  { color: MantineColor; icon: typeof IconInfoCircle; label: string }
> = {
  critical: { color: "red", icon: IconAlertOctagon, label: "Critique" },
  warning: { color: "orange", icon: IconAlertTriangle, label: "À surveiller" },
  info: { color: "blue", icon: IconInfoCircle, label: "À savoir" },
  ok: { color: "teal", icon: IconCircleCheck, label: "Sain" },
};

const TAB_VALUES: ReadonlySet<string> = new Set<ConnectorTab>([
  "analyse",
  "donnees",
  "stores",
  "requetes",
  "connexion",
  "migrations",
]);

/** Ligne de la grille des entités. */
interface EntityRow {
  name: string;
  module: string;
  domain: string;
  columns: number;
  relations: number;
  rows: number;
  share: number;
}

/** Ligne de l'historique des migrations, toutes origines confondues. */
interface MigrationRow extends MigrationEntry {
  source: string;
}

/** Télécharge un texte sous un nom de fichier (export du modèle). */
function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Une commande à copier, avec son bouton. */
function CopyCommand({ command }: { command: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {command}
      </Code>
      <CopyButton value={command}>
        {({ copied, copy }) => (
          <Button
            size="compact-xs"
            variant="subtle"
            color={copied ? "teal" : "gray"}
            onClick={copy}
            leftSection={
              copied ? <IconCheck size={12} /> : <IconCopy size={12} />
            }
          >
            {copied ? "Copié" : "Copier"}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}

/**
 * Texte d'un constat : les segments entre accents graves deviennent du code.
 * Rendu en TEXTE (jamais de HTML injecté) — le constat peut citer une erreur
 * de la base.
 */
function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text
        .split("`")
        .map((part, i) => (i % 2 === 1 ? <Code key={i}>{part}</Code> : part))}
    </>
  );
}

/**
 * **Résilience** — comment ce connecteur détecte une coupure et constate le
 * retour, avec les valeurs qui tournent dans ce process, puis la chronologie
 * des pertes et reprises. Le mécanisme (battement de cœur, perte en
 * souffrance, reprise constatée) vit dans `Orm` (`@nodefony/orm-core`) ;
 * cette section ne fait que le rendre lisible.
 */
function ResilienceSection({ health }: { health: ConnHealth }) {
  const [explain, setExplain] = useState(false);
  const res = health.resilience;
  const events = useMemo(
    () => timeOutages(health.events ?? []),
    [health.events],
  );
  if (!res) {
    return (
      <Text size="sm" c="dimmed">
        Ce serveur ne publie pas encore le mécanisme de reconnexion de ses
        connecteurs.
      </Text>
    );
  }
  const lastOutage = events.find((e) => e.outageMs !== undefined)?.outageMs;
  const period = res.heartbeatMs > 0 ? fmtDuration(res.heartbeatMs) : null;
  const mongo = health.driver === "mongodb";
  // SQLite est une bibliothèque DANS le process : ni serveur ni réseau, donc
  // rien qui tombe au sens d'une coupure — le mécanisme tourne, mais ses
  // chiffres n'ont pas le sens qu'ils ont face à PostgreSQL ou MongoDB.
  const inProcess = health.driver === "sqlite";
  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Group gap="xs">
          <IconHeartbeat size={18} />
          <Title order={2} size="h4">
            Résilience
          </Title>
          <Badge
            variant="light"
            color={res.lostPending ? "red" : health.connected ? "teal" : "gray"}
          >
            {res.lostPending
              ? "perte en cours"
              : health.connected
                ? "connecté"
                : "arrêté"}
          </Badge>
        </Group>
        <Button
          size="compact-sm"
          variant="subtle"
          aria-expanded={explain}
          onClick={() => setExplain((v) => !v)}
        >
          {explain ? "Masquer le mécanisme" : "Comment ça marche ?"}
        </Button>
      </Group>
      {inProcess ? (
        <Text size="sm" c="dimmed" mb="sm">
          <b>Peu significatif ici :</b> SQLite est une bibliothèque qui lit un
          fichier dans ce process — il n'y a ni serveur ni réseau qui puisse
          tomber. Le battement n'y détecterait qu'une panne de fichier (disque
          plein, fichier supprimé, droits retirés). Ce mécanisme prend son sens
          face à PostgreSQL, MySQL ou MongoDB.
        </Text>
      ) : null}
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <DefinitionList>
          <KeyValue
            k="Battement de cœur"
            v={
              res.heartbeatMs <= 0
                ? "désactivé"
                : res.heartbeatActive
                  ? `actif · toutes les ${period}`
                  : res.pingable
                    ? "arrêté"
                    : "impossible (pas de ping)"
            }
          />
          <KeyValue
            k="Délai de réponse"
            v={fmtDuration(res.heartbeatTimeoutMs)}
          />
        </DefinitionList>
        <DefinitionList>
          <KeyValue k="Pertes constatées" v={String(health.lostCount ?? 0)} />
          <KeyValue k="Reprises constatées" v={String(health.reconnectCount)} />
        </DefinitionList>
        <DefinitionList>
          <KeyValue
            k="Dernière perte"
            v={health.lastLostAt ? fmtClock(health.lastLostAt) : "—"}
          />
          <KeyValue
            k="Dernière coupure"
            v={lastOutage !== undefined ? fmtDuration(lastOutage) : "—"}
          />
        </DefinitionList>
      </SimpleGrid>
      <Collapse expanded={explain}>
        <Stack gap={6} mt="md">
          <Text size="sm" fw={600}>
            Ce qui se passe quand la base tombe
          </Text>
          <Text size="sm" c="dimmed">
            <b>1. Détecter.</b>{" "}
            {mongo
              ? "Le pilote MongoDB surveille ses serveurs en permanence : il signale seul la perte, même sans trafic."
              : inProcess
                ? "SQLite n'a pas de serveur : le battement exécute sa requête dans ce process, sur le fichier."
                : "Ce pilote n'apprend l'état de la base que par ses requêtes. Ses signaux (fermeture d'une connexion du pool) ne tranchent pas : ils avancent le battement, qui seul décide."}{" "}
            {period
              ? `Le battement interroge la base toutes les ${period} ; sans réponse en ${fmtDuration(res.heartbeatTimeoutMs)}, c'est une perte — une base gelée ne ferme rien, seule une montre la voit.`
              : "Le battement est désactivé : aucune sonde périodique ne complète le pilote."}
          </Text>
          <Text size="sm" c="dimmed">
            <b>2. Constater la perte, une seule fois.</b> Le connecteur passe
            hors ligne, sa durée de connexion est remise à zéro (un compteur qui
            continuerait de courir se lirait comme une preuve de santé), et
            l'événement <Code>onOrmLost</Code> part une fois — même si dix
            connexions du pool tombent ensemble.
          </Text>
          <Text size="sm" c="dimmed">
            <b>3. Attendre le retour.</b> Pendant la panne, le battement
            continue : c'est lui qui verra la base revenir. Un arrêt volontaire
            (<Code>disconnect()</Code>) l'arrête, en revanche.
          </Text>
          <Text size="sm" c="dimmed">
            <b>4. Constater la reprise.</b> À la première réponse, le connecteur
            repasse en ligne et <Code>onOrmRestored</Code> part. Une reprise
            n'est comptée que s'il y a eu une perte : ouvrir le pool au
            démarrage n'en est pas une.
          </Text>
          <Text size="xs" c="dimmed">
            Réglage : <Code>NF_ORM_HEARTBEAT_MS</Code> (période, 0 = désactivé).
            Mesures propres à ce process — chaque exemplaire a sa connexion.
          </Text>
        </Stack>
      </Collapse>
      <Title order={3} size="h5" mt="md" mb={6}>
        Chronologie des coupures
      </Title>
      {events.length > 0 ? (
        <Table striped>
          <Table.Tbody>
            {events.map((e, i) => (
              <Table.Tr key={`${i}-${e.ts}-${e.kind}`}>
                <Table.Td w={110}>{fmtClock(e.ts)}</Table.Td>
                <Table.Td w={110}>
                  <Badge
                    size="sm"
                    variant="light"
                    color={e.kind === "lost" ? "red" : "teal"}
                  >
                    {e.kind === "lost" ? "perte" : "reprise"}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {e.kind === "lost" ? (
                    <Code>{e.reason ?? "cause non transmise"}</Code>
                  ) : e.outageMs !== undefined ? (
                    `après ${fmtDuration(e.outageMs)} de coupure`
                  ) : (
                    "coupure antérieure à la chronologie"
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm" c="dimmed">
          Aucune coupure depuis le démarrage de ce process.
        </Text>
      )}
    </Paper>
  );
}

/** Un verdict de l'analyse, rendu. */
function FindingRow({
  finding,
  onOpen,
}: {
  finding: ConnectorFinding;
  onOpen: (tab: ConnectorTab) => void;
}) {
  const ui = LEVEL_UI[finding.level];
  const Icon = ui.icon;
  return (
    <Paper withBorder radius="md" p="sm">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <ThemeIcon variant="light" color={ui.color} size={30} radius="md">
          <Icon size={18} />
        </ThemeIcon>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600} size="sm">
              {finding.title}
            </Text>
            <Badge size="xs" variant="light" color={ui.color}>
              {ui.label}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            <InlineCode text={finding.detail} />
          </Text>
          {finding.command ? <CopyCommand command={finding.command} /> : null}
        </Stack>
        {finding.tab && finding.tab !== "analyse" ? (
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => onOpen(finding.tab as ConnectorTab)}
          >
            Voir le détail
          </Button>
        ) : null}
      </Group>
    </Paper>
  );
}

export const OrmConnector = observer(() => {
  const store = useStore();
  const ui = useUi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const name = params.get("name") ?? "";
  const rawTab = params.get("tab") as ConnectorTab | null;
  const tab: ConnectorTab =
    rawTab && TAB_VALUES.has(rawTab) ? rawTab : "analyse";
  // L'URL porte le connecteur ET l'onglet : un verdict « Voir le détail »,
  // un rechargement ou un lien partagé retombent au même endroit.
  const setTab = useCallback(
    (v: string) =>
      setParams(
        (p) => {
          p.set("tab", v);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  const q = `connector=${encodeURIComponent(name)}`;

  // ── Données invariantes (identiques depuis tout process) ────────────────
  const orms = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms"),
      [store],
    ),
  );
  const graph = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmGraph>(`/nodefony/orm/api/graph?${q}`),
      [store, q],
    ),
  );
  const counts = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<Record<string, number>>(
          `/nodefony/orm/api/counts?${q}`,
        ),
      [store, q],
    ),
  );
  const stores = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<{ stores?: StoreBrick[] }>(
          "/nodefony/kernel/api/stores",
        ),
      [store],
    ),
  );
  // Ouverte sans connecteur (lien direct, F5 sur `/orm-connector`) : la page
  // prend le connecteur PAR DÉFAUT et l'écrit dans l'URL, plutôt que d'afficher
  // un connecteur sans nom dont les migrations répondent 404.
  useEffect(() => {
    if (name || !orms.data?.length) return;
    const fallback = orms.data.find((o) => o.default) ?? orms.data[0];
    setParams(
      (p) => {
        p.set("name", fallback.name);
        return p;
      },
      { replace: true },
    );
  }, [name, orms.data, setParams]);
  const migrations = useResource(
    useCallback(
      () =>
        name
          ? store.api.getAbsolute<MigrationReply>(
              `/nodefony/orm/api/migrations?${q}`,
            )
          : Promise.resolve(null),
      [store, q, name],
    ),
  );

  // ── Mesures PAR PROCESS (le pid qui a répondu est gardé) ───────────────
  const health = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<ConnHealth[]>(
          `/nodefony/orm/api/connection/health?${q}`,
        ),
      [store, q],
    ),
  );
  const flowSnap = useResource(
    useCallback(
      () => store.api.getAbsolute<FlowSnapshot>(`/nodefony/orm/api/flow?${q}`),
      [store, q],
    ),
  );
  const topology = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<HealthPayload>("/nodefony/realtime/api/health"),
      [store],
    ),
  );
  const isCluster = useMemo(
    () => normalize(topology.data)?.cluster ?? false,
    [topology.data],
  );

  // ── Temps réel (réglages partagés avec les autres pages ORM) ───────────
  const live = ui.realtimeLive;
  const auto = ui.adaptiveCadence;
  const [liveMs, setLiveMs] = useState<number>(
    () => Number(lsGet("nf.orm.liveMs")) || 5000,
  );
  const [effectiveMs, setEffectiveMs] = useState<number>(liveMs);
  useEffect(() => lsSet("nf.orm.liveMs", String(liveMs)), [liveMs]);
  const [liveHealth, setLiveHealth] = useState<ConnHealth[] | null>(null);
  const { flowByName, onFlow, reset: resetFlow } = useOrmFlow();
  useEffect(() => {
    if (!live) {
      setLiveHealth(null);
      resetFlow();
    }
  }, [live, resetFlow]);

  // ── Lecture ─────────────────────────────────────────────────────────────
  const list = useMemo(() => orms.data ?? [], [orms.data]);
  const orm = list.find((o) => o.name === name) ?? null;
  const h: ConnHealth | null =
    (liveHealth ?? health.data ?? []).find((x) => x.name === name) ?? null;
  const flowEnabled = flowSnap.data?.enabled;
  const flow =
    flowSnap.data?.connectors.find((c) => c.connector === name) ?? null;
  const liveFlow = flowByName[name];
  const measuredBy = h?.instanceId ?? flowSnap.data?.instanceId ?? null;
  const entities = useMemo<EntityNode[]>(
    () => (graph.data?.entities ?? []).filter((e) => e.connector === name),
    [graph.data, name],
  );
  const rowsByEntity = useMemo(() => {
    const m = new Map<string, number>();
    if (!counts.data) return m;
    for (const e of entities) m.set(e.name, entityCount(counts.data, e) ?? -1);
    return m;
  }, [counts.data, entities]);
  const totalRows = useMemo(() => {
    let t = 0;
    for (const n of rowsByEntity.values()) if (n > 0) t += n;
    return t;
  }, [rowsByEntity]);
  const bricks = useMemo(
    () => attributeBricks(stores.data?.stores ?? [], list).get(name) ?? [],
    [stores.data, list, name],
  );
  const durable = bricks.filter((b) => b.nature === "durable");
  const findings = useMemo(
    () =>
      orm
        ? analyzeConnector({
            orm,
            health: h,
            bricks: stores.data ? bricks : undefined,
            entities,
            rows: counts.data ? rowsByEntity : undefined,
            flow,
            flowEnabled,
            slowMs: flowSnap.data?.slowMs,
            migrations: migrations.data,
          })
        : [],
    [
      orm,
      h,
      stores.data,
      bricks,
      entities,
      counts.data,
      rowsByEntity,
      flow,
      flowEnabled,
      flowSnap.data?.slowMs,
      migrations.data,
    ],
  );
  const verdict = worstLevel(findings);
  const role = orm ? connectorRole(orm, bricks.length) : null;
  const relationCount = entities.reduce(
    (n, e) => n + (e.relations?.length ?? 0),
    0,
  );
  const topEntity = useMemo(() => {
    let top: [string, number] | null = null;
    for (const [k, n] of rowsByEntity) if (!top || n > top[1]) top = [k, n];
    return top;
  }, [rowsByEntity]);

  const exportModel = useCallback(
    async (format: "dbml" | "jsonschema") => {
      const r = await store.api.getAbsolute<{ content: string }>(
        `/nodefony/orm/api/export/${format}?${q}`,
      );
      download(
        `${name}.${format === "dbml" ? "dbml" : "schema.json"}`,
        r.content,
        format === "dbml" ? "text/plain" : "application/json",
      );
    },
    [store, q, name],
  );

  // ── Onglet Données ──────────────────────────────────────────────────────
  const entityRows = useMemo<EntityRow[]>(
    () =>
      entities.map((e) => {
        const n = rowsByEntity.get(e.name) ?? -1;
        return {
          name: e.name,
          module: e.module ?? "—",
          domain: e.domain ?? "—",
          columns: e.columns?.length ?? 0,
          relations: e.relations?.length ?? 0,
          rows: n,
          share: n > 0 && totalRows > 0 ? n / totalRows : 0,
        };
      }),
    [entities, rowsByEntity, totalRows],
  );
  const entityColumns = useMemo<DataGridColumn<EntityRow>[]>(
    () => [
      {
        key: "name",
        header: "Entité",
        sortable: true,
        filterable: true,
        value: (r) => r.name,
        render: (r) => (
          <Anchor
            component={Link}
            size="sm"
            to={`/nodefony/orm-entity?name=${encodeURIComponent(r.name)}&${q}`}
          >
            {r.name}
          </Anchor>
        ),
      },
      {
        key: "module",
        header: "Module",
        sortable: true,
        filterable: true,
        filterType: "select",
        value: (r) => r.module,
      },
      {
        key: "domain",
        header: "Domaine",
        sortable: true,
        filterable: true,
        filterType: "select",
        value: (r) => r.domain,
      },
      {
        key: "columns",
        header: "Colonnes",
        align: "right",
        sortable: true,
        value: (r) => r.columns,
      },
      {
        key: "relations",
        header: "Relations",
        align: "right",
        sortable: true,
        value: (r) => r.relations,
      },
      {
        key: "rows",
        header: "Lignes",
        align: "right",
        sortable: true,
        value: (r) => r.rows,
        render: (r) => (
          <Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtNum(r.rows)}
          </Text>
        ),
      },
      {
        key: "share",
        header: "Part",
        align: "right",
        sortable: true,
        value: (r) => r.share,
        render: (r) => (
          <Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            {r.share > 0 ? `${(r.share * 100).toFixed(1)} %` : "—"}
          </Text>
        ),
      },
    ],
    [q],
  );

  // ── Onglet Stores ───────────────────────────────────────────────────────
  const brickColumns = useMemo<DataGridColumn<StoreBrick>[]>(
    () => [
      { key: "brick", header: "Brique", sortable: true, value: (r) => r.brick },
      {
        key: "nature",
        header: "Nature",
        sortable: true,
        value: (r) => r.nature ?? "—",
        render: (r) => (
          <Badge
            size="sm"
            variant="light"
            color={r.nature === "durable" ? "teal" : "gray"}
          >
            {r.nature ?? "—"}
          </Badge>
        ),
      },
      {
        key: "configPath",
        header: "Réglage",
        value: (r) => r.configPath ?? "—",
        render: (r) => <Code>{r.configPath ?? "—"}</Code>,
      },
      {
        key: "provenance",
        header: "Provenance",
        sortable: true,
        value: (r) => r.provenance ?? "—",
      },
      { key: "reason", header: "Pourquoi ici", value: (r) => r.reason ?? "—" },
    ],
    [],
  );

  // ── Onglet Migrations ───────────────────────────────────────────────────
  const migrationRows = useMemo<MigrationRow[]>(() => {
    const m = migrations.data;
    if (!m || isMigrationFailure(m)) return [];
    return m.sources.flatMap(
      (s) => s.entries?.map((e) => ({ ...e, source: s.name })) ?? [],
    );
  }, [migrations.data]);
  const migrationColumns = useMemo<DataGridColumn<MigrationRow>[]>(
    () => [
      {
        key: "source",
        header: "Origine",
        sortable: true,
        filterable: true,
        filterType: "select",
        value: (r) => r.source,
      },
      {
        key: "tag",
        header: "Migration",
        sortable: true,
        value: (r) => r.tag,
        render: (r) => <Code>{r.tag}</Code>,
      },
      {
        key: "status",
        header: "État",
        sortable: true,
        value: (r) => r.status,
        render: (r) => (
          <Badge
            size="sm"
            variant="light"
            color={
              r.status === "applied"
                ? "teal"
                : r.status === "pending"
                  ? "orange"
                  : "red"
            }
          >
            {r.status}
          </Badge>
        ),
      },
      {
        key: "appliedAt",
        header: "Appliquée le",
        sortable: true,
        value: (r) => r.appliedAt ?? 0,
        render: (r) =>
          r.appliedAt ? new Date(r.appliedAt).toLocaleString() : "—",
      },
      {
        key: "appliedBy",
        header: "Par",
        value: (r) => r.appliedBy ?? "—",
      },
    ],
    [],
  );

  const loadingCore = orms.loading && !list.length;
  if (!loadingCore && !orm) {
    return (
      <DataState
        loading={false}
        error={
          orms.error ??
          `Aucun connecteur « ${name || "(sans nom)"} » dans cette application.`
        }
        onRetry={orms.reload}
      >
        {null}
      </DataState>
    );
  }

  const levelUi = LEVEL_UI[verdict];
  const segments: StatusSegment[] = [
    {
      id: "verdict",
      label: "Analyse",
      tone:
        verdict === "critical"
          ? "danger"
          : verdict === "warning"
            ? "warn"
            : "ok",
      value: `${levelUi.label} · ${findings.length} constat(s)`,
    },
    {
      id: "measured",
      label: "Santé et flux mesurés par",
      tone: isCluster ? "warn" : "neutral",
      value: measuredBy ? (
        <Anchor component={Link} to={`/nodefony/orm/${measuredBy}`} size="sm">
          pid {measuredBy}
          {isCluster ? " (un worker du cluster)" : ""}
        </Anchor>
      ) : (
        "—"
      ),
      info: (
        <DocHint
          title="Mesures par process"
          version={ORM_DOC}
          summary={
            isCluster
              ? `Santé, latence, stockage et flux viennent du worker pid ${measuredBy ?? "?"} — celui que le répartiteur a choisi pour cette requête. Un autre worker peut voir autre chose : sa vue détaillée est dans /nodefony/orm/<pid>.`
              : "Un seul process sert l'application : ses mesures sont celles du connecteur."
          }
          sections={[
            {
              label: "Invariant",
              body: "Schéma, lignes, briques et migrations sont les mêmes vus de n'importe quel process.",
            },
          ]}
        />
      ),
    },
    {
      id: "live",
      label: "Temps réel",
      tone: live ? "active" : "neutral",
      value: live ? `actif · ${fmtMs(effectiveMs)}` : "coupé",
    },
  ];

  // ── Panneaux ────────────────────────────────────────────────────────────
  const analysisPanel = (
    <Stack gap="sm">
      <Grid>
        <KpiCard
          label="Santé"
          accent={!orm?.connected || (h && !h.pingOk) ? "red" : "teal"}
          icon={<IconHeartRateMonitor size={20} />}
          hint={`Joignabilité et latence mesurées par le pid ${measuredBy ?? "?"}.`}
          hintVersion={ORM_DOC}
          value={!orm?.connected ? "hors ligne" : h ? fmtMs(h.pingMs) : "—"}
          footer={
            <Text size="xs" c="dimmed">
              {h
                ? `depuis ${fmtDuration(h.uptimeMs)} · ${h.reconnectCount} reconnexion(s)`
                : "diagnostic indisponible"}
            </Text>
          }
          onClick={() => setTab("connexion")}
        />
        <KpiCard
          label="Entités"
          icon={<IconTable size={20} />}
          hint={`${entities.length} entité(s) déclarée(s) sur ce connecteur, ${relationCount} relation(s).`}
          hintVersion={ORM_DOC}
          value={entities.length || (orm?.entityCount ?? "—")}
          footer={
            <Group gap={4}>
              {Object.entries(
                entities
                  .flatMap((e) => e.relations ?? [])
                  .reduce<Record<string, number>>((acc, r) => {
                    acc[r.type] = (acc[r.type] ?? 0) + 1;
                    return acc;
                  }, {}),
              ).map(([type, n]) => (
                <Badge key={type} size="xs" variant="light">
                  {n} {REL_LABEL[type] ?? type}
                </Badge>
              ))}
            </Group>
          }
          onClick={() => setTab("donnees")}
        />
        <KpiCard
          label="Lignes"
          icon={<IconDatabase size={20} />}
          hint="Total des COUNT(*) des tables de ce connecteur."
          hintVersion={ORM_DOC}
          value={counts.data ? fmtNum(totalRows) : "—"}
          footer={
            <Text size="xs" c="dimmed">
              {topEntity && topEntity[1] > 0
                ? `↑ ${topEntity[0]} · ${fmtNum(topEntity[1])}`
                : "aucune ligne"}
            </Text>
          }
          onClick={() => setTab("donnees")}
        />
        <KpiCard
          label="Requêtes"
          icon={<IconBolt size={20} />}
          hint={`Requêtes vues par le pid ${measuredBy ?? "?"} depuis son démarrage.`}
          hintVersion={ORM_DOC}
          value={
            flowEnabled === false ? "non mesuré" : fmtNum(flow?.total ?? 0)
          }
          footer={
            <Text size="xs" c="dimmed">
              {flow
                ? `moy. ${fmtMs(flow.avgMs)} · ${flow.slowTotal} lente(s)`
                : "—"}
            </Text>
          }
          onClick={() => setTab("requetes")}
        />
      </Grid>
      <Text size="sm" c="dimmed">
        {durable.length > 0
          ? `Porte ${durable.length} brique(s) durable(s) du framework et ${bricks.length - durable.length} éphémère(s).`
          : "Ne porte aucune brique durable du framework."}
      </Text>

      {findings.length === 0 ? (
        <Text c="dimmed" size="sm">
          Aucun constat : les mesures disponibles ne signalent rien.
        </Text>
      ) : (
        findings.map((f) => (
          <FindingRow key={f.id} finding={f} onOpen={setTab} />
        ))
      )}
      {(health.error || flowSnap.error || counts.error || stores.error) && (
        <Text size="xs" c="dimmed">
          Non mesuré :{" "}
          {[
            health.error && "santé",
            flowSnap.error && "flux",
            counts.error && "lignes",
            stores.error && "briques",
          ]
            .filter(Boolean)
            .join(", ")}{" "}
          — les verdicts correspondants sont absents, pas favorables.
        </Text>
      )}
    </Stack>
  );

  const dataPanel = (
    <DataState
      loading={graph.loading && !entities.length}
      error={graph.error}
      empty={!entities.length}
      emptyMessage="Aucune entité déclarée sur ce connecteur."
      onRetry={graph.reload}
    >
      <DataGrid
        mode="client"
        data={entityRows}
        columns={entityColumns}
        getRowId={(r) => r.name}
        initialSort={{ key: "rows", dir: "desc" }}
        persist={{ key: "studio.orm.connector.entities" }}
        searchPlaceholder="Filtrer les entités…"
      />
    </DataState>
  );

  const storesPanel = (
    <DataState
      loading={stores.loading && !stores.data}
      error={stores.error}
      empty={!bricks.length}
      emptyMessage="Aucune brique du framework n'est résolue sur ce connecteur : ses tables appartiennent au module qui l'a déclaré."
      onRetry={stores.reload}
    >
      <DataGrid
        mode="client"
        data={bricks}
        columns={brickColumns}
        getRowId={(r) => r.brick}
        searchable={false}
      />
    </DataState>
  );

  const queriesPanel = (
    <DataState
      loading={flowSnap.loading && !flowSnap.data}
      error={flowSnap.error}
      onRetry={flowSnap.reload}
    >
      {flowEnabled === false ? (
        <Text c="dimmed" size="sm">
          La mesure du flux est coupée sur ce serveur (production).
        </Text>
      ) : (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Paper withBorder radius="md" p="md">
              <DefinitionList>
                <KeyValue k="Requêtes" v={fmtNum(flow?.total ?? 0)} />
                <KeyValue k="Latence moyenne" v={fmtMs(flow?.avgMs ?? null)} />
                <KeyValue
                  k="Latence récente (EWMA)"
                  v={fmtMs(liveFlow?.ewmaMs ?? flow?.ewmaMs ?? null)}
                />
                <KeyValue k="Dernière" v={fmtMs(flow?.lastMs ?? null)} />
                <KeyValue k="La pire" v={fmtMs(flow?.maxMs ?? null)} />
                <KeyValue
                  k={`Lentes (≥ ${flowSnap.data?.slowMs ?? "?"} ms)`}
                  v={fmtNum(flow?.slowTotal ?? 0)}
                />
              </DefinitionList>
            </Paper>
            <ChartCard
              title="Débit"
              caption={
                live
                  ? `requêtes/s, pid ${measuredBy ?? "?"}`
                  : "activer le temps réel pour suivre le débit"
              }
            >
              <MiniChart
                series={[
                  {
                    data: liveFlow?.hist ?? [],
                    color: "var(--mantine-color-brand-4)",
                    label: "req/s",
                  },
                ]}
                height={90}
              />
            </ChartCard>
          </SimpleGrid>
          <Title order={2} size="h4">
            Requêtes lentes retenues
          </Title>
          {flow && flow.slow.length > 0 ? (
            flow.slow
              .slice()
              .sort((a, b) => b.durationMs - a.durationMs)
              .map((s) => (
                <Paper key={`${s.ts}-${s.durationMs}`} withBorder p="sm">
                  <Group justify="space-between" mb={6}>
                    <Badge variant="light" color="orange">
                      {fmtMs(s.durationMs)}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {fmtClock(s.ts)}
                    </Text>
                  </Group>
                  <Code block style={{ whiteSpace: "pre-wrap" }}>
                    {s.sql ?? "(SQL non retenu)"}
                  </Code>
                </Paper>
              ))
          ) : (
            <Text c="dimmed" size="sm">
              Aucune requête n'a franchi le seuil depuis le démarrage de ce
              process.
            </Text>
          )}
        </Stack>
      )}
    </DataState>
  );

  const st = h?.storage;
  const connectionPanel = (
    <DataState
      loading={health.loading && !h}
      error={health.error}
      empty={!h}
      emptyMessage="Ce process n'a publié aucun diagnostic pour ce connecteur."
      onRetry={health.reload}
    >
      {h ? (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
            <Paper withBorder radius="md" p="md">
              <Title order={2} size="h5" mb="xs">
                Identité
              </Title>
              <DefinitionList>
                <KeyValue
                  k="ORM"
                  v={`${VENDOR_LABEL[h.vendor] ?? h.vendor} ${h.ormVersion ?? ""}`}
                />
                <KeyValue k="Moteur" v={`${h.driver} ${h.version ?? ""}`} />
                <KeyValue k="Cible" v={h.target ?? "—"} mono />
              </DefinitionList>
            </Paper>
            <Paper withBorder radius="md" p="md">
              <Title order={2} size="h5" mb="xs">
                Cycle de vie
              </Title>
              <DefinitionList>
                <KeyValue
                  k="Connecté depuis"
                  v={
                    h.connectedSince
                      ? new Date(h.connectedSince).toLocaleString()
                      : "—"
                  }
                />
                <KeyValue k="Durée" v={fmtDuration(h.uptimeMs)} />
                <KeyValue k="Connexions" v={String(h.connectCount)} />
                <KeyValue k="Reconnexions" v={String(h.reconnectCount)} />
                <KeyValue k="Temps d'ouverture" v={fmtMs(h.lastConnectMs)} />
              </DefinitionList>
            </Paper>
            <Paper withBorder radius="md" p="md">
              <Title order={2} size="h5" mb="xs">
                Latence du ping
              </Title>
              <DefinitionList>
                <KeyValue k="Dernier" v={fmtMs(h.latency.last)} />
                <KeyValue k="Min" v={fmtMs(h.latency.min)} />
                <KeyValue k="Moyen" v={fmtMs(h.latency.avg)} />
                <KeyValue k="Max" v={fmtMs(h.latency.max)} />
                <KeyValue k="Mesures" v={String(h.latency.samples)} />
              </DefinitionList>
            </Paper>
            {st ? (
              <Paper withBorder radius="md" p="md">
                <Title order={2} size="h5" mb="xs">
                  Stockage
                </Title>
                <DefinitionList>
                  <KeyValue k="Taille" v={fmtBytes(st.sizeBytes)} />
                  <KeyValue k="Pages" v={fmtNum(st.pages ?? -1)} />
                  <KeyValue k="Taille de page" v={fmtBytes(st.pageSize)} />
                  <KeyValue
                    k="Pages libres"
                    v={
                      st.freePages !== undefined && st.pages
                        ? `${fmtNum(st.freePages)} (${Math.round((st.freePages / st.pages) * 100)} %)`
                        : "—"
                    }
                  />
                  <KeyValue k="Journal" v={st.journalMode ?? "—"} />
                </DefinitionList>
              </Paper>
            ) : null}
            {h.pool ? (
              <Paper withBorder radius="md" p="md">
                <Title order={2} size="h5" mb="xs">
                  Pool
                </Title>
                <DefinitionList>
                  <KeyValue k="Taille" v={String(h.pool.size ?? "—")} />
                  <KeyValue
                    k="Disponibles"
                    v={String(h.pool.available ?? "—")}
                  />
                  <KeyValue k="Empruntées" v={String(h.pool.borrowed ?? "—")} />
                  <KeyValue k="En attente" v={String(h.pool.pending ?? "—")} />
                </DefinitionList>
              </Paper>
            ) : null}
          </SimpleGrid>
          <ResilienceSection health={h} />
          <Title order={2} size="h4">
            Erreurs récentes
          </Title>
          {h.recentErrors.length > 0 ? (
            <Table striped>
              <Table.Tbody>
                {h.recentErrors.map((e, i) => (
                  <Table.Tr key={`${i}-${e.ts}`}>
                    <Table.Td w={120}>{fmtClock(e.ts)}</Table.Td>
                    <Table.Td>
                      <Code>{e.message}</Code>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text c="dimmed" size="sm">
              Aucune erreur retenue depuis le démarrage de ce process.
            </Text>
          )}
        </Stack>
      ) : null}
    </DataState>
  );

  const mig = migrations.data;
  const migrationsPanel = (
    <DataState
      loading={migrations.loading && !mig}
      error={migrations.error}
      onRetry={migrations.reload}
    >
      {mig && isMigrationFailure(mig) ? (
        <Paper withBorder radius="md" p="md">
          <Stack gap="xs">
            <Group gap="xs">
              <Badge color="gray" variant="light">
                {mig.error.code}
              </Badge>
              <Text fw={600}>{mig.error.summary}</Text>
            </Group>
            <Text size="sm" c="dimmed">
              {mig.error.meaning}
            </Text>
            {mig.error.nextActions.map((a) => (
              <CopyCommand key={a.command} command={a.command} />
            ))}
          </Stack>
        </Paper>
      ) : mig ? (
        <Stack gap="md">
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" wrap="wrap">
              <Stack gap={4}>
                <Group gap="xs">
                  <Badge
                    variant="light"
                    color={mig.verdict === "up-to-date" ? "teal" : "orange"}
                  >
                    {mig.verdict}
                  </Badge>
                  <Text size="sm">{mig.summary}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {mig.driver.dialect ?? mig.driver.kind} · schéma en mode{" "}
                  {mig.driver.ddl ?? "?"} · historique{" "}
                  <Code>{mig.driver.historyTable ?? "—"}</Code>
                </Text>
              </Stack>
              <Button
                component={Link}
                to={`/nodefony/migrate?${q}`}
                variant="light"
                leftSection={<IconGitMerge size={16} />}
              >
                Plan et application
              </Button>
            </Group>
            {mig.nextActions.map((a) => (
              <CopyCommand key={a.command} command={a.command} />
            ))}
          </Paper>
          <DataGrid
            mode="client"
            data={migrationRows}
            columns={migrationColumns}
            getRowId={(r) => `${r.source}:${r.tag}`}
            initialSort={{ key: "appliedAt", dir: "desc" }}
            searchable={false}
          />
        </Stack>
      ) : null}
    </DataState>
  );

  const tabs: TabbedPageTab[] = [
    {
      value: "analyse",
      label: "Analyse",
      icon: <IconBulb size={14} />,
      badge: (
        <Badge size="xs" variant="light" color={levelUi.color}>
          {findings.length}
        </Badge>
      ),
      panel: analysisPanel,
    },
    {
      value: "donnees",
      label: "Données",
      icon: <IconTable size={14} />,
      panel: dataPanel,
    },
    {
      value: "stores",
      label: "Stores",
      icon: <IconStack2 size={14} />,
      badge: bricks.length ? (
        <Badge size="xs" variant="light">
          {bricks.length}
        </Badge>
      ) : undefined,
      panel: storesPanel,
    },
    {
      value: "requetes",
      label: "Requêtes",
      icon: <IconBolt size={14} />,
      panel: queriesPanel,
    },
    {
      value: "connexion",
      label: "Connexion",
      icon: <IconPlugConnected size={14} />,
      panel: connectionPanel,
    },
    {
      value: "migrations",
      label: "Migrations",
      icon: <IconGitMerge size={14} />,
      panel: migrationsPanel,
    },
  ];

  return (
    <DataState loading={loadingCore} error={orms.error} onRetry={orms.reload}>
      {live && (
        <OrmHealthLive
          intervalMs={liveMs}
          adaptive={auto}
          onData={setLiveHealth}
          onRate={setEffectiveMs}
        />
      )}
      {live && (
        <OrmFlowLive intervalMs={liveMs} adaptive={auto} onFlow={onFlow} />
      )}
      <TabbedPage
        title={`Connecteur « ${name} »`}
        icon={<IconDatabase size={22} />}
        subtitle={
          orm ? (
            <Group gap={6} wrap="wrap">
              {role ? (
                <Badge size="sm" variant="light" color={role.color}>
                  {role.label}
                </Badge>
              ) : null}
              <Text size="sm" c="dimmed">
                {VENDOR_LABEL[orm.vendor ?? ""] ?? orm.vendor} ·{" "}
                {orm.connection?.driver} {orm.connection?.version ?? ""} ·{" "}
                <Code>{orm.connection?.target ?? "—"}</Code>
              </Text>
            </Group>
          ) : undefined
        }
        actions={
          <Group gap="xs" wrap="wrap">
            <Select
              aria-label="Changer de connecteur"
              size="sm"
              w={170}
              data={list.map((o) => o.name)}
              value={name}
              allowDeselect={false}
              onChange={(v) => {
                if (v) {
                  void navigate(
                    `/nodefony/orm-connector?name=${encodeURIComponent(v)}&tab=${tab}`,
                  );
                }
              }}
            />
            <OrmRealtimeControls
              live={live}
              onToggle={(v) => ui.setRealtimeLive(v)}
              liveMs={liveMs}
              setLiveMs={setLiveMs}
              auto={auto}
              effectiveMs={effectiveMs}
              ariaLabel={`abonnement temps réel du connecteur ${name}`}
            />
            <Menu position="bottom-end">
              <Menu.Target>
                <Button
                  variant="default"
                  leftSection={<IconDownload size={16} />}
                >
                  Exporter
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => void exportModel("dbml")}>
                  Modèle DBML
                </Menu.Item>
                <Menu.Item onClick={() => void exportModel("jsonschema")}>
                  JSON Schema
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              component={Link}
              to="/nodefony/orm"
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
            >
              Dashboard ORM
            </Button>
          </Group>
        }
        statusBar={<StatusBar segments={segments} />}
        tabs={tabs}
        value={tab}
        onChange={setTab}
      />
    </DataState>
  );
});
