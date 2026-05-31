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
  Code,
  Group,
  Paper,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconInfoCircle,
  IconRoute2,
  IconSortAscending,
  IconSortDescending,
  IconX,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import {
  DataGrid,
  DocHint,
  type DataGridColumn,
  type DataGridServerQuery,
  type DataGridServerResult,
} from "../../components/ui";
import { ansiToReact } from "../../utils/ansiToReact";
import type {
  LogDriverCapabilities,
  LogQueryResult,
  LogRecord,
} from "./logsTypes";
import { SEVERITIES } from "./logsTypes";
import { LOGS_DOC, fmtClock, fmtMillis, recordMessage } from "./logFormat";
import { SeverityBadge } from "./LogVisuals";
import { describeFlow } from "./eventFlow";

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
}

export const LogExplorer = observer(
  ({
    capabilities,
    driverName,
    traceRequestId,
    onSelect,
    refreshKey = 0,
  }: LogExplorerProps) => {
    const store = useStore();
    const [requestId, setRequestId] = useState(traceRequestId ?? "");
    // Sens de lecture. "desc" = plus RÉCENT en haut (défaut d'un viewer de logs) ;
    // "asc" = plus ANCIEN en haut = lecture du DÉBUT à la FIN (le bon sens pour
    // SUIVRE une requête). L'ordre s'appuie sur l'uid (#), pas l'horloge (ms) →
    // exact même quand plusieurs logs tombent dans la même milliseconde.
    // Tracer une requête démarre en "asc" : on veut la lire dans l'ordre.
    const [order, setOrder] = useState<"asc" | "desc">(
      traceRequestId ? "asc" : "desc",
    );

    // L'orchestrateur peut pousser un requestId à tracer (depuis Live ou le
    // drawer) → on synchronise le champ ET on passe en lecture chronologique
    // (suivre une requête = la lire du début à la fin).
    useEffect(() => {
      if (traceRequestId !== undefined) {
        setRequestId(traceRequestId);
        if (traceRequestId) setOrder("asc");
      }
    }, [traceRequestId]);

    const loader = useCallback(
      async (q: DataGridServerQuery): Promise<DataGridServerResult<LogRecord>> => {
        const params = new URLSearchParams();
        params.set("limit", String(q.pageSize));
        params.set("offset", String((q.page - 1) * q.pageSize));
        params.set("order", order);
        if (q.search) params.set("q", q.search);
        if (requestId.trim()) params.set("requestId", requestId.trim());
        // Filtres par colonne → critères backplane (le back fait l'inclusion ;
        // l'opérateur du DataGrid est ignoré côté serveur, sémantique fixe).
        for (const f of q.columnFilters) {
          if (!f.value) continue;
          if (f.key === "severity") params.append("severity", f.value);
          else if (f.key === "module") params.set("module", f.value);
          else if (f.key === "msgid") params.set("msgid", f.value);
          else if (f.key === "requestId") params.set("requestId", f.value);
        }
        const res = await store.api.getAbsolute<LogQueryResult>(
          `/nodefony/syslog/api/logs/search?${params.toString()}`,
        );
        return { rows: res.rows, total: res.total };
      },
      // refreshKey force la régénération du loader (→ refetch) après un switch ;
      // order → refetch au changement de sens chronologique.
      [store, requestId, order, refreshKey],
    );

    const columns = useMemo<DataGridColumn<LogRecord>[]>(
      () => [
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
        {
          key: "time",
          header: "Heure",
          size: 118,
          hint: "Horodatage à la milliseconde. À débit élevé, plusieurs logs partagent la même ms → se fier au # (séquence) pour l'ordre exact.",
          value: (r) => r.timeStamp,
          render: (r) => (
            <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtClock(r.timeStamp)}
              <Text span size="xs" opacity={0.6}>
                .{fmtMillis(r.timeStamp)}
              </Text>
            </Text>
          ),
        },
        {
          key: "severity",
          header: "Sévérité",
          size: 120,
          filterable: true,
          filterType: "select",
          filterOptions: [...SEVERITIES],
          value: (r) => r.severityName,
          render: (r) => <SeverityBadge severity={r.severityName} />,
        },
        {
          key: "module",
          header: "Module",
          size: 130,
          filterable: true,
          filterType: "text",
          value: (r) => r.moduleName,
          render: (r) => (
            <Text size="xs" c="dimmed" truncate>
              {r.moduleName}
            </Text>
          ),
        },
        {
          key: "msgid",
          header: "msgid",
          size: 120,
          filterable: true,
          filterType: "text",
          value: (r) => r.msgid,
          render: (r) =>
            r.msgid ? (
              <Code style={{ fontSize: 11 }}>{r.msgid}</Code>
            ) : (
              <Text c="dimmed">—</Text>
            ),
        },
        {
          key: "requestId",
          header: "requestId",
          size: 130,
          value: (r) => r.requestId ?? "",
          render: (r) =>
            r.requestId ? (
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
                    setRequestId(r.requestId!);
                    setOrder("asc"); // suivre la requête = lecture chronologique
                  }}
                >
                  {r.requestId.slice(0, 8)}
                </Badge>
              </Tooltip>
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
          key: "message",
          header: "Message",
          size: 420,
          value: (r) => recordMessage(r),
          render: (r) => (
            <Text
              size="xs"
              style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {ansiToReact(recordMessage(r))}
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
          title={`Le driver « ${driverName ?? "?"} » ne permet pas la recherche`}
        >
          Ce driver de logs ne sait pas <b>fouiller l'historique</b> : il
          transmet les logs (ici, vers la console) sans les conserver d'une façon
          interrogeable. Seul l'onglet <b>Live</b> reste disponible. Pour explorer
          le passé, choisis un driver avec la capacité <b>Recherche</b>
          (<Code>mémoire</Code>, ou <Code>fichier</Code>/<Code>Elasticsearch</Code>
          à venir) dans le sélecteur du bandeau.
        </Alert>
      );
    }

    return (
      <Paper withBorder radius="md" p="sm">
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
              onChange={(v) => setOrder(v as "asc" | "desc")}
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
                label: "Ordre & chronologie",
                body: "Bascule récent↔chrono. L'ordre s'appuie sur le # (uid, séquence d'émission monotone), pas sur l'horloge ms — donc l'ordre reste exact même quand plusieurs logs tombent dans la même milliseconde.",
              },
            ]}
          />
        </Group>

        {/* Sens de lecture explicite — répond à « je comprends pas la chronologie ». */}
        <Text size="xs" c="dimmed" mb="xs">
          {order === "asc" ? (
            <>
              <b>Ordre chronologique</b> : 1ʳᵉ étape en haut, réponse en bas — on
              lit la requête du début à la fin.
            </>
          ) : (
            <>
              <b>Plus récent en haut</b> : la dernière ligne émise est en tête (on
              remonte le temps en descendant).
            </>
          )}{" "}
          L'ordre exact est donné par le <b>#</b> (séquence d'émission), pas par
          l'heure (plusieurs logs partagent souvent la même milliseconde).
        </Text>

        <DataGrid
          mode="server"
          loader={loader}
          columns={columns}
          getRowId={(r) => `${r.uid}-${r.timeStamp}`}
          onRowClick={onSelect}
          pageSize={50}
          height={540}
          searchPlaceholder="Recherche plein-texte (payload, msg, module, msgid)…"
          emptyMessage="Aucun log ne correspond aux critères."
          persist={{ key: "studio.logs.explorer", storage: "session" }}
        />
      </Paper>
    );
  },
);
