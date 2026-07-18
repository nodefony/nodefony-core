/**
 * Console auditeur (P6.15) — lecture du **journal d'audit de sécurité** de
 * `@nodefony/security` (P6.14). Mode CONSULTATION par défaut (forensique : on
 * consulte, on ne fixe pas un flux) : page filtrée du data plane
 * `GET /nodefony/security/api/audit/events` (RBAC `ROLE_NODEFONY_ADMIN`,
 * pagination par curseur). Le **temps réel est PRÊT mais OFF par défaut** (switch) :
 * à l'allumage, les nouveaux événements arrivent en tête — utile pour repérer une
 * attaque en cours (rafale de refus), pas pour regarder défiler des logs.
 *
 * ⚠️ Le canal live `security:audit` n'est pas encore servi par la socket Studio
 * (cf `audit/auditModel`) → le switch reste muet jusqu'au branchement backend
 * (sécurisation de Studio, P6.15). La consultation HTTP, elle, marche dès maintenant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Grid,
  Group,
  Switch,
  Button,
  Badge,
  Text,
  Code,
  Alert,
  Tooltip,
  ThemeIcon,
} from "@mantine/core";
import {
  IconRefresh,
  IconChevronDown,
  IconRoute,
  IconShieldCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";

import { useStore } from "../stores";
import {
  PageLayout,
  StatCard,
  DataGrid,
  InfoHint,
  type DataGridColumn,
} from "../components/ui";
import {
  buildAuditQuery,
  type AuditBatch,
  type AuditEvent,
  type AuditFilter,
  type AuditPage,
} from "./audit/auditModel";
import {
  CategoryBadge,
  OutcomeBadge,
  ActorText,
  EventTime,
} from "./audit/auditFormat";
import { BrickStoreChip } from "./stores/BrickStoreChip";
import { AuditFilters } from "./audit/AuditFilters";
import { AuditDetail } from "./audit/AuditDetail";
import { AuditLive } from "./audit/AuditLive";

const ENDPOINT = "/nodefony/security/api/audit/events";
/** Borne de la fenêtre en mémoire (live + pagination) — anti-fuite navigateur. */
const MAX_WINDOW = 2000;
const DEFAULT_FILTER: AuditFilter = { period: "24h" };

/** Un événement live ne s'affiche que s'il matche le filtre serveur courant. */
function matchesFilter(e: AuditEvent, f: AuditFilter): boolean {
  if (f.category && e.category !== f.category) return false;
  if (f.outcome && e.outcome !== f.outcome) return false;
  if (f.action && e.action !== f.action) return false;
  if (f.actor && (e.actor ?? "") !== f.actor) return false;
  return true;
}

/** Fusionne en dédupliquant par id, tri décroissant (le + récent d'abord). */
function dedupSorted(events: AuditEvent[]): AuditEvent[] {
  const seen = new Set<string>();
  const out: AuditEvent[] = [];
  for (const e of events) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Traduit une erreur HTTP du data plane en message FR explicite (vitrine). */
function describeAuditError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return (
      "Non authentifié — votre session Studio a expiré ou n'est plus reconnue " +
      "par le firewall. Reconnectez-vous."
    );
  }
  if (status === 403) {
    return (
      "Accès refusé — le journal d'audit est réservé aux administrateurs " +
      "(ROLE_NODEFONY_ADMIN)."
    );
  }
  if (status === 503) {
    return "Journal d'audit indisponible — service désactivé dans la configuration (audit.enabled).";
  }
  if (status === 404) {
    return "Endpoint d'audit introuvable — le module @nodefony/security n'est peut-être pas chargé.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement du journal : ${msg}`
    : "Erreur de chargement du journal d'audit.";
}

