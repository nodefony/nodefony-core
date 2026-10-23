/**
 * **LogExplorer** — onglet « requête froide » de la page Log Backplane.
 *
 * Interroge le driver de relecture ACTIF via `GET /syslog/api/logs/search`
 * (pagination + filtres **côté serveur**, `DataGrid mode="server"`). C'est la même
 * logique `filterPdus` que partageront le futur CLI et les drivers file/elastic →
 * cet écran ne changera pas quand on branchera Elasticsearch.
 *
 * Différenciateur : la **trace full-stack** — saisir (ou cliquer) un `requestId`
 * affiche TOUS les logs de cette requête, tous modules confondus.
 *
 * S'adapte aux **capabilities** : si le driver actif n'est pas `query`, l'écran
 * explique comment basculer plutôt que de requêter dans le vide.
 */
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Chip,
  Code,
  Collapse,
  Group,
  MultiSelect,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowsLeftRight,
  IconChevronDown,
  IconChevronRight,
  IconFilter,
  IconFilterOff,
  IconInfoCircle,
  IconPlugConnected,
  IconRoute2,
  IconSortAscending,
  IconSortDescending,
  IconTimeline,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import {
  DataGrid,
  DocHint,
  InfoHint,
  toPageParams,
  type DataGridColumn,
  type DataGridServerQuery,
  type DataGridServerResult,
} from "../../components/ui";
import { ansiToReact } from "../../utils/ansiToReact";
import type {
  ClusterTopology,
  ILogViewFilters,
  LogDriverCapabilities,
  LogQueryResult,
  LogRecord,
  Severity,
} from "./logsTypes";
import { parseSavedFilters, SEVERITIES, type SavedFilters } from "./logsTypes";
import { readStoredJson } from "../../utils/storedJson";
import { BROWSER_ORIGIN } from "nodefony";
import {
  LOGS_DOC,
  FRAMEWORK_MODULE,
  fmtClock,
  fmtMillis,
  methodColor,
  parseAccessLine,
  recordMessage,
  statusColor,
  severityColor,
  type ISourceDescription,
} from "./logFormat";
import { ClusterScopeNotice, SeverityBadge, OriginBadge } from "./LogVisuals";
import { SourceBanner } from "./SourceBanner";
import { RequestLines } from "./RequestLines";
import { ViewFilterSwitches } from "./ViewFilterSwitches";
import {
  describeFlow,
  flowSelectGroups,
  flowStepsForProtocol,
  type FlowStepId,
} from "./eventFlow";

/** Clé de persistance (sessionStorage) des filtres explicites de l'Explorer. */
// v2 : la vue d'ouverture est passée de « tout » à « INFO et plus grave » — une
// sélection vide gardée par la v1 aurait masqué ce nouveau défaut.
const FILTERS_KEY = "nf.logs.explorer.filters.v2";

/**
 * Vue d'ouverture : INFO et plus grave. Les jalons d'une requête (entrée, route,
 * réponse) sont en INFO/NOTICE ; DEBUG ne porte que la mécanique interne.
 */
const DEFAULT_SEVERITIES: readonly Severity[] = SEVERITIES.filter(
  (s) => s !== "DEBUG",
);
const isDefaultSeverities = (set: ReadonlySet<Severity>): boolean =>
  set.size === DEFAULT_SEVERITIES.length &&
  DEFAULT_SEVERITIES.every((s) => set.has(s));

export interface LogExplorerProps {
  /** Capacités du driver actif (garde `query`). `null` = méta pas encore chargée. */
  capabilities: LogDriverCapabilities | null;
  /** Nom du driver actif (message d'aide si non-queryable). */
  driverName: string | null;
  /** requestId à tracer, injecté par l'orchestrateur (clic « Tracer la requête »). */
  traceRequestId?: string;
  /** Clic sur une ligne → détail (drawer). */
  onSelect: (rec: LogRecord) => void;
  /** Incrémenté à chaque switch de driver → force un rechargement. */
  refreshKey?: number;
  /** Topologie cluster (méta backplane) → avertissement de vue partielle. */
  cluster?: ClusterTopology | null | undefined;
  /** Source de lecture décrite pour l'exploitant (bandeau, attente, vide). */
  source: ISourceDescription;
  /** Filtres d'affichage communs avec le Direct. */
  viewFilters: ILogViewFilters;
  onViewFiltersChange: (next: ILogViewFilters) => void;
}

