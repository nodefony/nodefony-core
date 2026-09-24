import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Grid,
  Stack,
  Card,
  Group,
  Text,
  Badge,
  ThemeIcon,
  Button,
  SimpleGrid,
  Progress,
  Anchor,
  Divider,
  Loader,
  Menu,
  Tabs,
  Alert,
  RingProgress,
  UnstyledButton,
  type MantineColor,
} from "@mantine/core";
import { Link, useNavigate } from "react-router";
import {
  IconDatabase,
  IconPlugConnected,
  IconPlugX,
  IconAffiliate,
  IconTable,
  IconChartBar,
  IconCategory,
  IconActivity,
  IconDownload,
  IconListSearch,
  IconStack2,
  IconServer,
  IconHeartRateMonitor,
  IconInfoCircle,
  IconChevronRight,
} from "@tabler/icons-react";
import { useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import {
  PageHeader,
  StickyTabsList,
  DataState,
  DocHint,
  KpiCard,
  MiniChart,
  FlashValue,
} from "../components/ui";
import { DbLogo, hasDbLogo } from "../components/DbLogo";
import { buildHealth, type HealthResult } from "../utils/health";
import {
  normalize,
  type HealthPayload,
  type InstanceHealth,
  type OrmLeanHealth,
} from "../utils/realtimeHealth";
import {
  ORM_DOC,
  fmtNum,
  fmtMs,
  analyzeModel,
  ormHealthInputs,
  ensureLivePulseStyle,
  connectorRole,
  lsGet,
  lsSet,
  entityCount,
} from "../utils/ormFormat";
import {
  RealtimeHealthLive,
  OrmRealtimeControls,
  useOrmRates,
} from "./orm/ConnectorCard";
import {
  REL_LABEL,
  type OrmSummary,
  type OrmGraph,
  type RankItem,
  type OrmRate,
} from "../types/orm";

/**
 * Mini bar-list (classement horizontal) — label + valeur + barre proportionnelle
 * à la valeur max. Catégoriel → barres (pas MiniChart, réservé aux séries temps).
 */
function RankBars({
  items,
  color = "brand",
  empty = "Aucune donnée.",
}: {
  items: RankItem[];
  color?: MantineColor;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => (i.value < 0 ? 0 : i.value)));
  if (!items.length)
    return (
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    );
  return (
    <Stack gap={10}>
      {items.map((it) => {
        const row = (
          <div
            key={it.key}
            // Aucun `tabIndex` ici : la fiche enveloppe déjà la ligne dans un
            // bouton, qui porte le focus et l'annonce. En poser un ferait un
            // second arrêt de tabulation sur la même chose — le composant le
            // dit en toutes lettres.
            style={{ width: "100%" }}
          >
            <Group justify="space-between" gap="xs" wrap="nowrap" mb={3}>
              {it.href ? (
                <Anchor component={Link} to={it.href} size="xs" truncate>
                  {it.label}
                </Anchor>
              ) : (
                <Text size="xs" truncate>
                  {it.label}
                </Text>
              )}
              <Text
                size="xs"
                c="dimmed"
                ff="monospace"
                style={{ flexShrink: 0 }}
              >
                {fmtNum(it.value)}
              </Text>
            </Group>
            {/* Une barre de progression EXIGE un nom accessible : sans lui,
                un lecteur d'écran annonce vingt-cinq « barre de progression »
                indistinctes. Le nom porte le libellé ET la valeur, puisque
                c'est ce que la barre représente. */}
            <Progress
              value={it.value < 0 ? 0 : (it.value / max) * 100}
              color={color}
              size="sm"
              radius="sm"
              aria-label={`${it.label} : ${fmtNum(it.value)}`}
            />
          </div>
        );
        // L'aide suit la norme du kit : une FICHE typée (`DocHint`), pas un
        // tooltip brut — c'est la doctrine écrite dans le composant lui-même.
        // Le déclencheur « custom » y est prévu : l'enfant ouvre la fiche au
        // survol, ce qui fait de la LIGNE ENTIÈRE la cible. Le libellé seul
        // ferait quelques dizaines de pixels là où la ligne en fait plus de
        // cinq cents, et une aide qu'on n'atteint pas n'aide personne.
        return it.detail ? (
          <DocHint
            key={it.key}
            title={it.label}
            version={ORM_DOC}
            summary={`${fmtNum(it.value)} — ce que cette ligne agrège.`}
            sections={[{ label: "Contenu", body: it.detail }]}
            block
          >
            {row}
          </DocHint>
        ) : (
          row
        );
      })}
    </Stack>
  );
}

/** En-tête de panneau (icône + titre + bulle d'aide ⓘ dynamique + action). */
function Panel({
  title,
  icon,
  hint,
  info,
  right,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  /** Texte de la bulle ⓘ — typiquement DYNAMIQUE (compteurs, scope ORM). */
  hint?: string;
  /** Fiche d'aide riche (`<DocHint/>`) — rendue à la place de `hint` si fournie. */
  info?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="md" h="100%">
      <Group justify="space-between" wrap="nowrap" mb="sm">
        <Group gap="xs" wrap="nowrap">
          {icon}
          <Text fw={600}>{title}</Text>
          {info ??
            (hint ? (
              <DocHint title={title} version={ORM_DOC} summary={hint} />
            ) : null)}
        </Group>
        {right}
      </Group>
      {children}
    </Card>
  );
}

/** Petite stat d'agrégat pod (label + valeur tabular-nums) — en-tête santé pod. */
function PodStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: MantineColor;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </div>
  );
}

/**
 * **Vue ORM par worker — orientée GRAPHS, calquée sur l'accueil Supervision**
 * (`ProcessGraphGrid`) : en cluster, une carte **« Santé ORM » pod** (anneau du verdict
 * + rollup pire worker + agrégats pod) ; PUIS **une card par worker** (santé +
 * requêtes/connecteurs en grand + **courbe débit req/s**) — **cliquable → drill
 * `/nodefony/orm/<pid>`** (détail riche par connecteur). En mono : 1 card, sans
 * en-tête pod (la KPI « Santé ORM » porte déjà le verdict). Source = sonde lean pod
 * `nodefony:socket` (`.totals.orm` + `.instances[].orm`, agrégée par le master →
 * cohérente, ≠ `/orm/api/*` round-robin).
 */
