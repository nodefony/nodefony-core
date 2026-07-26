import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Group,
  Card,
  Text,
  Badge,
  Button,
  SimpleGrid,
  RingProgress,
  Alert,
  Loader,
} from "@mantine/core";
import { Link, useParams } from "react-router";
import {
  IconArrowLeft,
  IconDatabase,
  IconServer,
  IconInfoCircle,
  IconBolt,
  IconReload,
  IconAlertTriangle,
  IconPlugConnected,
  IconActivity,
} from "@tabler/icons-react";
import { useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import { PageLayout, DataState, DocHint, MiniChart } from "../components/ui";
import { buildHealth, type HealthResult } from "../utils/health";
import { normalize, type HealthPayload } from "../utils/realtimeHealth";
import {
  ORM_DOC,
  fmtNum,
  fmtMs,
  ormHealthInputs,
  ensureLivePulseStyle,
  lsGet,
  lsSet,
} from "../utils/ormFormat";
import {
  ConnectorCard,
  MiniStat,
  OrmRichLive,
  RealtimeHealthLive,
  OrmRealtimeControls,
  useOrmFlow,
  useOrmRates,
} from "./orm/ConnectorCard";
import { type OrmSummary, type OrmGraph, type ConnHealth } from "../types/orm";

/**
 * **Drill ORM par worker** (`/nodefony/orm/:pid`) — détail d'UN process/pod :
 *  - **Santé lean EXACTE de ce pid** : verdict 3 états + métriques cumulées + débit
 *    req/s, extraits par pid de la sonde lean pod `nodefony:socket` (agrégée par le
 *    master → la valeur de CE worker est exacte, ≠ round-robin).
 *  - **Diagnostic RICHE par connecteur** (ping/latence/pool/stockage/flux SQL) via le
 *    data plane `connection/health` + canal `nodefony:orm:flow`. ⚠️ En cluster ce data plane
 *    tombe sur UN worker au hasard (reusePort) : si ce n'est pas le pid demandé, on
 *    le **signale honnêtement** (le relais ciblé @pid = backend futur). En mono = exact.
 *
 * Accessible depuis la grille worker du dashboard `/nodefony/orm` (carte → drill).
 */
export const OrmWorker = observer(() => {
  const { pid = "" } = useParams();
  const store = useStore();
  const ui = useUi();

  useEffect(ensureLivePulseStyle, []);

  // ── Schéma INVARIANT (mêmes endpoints que l'overview ; identique sur tout worker). ──
  const orms = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms"),
      [store],
    ),
  );
  const graph = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmGraph>("/nodefony/orm/api/graph"),
      [store],
    ),
  );
  const counts = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<Record<string, number>>(
          "/nodefony/orm/api/counts",
        ),
      [store],
    ),
  );
  const list = orms.data ?? [];
  const entities = useMemo(() => graph.data?.entities ?? [], [graph.data]);
  const countMap = useMemo(() => counts.data ?? {}, [counts.data]);

  // ── Diagnostic RICHE par connecteur (round-robin → tombe sur 1 worker). ──
  const health = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<ConnHealth[]>(
          "/nodefony/orm/api/connection/health",
        ),
      [store],
    ),
  );
  const [liveHealth, setLiveHealth] = useState<ConnHealth[] | null>(null);
  // « warming » : enrich ORM ciblé pas encore propagé au worker distant (≤ 1 cycle).
  const [richPending, setRichPending] = useState(false);
  const healthList = useMemo(
    () => liveHealth ?? health.data ?? [],
    [liveHealth, health.data],
  );
  const healthByName = useMemo(() => {
    const m: Record<string, ConnHealth> = {};
    for (const h of healthList) m[h.name] = h;
    return m;
  }, [healthList]);
  // pid du worker qui A RÉPONDU au diagnostic riche (honnêteté cluster).
  const respondingPid = healthList[0]?.instanceId ?? null;

  // Flux SQL par connecteur (débit/s + EWMA + sparkline), live-only.
  const { flowByName, onFlow, reset: resetFlow } = useOrmFlow();

  // ── Réglages temps réel (partagés/persistés, comme l'overview). ──
  const live = ui.realtimeLive;
  const auto = ui.adaptiveCadence;
  const [liveMs, setLiveMs] = useState<number>(
    () => Number(lsGet("nf.orm.liveMs")) || 5000,
  );
  const [effectiveMs, setEffectiveMs] = useState<number>(liveMs);
  useEffect(() => lsSet("nf.orm.liveMs", String(liveMs)), [liveMs]);

  // ── Sonde LEAN pod (nodefony:socket) → lean EXACT de CE pid + détection cluster. ──
  const realtime = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<HealthPayload>("/nodefony/realtime/api/health"),
      [store],
    ),
  );
  const [liveRt, setLiveRt] = useState<HealthPayload | null>(null);
  const rt: HealthPayload | null = live
    ? (liveRt ?? realtime.data)
    : realtime.data;
  const normRt = useMemo(() => normalize(rt), [rt]);
  const isClusterMode = normRt?.cluster ?? false;
  const me = useMemo(
    () => normRt?.instances.find((w) => w.instanceId === pid) ?? null,
    [normRt, pid],
  );
  const myOrm = me?.orm ?? null;

  // Taux ORM (delta) + débit req/s — par pid ; on extrait celui de ce worker.
  const { ratesByPid, qSeriesByPid } = useOrmRates(normRt, live);
  const myRate = ratesByPid.get(pid) ?? {
    errPerMin: null,
    reconPerMin: null,
  };
  const myVerdict = useMemo<HealthResult | null>(
    () => (myOrm ? buildHealth(ormHealthInputs(myOrm, myRate)) : null),
    [myOrm, myRate],
  );
  const myQHist = qSeriesByPid.get(pid) ?? [];

  // OFF → relâcher les états live.
  useEffect(() => {
    if (!live) {
      setLiveHealth(null);
      setLiveRt(null);
      setRichPending(false);
      resetFlow();
    }
  }, [live, resetFlow]);

  // Diagnostic riche réellement fourni par CE worker ? Mono : toujours. Cluster :
  //  - en LIVE → canal `nodefony:orm:rich@<pid>` = relais ciblé exact (respondingPid === pid) ;
  //  - en OFF → fallback HTTP round-robin → exact seulement si le LB est tombé sur ce pid.
  const exactDiag =
    !isClusterMode || respondingPid == null || respondingPid === pid;

  const loadingCore = orms.loading && !list.length;

  return (
    <PageLayout
      gap="lg"
      title={`Connecteur ORM — worker pid ${pid}`}
      subtitle={
        isClusterMode
          ? "Drill d'un worker du cluster — santé lean exacte + diagnostic riche par connecteur"
          : "Détail du process — santé ORM + diagnostic riche par connecteur"
      }
      actions={
        <Group gap="xs">
          <OrmRealtimeControls
            live={live}
            onToggle={(v) => ui.setRealtimeLive(v)}
            liveMs={liveMs}
            setLiveMs={setLiveMs}
            auto={auto}
            effectiveMs={effectiveMs}
            ariaLabel={`abonnement temps réel (socket Nodefony) du worker pid ${pid}`}
          />
          <Button
            component={Link}
            to="/nodefony/orm"
            variant="default"
            leftSection={<IconArrowLeft size={16} />}
          >
            Vue d'ensemble
          </Button>
        </Group>
      }
    >
      {/* Drill ORM riche du worker EXACT (relais ciblé @pid) : un seul canal combiné
          `${PLATFORM_CHANNELS.ormRich}@<pid>` → santé connecteurs + flux SQL du pid demandé (≠ round-robin). */}
      {live && (
        <OrmRichLive
          pid={pid}
          intervalMs={liveMs}
          adaptive={auto}
          onHealth={setLiveHealth}
          onFlow={onFlow}
          onPending={setRichPending}
        />
      )}
      {live && (
        <RealtimeHealthLive
          intervalMs={liveMs}
          adaptive={auto}
          onData={setLiveRt}
          onRate={setEffectiveMs}
        />
      )}

      {/* Santé LEAN EXACTE de ce worker (pid demandé) — verdict + métriques + débit. */}
      <Card
        withBorder
        radius="md"
        p="md"
        className={live ? "nf-live-card" : undefined}
        style={{ contain: "content" }}
      >
        {myOrm ? (
          <>
            <Group wrap="nowrap" align="center" gap="lg">
              <RingProgress
                size={92}
                thickness={10}
                roundCaps
                sections={[
                  {
                    value: myVerdict?.score ?? 0,
                    color: myVerdict?.color ?? "gray",
                  },
                ]}
                label={
                  <Text
                    ta="center"
                    fw={800}
                    fz={22}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {myVerdict?.score ?? "—"}
                  </Text>
                }
              />
              <div style={{ minWidth: 0 }}>
                <Group gap="xs" mb={4}>
                  <Text fw={700}>Santé ORM (ce worker)</Text>
                  {myVerdict && (
                    <Badge color={myVerdict.color} variant="light">
                      {myVerdict.label}
                    </Badge>
                  )}
                  <Badge
                    variant="default"
                    leftSection={<IconServer size={11} />}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    pid {pid}
                  </Badge>
                  <DocHint
                    title="Santé ORM (worker)"
                    version={ORM_DOC}
                    summary="Verdict 3 états du SEUL worker demandé (Derringer-Suich), extrait par pid de la sonde lean pod — donc EXACT pour ce process."
                    sections={[
                      {
                        label: "Signaux",
                        body: "Connecteurs coupés & taux d'erreurs = PANNE (→ 0). Latence EWMA, requêtes lentes & reconnexions = SATURATION (planché « Dégradé »).",
                      },
                      {
                        label: "Taux, pas cumul",
                        body: "Erreurs & reconnexions en delta/min (après 2 mesures live). Débit & EWMA = flux ORM (NODEFONY_ORM_FLOW=1).",
                      },
                    ]}
                  />
                </Group>
                <Text size="sm" c="dimmed">
                  Sonde lean EXACTE de ce process (extraite de nodefony:socket
                  par pid).
                  {myVerdict?.worst
                    ? ` Facteur limitant : ${myVerdict.worst}.`
                    : ""}
                </Text>
              </div>
            </Group>

            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm" mt="md">
              <MiniStat
                icon={<IconDatabase size={16} />}
                label="Requêtes"
                value={fmtNum(myOrm.queryTotal)}
                flashKey={myOrm.queryTotal}
                hint="Total des requêtes SQL exécutées par ce process depuis le boot."
              />
              <MiniStat
                icon={<IconPlugConnected size={16} />}
                label="Connecteurs"
                value={`${myOrm.connected}/${myOrm.connectors}`}
                color={
                  myOrm.connected < myOrm.connectors ? "orange" : undefined
                }
                hint="Connecteurs ORM connectés / enregistrés sur ce process."
              />
              <MiniStat
                icon={<IconBolt size={16} />}
                label="Requêtes lentes"
                value={myOrm.slowTotal}
                color={myOrm.slowTotal > 0 ? "orange" : undefined}
                hint="Requêtes au-delà du seuil de lenteur (flux ORM)."
              />
              <MiniStat
                icon={<IconAlertTriangle size={16} />}
                label="Erreurs ORM"
                value={myOrm.errorTotal}
                color={myOrm.errorTotal > 0 ? "red" : undefined}
                hint="Erreurs ORM cumulées sur ce process. La couleur du verdict se base sur le TAUX (delta/min), pas ce cumul."
              />
              <MiniStat
                icon={<IconActivity size={16} />}
                label="EWMA max"
                value={myOrm.maxEwmaMs == null ? "—" : fmtMs(myOrm.maxEwmaMs)}
                hint="Latence lissée du pire connecteur (flux ORM). À lire à l'aune de l'event-loop lag sous charge."
              />
              <MiniStat
                icon={<IconReload size={16} />}
                label="Reconnexions"
                value={myOrm.reconnectTotal}
                color={myOrm.reconnectTotal > 0 ? "orange" : undefined}
                hint="Rétablissements de connexion sur ce process (instabilité)."
              />
            </SimpleGrid>

            <Text size="xs" c="dimmed" mt="md" mb={2}>
              Requêtes/s
            </Text>
            <MiniChart
              series={[
                {
                  data: myQHist.length ? myQHist : [0],
                  color: "var(--mantine-color-grape-5)",
                  label: "req/s",
                },
              ]}
              height={70}
            />
          </>
        ) : realtime.loading ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Chargement de la santé ORM…
            </Text>
          </Group>
        ) : (
          <Alert
            variant="light"
            color="gray"
            icon={<IconInfoCircle size={18} />}
            title="Aucune sonde lean pour ce worker"
          >
            Le worker pid {pid} ne remonte pas (ou plus) la sonde ORM lean —
            process disparu (respawn), temps réel coupé, ou aucun driver ORM sur
            ce process. Le diagnostic riche par connecteur reste affiché
            ci-dessous (worker répondant).
          </Alert>
        )}
      </Card>

      {/* Warming : enrich ORM ciblé en cours de propagation au worker distant (≤ 1 cycle). */}
      {isClusterMode && live && richPending && (
        <Alert
          variant="light"
          color="blue"
          icon={<Loader size={14} />}
          title="Préparation du diagnostic riche…"
        >
          Activation de la sonde ORM riche sur le worker <b>pid {pid}</b> via le
          master (relais ciblé). Le diagnostic détaillé arrive au prochain
          cycle.
        </Alert>
      )}

      {/* Honnêteté cluster : en OFF, le diagnostic riche HTTP tombe sur un worker round-robin.
          Le relais ciblé exact @pid est disponible en activant le temps réel. */}
      {isClusterMode && !live && !exactDiag && (
        <Alert
          variant="light"
          color="orange"
          icon={<IconInfoCircle size={18} />}
          title="Diagnostic riche : fourni par un autre worker"
        >
          Hors temps réel, le diagnostic détaillé par connecteur ci-dessous
          (ping, latence, pool, stockage, flux SQL) provient du worker{" "}
          <b>pid {respondingPid}</b> (choisi au hasard par le load-balancer,
          reusePort), pas du worker {pid} demandé. <b>Active le temps réel</b>{" "}
          pour obtenir le diagnostic riche EXACT de ce pid (relais ciblé{" "}
          <code>nodefony:orm:rich@{pid}</code> master→worker). La santé lean
          ci-dessus est déjà exacte pour le pid {pid}.
        </Alert>
      )}

      {/* Cartes connecteur RICHES (diagnostic + connexion + modèle + entités). */}
      <DataState
        loading={loadingCore}
        error={orms.error ?? graph.error}
        empty={!list.length}
        onRetry={() => {
          orms.reload();
          graph.reload();
        }}
        emptyMessage="Aucun connecteur ORM enregistré au runtime."
      >
        <SimpleGrid cols={list.length > 1 ? { base: 1, xl: 2 } : 1}>
          {list.map((o) => (
            <ConnectorCard
              key={o.name}
              orm={o}
              entities={entities}
              countMap={countMap}
              health={healthByName[o.name]}
              flow={flowByName[o.name]}
            />
          ))}
        </SimpleGrid>
      </DataState>
    </PageLayout>
  );
});

export default OrmWorker;