export const LogExplorer = observer(
  ({
    capabilities,
    driverName,
    traceRequestId,
    onSelect,
    refreshKey = 0,
    cluster,
    source,
    viewFilters,
    onViewFiltersChange,
  }: LogExplorerProps) => {
    const store = useStore();

    // Filtres explicites PERSISTÉS (sessionStorage) → naviguer vers le Suivi de
    // requête puis revenir ne perd ni les filtres ni le requestId tracé. Lu une
    // fois (lazy) au montage ; ré-écrit à chaque changement (effet plus bas).
    const saved = useMemo(
      () => parseSavedFilters(readStoredJson("session", FILTERS_KEY)),
      [],
    );

    const [requestId, setRequestId] = useState(
      traceRequestId || saved.requestId || "",
    );
    // Sens de lecture. "desc" = plus RÉCENT en haut (défaut d'un viewer de logs) ;
    // "asc" = plus ANCIEN en haut = lecture du DÉBUT à la FIN (le bon sens pour
    // SUIVRE une requête). L'ordre s'appuie sur l'uid (#), pas l'horloge (ms) →
    // exact même quand plusieurs logs tombent dans la même milliseconde.
    // Tracer une requête démarre en "asc" : on veut la lire dans l'ordre.
    const [order, setOrder] = useState<"asc" | "desc">(
      traceRequestId ? "asc" : (saved.order ?? "desc"),
    );

    // Filtres EXPLICITES (barre dédiée, ≠ filtres colonne jugés peu lisibles).
    // Appliqués CÔTÉ SERVEUR via le loader. Sévérité = multi-sélection.
    // Le PROTOCOLE (WS/HTTP) est un VRAI critère back (`pduProtocol` : WS ⟺
    // msgid "WEBSOCKET CONTEXT", HTTP = le reste) → fiable, ≠ l'ancien filtre
    // « étape » par texte (trompeur, retiré : l'étape reste dérivée front via
    // describeFlow, pour la colonne seulement).
    const [protocol, setProtocol] = useState<"all" | "ws" | "http">(
      saved.protocol ?? "all",
    );
    // Étapes du cycle de vie — critère back STRUCTURÉ (pduFlowStep), multi-sélection.
    const [flows, setFlows] = useState<FlowStepId[]>(saved.flows ?? []);
    const [severities, setSeverities] = useState<Set<Severity>>(
      new Set(saved.severities ?? DEFAULT_SEVERITIES),
    );
    const [moduleF, setModuleF] = useState(saved.moduleF ?? "");
    const [msgidF, setMsgidF] = useState(saved.msgidF ?? "");
    // Filtres d'affichage communs avec le Direct : portés par la page.
    const { hideConsole, hideFramework } = viewFilters;
    // Une ligne par requête (sa ligne d'accès), ses autres lignes dépliées
    // dessous — sauf quand on trace déjà UNE requête.
    const [groupByRequest, setGroupByRequest] = useState(
      saved.groupByRequest ?? true,
    );
    const grouped = groupByRequest && requestId.trim() === "";
    // Suivre : relire la page toutes les 5 s (la source se remplit pendant
    // qu'on regarde). Rien ne bat quand l'onglet du navigateur est caché.
    const [follow, setFollow] = useState(true);
    const [tick, setTick] = useState(0);
    useEffect(() => {
      if (!follow) return;
      const id = setInterval(() => {
        if (document.visibilityState === "visible") setTick((t) => t + 1);
      }, 5_000);
      return () => clearInterval(id);
    }, [follow]);

    // Ré-écriture des filtres à chaque changement (source unique = sessionStorage).
    useEffect(() => {
      try {
        sessionStorage.setItem(
          FILTERS_KEY,
          JSON.stringify({
            requestId,
            order,
            protocol,
            flows,
            severities: [...severities],
            moduleF,
            msgidF,
            groupByRequest,
          } satisfies SavedFilters),
        );
      } catch {
        /* quota / mode privé — non bloquant */
      }
    }, [
      requestId,
      order,
      protocol,
      flows,
      severities,
      moduleF,
      msgidF,
      groupByRequest,
    ]);
    const filtersActive =
      protocol !== "all" ||
      flows.length > 0 ||
      !isDefaultSeverities(severities) ||
      moduleF.trim() !== "" ||
      msgidF.trim() !== "";
    // Filtres repliés sous « Plus de filtres » : le compte dit ce qui agit sans
    // être vu, et le repli s'ouvre de lui-même quand l'un d'eux est posé.
    const moreActive =
      (requestId.trim() !== "" ? 1 : 0) +
      (order === "asc" ? 1 : 0) +
      (protocol !== "all" ? 1 : 0) +
      (flows.length > 0 ? 1 : 0) +
      (moduleF.trim() !== "" ? 1 : 0) +
      (msgidF.trim() !== "" ? 1 : 0);
    const [moreOpen, setMoreOpen] = useState(moreActive > 0);
    // Signal stable → le DataGrid repart page 1 quand un filtre change.
    const filterSignal = `${hideFramework}|${grouped}|${hideConsole}|${protocol}|${[...flows].sort().join(",")}|${[...severities].sort().join(",")}|${moduleF.trim()}|${msgidF.trim()}`;
    const clearFilters = () => {
      setProtocol("all");
      setFlows([]);
      setSeverities(new Set(DEFAULT_SEVERITIES));
      setModuleF("");
      setMsgidF("");
    };

    // Le sélecteur d'étapes s'ADAPTE au protocole (WS → étapes WS + communes ;
    // HTTP → étapes HTTP + communes ; Tous → l'union, groupées).
    const flowData = useMemo(() => flowSelectGroups(protocol), [protocol]);
    // Changer de protocole peut invalider des étapes sélectionnées → on purge
    // celles qui ne sont plus proposées (sinon un AND impossible = 0 résultat).
    useEffect(() => {
      const valid = new Set(flowStepsForProtocol(protocol));
      setFlows((prev) => prev.filter((f) => valid.has(f)));
    }, [protocol]);

    // L'orchestrateur peut pousser un requestId à tracer (depuis Live ou le
    // drawer) → on synchronise le champ ET on passe en lecture chronologique
    // (suivre une requête = la lire du début à la fin).
    // Ne s'applique QUE pour un requestId non vide (poussé par le drawer) : sur un
    // simple remontage, le prop revient à "" et NE DOIT PAS écraser le requestId
    // restauré depuis sessionStorage.
    useEffect(() => {
      if (traceRequestId) {
        setRequestId(traceRequestId);
        setOrder("asc");
        setMoreOpen(true);
      }
    }, [traceRequestId]);

    const loader = useCallback(
      async (
        q: DataGridServerQuery,
      ): Promise<DataGridServerResult<LogRecord>> => {
        const params = toPageParams(q);
        // Le sens de lecture s'exprime désormais dans la grammaire du contrat
        // (`champ:SENS`), comme partout ailleurs : le data plane syslog a cessé
        // d'être le second dialecte. `timeStamp` est le seul champ que le
        // journal déclare triable — son axe technique est l'`uid` du Pdu, qui
        // départage deux logs de la même milliseconde.
        //
        // Ce `set` écrase ce que `toPageParams` aurait pu émettre : le sens est
        // piloté par le sélecteur dédié de la barre, pas par un en-tête de
        // colonne (aucune colonne de ce grid n'est `sortable` — deux commandes
        // pour le même réglage se contrediraient).
        params.set("order", `timeStamp:${order === "asc" ? "ASC" : "DESC"}`);
        if (requestId.trim()) params.set("requestId", requestId.trim());
        // Filtres EXPLICITES de la barre dédiée (le back applique l'inclusion via
        // filterPdus : severity = OU entre niveaux, module/msgid = égalité,
        // protocol = classification pduProtocol côté core).
        if (protocol !== "all") params.set("protocol", protocol);
        for (const f of flows) params.append("flow", f);
        for (const s of severities) params.append("severity", s);
        if (moduleF.trim()) params.set("module", moduleF.trim());
        if (msgidF.trim()) params.set("msgid", msgidF.trim());
        if (hideConsole) params.set("hideConsole", "true");
        if (grouped) params.set("groupByRequest", "true");
        if (hideFramework) params.set("excludeModule", FRAMEWORK_MODULE);
        const res = await store.api.getAbsolute<LogQueryResult>(
          `/nodefony/syslog/api/logs/search?${params.toString()}`,
        );
        return { rows: res.rows, total: res.total };
      },
      // refreshKey force la régénération du loader (→ refetch) après un switch ;
      // order/filtres → refetch au changement.
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- contrat de DataGrid : un loader NEUF déclenche le rechargement ; refreshKey n'existe que pour changer cette identité
      [
        store,
        requestId,
        order,
        refreshKey,
        protocol,
        flows,
        severities,
        moduleF,
        msgidF,
        hideConsole,
        grouped,
        hideFramework,
      ],
    );

    const columns = useMemo<DataGridColumn<LogRecord>[]>(
      () => [
        {
          key: "time",
          header: "Heure",
          size: 118,
          hint: "Horodatage à la milliseconde. À débit élevé, plusieurs logs partagent la même ms → se fier au # (séquence) pour l'ordre exact.",
          value: (r) => r.timeStamp,
          render: (r) => (
            <Text
              size="xs"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmtClock(r.timeStamp)}
              {/* Pas d'`opacity` ici : le retrait est DÉJÀ porté par le
                  `c="dimmed"` du parent, dont le thème a relevé la luminosité
                  pour atteindre 4,5:1. Une seconde couche l'annulait et faisait
                  retomber les millisecondes à 3,5:1. */}
              <Text span size="xs">
                .{fmtMillis(r.timeStamp)}
              </Text>
            </Text>
          ),
        },
        {
          key: "method",
          header: "Verbe",
          size: 76,
          hint: "Méthode HTTP de la requête (WS = connexion WebSocket). Vide pour une ligne qui n'est pas une ligne d'accès.",
          value: (r) => parseAccessLine(r)?.method ?? "",
          render: (r) => {
            const a = parseAccessLine(r);
            return a ? (
              <Badge
                size="sm"
                variant="filled"
                color={methodColor(a.method)}
                tt="none"
                ff="monospace"
              >
                {a.method}
              </Badge>
            ) : null;
          },
        },
        {
          key: "message",
          header: "Message",
          size: 420,
          value: (r) => recordMessage(r),
          render: (r) => {
            // Ligne d'accès : statut, chemin, durée — lus, pas un texte brut.
            const a = parseAccessLine(r);
            if (a) {
              return (
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge
                    size="sm"
                    variant="light"
                    color={statusColor(a.status)}
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {a.status ?? "—"}
                  </Badge>
                  <Text size="sm" fw={700} ff="monospace" truncate>
                    {a.path}
                  </Text>
                  {a.duration && (
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {a.duration}
                    </Text>
                  )}
                </Group>
              );
            }
            return (
              <Text
                size="xs"
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {ansiToReact(recordMessage(r))}
              </Text>
            );
          },
        },
        {
          key: "severity",
          header: "Sévérité",
          size: 120,
          value: (r) => r.severityName,
          render: (r) => <SeverityBadge severity={r.severityName} />,
        },
        {
          key: "module",
          header: "Module",
          size: 130,
          value: (r) => r.moduleName,
          render: (r) => <OriginBadge moduleName={r.moduleName} />,
        },
        {
          key: "requestId",
          header: "requestId",
          size: 170,
          value: (r) => r.requestId ?? "",
          render: (r) =>
            r.requestId ? (
              <>
                <Tooltip label="Tracer toute la requête">
                  <Badge
                    component="button"
                    type="button"
                    variant="outline"
                    color="grape"
                    size="sm"
                    style={{ cursor: "pointer", fontFamily: "monospace" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRequestId(r.requestId ?? "");
                      setOrder("asc"); // suivre la requête = lecture chronologique
                      setMoreOpen(true);
                    }}
                  >
                    {r.requestId.slice(0, 8)}
                  </Badge>
                </Tooltip>
                {r.lines !== undefined && r.lines > 1 && (
                  <Text span size="xs" c="dimmed" ml={4}>
                    {r.lines} lignes
                  </Text>
                )}
              </>
            ) : (
              <Text c="dimmed" size="xs">
                —
              </Text>
            ),
        },
        {
          key: "flow",
          header: "Étape",
          size: 140,
          hint: "Traduit l'event technique en étape logique du cycle de la requête (entrée → routage → session → réponse → fin). Vide (—) = log applicatif libre (ton métier). Légende complète dans l'onglet Backplane.",
          value: (r) => describeFlow(r)?.label ?? "",
          render: (r) => {
            const f = describeFlow(r);
            return f ? (
              <Badge size="xs" variant="light" color={f.color}>
                {f.label}
              </Badge>
            ) : (
              <Text c="dimmed" size="xs">
                —
              </Text>
            );
          },
        },
        {
          key: "msgid",
          header: "msgid",
          size: 120,
          value: (r) => r.msgid,
          render: (r) =>
            r.msgid ? (
              <Code style={{ fontSize: 11 }}>{r.msgid}</Code>
            ) : (
              <Text c="dimmed">—</Text>
            ),
        },
        {
          key: "uid",
          header: "#",
          size: 76,
          hint: "Numéro de séquence (uid) — compteur monotone d'émission. Garantit la chronologie EXACTE même quand l'horloge (ms) est identique.",
          value: (r) => r.uid,
          render: (r) => (
            <Text
              size="xs"
              c="dimmed"
              ff="monospace"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              #{r.uid}
            </Text>
          ),
        },
      ],
      [],
    );

    // Garde : driver actif sans capacité de RECHERCHE → on explique au lieu de
    // requêter dans le vide (ex. le driver « console » envoie les logs au terminal
    // mais ne les garde pas d'une façon qu'on puisse refouiller).
    if (capabilities && !capabilities.query) {
      return (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconInfoCircle size={16} />}
          title={`La source « ${driverName ?? "?"} » ne garde pas les journaux`}
        >
          Cette source transmet les lignes (par exemple vers la console) sans
          les conserver d'une façon qu'on puisse relire. L'onglet <b>Direct</b>{" "}
          montre les lignes au fil de l'eau. Pour relire le passé, choisir dans
          l'onglet <b>Source</b> une source qui les garde : <Code>memory</Code>,{" "}
          <Code>file</Code>, <Code>cluster-file</Code>, <Code>loki</Code> ou{" "}
          <Code>opensearch</Code>.
        </Alert>
      );
    }

    return (
      <Stack gap="sm">
        <SourceBanner source={source} />

        {/* Honnêteté cluster : la query froide ne voit qu'un worker sauf driver agrégateur. */}
        <ClusterScopeNotice
          cluster={cluster}
          driverName={driverName}
          context="query"
        />
        <Paper withBorder radius="md" p="sm">
          {/* Toujours visibles : les niveaux affichés, puis ce qui est masqué. */}
          <Group gap="sm" wrap="wrap" align="center" mb="xs">
            <Group gap={6} wrap="nowrap">
              <IconFilter size={14} />
              <Text size="xs" fw={600} c="dimmed">
                Sévérité
              </Text>
            </Group>
            <Chip.Group
              multiple
              value={[...severities]}
              onChange={(vals) => setSeverities(new Set(vals))}
            >
              <Group gap={4} wrap="wrap">
                {SEVERITIES.map((s) => (
                  <Chip key={s} value={s} size="xs" color={severityColor(s)}>
                    {s}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            {/* Raccourci vers l'origine NAVIGATEUR. Il ne crée pas un second
            état de filtre : il pilote le champ « Module » (sous « Plus de filtres »), que le
            data plane applique déjà en égalité. Sa raison d'être est la
            DÉCOUVRABILITÉ — personne ne tape « browser » dans un champ libre
            s'il ignore que ces lignes existent. */}
            <Chip
              size="xs"
              color="grape"
              checked={moduleF === BROWSER_ORIGIN}
              onChange={(on) => setModuleF(on ? BROWSER_ORIGIN : "")}
              aria-label="ne montrer que les journaux remontés par les navigateurs"
            >
              Navigateur
            </Chip>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={
                moreOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )
              }
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-controls="logs-more-filters"
            >
              Plus de filtres
              {moreActive > 0
                ? ` (${moreActive} actif${moreActive > 1 ? "s" : ""})`
                : ""}
            </Button>
            {filtersActive && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                leftSection={<IconFilterOff size={14} />}
                onClick={clearFilters}
              >
                Effacer
              </Button>
            )}
            <DocHint
              title="Filtres"
              version={LOGS_DOC}
              summary="Filtres appliqués CÔTÉ SERVEUR (sur TOUT l'historique du driver, pas seulement la page affichée). La sévérité est multi-sélection : coche plusieurs niveaux pour les cumuler."
              sections={[
                {
                  label: "Comment ils se combinent",
                  body: "Protocole (WS ou HTTP) ET étape(s) du cycle de vie (OU entre étapes) ET sévérité (OU entre les niveaux cochés) ET module ET msgid ET recherche plein-texte — tout se cumule. La page repart à 1 à chaque changement.",
                },
                {
                  label: "Protocole, puis cycle de vie",
                  body: "1) Sépare WS / HTTP à la source (WS = contexte socket : ouverture, messages, fermeture ; HTTP = le reste). 2) Le sélecteur Étape s'adapte alors au protocole et cible un jalon précis (requête entrante, route trouvée, réponse… ou ouverture/message/fermeture en WS).",
                },
                {
                  label: "Étapes & sévérité",
                  body: "Les jalons notables sont en INFO/NOTICE (requête entrante, route trouvée, réponse envoyée, ouverture/fermeture WebSocket) → visibles sans DEBUG. Les étapes techniques (message reçu, corps reçu, dispatch kernel, fin) restent en DEBUG : si tu les filtres en cochant INFO+, elles seront masquées. Pour les suivre, laisse la sévérité libre ou inclus DEBUG.",
                },
              ]}
            />
          </Group>

          {/* Ce qui est affiché, dit en clair : par défaut INFO et plus grave. */}
          <Group gap="xs" mb="xs" wrap="wrap">
            <Switch
              size="sm"
              checked={follow}
              onChange={(e) => setFollow(e.currentTarget.checked)}
              label="Suivre les nouvelles lignes"
            />
            <ViewFilterSwitches
              value={viewFilters}
              onChange={onViewFiltersChange}
            />
            <Switch
              size="sm"
              checked={groupByRequest}
              onChange={(e) => setGroupByRequest(e.currentTarget.checked)}
              label="Une ligne par requête"
            />
            <InfoHint text="Chaque requête (ou connexion WebSocket) tient sur une ligne : sa ligne d'accès — méthode, statut, URL, durée — quand elle est là. Le chevron déplie toutes ses lignes, tous niveaux compris. Désactivé, chaque ligne du journal est affichée seule." />
            <Text size="sm">
              {severities.size === 0 || severities.has("DEBUG") ? (
                <>
                  Affiché : <b>toutes les lignes</b>, détails techniques (DEBUG)
                  compris.
                </>
              ) : isDefaultSeverities(severities) ? (
                <>
                  Affiché : <b>INFO et plus grave</b> — l'arrivée de chaque
                  requête, sa route, sa réponse, et les erreurs. Les détails
                  techniques (DEBUG) sont masqués.
                </>
              ) : (
                <>
                  Affiché :{" "}
                  <b>{[...severities].join(", ") || "aucun niveau"}</b>.
                </>
              )}
            </Text>
            {severities.size > 0 && !severities.has("DEBUG") ? (
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => setSeverities(new Set(SEVERITIES))}
              >
                Afficher aussi DEBUG
              </Button>
            ) : (
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => setSeverities(new Set(DEFAULT_SEVERITIES))}
              >
                Masquer DEBUG
              </Button>
            )}
          </Group>

          <Collapse expanded={moreOpen} id="logs-more-filters">
            <Stack gap="xs" mb="sm">
              {/* Barre de trace full-stack. */}
              <Group gap="xs" mb="xs" wrap="nowrap">
                <TextInput
                  size="xs"
                  leftSection={<IconRoute2 size={14} />}
                  placeholder="requestId — trace full-stack d'une requête (tous modules)"
                  value={requestId}
                  onChange={(e) => setRequestId(e.currentTarget.value)}
                  style={{ flex: 1, maxWidth: 460, fontFamily: "monospace" }}
                  aria-label="tracer une requête par requestId"
                  rightSection={
                    requestId ? (
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        onClick={() => setRequestId("")}
                        aria-label="effacer la trace"
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    ) : null
                  }
                />
                {requestId && (
                  <Badge variant="light" color="grape" size="sm">
                    trace active
                  </Badge>
                )}
                {/* Sens chronologique — s'appuie sur l'uid (séquence), pas l'horloge. */}
                <Tooltip
                  label={
                    order === "desc"
                      ? "Récent → ancien (défaut)"
                      : "Ancien → récent (lecture chronologique)"
                  }
                >
                  <SegmentedControl
                    size="xs"
                    value={order}
                    onChange={(v) => setOrder(v)}
                    data={[
                      {
                        value: "desc",
                        label: (
                          <Group gap={4} wrap="nowrap">
                            <IconSortDescending size={14} />
                            <Text size="xs">récent</Text>
                          </Group>
                        ),
                      },
                      {
                        value: "asc",
                        label: (
                          <Group gap={4} wrap="nowrap">
                            <IconSortAscending size={14} />
                            <Text size="xs">chrono</Text>
                          </Group>
                        ),
                      },
                    ]}
                    aria-label="ordre chronologique des logs"
                  />
                </Tooltip>
                <DocHint
                  title="Explorer (requête froide du backplane)"
                  version={LOGS_DOC}
                  summary="Interroge le driver de relecture actif. Pagination et filtres côté serveur — supporte des milliers de logs sans charger la page."
                  sections={[
                    {
                      label: "Trace full-stack",
                      body: "Un requestId corrèle tous les logs d'UNE requête (ALS) — appel base de données inclus. Clique un badge requestId ou colle-en un ici pour suivre une requête de bout en bout. Essaie GET /nodefony/test/db/trace.",
                    },
                    {
                      label: "Trouver une requête par URL",
                      body: "Tape l'URL ou la route dans la barre de RECHERCHE (ex. « GET /api/users ») : tu retrouves le bilan de la/les requête(s) correspondante(s) ; clique alors son requestId pour dérouler toute sa trace.",
                    },
                    {
                      label: "Ordre & chronologie",
                      body: "Bascule récent↔chrono. L'ordre s'appuie sur le # (uid, séquence d'émission monotone), pas sur l'horloge ms — donc l'ordre reste exact même quand plusieurs logs tombent dans la même milliseconde.",
                    },
                  ]}
                />
              </Group>
              {/* Barre de FILTRES explicites — clairs, au-dessus de la grille.
            Protocole EN TÊTE (vision « protocole d'abord, puis cycle de vie »). */}
              <Group gap="sm" wrap="wrap" align="center">
                <Group gap={6} wrap="nowrap">
                  <IconPlugConnected size={14} />
                  <Text size="xs" fw={600} c="dimmed">
                    Protocole
                  </Text>
                  <InfoHint text="WS = logs des connexions WebSocket (msgid « WEBSOCKET CONTEXT » : handshake, messages, fermeture). HTTP = tout le reste du pipeline (requête, routage, firewall, applicatif). Critère appliqué côté serveur (pduProtocol)." />
                </Group>
                <SegmentedControl
                  size="xs"
                  value={protocol}
                  onChange={(v) => setProtocol(v)}
                  data={[
                    { value: "all", label: "Tous" },
                    {
                      value: "http",
                      label: (
                        <Group gap={4} wrap="nowrap">
                          <IconWorld size={13} />
                          <Text size="xs">HTTP</Text>
                        </Group>
                      ),
                    },
                    {
                      value: "ws",
                      label: (
                        <Group gap={4} wrap="nowrap">
                          <IconArrowsLeftRight size={13} />
                          <Text size="xs">WS</Text>
                        </Group>
                      ),
                    },
                  ]}
                  aria-label="filtrer par protocole"
                />
                {/* Étape du cycle de vie — s'adapte au protocole (« protocole d'abord »). */}
                <Group gap={6} wrap="nowrap">
                  <IconTimeline size={14} />
                  <Text size="xs" fw={600} c="dimmed">
                    Étape
                  </Text>
                  <InfoHint text="Étape du cycle de vie de la requête/connexion — critère structuré (≠ recherche texte). Les options s'adaptent au protocole choisi. Les jalons notables sont en INFO/NOTICE (requête entrante, route trouvée, réponse, ouverture/fermeture WS) ; les étapes techniques (message reçu, corps reçu, dispatch, fin) restent en DEBUG → si tu les filtres en cochant INFO+, elles seront masquées." />
                </Group>
                <MultiSelect
                  size="xs"
                  w={250}
                  data={flowData}
                  value={flows}
                  onChange={(v) => setFlows(v)}
                  placeholder={flows.length ? undefined : "Toutes les étapes"}
                  clearable
                  searchable
                  nothingFoundMessage="Aucune étape"
                  comboboxProps={{ withinPortal: true }}
                  aria-label="filtrer par étape du cycle de vie"
                />
                <TextInput
                  size="xs"
                  w={150}
                  placeholder="Module…"
                  value={moduleF}
                  onChange={(e) => setModuleF(e.currentTarget.value)}
                  aria-label="filtrer par module"
                />
                <TextInput
                  size="xs"
                  w={150}
                  placeholder="msgid…"
                  value={msgidF}
                  onChange={(e) => setMsgidF(e.currentTarget.value)}
                  aria-label="filtrer par msgid"
                />
              </Group>
            </Stack>
          </Collapse>

          <DataGrid
            mode="server"
            loader={loader}
            columns={columns}
            getRowId={(r) => `${r.uid}-${r.timeStamp}`}
            onRowClick={onSelect}
            // Une ligne de requête se déplie sur toutes ses lignes (même
            // requestId) — inutile quand on trace déjà une seule requête.
            rowHasDetail={(r) => Boolean(r.requestId) && !requestId.trim()}
            renderRowDetail={(r) =>
              r.requestId ? (
                <RequestLines requestId={r.requestId} onSelect={onSelect} />
              ) : null
            }
            pageSize={50}
            resetPageSignal={filterSignal}
            searchPlaceholder="Recherche : URL/route (ex. GET /api/x), payload, module, msgid…"
            refreshSignal={tick}
            loadingMessage={source.loadingMessage}
            emptyMessage={
              filtersActive || requestId.trim() !== ""
                ? "Aucune ligne ne correspond aux filtres."
                : source.emptyMessage
            }
            // v3 : colonnes réordonnées (verbe et chemin d'abord) — l'ordre mémorisé
            // par la v2 aurait gardé l'URI en dernier, coupée.
            persist={{ key: "studio.logs.explorer.v3", storage: "session" }}
          />
        </Paper>
      </Stack>
    );
  },
);