function ClusterOrmGrid({
  workers,
  ratesByPid,
  qSeriesByPid,
  podOrm,
  verdict,
  live,
  onSelect,
}: {
  workers: InstanceHealth[];
  ratesByPid: Map<string, OrmRate>;
  qSeriesByPid: Map<string, number[]>;
  podOrm: OrmLeanHealth | null;
  verdict: { result: HealthResult | null; worstPid: string | null };
  live: boolean;
  onSelect: (pid: string) => void;
}) {
  // Liste typée (worker + sonde ORM non-null) sans assertion `!`.
  const rows = workers.flatMap((w) => (w.orm ? [{ w, o: w.orm }] : []));
  if (!rows.length) return null;
  const v = verdict.result;
  // En-tête pod (anneau santé agrégée) seulement en cluster (≥2 workers).
  const showPodHeader = rows.length > 1;
  return (
    <Stack gap="md">
      {/* En-tête : Santé ORM AGRÉGÉE pod (rollup = pire worker), comme la santé framework. */}
      {v && showPodHeader ? (
        <Card withBorder radius="md" p="md" style={{ contain: "content" }}>
          <Group wrap="nowrap" align="center" gap="lg">
            <RingProgress
              size={92}
              thickness={10}
              roundCaps
              sections={[{ value: v.score ?? 0, color: v.color }]}
              label={
                <Text
                  ta="center"
                  fw={800}
                  fz={22}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {v.score}
                </Text>
              }
            />
            <div style={{ minWidth: 0 }}>
              <Group gap="xs" mb={4}>
                <Text fw={700}>Santé ORM</Text>
                <Badge color={v.color} variant="light">
                  {v.label}
                </Badge>
                <DocHint
                  title="Santé ORM (pod)"
                  version={ORM_DOC}
                  summary="Verdict 3 états agrégé des sondes ORM (Derringer-Suich) — même brique que la santé du framework. Rollup = PIRE worker."
                  sections={[
                    {
                      label: "Signaux",
                      body: "Connecteurs coupés & taux d'erreurs = PANNE (→ 0). Latence EWMA, requêtes lentes & reconnexions = SATURATION (planché « Dégradé »).",
                    },
                    {
                      label: "Taux, pas cumul",
                      body: "Erreurs & reconnexions en delta/min (après 2 mesures live). Requêtes lentes & EWMA = flux ORM (NF_ORM_FLOW=1).",
                    },
                  ]}
                />
              </Group>
              <Text size="sm" c="dimmed">
                Pod de {rows.length} workers — rollup = <b>pire worker</b>
                {verdict.worstPid ? ` (pid ${verdict.worstPid}` : ""}
                {verdict.worstPid && v.worst ? `, facteur ${v.worst})` : ""}
                {verdict.worstPid && !v.worst ? ")" : ""}.
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                Sonde lean agrégée par le master (cohérente, ≠ /orm/api/*
                round-robin). Détail riche par connecteur → clique une carte.
              </Text>
            </div>
            {podOrm ? (
              <Group gap="xl" ml="auto" wrap="wrap" visibleFrom="sm">
                <PodStat
                  label="Connecteurs"
                  value={`${podOrm.connected}/${podOrm.connectors}`}
                  color={
                    podOrm.connected < podOrm.connectors ? "orange" : undefined
                  }
                />
                <PodStat
                  label="Requêtes pod"
                  value={fmtNum(podOrm.queryTotal)}
                />
                <PodStat
                  label="Lentes"
                  value={String(podOrm.slowTotal)}
                  color={podOrm.slowTotal > 0 ? "orange" : undefined}
                />
                <PodStat
                  label="Erreurs ORM"
                  value={String(podOrm.errorTotal)}
                  color={podOrm.errorTotal > 0 ? "red" : undefined}
                />
                <PodStat
                  label="EWMA max"
                  value={
                    podOrm.maxEwmaMs == null ? "—" : fmtMs(podOrm.maxEwmaMs)
                  }
                />
              </Group>
            ) : null}
          </Group>
        </Card>
      ) : null}

      {/* Grille : une card par worker (santé + requêtes/connecteurs + courbe débit). */}
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
        {rows.map(({ w, o }, i) => {
          const wh = buildHealth(
            ormHealthInputs(
              o,
              ratesByPid.get(w.instanceId) ?? {
                errPerMin: null,
                reconPerMin: null,
              },
            ),
          );
          const qHist = qSeriesByPid.get(w.instanceId) ?? [];
          return (
            <UnstyledButton
              key={w.instanceId}
              onClick={() => onSelect(w.instanceId)}
              aria-label={`détail ORM du worker ${i + 1} (pid ${w.instanceId})`}
              style={{ display: "block" }}
            >
              <Card
                withBorder
                radius="md"
                p="md"
                h="100%"
                className={live ? "nf-live-card" : undefined}
                style={{ contain: "content" }}
              >
                <Group justify="space-between" wrap="nowrap" mb="sm">
                  <Group gap="xs" wrap="nowrap">
                    <ThemeIcon variant="light" color="brand" radius="md">
                      <IconDatabase size={18} />
                    </ThemeIcon>
                    <div>
                      <Group gap={4} wrap="nowrap">
                        <Text fw={600}>
                          {showPodHeader ? `worker ${i + 1}` : "ce process"}
                        </Text>
                        <IconChevronRight size={14} style={{ opacity: 0.5 }} />
                      </Group>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        pid {w.instanceId}
                      </Text>
                    </div>
                  </Group>
                  {wh.score != null ? (
                    <Badge
                      variant="light"
                      color={wh.color}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {wh.score}
                    </Badge>
                  ) : null}
                </Group>

                {/* Requêtes + Connecteurs EN GRAND (visu directe). */}
                <Group grow mb="sm" gap="xs">
                  <div style={{ textAlign: "center" }}>
                    <Text size="xs" c="dimmed">
                      Requêtes
                    </Text>
                    <Text
                      fw={800}
                      fz={28}
                      lh={1.1}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      <FlashValue value={o.queryTotal}>
                        {fmtNum(o.queryTotal)}
                      </FlashValue>
                    </Text>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <Text size="xs" c="dimmed">
                      Connecteurs
                    </Text>
                    <Text
                      fw={800}
                      fz={28}
                      lh={1.1}
                      c={o.connected < o.connectors ? "orange" : undefined}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {o.connected}/{o.connectors}
                    </Text>
                  </div>
                </Group>

                {/* Débit requêtes/s — courbe en grand (page orientée graphs). */}
                <Text size="xs" c="dimmed" mb={2}>
                  Requêtes/s
                </Text>
                <MiniChart
                  series={[
                    {
                      data: qHist.length ? qHist : [0],
                      color: "var(--mantine-color-grape-5)",
                      label: "req/s",
                    },
                  ]}
                  height={64}
                />

                {/* Secondaire : lentes / erreurs / EWMA / reconnexions. */}
                <Group justify="space-between" mt="sm" gap="xs" wrap="nowrap">
                  <Text
                    size="xs"
                    c={o.slowTotal > 0 ? "orange" : "dimmed"}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    lentes {o.slowTotal}
                  </Text>
                  <Text
                    size="xs"
                    c={o.errorTotal > 0 ? "red" : "dimmed"}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    err {o.errorTotal}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    EWMA {o.maxEwmaMs == null ? "—" : fmtMs(o.maxEwmaMs)}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    recon {o.reconnectTotal}
                  </Text>
                </Group>
              </Card>
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

/**
 * Dashboard ORM — vue d'ensemble EXPLOITABLE du modèle de données : KPIs
 * (connecteurs, **verdict Santé ORM**, entités, relations, **lignes réelles**),
 * **santé par worker orientée graphs** (carte/worker cliquable → drill
 * `/nodefony/orm/:pid`), classements live (top tables, domaines) et santé du modèle.
 * Exporte le modèle (DBML / JSON Schema). Le rendu visuel (ERD) vit dans
 * `/nodefony/databases` ; le **diagnostic riche par connecteur** vit dans le drill.
 *
 * Data plane `/nodefony/orm/api` : `orms` + `graph` (rapides) ; `counts` (COUNT(*),
 * plus lent) chargé séparément. Runtime cluster-aware = sonde lean pod
 * `nodefony:socket` (agrégée par le master → cohérente, ≠ `/orm/api/*` round-robin).
 */
interface OrmOverviewProps {
  /**
   * Monté DANS un autre écran (forage du Jumeau) : pas de `PageHeader` sticky
   * propre (le conteneur a déjà le sien) → seule la barre d'actions est rendue.
   */
  embedded?: boolean;
}

export const OrmOverview = observer(
  ({ embedded = false }: OrmOverviewProps) => {
    const store = useStore();
    const ui = useUi();
    const navigate = useNavigate();

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
    // Le registre des STORES, pour répondre à la question qui perd tout le
    // monde : « laquelle de ces bases porte réellement mes données ? ».
    // Le drapeau `default` d'un ORM ne le dit PAS — `@nodefony/drizzle` est
    // chargé sans condition et tient toujours un connecteur `default`, même
    // quand l'infrastructure déclarée est MongoDB et que toutes les briques
    // durables sont résolues sur `mongoose`.
    const storesRegistry = useResource(
      useCallback(
        () =>
          store.api.getAbsolute<{
            infra?: { database?: { family?: string } | null };
            stores?: Array<{
              brick: string;
              resolved: string;
              location?: string;
            }>;
          }>("/nodefony/kernel/api/stores"),
        [store],
      ),
    );
    /**
     * Briques portées par chaque CONNECTEUR (clé : son nom).
     *
     * 🔴 Jamais par moteur : deux connecteurs sqlite (le `default` sur fichier
     * et un connecteur dédié `:memory:`) recevaient alors TOUS DEUX les huit
     * briques, et le dédié s'affichait « porte les stores » — la page désignait
     * comme base applicative celle qui s'efface au redémarrage. La preuve
     * d'appartenance est la `location` que le registre publie pour chaque
     * brique, comparée à la cible du connecteur. Un moteur qui n'a qu'UN
     * connecteur lui rend ses briques sans autre preuve ; entre plusieurs, une
     * brique sans correspondance n'est attribuée à personne — ne rien dire
     * vaut mieux qu'annoncer faux.
     */
    const bricksByConnector = useMemo(() => {
      const by = new Map<string, string[]>();
      const connectors = orms.data ?? [];
      for (const s of storesRegistry.data?.stores ?? []) {
        const candidates = connectors.filter((o) => o.vendor === s.resolved);
        const owner =
          candidates.length === 1
            ? candidates[0]
            : candidates.find(
                (o) =>
                  s.location !== undefined &&
                  o.connection?.target === s.location,
              );
        if (owner === undefined) continue;
        const list = by.get(owner.name) ?? [];
        list.push(s.brick);
        by.set(owner.name, list);
      }
      return by;
    }, [storesRegistry.data, orms.data]);
    // Volumes réels — endpoint séparé (1 COUNT(*) par table) : peut être lent sur
    // un gros schéma → ne bloque pas le 1er rendu.
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
    const connected = list.filter((o) => o.connected).length;

    // Onglet ORM actif ("*" = tous) → scope du compartiment « Modèle de données ».
    const [activeOrm, setActiveOrm] = useState<string>("*");
    const scopedEntities = useMemo(
      () =>
        activeOrm === "*"
          ? entities
          : entities.filter((e) => e.connector === activeOrm),
      [entities, activeOrm],
    );
    // KPIs = projet entier ; panneaux = scope de l'onglet (~400 entités → mémo).
    const globalAgg = useMemo(
      () => analyzeModel(entities, countMap),
      [entities, countMap],
    );
    const agg = useMemo(
      () => analyzeModel(scopedEntities, countMap),
      [scopedEntities, countMap],
    );
    // Suffixe d'aide selon l'onglet actif (rend les bulles ⓘ contextuelles).
    const scopeLabel = activeOrm === "*" ? "tous connecteurs" : activeOrm;

    // Onglet de section actif (contrôlé) — les KPIs cliquables y naviguent.
    const [section, setSection] = useState<"connecteurs" | "modele">(
      "connecteurs",
    );

    useEffect(ensureLivePulseStyle, []);

    // Temps réel : interrupteur GLOBAL partagé (UiStore), OFF au (re)chargement
    // (opt-in par session). ON → on s'abonne à `nodefony:socket` (sonde lean pod).
    const live = ui.realtimeLive;
    // Granularité (cadence du canal) — préférence persistée, défaut 5 s.
    const [liveMs, setLiveMs] = useState<number>(
      () => Number(lsGet("nf.orm.liveMs")) || 5000,
    );
    // Cadence ADAPTATIVE (AIMD) : politique GLOBALE de la socket (réglée dans le Hub).
    const auto = ui.adaptiveCadence;
    // Cadence réelle appliquée par l'AIMD (lecture seule) → badge feedback sur la page.
    const [effectiveMs, setEffectiveMs] = useState<number>(liveMs);

    // ── Sonde LEAN pod (canal `nodefony:socket`) — cluster-aware ──────────────
    // 1ᵉʳ paint + détection cluster : snapshot pod one-shot (indépendant du toggle
    // « Temps réel »). Le MASTER agrège en cluster → vue cohérente quel que soit le
    // worker qui répond (≠ /orm/api/* en round-robin reusePort → 1 worker au hasard).
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
    const workers = useMemo(() => normRt?.instances ?? [], [normRt]);
    const podOrm = normRt?.totals.orm ?? null;
    // Au moins un worker remonte la sonde ORM ? (sinon : grille vide → fallback).
    const hasLean = useMemo(() => workers.some((w) => !!w.orm), [workers]);

    // Taux ORM par worker (delta des cumuls) + débit requêtes/s (sparkline) — 0 backend.
    const { ratesByPid, qSeriesByPid } = useOrmRates(normRt, live);

    // Verdict « Santé ORM » 3 états — calculé PAR worker via buildHealth (même brique
    // que la santé framework), pod = PIRE worker (rollup). Rouge réservé au critique.
    const verdict = useMemo<{
      result: HealthResult | null;
      worstPid: string | null;
    }>(() => {
      let worst: HealthResult | null = null;
      let worstPid: string | null = null;
      for (const inst of workers) {
        if (!inst.orm) continue;
        const r = buildHealth(
          ormHealthInputs(
            inst.orm,
            ratesByPid.get(inst.instanceId) ?? {
              errPerMin: null,
              reconPerMin: null,
            },
          ),
        );
        if (r.score == null) continue;
        if (!worst || (r.score as number) < (worst.score as number)) {
          worst = r;
          worstPid = inst.instanceId;
        }
      }
      return { result: worst, worstPid };
    }, [workers, ratesByPid]);

    useEffect(() => {
      if (!live) setLiveRt(null);
    }, [live]);
    useEffect(() => lsSet("nf.orm.liveMs", String(liveMs)), [liveMs]);

    /**
     * Compte d'une entité, en tenant compte de l'HOMONYMIE entre connecteurs.
     *
     * Le serveur qualifie la clé (`connecteur:nom`) quand plusieurs connecteurs
     * portent ce nom, et la laisse nue sinon — d'où les deux lectures. Sans
     * cela, `session` de Mongoose affichait le compte de `session` de Drizzle :
     * deux lignes jumelles, un chiffre faux, et rien pour le dire.
     */
    const countOf = useCallback(
      (e: { name: string; connector: string }): number | undefined =>
        entityCount(countMap, e),
      [countMap],
    );

    // Volume global : plus grosse table + nb de tables peuplées (KPI « Lignes »).
    const volume = useMemo(() => {
      let populated = 0;
      let topName = "";
      let topRows = 0;
      for (const e of entities) {
        const c = countOf(e);
        if (typeof c === "number" && c > 0) {
          populated += 1;
          if (c > topRows) {
            topRows = c;
            topName = e.name;
          }
        }
      }
      return { populated, topName, topRows };
    }, [entities, countOf]);

    /**
     * Texte de la bulle d'aide d'une carte de connecteur — UNE seule par carte.
     *
     * Ce que les badges disent en un mot est développé ici : le rôle, les
     * briques réellement portées, l'avertissement d'une base volatile. Le
     * contraire — une bulle par badge — multiplie les cibles de survol sans en
     * rendre AUCUNE atteignable au clavier.
     */
    const sectionsConnecteur = useCallback(
      (
        o: OrmSummary,
        role: { label: string; hint: string },
        bricks: string[],
      ): { label: string; body: string }[] => {
        const sections = [{ label: role.label, body: role.hint }];
        sections.push({
          label: "Où vivent les données",
          body:
            o.connection?.target === ":memory:"
              ? "En mémoire du processus : tout son contenu disparaît au redémarrage."
              : (o.connection?.target ?? "emplacement inconnu"),
        });
        sections.push({
          label: "Briques durables",
          body:
            bricks.length > 0
              ? `${bricks.length} résolue(s) sur ce connecteur : ${bricks.join(", ")}.`
              : "Aucune. Les sessions, comptes, jetons et audit de cette application sont résolus sur un autre connecteur de cette page.",
        });
        if (!o.connected) {
          sections.push({
            label: "Non relié",
            body: "Le connecteur n'est pas joignable : les entités qu'il porte ne répondent pas.",
          });
        }
        return sections;
      },
      [],
    );

    /** Noms d'entité portés par PLUSIEURS connecteurs — sources d'ambiguïté. */
    const homonymNames = useMemo(() => {
      const seen = new Map<string, number>();
      for (const e of entities) seen.set(e.name, (seen.get(e.name) ?? 0) + 1);
      return new Set(
        [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name),
      );
    }, [entities]);

    // Top 12 tables par volume (lignes), liées au détail de l'entité.
    const topEntities = useMemo<RankItem[]>(
      () =>
        scopedEntities
          .map((e) => ({
            key: `${e.connector}:${e.name}`,
            // Le connecteur entre dans le libellé UNIQUEMENT quand le nom est
            // porté par plusieurs : sinon on alourdit toutes les lignes pour
            // un cas qui n'existe pas dans la plupart des applications.
            label: homonymNames.has(e.name)
              ? `${e.name} · ${e.connector}`
              : e.name,
            value: countOf(e) ?? -1,
            href: `/nodefony/orm-entity?name=${encodeURIComponent(
              e.name,
            )}&connector=${encodeURIComponent(e.connector)}`,
          }))
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 12),
      [scopedEntities, countOf, homonymNames],
    );

    /**
     * Les entités de chaque groupe, prêtes à être montrées au survol.
     *
     * Sans cela, une barre « (non classé) 1 » ne dit pas CE qu'elle compte :
     * on voit qu'il reste une entité non rangée, sans pouvoir la nommer — donc
     * sans pouvoir la corriger. Le groupe suit la même règle que l'agrégat :
     * domaine déclaré, à défaut module propriétaire.
     */
    const entitiesByGroup = useMemo(() => {
      const by = new Map<string, string[]>();
      for (const e of scopedEntities) {
        const g = e.domain || e.module || "(non classé)";
        const members = by.get(g) ?? [];
        members.push(`${e.name} · ${e.connector}`);
        by.set(g, members);
      }
      return by;
    }, [scopedEntities]);

    /**
     * Les entités sans relation déclarée, et leur module.
     *
     * 🔴 Ce n'est PAS un défaut en soi, et le présenter comme tel faisait un
     * badge orange allumé en permanence : les entités du framework sont PLATES
     * par conception. `access_token` porte `subjectId` + `subjectType` — une
     * référence polymorphe —, `audit_event` porte son acteur en texte. Le
     * framework refuse d'imposer une clé étrangère vers `User`, puisque c'est
     * l'application qui possède cette table. Vingt entités sur vingt-trois
     * relèvent de ce choix ; les nommer est la seule façon de voir les trois
     * autres, qui sont applicatives.
     */
    const orphelines = useMemo(
      () =>
        scopedEntities
          .filter((e) => (e.relations?.length ?? 0) === 0)
          .map((e) => `${e.name} · ${e.module || "?"}`),
      [scopedEntities],
    );

    /** Rend le détail d'un groupe, borné : au-delà de dix, on compte le reste. */
    const groupDetail = useCallback(
      (group: string): string | undefined => {
        const members = entitiesByGroup.get(group);
        if (!members?.length) return undefined;
        const head = members.slice(0, 10).join(", ");
        return members.length > 10
          ? `${head}, et ${members.length - 10} autre(s)`
          : head;
      },
      [entitiesByGroup],
    );

    const topDomainsByEntities = useMemo<RankItem[]>(
      () =>
        Object.entries(agg.entitiesByDomain)
          .map(([k, v]) => ({
            key: k,
            label: k,
            value: v,
            detail: groupDetail(k),
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 12),
      [agg.entitiesByDomain, groupDetail],
    );

    const topDomainsByRows = useMemo<RankItem[]>(
      () =>
        Object.entries(agg.rowsByDomain)
          .map(([k, v]) => ({
            key: k,
            label: k,
            value: v,
            detail: groupDetail(k),
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 12),
      [agg.rowsByDomain, groupDetail],
    );

    const exportModel = useCallback(
      async (format: "dbml" | "jsonschema") => {
        const res = await store.api.getAbsolute<{
          format: string;
          content: string;
        }>(`/nodefony/orm/api/export/${format}`);
        const ext = format === "dbml" ? "dbml" : "json";
        const blob = new Blob([res.content], {
          type: "text/plain;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nodefony-model.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      [store],
    );

    const loadingCore = orms.loading && !list.length;

    const headerActions = (
      <Group gap="xs">
        <OrmRealtimeControls
          live={live}
          onToggle={(v) => ui.setRealtimeLive(v)}
          liveMs={liveMs}
          setLiveMs={setLiveMs}
          auto={auto}
          effectiveMs={effectiveMs}
          ariaLabel="abonnement temps réel (socket Nodefony) de la santé ORM par worker"
        />
        <Button
          component={Link}
          to="/nodefony/databases"
          variant="light"
          leftSection={<IconAffiliate size={16} />}
        >
          Schéma ERD
        </Button>
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconDownload size={16} />}
            >
              Exporter
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Modèle de données</Menu.Label>
            <Menu.Item onClick={() => void exportModel("dbml")}>
              DBML (dbdiagram.io)
            </Menu.Item>
            <Menu.Item onClick={() => void exportModel("jsonschema")}>
              JSON Schema (2020-12)
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    );

    return (
      <Stack gap="lg">
        {embedded ? (
          <Group justify="flex-end">{headerActions}</Group>
        ) : (
          <PageHeader
            sticky
            title="Dashboard ORM"
            subtitle={
              isClusterMode
                ? `Cluster — ${workers.length} worker(s) · schéma identique, runtime agrégé`
                : "Connecteurs, modèle de données & volumes réels"
            }
            actions={headerActions}
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

        <Grid>
          {/* Connecteurs — vendors présents + ratio up. Clic → onglet Connecteurs. */}
          <KpiCard
            label="Connecteurs"
            accent="brand"
            icon={<IconDatabase size={20} />}
            hintVersion={ORM_DOC}
            hint="ORM enregistrés dans le registre process-wide. Clic → onglet Connecteurs."
            value={list.length || "—"}
            active={section === "connecteurs"}
            onClick={() => setSection("connecteurs")}
            footer={
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Group gap={4} wrap="nowrap">
                  {[...new Set(list.map((o) => o.vendor).filter(Boolean))].map(
                    (v) =>
                      hasDbLogo(v) ? (
                        <DbLogo key={v} name={v} size={16} title={v} />
                      ) : null,
                  )}
                </Group>
                <Badge
                  size="sm"
                  variant="light"
                  color={
                    connected === list.length
                      ? "teal"
                      : connected === 0
                        ? "red"
                        : "orange"
                  }
                >
                  {connected}/{list.length} up
                </Badge>
              </Group>
            }
          />

          {/* Santé ORM — verdict 3 états (pod = pire worker). Clic → onglet Connecteurs. */}
          <KpiCard
            label="Santé ORM"
            accent={(verdict.result?.color ?? "gray") as MantineColor}
            icon={<IconHeartRateMonitor size={20} />}
            value={
              verdict.result ? (
                <Text span inherit c={verdict.result.color}>
                  {verdict.result.score}
                </Text>
              ) : (
                "—"
              )
            }
            active={section === "connecteurs"}
            pulse={live}
            onClick={() => setSection("connecteurs")}
            info={
              <DocHint
                title="Santé ORM"
                version={ORM_DOC}
                summary="Verdict 3 états (OK / à surveiller / dégradé) agrégé des sondes ORM par la méthode Derringer-Suich — même brique que la santé du framework."
                sections={[
                  {
                    label: "Signaux",
                    body: "Connecteurs coupés & taux d'erreurs ORM = PANNE (peuvent tirer l'indice à 0). Latence EWMA, part de requêtes lentes & reconnexions = SATURATION (ralentit mais sert → « Dégradé » au pire, jamais « Critique » seul).",
                  },
                  {
                    label: "Taux, pas cumul",
                    body: "Erreurs & reconnexions lues en delta/minute (apparaissent après 2 mesures live) — un cumul ferait paraître un vieux pod malade.",
                  },
                  {
                    label: isClusterMode ? "Cluster" : "Mono-process",
                    body: isClusterMode
                      ? `Pod = PIRE worker (rollup) sur ${workers.length} worker(s). Source = sonde lean agrégée par le master (cohérente, ≠ /orm/api/* en round-robin).`
                      : "1 process : la latence EWMA & la part de requêtes lentes n'apparaissent que si le flux ORM est actif (NF_ORM_FLOW=1).",
                  },
                ]}
              />
            }
            footer={
              <Group gap="xs" wrap="nowrap">
                <Badge
                  size="sm"
                  variant="light"
                  color={(verdict.result?.color ?? "gray") as MantineColor}
                >
                  {verdict.result?.label ?? "—"}
                </Badge>
                {podOrm && (
                  <Badge
                    size="sm"
                    variant="light"
                    color={
                      podOrm.connected < podOrm.connectors ? "orange" : "teal"
                    }
                    leftSection={<IconPlugConnected size={11} />}
                  >
                    {podOrm.connected}/{podOrm.connectors}
                  </Badge>
                )}
                {verdict.result?.worst && (
                  <Text
                    size="xs"
                    c="dimmed"
                    truncate
                    title={`Facteur limitant : ${verdict.result.worst}`}
                  >
                    ↓ {verdict.result.worst}
                  </Text>
                )}
                {isClusterMode && verdict.worstPid && (
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    pire : pid {verdict.worstPid}
                  </Text>
                )}
              </Group>
            }
          />

          {/* Entités — relations + domaines. Clic → onglet Modèle. */}
          <KpiCard
            label="Entités"
            accent="indigo"
            icon={<IconTable size={20} />}
            hintVersion={ORM_DOC}
            hint="Entités mappées tous connecteurs. Clic → onglet Modèle de données."
            value={entities.length || "—"}
            active={section === "modele"}
            onClick={() => setSection("modele")}
            footer={
              <Group gap="xs" wrap="nowrap">
                <Badge
                  size="sm"
                  variant="light"
                  color="indigo"
                  leftSection={<IconAffiliate size={11} />}
                >
                  {globalAgg.relationTotal} rel.
                </Badge>
                <Badge
                  size="sm"
                  variant="light"
                  color="grape"
                  leftSection={<IconCategory size={11} />}
                >
                  {globalAgg.domainCount} dom.
                </Badge>
              </Group>
            }
          />

          {/* Lignes — volume réel + plus grosse table. Clic → onglet Modèle. */}
          <KpiCard
            label="Lignes (réelles)"
            accent="teal"
            icon={<IconChartBar size={20} />}
            hintVersion={ORM_DOC}
            hint="Total des lignes en base (COUNT(*) par table) + table la plus volumineuse. Clic → onglet Modèle de données."
            value={
              counts.loading ? (
                <Loader size="sm" />
              ) : globalAgg.rowsTotal ? (
                fmtNum(globalAgg.rowsTotal)
              ) : (
                "—"
              )
            }
            active={section === "modele"}
            onClick={() => setSection("modele")}
            footer={
              counts.loading ? (
                <Text size="xs" c="dimmed">
                  comptage…
                </Text>
              ) : volume.topName ? (
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="xs" c="dimmed" truncate title={volume.topName}>
                    ↑ {volume.topName}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    ff="monospace"
                    style={{ flexShrink: 0 }}
                  >
                    {fmtNum(volume.topRows)} · {volume.populated} tables
                  </Text>
                </Group>
              ) : (
                <Text size="xs" c="dimmed">
                  aucune table peuplée
                </Text>
              )
            }
          />
        </Grid>

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
          <Tabs
            value={section}
            onChange={(v) =>
              setSection((v as "connecteurs" | "modele") ?? "connecteurs")
            }
            keepMounted={false}
          >
            <StickyTabsList mb="md">
              <Tabs.Tab
                value="connecteurs"
                leftSection={<IconDatabase size={16} />}
              >
                Connecteurs ({list.length})
              </Tabs.Tab>
              <Tabs.Tab
                value="modele"
                leftSection={<IconAffiliate size={16} />}
              >
                Modèle de données
              </Tabs.Tab>
            </StickyTabsList>

            <Tabs.Panel value="connecteurs">
              <Stack gap="md">
                {/* Identité des connecteurs (schéma INVARIANT — même sur tous les workers). */}
                <Card withBorder radius="md" p="md">
                  <Group gap="xs" mb="sm">
                    <IconDatabase size={18} />
                    <Text fw={600}>Connecteurs</Text>
                    <Badge variant="light" color="gray" size="sm">
                      {list.length}
                    </Badge>
                    {isClusterMode && (
                      <Badge
                        variant="light"
                        color="grape"
                        size="sm"
                        leftSection={<IconServer size={11} />}
                      >
                        schéma identique · {workers.length} workers
                      </Badge>
                    )}
                    <DocHint
                      title="Connecteurs"
                      version={ORM_DOC}
                      summary={`${list.length} connecteur(s) enregistré(s) · ${connected} connecté(s).`}
                      sections={[
                        {
                          label: "Définition",
                          body: "Un connecteur = une instance ORM (Drizzle, Mongoose…) reliée à une base, enregistrée dans le registre process-wide.",
                        },
                        {
                          label: "Détail riche",
                          body: "Ping, latence, pool, stockage, flux SQL : dans le drill par worker (clique une carte ci-dessous → /nodefony/orm/<pid>).",
                        },
                        ...(isClusterMode
                          ? [
                              {
                                label: "Cluster",
                                body: "Le schéma (entités, relations, base) est IDENTIQUE sur tous les workers (même code) — invariant. Seuls le runtime (santé, flux) varient par worker.",
                              },
                            ]
                          : []),
                      ]}
                    />
                  </Group>
                  {/* Une CARTE par connecteur, jamais une pastille : la
                      question posée ici est « quelle base, sur quel moteur, et
                      est-ce que ça tourne ? ». Le nom seul n'y répond pas, et
                      tout le reste — moteur, pilote, cible, volumétrie,
                      versions — était déjà servi par le data plane et jeté à
                      l'affichage. */}
                  <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                    {list.map((o) => {
                      const bricks = bricksByConnector.get(o.name) ?? [];
                      const role = connectorRole(o, bricks.length);
                      const driver = o.connection?.driver ?? o.vendor ?? "";
                      const target = o.connection?.target ?? "";
                      const volatile = target === ":memory:";
                      return (
                        <Card
                          key={o.name}
                          withBorder
                          radius="md"
                          p="sm"
                          // Un connecteur TOMBÉ doit se voir de loin : la
                          // bordure porte l'alerte, pas une icône de 12 px
                          // perdue au bout d'une ligne.
                          style={{
                            borderColor: o.connected
                              ? undefined
                              : "var(--mantine-color-red-6)",
                          }}
                        >
                          <Group gap="xs" wrap="nowrap" mb={6}>
                            {hasDbLogo(driver) ? (
                              <DbLogo name={driver} size={18} />
                            ) : (
                              <IconDatabase size={17} />
                            )}
                            <Text
                              fw={600}
                              size="sm"
                              style={{ flex: 1 }}
                              truncate
                            >
                              {o.name}
                            </Text>
                            <Badge
                              size="xs"
                              variant="light"
                              color={role.color as MantineColor}
                              style={{ textTransform: "none" }}
                            >
                              {role.label}
                            </Badge>
                            {o.connected ? (
                              <IconPlugConnected
                                size={15}
                                color="var(--mantine-color-teal-5)"
                                aria-label="connecteur relié à sa base"
                              />
                            ) : (
                              <IconPlugX
                                size={15}
                                color="var(--mantine-color-red-5)"
                                aria-label="connecteur non relié"
                              />
                            )}
                            {/* L'aide passe par le composant du kit : une bulle
                                posée sur un `Badge` n'est atteignable NI au
                                clavier ni au tactile — Mantine ne le rend pas
                                focusable, et `aria-label` est interdit sur son
                                `<div>`. `InfoHint` porte la norme : cible de
                                24 px, `aria-label`, events hover/focus/touch. */}
                            <DocHint
                              title={o.name}
                              version={ORM_DOC}
                              summary={`${o.vendor} · ${driver} — ${role.label}.`}
                              sections={sectionsConnecteur(o, role, bricks)}
                            />
                          </Group>

                          <Group gap={6} mb={6}>
                            <Badge
                              size="xs"
                              variant="default"
                              style={{ textTransform: "none" }}
                            >
                              {o.vendor}
                            </Badge>
                            <Badge
                              size="xs"
                              variant="default"
                              style={{ textTransform: "none" }}
                            >
                              {driver}
                            </Badge>
                            {volatile && (
                              <Badge
                                size="xs"
                                variant="light"
                                color="orange"
                                style={{ textTransform: "none" }}
                              >
                                volatile
                              </Badge>
                            )}
                          </Group>

                          {/* La CIBLE est ce qu'on vient chercher : « mes
                              données sont où ? ». Monospace, jamais tronquée
                              en silence — le titre porte la valeur entière. */}
                          <Text
                            size="xs"
                            c="dimmed"
                            title={target || undefined}
                            truncate
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, monospace",
                            }}
                          >
                            {target || "—"}
                          </Text>

                          <Divider my={8} />

                          <Group justify="space-between" gap="xs" wrap="nowrap">
                            <Group gap={4} wrap="nowrap">
                              <IconTable size={13} />
                              <Text
                                size="xs"
                                style={{ fontVariantNumeric: "tabular-nums" }}
                              >
                                {o.entityCount} entité
                                {o.entityCount > 1 ? "s" : ""}
                              </Text>
                              {/* CE qui lève la confusion : la base qui porte
                                  les briques durables n'est pas forcément celle
                                  que l'ORM appelle « default ». */}
                              {bricks.length > 0 && (
                                <Badge
                                  size="xs"
                                  variant="light"
                                  color="teal"
                                  style={{ textTransform: "none" }}
                                >
                                  {bricks.length} brique
                                  {bricks.length > 1 ? "s" : ""}
                                </Badge>
                              )}
                            </Group>
                            {/* Les versions répondent à la question d'après :
                                « suis-je sur le pilote que je crois ? ». */}
                            <Text size="xs" c="dimmed" ta="right" truncate>
                              {o.connection?.version
                                ? `${driver} ${o.connection.version} · `
                                : ""}
                              {o.vendor} {o.connection?.ormVersion ?? "—"}
                            </Text>
                          </Group>
                        </Card>
                      );
                    })}
                  </SimpleGrid>
                </Card>

                {/* Santé ORM par worker (orientée graphs) — carte → drill /nodefony/orm/<pid>. */}
                {hasLean ? (
                  <ClusterOrmGrid
                    workers={workers}
                    ratesByPid={ratesByPid}
                    qSeriesByPid={qSeriesByPid}
                    podOrm={podOrm}
                    verdict={verdict}
                    live={live}
                    onSelect={(pid) => navigate(`/nodefony/orm/${pid}`)}
                  />
                ) : realtime.loading ? (
                  <Group justify="center" p="xl">
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
                    title="Santé ORM par worker indisponible"
                  >
                    La sonde lean ORM (`nodefony:socket`) n'est pas remontée par
                    ce pod. Le diagnostic riche reste accessible par worker via
                    le drill (clique un connecteur), ou active le flux ORM
                    (`NF_ORM_FLOW=1`) pour animer débit & latence.
                  </Alert>
                )}

                {isClusterMode && (
                  <Alert
                    variant="light"
                    color="blue"
                    icon={<IconInfoCircle size={18} />}
                    title="Diagnostic détaillé = 1 worker"
                  >
                    Le diagnostic riche par connecteur (ping, latence, pool,
                    stockage, flux SQL) est <b>per-worker</b> : ouvre une carte
                    worker ci-dessus pour le détail de ce process (pid). La vue
                    pod cohérente = la carte « Santé ORM » + la grille worker.
                  </Alert>
                )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="modele">
              {/* Compartiment Modèle de données — sous-onglets par connecteur (filtre live) */}
              <Card withBorder radius="md" p="md">
                <Group gap="xs" mb="sm">
                  <IconAffiliate size={18} />
                  <Text fw={600}>Modèle de données</Text>
                  {isClusterMode && (
                    <Badge
                      variant="light"
                      color="grape"
                      size="sm"
                      leftSection={<IconServer size={11} />}
                    >
                      identique · {workers.length} workers
                    </Badge>
                  )}
                  <DocHint
                    title="Modèle de données"
                    version={ORM_DOC}
                    summary={`${entities.length} entité(s) · ${globalAgg.relationTotal} relation(s) · ${globalAgg.domainCount} domaine(s).`}
                    sections={[
                      {
                        label: "Navigation",
                        body: "Chaque sous-onglet filtre le modèle par connecteur.",
                      },
                      ...(isClusterMode
                        ? [
                            {
                              label: "Cluster",
                              body: "Le modèle (schéma) est invariant : même code → mêmes tables sur les N workers. Aucun besoin de l'agréger.",
                            },
                          ]
                        : []),
                    ]}
                  />
                </Group>
                <Tabs
                  value={activeOrm}
                  onChange={(v) => setActiveOrm(v ?? "*")}
                  variant="pills"
                >
                  <Tabs.List mb="md">
                    <Tabs.Tab value="*" leftSection={<IconStack2 size={14} />}>
                      Tous
                    </Tabs.Tab>
                    {list.map((o) => (
                      <Tabs.Tab
                        key={o.name}
                        value={o.name}
                        leftSection={
                          hasDbLogo(o.vendor) ? (
                            <DbLogo name={o.vendor} size={14} />
                          ) : (
                            <IconDatabase size={14} />
                          )
                        }
                      >
                        {o.name}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                  <Tabs.Panel value={activeOrm}>
                    <Grid>
                      <Grid.Col span={{ base: 12, lg: 6 }}>
                        <Panel
                          title="Top tables par volume"
                          icon={<IconChartBar size={18} />}
                          hint={`${topEntities.length} table(s) peuplée(s) — top 12 par COUNT(*) · ${scopeLabel}.`}
                          right={
                            counts.loading ? (
                              <Loader size="xs" />
                            ) : (
                              <Badge variant="light" color="gray" size="sm">
                                COUNT(*)
                              </Badge>
                            )
                          }
                        >
                          <RankBars
                            items={topEntities}
                            color="brand"
                            empty={
                              counts.loading
                                ? "Comptage en cours…"
                                : "Aucune table peuplée."
                            }
                          />
                        </Panel>
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, lg: 6 }}>
                        <Panel
                          title="Entités par domaine ou module"
                          icon={<IconCategory size={18} />}
                          hint={`${scopedEntities.length} entité(s) réparties sur ${agg.domainCount} groupe(s) · ${scopeLabel}. Le groupe est le DOMAINE déclaré par l'entité ; à défaut, son MODULE propriétaire — les entités du framework ne déclarent pas de domaine, et les ranger toutes sous « non classé » n'apprendrait rien.`}
                          right={
                            <Badge variant="light" color="gray" size="sm">
                              {agg.domainCount}
                            </Badge>
                          }
                        >
                          <RankBars
                            items={topDomainsByEntities}
                            color="indigo"
                          />
                        </Panel>
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, lg: 6 }}>
                        <Panel
                          title="Lignes par domaine ou module"
                          icon={<IconCategory size={18} />}
                          hint={`${fmtNum(agg.rowsTotal)} ligne(s) réparties sur ${Object.keys(agg.rowsByDomain).length} groupe(s) peuplé(s) · ${scopeLabel}. Même groupement que le panneau voisin : domaine déclaré, à défaut module propriétaire.`}
                        >
                          <RankBars
                            items={topDomainsByRows}
                            color="teal"
                            empty={
                              counts.loading
                                ? "Comptage en cours…"
                                : "Aucune donnée."
                            }
                          />
                        </Panel>
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, lg: 6 }}>
                        <Panel
                          title="Santé du modèle"
                          icon={<IconActivity size={18} />}
                          hint={`${agg.orphans} entité(s) sans relation déclarée · ${agg.relationTotal} relation(s) sur ${scopedEntities.length} entité(s) · ${scopeLabel}. Une entité plate n'est PAS une anomalie : les magasins du framework le sont tous par conception (référence polymorphe \`subjectId\`/\`subjectType\`, acteur d'audit en texte), pour ne pas imposer de clé étrangère vers la table \`User\` que possède l'application. Survolez la ligne pour voir lesquelles, avec leur module.`}
                          right={
                            <Button
                              component={Link}
                              to="/nodefony/databases"
                              variant="subtle"
                              size="compact-xs"
                              leftSection={<IconListSearch size={14} />}
                            >
                              Explorer
                            </Button>
                          }
                        >
                          <Stack gap="sm">
                            <Group justify="space-between" wrap="nowrap">
                              <Text
                                size="sm"
                                title={
                                  orphelines.length
                                    ? orphelines.slice(0, 12).join(", ") +
                                      (orphelines.length > 12
                                        ? `, et ${orphelines.length - 12} autre(s)`
                                        : "")
                                    : undefined
                                }
                              >
                                Entités sans relation déclarée
                              </Text>
                              {/* Couleur NEUTRE : une entité plate n'est pas une
                                  anomalie — les magasins du framework le sont
                                  tous. Un badge orange permanent n'alerte plus
                                  de rien. */}
                              <Badge variant="light" color="gray">
                                {agg.orphans}
                              </Badge>
                            </Group>
                            <Group justify="space-between" wrap="nowrap">
                              <Text size="sm">Colonnes non introspectées</Text>
                              <Badge
                                variant="light"
                                color={agg.noColumns ? "yellow" : "teal"}
                              >
                                {agg.noColumns}
                              </Badge>
                            </Group>
                            <Divider
                              label="Relations par type"
                              labelPosition="left"
                            />
                            {Object.keys(agg.relByType).length ? (
                              <Group gap="xs">
                                {Object.entries(agg.relByType)
                                  .sort((a, b) => b[1] - a[1])
                                  .map(([t, n]) => (
                                    <Badge
                                      key={t}
                                      variant="light"
                                      color="brand"
                                      size="lg"
                                    >
                                      {REL_LABEL[t] ?? t} · {n}
                                    </Badge>
                                  ))}
                              </Group>
                            ) : (
                              <Text size="sm" c="dimmed">
                                Aucune relation déclarée.
                              </Text>
                            )}
                          </Stack>
                        </Panel>
                      </Grid.Col>
                    </Grid>
                  </Tabs.Panel>
                </Tabs>
              </Card>
            </Tabs.Panel>
          </Tabs>
        </DataState>
      </Stack>
    );
  },
);

export default OrmOverview;