export const Audit = observer(() => {
  const store = useStore();

  const [filter, setFilter] = useState<AuditFilter>(DEFAULT_FILTER);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  // Temps réel — OFF par défaut (un journal d'audit se consulte).
  const [live, setLive] = useState(false);
  const [newLiveCount, setNewLiveCount] = useState(0);
  const [liveDropped, setLiveDropped] = useState(0);

  /** Jeton de course : un re-filtrage (reload) invalide les fetchs en vol. */
  const reqId = useRef(0);

  const fetchPage = useCallback(
    (cursor?: string): Promise<AuditPage> => {
      const qs = buildAuditQuery(filter, Date.now(), cursor);
      return store.api.getAbsolute<AuditPage>(`${ENDPOINT}?${qs}`);
    },
    [store, filter],
  );

  const reload = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage();
      if (my !== reqId.current) return;
      setEvents(dedupSorted(res.items));
      setTotal(res.total ?? 0);
      setNextCursor(res.nextCursor ?? null);
    } catch (e) {
      if (my !== reqId.current) return;
      setError(describeAuditError(e));
      setEvents([]);
      setTotal(0);
      setNextCursor(null);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [fetchPage]);

  // Re-charge à chaque changement de filtre (reload change quand filter change).
  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const my = reqId.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(nextCursor);
      if (my !== reqId.current) return; // le filtre a changé en cours de route
      setEvents((prev) => dedupSorted([...prev, ...res.items]));
      setNextCursor(res.nextCursor ?? null);
      setTotal(res.total ?? 0);
    } catch (e) {
      if (my === reqId.current) setError(describeAuditError(e));
    } finally {
      if (my === reqId.current) setLoadingMore(false);
    }
  }, [fetchPage, nextCursor, loadingMore]);

  const onBatch = useCallback(
    (batch: AuditBatch) => {
      if (batch.dropped) setLiveDropped((d) => d + batch.dropped);
      const fresh = batch.events.filter((e) => matchesFilter(e, filter));
      if (fresh.length === 0) return;
      setNewLiveCount((c) => c + fresh.length);
      setEvents((prev) =>
        dedupSorted([...fresh, ...prev]).slice(0, MAX_WINDOW),
      );
    },
    [filter],
  );

  const toggleLive = (v: boolean) => {
    setLive(v);
    setNewLiveCount(0);
    setLiveDropped(0);
  };

  const patchFilter = (patch: Partial<AuditFilter>) =>
    setFilter((f) => ({ ...f, ...patch }));
  const resetFilter = () => setFilter(DEFAULT_FILTER);
  const hasActiveFilter = Boolean(
    filter.category || filter.outcome || filter.actor || filter.action,
  );

  // Compteurs dérivés de la fenêtre chargée (DocHint explique le périmètre).
  const counts = useMemo(() => {
    let success = 0;
    let failure = 0;
    let denied = 0;
    for (const e of events) {
      if (e.outcome === "success") success++;
      else if (e.outcome === "failure") failure++;
      else if (e.outcome === "denied") denied++;
    }
    return { success, failure, denied };
  }, [events]);

  const columns = useMemo<DataGridColumn<AuditEvent>[]>(
    () => [
      {
        key: "ts",
        header: "Heure",
        sortable: true,
        value: (r) => r.ts,
        render: (r) => <EventTime ts={r.ts} />,
        size: 95,
      },
      {
        key: "category",
        header: "Catégorie",
        filterable: true,
        filterType: "select",
        value: (r) => r.category,
        render: (r) => <CategoryBadge category={r.category} />,
        size: 150,
      },
      {
        key: "action",
        header: "Action",
        filterable: true,
        value: (r) => r.action,
        render: (r) => <Code>{r.action}</Code>,
        size: 175,
      },
      {
        key: "outcome",
        header: "Issue",
        filterable: true,
        filterType: "select",
        value: (r) => r.outcome,
        render: (r) => <OutcomeBadge outcome={r.outcome} />,
        size: 110,
      },
      {
        key: "actor",
        header: "Acteur",
        filterable: true,
        value: (r) => r.actor ?? "anonyme",
        render: (r) => <ActorText actor={r.actor} />,
        size: 150,
      },
      {
        key: "reason",
        header: "Raison",
        value: (r) => r.reason ?? "",
        render: (r) =>
          r.reason ? (
            <Code>{r.reason}</Code>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          ),
        size: 150,
      },
      {
        key: "ip",
        header: "IP",
        value: (r) => r.ip ?? "",
        render: (r) => (
          <Text size="sm" ff="monospace">
            {r.ip ?? "—"}
          </Text>
        ),
        size: 125,
      },
      {
        key: "trace",
        header: "Trace",
        align: "right",
        value: (r) => (r.requestId ? "1" : ""),
        render: (r) =>
          r.requestId ? (
            <Tooltip label="Voir la trace de la requête" withinPortal>
              <ThemeIcon variant="subtle" size="sm" color="brand">
                <IconRoute size={15} />
              </ThemeIcon>
            </Tooltip>
          ) : null,
        size: 70,
      },
    ],
    [],
  );

  const subtitle = `${events.length} événement(s) chargé(s)${
    total > events.length ? ` · ${total} en rétention pour ce filtre` : ""
  }`;

  return (
    <PageLayout
      title="Journal d'audit"
      subtitle={subtitle}
      icon={<IconShieldCheck size={26} />}
      actions={
        <Group gap="sm" wrap="nowrap">
          <BrickStoreChip brick="audit" />
          <Group gap={6} wrap="nowrap">
            <Switch
              size="sm"
              checked={live}
              onChange={(e) => toggleLive(e.currentTarget.checked)}
              label="Temps réel"
            />
            <InfoHint text="Affiche les nouveaux événements en tête, en direct (canal security:audit). Réservé aux pics d'activité — un journal d'audit se consulte, il ne se regarde pas défiler. Nécessite le branchement du canal côté serveur (P6.15)." />
            {live && newLiveCount > 0 && (
              <Badge color="teal" variant="light">
                {newLiveCount} nouveau(x)
              </Badge>
            )}
          </Group>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={() => void reload()}
          >
            Recharger
          </Button>
        </Group>
      }
    >
      {/* Abonnement live monté SEULEMENT quand le switch est ON (0 ticker sinon). */}
      {live && <AuditLive onBatch={onBatch} />}

      {live && liveDropped > 0 && (
        <Alert
          variant="light"
          color="orange"
          icon={<IconAlertTriangle size={18} />}
          title="Pic d'activité"
        >
          {liveDropped} événement(s) omis du flux live (ring borné). Le journal
          complet reste consultable via « Recharger » et les filtres.
        </Alert>
      )}

      <Grid>
        <StatCard
          label="Total (rétention)"
          hint="Nombre d'événements correspondant au filtre courant sur toute la fenêtre de rétention du journal (compté côté serveur)."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {total}
          </Text>
        </StatCard>
        <StatCard
          label="Succès"
          hint="Issues « success » sur les événements chargés. Filtrez « Issue = Succès » pour le total exact en rétention."
        >
          <Text
            fz={28}
            fw={700}
            c="teal"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.success}
          </Text>
        </StatCard>
        <StatCard
          label="Échecs"
          hint="Issues « failure » (l'acteur a raté une preuve : mot de passe, signature) sur les événements chargés."
        >
          <Text
            fz={28}
            fw={700}
            c="orange"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.failure}
          </Text>
        </StatCard>
        <StatCard
          label="Refus"
          hint="Issues « denied » (une politique a refusé un acteur valide — Zero Trust, RBAC, CSRF). Le signal d'alerte de l'auditeur."
        >
          <Text
            fz={28}
            fw={700}
            c="red"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.denied}
          </Text>
        </StatCard>
      </Grid>

      <AuditFilters
        filter={filter}
        onChange={patchFilter}
        onReset={resetFilter}
        hasActiveFilter={hasActiveFilter}
      />

      <DataGrid
        mode="client"
        data={events}
        loading={loading}
        error={error}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
        initialSort={{ key: "ts", dir: "desc" }}
        searchable
        searchPlaceholder="Rechercher (acteur, action, IP, raison…)"
        pageSize={25}
        persist={{ key: "studio.audit", storage: "session" }}
        emptyMessage="Aucun événement de sécurité pour ce filtre."
      />

      {nextCursor && (
        <Group justify="center">
          <Button
            variant="default"
            leftSection={<IconChevronDown size={16} />}
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            Charger les événements plus anciens
          </Button>
        </Group>
      )}

      <AuditDetail event={selected} onClose={() => setSelected(null)} />
    </PageLayout>
  );
});
