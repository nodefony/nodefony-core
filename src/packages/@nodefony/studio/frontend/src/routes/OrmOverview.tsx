import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Code,
  Progress,
  Anchor,
  Divider,
  Loader,
  Menu,
  Tabs,
  ScrollArea,
  Table,
  Switch,
  HoverCard,
  SegmentedControl,
  Alert,
  type MantineColor,
} from "@mantine/core";
import { Link } from "react-router-dom";
import {
  IconDatabase,
  IconPlugConnected,
  IconPlugX,
  IconAffiliate,
  IconTable,
  IconBolt,
  IconChartBar,
  IconCategory,
  IconActivity,
  IconDownload,
  IconListSearch,
  IconStack2,
  IconFile,
  IconServer,
  IconHeartRateMonitor,
  IconClockHour4,
  IconReload,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import {
  PageHeader,
  DataState,
  DocHint,
  KeyValue,
  DefinitionList,
  MiniChart,
} from "../components/ui";
import { DbLogo, hasDbLogo } from "../components/DbLogo";

/** Version de la doc des fiches d'aide (`DocHint`) du dashboard ORM. */
const ORM_DOC = "v1.1";
import {
  useNodefonyAdaptiveChannel,
  useNodefonyAdaptiveChannelData,
} from "nodefony/react";
import {
  buildHealth,
  type HealthInput,
  type HealthResult,
} from "../utils/health";
import {
  normalize,
  type HealthPayload,
  type InstanceHealth,
  type OrmLeanHealth,
} from "../utils/realtimeHealth";

/** Résumé d'un connecteur ORM (data plane /nodefony/orm/api/orms). */
interface OrmSummary {
  name: string;
  vendor?: string;
  default: boolean;
  connected: boolean;
  entityCount: number;
  connection?: {
    driver: string;
    target?: string;
    version?: string;
    ormVersion?: string;
  };
}

/** Relation déclarée entre deux entités (graphe canonique). */
interface EntityRel {
  type: string;
  target: string;
  field: string;
  foreignKey?: string;
}

/** Entité du graphe canonique (/nodefony/orm/api/graph). */
interface EntityNode {
  name: string;
  orm: string;
  module?: string;
  domain?: string;
  columns?: { name: string; type: string }[];
  relations?: EntityRel[];
}

interface OrmGraph {
  orms: OrmSummary[];
  entities: EntityNode[];
}

const VENDOR_LABEL: Record<string, string> = {
  drizzle: "Drizzle",
  sequelize: "Sequelize",
  mongoose: "Mongoose",
  mikroorm: "MikroORM",
};

/** Libellé court d'un type de relation. */
const REL_LABEL: Record<string, string> = {
  "one-to-many": "1-N",
  "many-to-one": "N-1",
  "one-to-one": "1-1",
  "many-to-many": "N-N",
};

/** Formatte un nombre de lignes en compact (1.2k, 3.4M) ; `-1` → « — ». */
function fmtNum(n: number): string {
  if (n < 0) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Agrège un ensemble d'entités : relations (total + par type), domaines
 * (entités + lignes), santé (orphelines, colonnes non introspectées).
 * Pure → mémoïsable côté global ET par onglet ORM.
 */
function analyzeModel(ents: EntityNode[], countMap: Record<string, number>) {
  let relationTotal = 0;
  let orphans = 0;
  let noColumns = 0;
  let rowsTotal = 0;
  const relByType: Record<string, number> = {};
  const entitiesByDomain: Record<string, number> = {};
  const rowsByDomain: Record<string, number> = {};
  for (const e of ents) {
    const rels = e.relations ?? [];
    relationTotal += rels.length;
    if (rels.length === 0) orphans++;
    if (!e.columns || e.columns.length === 0) noColumns++;
    for (const r of rels) relByType[r.type] = (relByType[r.type] ?? 0) + 1;
    const d = e.domain || "(non classé)";
    entitiesByDomain[d] = (entitiesByDomain[d] ?? 0) + 1;
    const c = countMap[e.name];
    if (typeof c === "number" && c > 0) {
      rowsTotal += c;
      rowsByDomain[d] = (rowsByDomain[d] ?? 0) + c;
    }
  }
  return {
    relationTotal,
    orphans,
    noColumns,
    rowsTotal,
    relByType,
    entitiesByDomain,
    rowsByDomain,
    domainCount: Object.keys(entitiesByDomain).length,
  };
}

// Styles « temps réel » — injectés UNE fois (point pulsant + halo de carte).
let livePulseInjected = false;
function ensureLivePulseStyle(): void {
  if (livePulseInjected || typeof document === "undefined") return;
  livePulseInjected = true;
  const el = document.createElement("style");
  el.setAttribute("data-nf-orm-live", "");
  el.textContent = `
@keyframes nf-live-pulse{0%{box-shadow:0 0 0 0 rgba(18,184,134,.5)}70%{box-shadow:0 0 0 5px rgba(18,184,134,0)}100%{box-shadow:0 0 0 0 rgba(18,184,134,0)}}
.nf-live-dot{width:8px;height:8px;border-radius:50%;background:var(--mantine-color-teal-6);animation:nf-live-pulse 1.6s ease-out infinite;flex:0 0 auto}
@keyframes nf-live-glow{0%,100%{box-shadow:0 0 0 0 rgba(18,184,134,0)}50%{box-shadow:0 0 0 3px rgba(18,184,134,.16)}}
.nf-live-card{animation:nf-live-glow 2.4s ease-in-out infinite}
@keyframes nf-flash{0%{background:rgba(18,184,134,.32)}100%{background:transparent}}
.nf-flash{animation:nf-flash .9s ease-out;border-radius:4px}
`;
  document.head.appendChild(el);
}

/** Lecture localStorage tolérante (navigation privée / quota). */
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
/** Écriture localStorage tolérante. */
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Une ligne de classement (barre proportionnelle). */
interface RankItem {
  key: string;
  label: string;
  value: number;
  href?: string;
}

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
      {items.map((it) => (
        <div key={it.key}>
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
            <Text size="xs" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>
              {fmtNum(it.value)}
            </Text>
          </Group>
          <Progress
            value={it.value < 0 ? 0 : (it.value / max) * 100}
            color={color}
            size="sm"
            radius="sm"
          />
        </div>
      ))}
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

/** Erreur de connexion (data plane connection/health). */
interface ConnError {
  message: string;
  ts: number;
}

/** Diagnostic d'un connecteur (/nodefony/orm/api/connection/health). */
interface ConnHealth {
  instanceId: string;
  name: string;
  vendor: string;
  driver: string;
  target?: string;
  version?: string;
  ormVersion?: string;
  connected: boolean;
  connectedSince: number | null;
  uptimeMs: number | null;
  connectCount: number;
  reconnectCount: number;
  errorCount: number;
  lastError: ConnError | null;
  recentErrors: ConnError[];
  lastConnectMs: number | null;
  pingMs: number | null;
  pingOk: boolean;
  pingError: string | null;
  latency: {
    last: number | null;
    min: number | null;
    avg: number | null;
    max: number | null;
    samples: number;
  };
  storage?: {
    sizeBytes?: number;
    pages?: number;
    pageSize?: number;
    journalMode?: string;
    freePages?: number;
  };
  pool?: {
    size?: number;
    available?: number;
    borrowed?: number;
    pending?: number;
  };
  extra?: Record<string, string | number | boolean>;
}

/** Latence en ms → texte lisible (`0.15 ms`, `2.6 ms`, `1.20 s`). */
function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Durée en ms → `12s` / `5m 3s` / `2h 10m` / `3j 4h`. */
function fmtDuration(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}j ${h % 24}h`;
}

/** Horodatage epoch ms → heure locale. */
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/** Octets → texte lisible (o / Ko / Mo / Go). */
function fmtBytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

/**
 * Abonné à la SOCKET Nodefony, canal `orm:health` — monté UNIQUEMENT quand « Temps
 * réel » est ON (abonnement ref-compté → démonter désabonne → le serveur arrête le
 * ticker, 0 travail quand OFF). Pousse le dernier paquet à `onData`.
 *
 * Cadence : **fixe** (granularité choisie) OU **adaptative (AIMD)** si `adaptive`.
 * En adaptatif, la lib mesure la gigue d'arrivée et ré-abonne le canal à une cadence
 * plus grossière sous famine puis plus fine quand c'est sain (cf `adaptiveChannel`).
 * `enabled:false` ⇒ simple abonnement à `intervalMs` ; `onRate` remonte la cadence réelle.
 */
function OrmHealthLive({
  intervalMs,
  adaptive,
  onData,
  onRate,
}: {
  intervalMs: number;
  adaptive: boolean;
  onData: (h: ConnHealth[]) => void;
  /** Remonte la cadence RÉELLE (ms) appliquée par l'AIMD → badge feedback. */
  onRate?: (ms: number) => void;
}) {
  const { data, intervalMs: effectiveMs } = useNodefonyAdaptiveChannelData<
    ConnHealth[]
  >("orm:health", intervalMs, {
    defaultMs: 5000,
    enabled: adaptive,
  });
  useEffect(() => {
    if (Array.isArray(data)) onData(data);
    // onData = setState (stable) → hors deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    onRate?.(effectiveMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMs]);
  return null;
}

/** Flux d'un connecteur (canal `orm:flow` / `GET /orm/api/flow`) — sous-ensemble consommé. */
interface FlowConn {
  connector: string;
  total: number;
  ewmaMs: number | null;
}
interface FlowReport {
  ts: number;
  connectors: FlowConn[];
}
/** Vue flux par connecteur (débit instantané + latence EWMA + historique sparkline). */
export interface ConnFlow {
  rate: number;
  ewmaMs: number | null;
  hist: number[];
}
const FLOW_HISTORY = 40;

/**
 * Abonné à la SOCKET, canal `orm:flow` — **même mécanique adaptative** qu'`OrmHealthLive`
 * (suit le réglage global AIMD). Dérive le débit/s du delta de `total` entre 2 frames et
 * pousse une vue par connecteur (rate + EWMA + historique) → sparkline `MiniChart`.
 */
function OrmFlowLive({
  intervalMs,
  adaptive,
  onFlow,
}: {
  intervalMs: number;
  adaptive: boolean;
  onFlow: (payload: unknown) => void;
}) {
  useNodefonyAdaptiveChannel("orm:flow", onFlow, intervalMs, {
    defaultMs: 2000,
    enabled: adaptive,
  });
  return null;
}

/**
 * Abonné à la SOCKET Nodefony, canal `realtime:health` — sonde LEAN pod (cumuls
 * `IOrmLeanHealth` + erreurs) **agrégée par le master en cluster** (donc cohérente,
 * ≠ `/orm/api/*` qui tape 1 worker au hasard). Sert la **détection cluster** + le
 * **verdict Santé ORM** + le breakdown par worker. Monté seulement quand « Temps
 * réel » est ON (ref-compté → 0 ticker serveur OFF) ; suit l'AIMD global.
 */
function RealtimeHealthLive({
  intervalMs,
  adaptive,
  onData,
}: {
  intervalMs: number;
  adaptive: boolean;
  onData: (h: HealthPayload) => void;
}) {
  const { data } = useNodefonyAdaptiveChannelData<HealthPayload>(
    "realtime:health",
    intervalMs,
    { defaultMs: 5000, enabled: adaptive },
  );
  useEffect(() => {
    if (data) onData(data);
    // onData = setState (stable) → hors deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return null;
}

/** Taux ORM dérivés (delta des cumuls / temps) — `null` tant qu'un seul snapshot. */
interface OrmRate {
  /** Erreurs ORM par minute (delta `errorTotal`). */
  errPerMin: number | null;
  /** Reconnexions par minute (delta `reconnectTotal`). */
  reconPerMin: number | null;
}

/**
 * Signaux « Santé ORM » d'UN worker → entrées {@link buildHealth} (méthode
 * Derringer-Suich, MÊME brique que la santé du framework). Choix figés (kit) :
 * - **Erreurs/reconnexions = TAUX** (delta/min), JAMAIS le cumul (sinon un vieux
 *   pod paraît malade) → exclus tant qu'on n'a pas 2 snapshots (`value:null`).
 * - **Connecteurs déconnectés + erreurs = PANNE** (`critical` : tirent l'indice à 0).
 * - **Latence EWMA + part de requêtes lentes + reconnexions = SATURATION** (planché
 *   « Dégradé » : ralentit mais sert toujours, jamais « Critique » seul).
 * - La part de requêtes lentes est un **ratio de vie** (slow/total), borné → pas de delta.
 */
function ormHealthInputs(orm: OrmLeanHealth, rate: OrmRate): HealthInput[] {
  const inputs: HealthInput[] = [];
  // Connecteurs coupés = panne (tous coupés → 0 = Critique).
  inputs.push({
    label: "Connecteurs",
    value: orm.connectors > 0 ? orm.connectors - orm.connected : null,
    good: 0,
    crit: Math.max(1, orm.connectors),
    weight: 1.5,
    critical: true,
  });
  // Taux d'erreurs ORM (delta/min) = panne.
  if (rate.errPerMin != null) {
    inputs.push({
      label: "Erreurs",
      value: rate.errPerMin,
      good: 0,
      crit: 30,
      weight: 1.2,
      critical: true,
    });
  }
  // Part de requêtes lentes (ratio de vie) = saturation.
  if (orm.queryTotal > 0) {
    inputs.push({
      label: "Requêtes lentes",
      value: orm.slowTotal / orm.queryTotal,
      good: 0.01,
      crit: 0.25,
      weight: 1,
      floor: 0.3,
    });
  }
  // Latence EWMA (pire connecteur) = saturation. Se lit à l'aune de l'event-loop lag.
  if (orm.maxEwmaMs != null) {
    inputs.push({
      label: "Latence",
      value: orm.maxEwmaMs,
      good: 20,
      crit: 500,
      weight: 1,
      floor: 0.2,
    });
  }
  // Taux de reconnexions (delta/min) = instabilité (saturation).
  if (rate.reconPerMin != null) {
    inputs.push({
      label: "Reconnexions",
      value: rate.reconPerMin,
      good: 0,
      crit: 6,
      weight: 0.8,
      floor: 0.2,
    });
  }
  return inputs;
}

/** Type de stockage déduit (icône + libellé + couleur). */
function storageOf(driver: string, target?: string) {
  if (target === ":memory:")
    return {
      label: "En mémoire (volatile)",
      icon: <IconBolt size={14} />,
      color: "grape" as const,
    };
  if (driver === "sqlite" && target)
    return {
      label: "Fichier local",
      icon: <IconFile size={14} />,
      color: "blue" as const,
    };
  return {
    label: "Serveur",
    icon: <IconServer size={14} />,
    color: "teal" as const,
  };
}

/** Mini-statistique encadrée — icône + label + bulle ⓘ + valeur colorée. */
function MiniStat({
  icon,
  label,
  value,
  hint,
  info,
  color,
  flashKey,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  info?: React.ReactNode;
  color?: MantineColor;
  /** Si fourni, la valeur FLASHE quand cette clé change (live = « ce qui bouge »). */
  flashKey?: string | number;
}) {
  return (
    <Card withBorder radius="sm" p="sm">
      <Group gap={6} wrap="nowrap" mb={4} c="dimmed">
        {icon}
        <Text size="xs">{label}</Text>
        {info ??
          (hint ? (
            <DocHint title={label} version={ORM_DOC} summary={hint} />
          ) : null)}
      </Group>
      <Text fw={700} size="lg" c={color}>
        {flashKey !== undefined ? (
          <span key={String(flashKey)} className="nf-flash">
            {value}
          </span>
        ) : (
          value
        )}
      </Text>
    </Card>
  );
}

/**
 * **KpiCard** — carte de tête riche : label + ⓘ, grande valeur, **pied de carte**
 * (sous-métriques live), accent coloré, et **clic → onglet** (intégration au
 * dashboard). Bordure accent quand l'onglet cible est actif.
 */
function KpiCard({
  icon,
  label,
  hint,
  info,
  value,
  accent = "brand",
  footer,
  onClick,
  active,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  info?: React.ReactNode;
  value: React.ReactNode;
  accent?: MantineColor;
  footer?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  /** Halo CSS pulsant — signale que cette carte est rafraîchie en temps réel. */
  pulse?: boolean;
}) {
  return (
    <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
      <Card
        withBorder
        radius="md"
        p="md"
        h="100%"
        className={pulse ? "nf-live-card" : undefined}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-pressed={onClick ? active : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        style={{
          cursor: onClick ? "pointer" : undefined,
          borderColor: active
            ? `var(--mantine-color-${accent}-filled)`
            : undefined,
          transition: "border-color 120ms ease",
        }}
      >
        <Group justify="space-between" wrap="nowrap" mb={8} align="flex-start">
          <Group gap={6} wrap="nowrap" c="dimmed" style={{ minWidth: 0 }}>
            <Text
              size="xs"
              fw={600}
              tt="uppercase"
              style={{ letterSpacing: 0.3 }}
              truncate
            >
              {label}
            </Text>
            {info ??
              (hint ? (
                <DocHint title={label} version={ORM_DOC} summary={hint} />
              ) : null)}
          </Group>
          <ThemeIcon variant="light" color={accent} size={34} radius="md">
            {icon}
          </ThemeIcon>
        </Group>
        <Text fw={700} style={{ fontSize: 30, lineHeight: 1.05 }}>
          {value}
        </Text>
        {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
      </Card>
    </Grid.Col>
  );
}

/**
 * **ConnectorCard** — vue COMPLÈTE d'un connecteur en onglets (place limitée) :
 *  - **Diagnostic** : état live, ping/latence, erreurs, reconnexions, uptime
 *    (data plane `connection/health`, **per-instance** cloud-native).
 *  - **Connexion** : config figée (vendor, driver, versions, emplacement).
 *  - **Modèle** : entités/relations/domaines/lignes de ce connecteur.
 *  - **Entités** : liste triée par volume, vers le détail.
 *
 * Toutes les métriques portent une bulle ⓘ explicative (exigence UX).
 */
function ConnectorCard({
  orm,
  entities,
  countMap,
  health,
  flow,
}: {
  orm: OrmSummary;
  entities: EntityNode[];
  countMap: Record<string, number>;
  health?: ConnHealth;
  flow?: ConnFlow;
}) {
  const driver = orm.connection?.driver ?? health?.driver ?? "";
  const target = orm.connection?.target ?? health?.target;
  const version = orm.connection?.version ?? health?.version;
  const ormVersion = orm.connection?.ormVersion ?? health?.ormVersion;
  const vendorLabel = VENDOR_LABEL[orm.vendor ?? ""] ?? orm.vendor ?? "—";
  const storage = storageOf(driver, target);

  // Modèle propre à ce connecteur (dérivé du graphe + counts).
  const own = useMemo(() => {
    const ents = entities.filter((e) => e.orm === orm.name);
    let relations = 0;
    let rows = 0;
    const domains = new Set<string>();
    const rowList = ents
      .map((e) => {
        relations += e.relations?.length ?? 0;
        domains.add(e.domain || "(non classé)");
        const c = countMap[e.name];
        if (typeof c === "number" && c > 0) rows += c;
        return { name: e.name, domain: e.domain || "—", rows: c ?? -1 };
      })
      .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
    return {
      count: ents.length,
      relations,
      rows,
      domainCount: domains.size,
      rowList,
    };
  }, [entities, countMap, orm.name]);

  const errs = health?.recentErrors ?? [];

  return (
    <Card withBorder radius="md" p="lg">
      {/* En-tête : identité + état live */}
      <Group justify="space-between" wrap="nowrap" mb="md">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size={46} radius="md" variant="default">
            {hasDbLogo(driver) ? (
              <DbLogo name={driver} size={28} title={driver} />
            ) : (
              <IconDatabase size={26} />
            )}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={700} truncate>
                {orm.name}
              </Text>
              {orm.default && (
                <Badge size="xs" variant="light" color="brand">
                  défaut
                </Badge>
              )}
            </Group>
            <Group gap={5} wrap="nowrap" style={{ minWidth: 0 }}>
              {hasDbLogo(orm.vendor) && (
                <DbLogo name={orm.vendor} size={13} title={vendorLabel} />
              )}
              <Text size="xs" c="dimmed" truncate>
                {vendorLabel}
                {ormVersion ? ` ${ormVersion}` : ""}
                {driver ? ` · ${driver}` : ""}
              </Text>
            </Group>
          </div>
        </Group>
        <Badge
          variant="light"
          color={orm.connected ? "teal" : "gray"}
          leftSection={
            orm.connected ? (
              <IconPlugConnected size={13} />
            ) : (
              <IconPlugX size={13} />
            )
          }
        >
          {orm.connected ? "connecté" : "déconnecté"}
        </Badge>
      </Group>

      <Tabs defaultValue="diagnostic" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab
            value="diagnostic"
            leftSection={<IconHeartRateMonitor size={14} />}
          >
            Diagnostic
          </Tabs.Tab>
          <Tabs.Tab
            value="connexion"
            leftSection={<IconPlugConnected size={14} />}
          >
            Connexion
          </Tabs.Tab>
          <Tabs.Tab value="modele" leftSection={<IconAffiliate size={14} />}>
            Modèle
          </Tabs.Tab>
          <Tabs.Tab value="entites" leftSection={<IconTable size={14} />}>
            Entités
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Diagnostic ── */}
        <Tabs.Panel value="diagnostic">
          <Group gap="xs" wrap="nowrap" mb="sm">
            <Badge
              size="sm"
              variant="light"
              color={
                health
                  ? health.pingOk
                    ? "teal"
                    : "red"
                  : orm.connected
                    ? "gray"
                    : "red"
              }
              leftSection={<IconBolt size={12} />}
            >
              {health ? (
                <span key={String(health.pingMs)} className="nf-flash">
                  {health.pingOk
                    ? `ping ${fmtMs(health.pingMs)}`
                    : "ping échec"}
                </span>
              ) : (
                "ping —"
              )}
            </Badge>
            {health && (
              <Badge
                size="sm"
                variant="default"
                leftSection={<IconServer size={12} />}
              >
                instance {health.instanceId}
              </Badge>
            )}
            <DocHint
              title="Diagnostic per-instance"
              version={ORM_DOC}
              summary="Chaque process/pod a son propre pool de connexions, donc ses propres métriques (cloud-native)."
              sections={[
                {
                  label: "Temps réel",
                  body: "Données poussées en direct par la Socket Nodefony (switch « Temps réel »).",
                },
                {
                  label: "Multi-pod",
                  body: "La vue agrégée relève de l'observabilité externe (Prometheus) ou du fan-out Redis cross-pod (P13).",
                },
              ]}
            />
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
            <MiniStat
              icon={<IconBolt size={16} />}
              label="Latence ping"
              value={fmtMs(health?.pingMs ?? null)}
              color={health?.pingOk ? "teal" : undefined}
              flashKey={health?.pingMs ?? "—"}
              hint="Round-trip RÉEL vers la base (SQL `SELECT 1` / Mongo `ping`), mesuré à chaque push temps réel et au bouton « Tester »."
            />
            <MiniStat
              icon={<IconClockHour4 size={16} />}
              label="Uptime"
              value={fmtDuration(health?.uptimeMs ?? null)}
              hint="Temps écoulé depuis la dernière connexion réussie de ce process."
            />
            <MiniStat
              icon={<IconPlugConnected size={16} />}
              label="Connexions"
              value={health?.connectCount ?? "—"}
              hint="Nombre de connexions réussies depuis le démarrage du process (1 = boot normal)."
            />
            <MiniStat
              icon={<IconReload size={16} />}
              label="Reconnexions"
              value={health?.reconnectCount ?? "—"}
              color={health && health.reconnectCount > 0 ? "orange" : undefined}
              hint="Connexions au-delà de la première = rétablissements après une coupure. > 0 signale une connexion instable (per-instance)."
            />
            <MiniStat
              icon={<IconAlertTriangle size={16} />}
              label="Erreurs"
              value={health?.errorCount ?? "—"}
              color={health && health.errorCount > 0 ? "red" : undefined}
              hint="Erreurs de connexion + pings en échec cumulés sur ce process. > 0 = la base a refusé/coupé au moins une fois."
            />
            <MiniStat
              icon={<IconClockHour4 size={16} />}
              label="Latence connexion"
              value={fmtMs(health?.lastConnectMs ?? null)}
              hint="Durée d'établissement de la dernière connexion (handshake + pool). Élevée = base lente à répondre au boot."
            />
          </SimpleGrid>

          {flow && (
            <>
              <Divider
                my="sm"
                label={
                  <Group gap={5}>
                    Flux requêtes (live)
                    <DocHint
                      title="Flux SQL du connecteur"
                      version={ORM_DOC}
                      summary="Débit SQL de ce connecteur (requêtes/s) + latence moyenne lissée (EWMA)."
                      sections={[
                        {
                          label: "Technique",
                          body: "Débit dérivé du delta entre 2 mesures ; latence lissée en EWMA. Le petit graphe = historique du débit.",
                        },
                        {
                          label: "Source",
                          body: "Canal orm:flow, cadence suivant le réglage temps réel.",
                        },
                      ]}
                    />
                  </Group>
                }
                labelPosition="left"
              />
              <Group
                justify="space-between"
                align="flex-end"
                wrap="nowrap"
                gap="md"
              >
                <Group gap="lg" wrap="nowrap">
                  <div>
                    <Text size="xs" c="dimmed">
                      Débit
                    </Text>
                    <Text
                      fw={700}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {flow.rate.toFixed(flow.rate < 10 ? 1 : 0)}{" "}
                      <Text span size="xs" c="dimmed">
                        req/s
                      </Text>
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Latence ⌀ (EWMA)
                    </Text>
                    <Text
                      fw={700}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtMs(flow.ewmaMs)}
                    </Text>
                  </div>
                </Group>
                {flow.hist.length > 1 && (
                  <div style={{ flex: 1, minWidth: 0, maxWidth: 240 }}>
                    <MiniChart
                      series={[
                        {
                          data: flow.hist,
                          color: "var(--mantine-color-grape-5)",
                          label: "req/s",
                        },
                      ]}
                      height={46}
                    />
                  </div>
                )}
              </Group>
            </>
          )}

          {health &&
            (health.latency.samples > 0 || health.storage || health.pool) && (
              <>
                <Divider my="sm" label="Sondes" labelPosition="left" />
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                  {health.latency.samples > 0 && (
                    <MiniStat
                      icon={<IconBolt size={16} />}
                      label="Latence min/⌀/max"
                      value={`${fmtMs(health.latency.min)} / ${fmtMs(
                        health.latency.avg,
                      )} / ${fmtMs(health.latency.max)}`}
                      flashKey={health.latency.last ?? "—"}
                      hint={`Fenêtre glissante sur ${health.latency.samples} ping(s) — révèle les pics, pas qu'un instantané.`}
                    />
                  )}
                  {health.storage && (
                    <>
                      <MiniStat
                        icon={<IconDatabase size={16} />}
                        label="Taille base"
                        value={fmtBytes(health.storage.sizeBytes)}
                        flashKey={health.storage.sizeBytes ?? "—"}
                        hint={`${health.storage.pages ?? "—"} pages × ${
                          health.storage.pageSize ?? "—"
                        } o. Croissance visible en direct.`}
                      />
                      <MiniStat
                        icon={<IconActivity size={16} />}
                        label="Journal"
                        value={health.storage.journalMode ?? "—"}
                        hint="Mode de journalisation SQLite (`wal` = lectures concurrentes pendant l'écriture ; `delete` = défaut)."
                      />
                      <MiniStat
                        icon={<IconAlertTriangle size={16} />}
                        label="Pages libres"
                        value={health.storage.freePages ?? "—"}
                        color={
                          (health.storage.freePages ?? 0) > 1000
                            ? "orange"
                            : undefined
                        }
                        hint="Pages libérées non récupérées (fragmentation). Élevé → un `VACUUM` récupérerait de l'espace."
                      />
                    </>
                  )}
                  {health.pool && (
                    <MiniStat
                      icon={<IconServer size={16} />}
                      label="Pool (actives/dispo)"
                      value={`${health.pool.borrowed ?? "—"} / ${
                        health.pool.available ?? "—"
                      }`}
                      hint="Connexions en cours d'utilisation / disponibles (bases serveur)."
                    />
                  )}
                </SimpleGrid>
              </>
            )}

          <Divider
            my="sm"
            label={`Erreurs récentes${errs.length ? ` (${errs.length})` : ""}`}
            labelPosition="left"
          />
          {errs.length === 0 ? (
            <Group gap={6} c="teal">
              <IconCircleCheck size={16} />
              <Text size="sm">Aucune erreur de connexion enregistrée.</Text>
            </Group>
          ) : (
            <ScrollArea.Autosize mah={150} type="auto">
              <Stack gap={6}>
                {errs.map((e, i) => (
                  <Group
                    key={`${e.ts}-${i}`}
                    gap="xs"
                    wrap="nowrap"
                    align="flex-start"
                  >
                    <Text
                      size="xs"
                      c="dimmed"
                      ff="monospace"
                      style={{ flexShrink: 0 }}
                    >
                      {fmtClock(e.ts)}
                    </Text>
                    <Text size="xs" c="red" style={{ wordBreak: "break-word" }}>
                      {e.message}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
          {health?.pingError && (
            <Text size="xs" c="red" mt="xs">
              Dernier ping : {health.pingError}
            </Text>
          )}
        </Tabs.Panel>

        {/* ── Connexion ── */}
        <Tabs.Panel value="connexion">
          <DefinitionList>
            <KeyValue
              k="Vendor ORM"
              v={`${vendorLabel}${ormVersion ? ` ${ormVersion}` : ""}`}
            />
            <KeyValue k="Base / driver" v={driver || "—"} mono />
            <KeyValue k="Version base" v={version ?? "—"} mono />
            <KeyValue
              k="Connecteur"
              v={`${orm.name}${orm.default ? " (défaut)" : ""}`}
              mono
            />
          </DefinitionList>
          <Group gap="xs" mt="sm" align="center">
            <Badge
              variant="light"
              color={storage.color}
              leftSection={storage.icon}
            >
              {storage.label}
            </Badge>
            <DocHint
              title="Emplacement"
              version={ORM_DOC}
              summary="Emplacement physique de la base de données."
              sections={[
                {
                  label: "Sécurité",
                  body: "Chemin TOUJOURS relatif à la racine du projet — jamais d'absolu ni de credential exposé dans le data plane.",
                },
              ]}
            />
          </Group>
          {target && target !== ":memory:" && (
            <Code
              block
              mt="xs"
              style={{ fontSize: 11, wordBreak: "break-all" }}
              title={target}
            >
              {target}
            </Code>
          )}
        </Tabs.Panel>

        {/* ── Modèle ── */}
        <Tabs.Panel value="modele">
          <SimpleGrid cols={2} spacing="sm">
            <MiniStat
              icon={<IconTable size={16} />}
              label="Entités"
              value={own.count}
              hint="Entités mappées sur ce connecteur."
            />
            <MiniStat
              icon={<IconAffiliate size={16} />}
              label="Relations"
              value={own.relations}
              hint="Relations déclarées entre entités de ce connecteur."
            />
            <MiniStat
              icon={<IconCategory size={16} />}
              label="Domaines"
              value={own.domainCount}
              hint="Domaines fonctionnels distincts couverts."
            />
            <MiniStat
              icon={<IconChartBar size={16} />}
              label="Lignes"
              value={fmtNum(own.rows)}
              hint="Total des lignes en base pour ce connecteur (COUNT(*))."
            />
          </SimpleGrid>
          <Button
            component={Link}
            to="/nodefony/databases"
            variant="subtle"
            size="xs"
            mt="md"
            fullWidth
            leftSection={<IconAffiliate size={14} />}
          >
            Voir le schéma ERD
          </Button>
        </Tabs.Panel>

        {/* ── Entités ── */}
        <Tabs.Panel value="entites">
          {own.rowList.length === 0 ? (
            <Text size="sm" c="dimmed">
              Aucune entité sur ce connecteur.
            </Text>
          ) : (
            <ScrollArea h={300} type="auto" offsetScrollbars="y">
              <Table stickyHeader highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Entité</Table.Th>
                    <Table.Th>Domaine</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Lignes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {own.rowList.map((e) => (
                    <Table.Tr key={e.name}>
                      <Table.Td>
                        <Anchor
                          component={Link}
                          to={`/nodefony/orm-entity?name=${encodeURIComponent(
                            e.name,
                          )}&orm=${encodeURIComponent(orm.name)}`}
                          size="xs"
                        >
                          {e.name}
                        </Anchor>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {e.domain}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="xs" ff="monospace">
                          {fmtNum(e.rows)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Tabs.Panel>
      </Tabs>
    </Card>
  );
}

/**
 * Breakdown ORM LEAN **par worker** (cluster uniquement) — table compacte alimentée
 * par la sonde pod `realtime:health.instances[].orm` (agrégée par le master → cohérente,
 * ≠ `/orm/api/*` qui tombe sur 1 worker au hasard). Verdict par worker (même brique
 * {@link buildHealth}) + lien vers la « salle des machines » `/nodefony/cluster`. Le
 * détail process+socket complet d'un worker vit sur la page Cluster (non dupliqué ici).
 */
function ClusterOrmStrip({
  workers,
  ratesByPid,
}: {
  workers: InstanceHealth[];
  ratesByPid: Map<string, OrmRate>;
}) {
  // Liste typée (worker + sonde ORM non-null) sans assertion `!`.
  const rows = workers.flatMap((w) => (w.orm ? [{ w, o: w.orm }] : []));
  if (!rows.length) return null;
  return (
    <Card withBorder radius="md" p="md" mb="md">
      <Group justify="space-between" wrap="nowrap" mb="sm">
        <Group gap="xs" wrap="nowrap">
          <IconServer size={18} />
          <Text fw={600}>ORM par worker</Text>
          <Badge variant="light" color="grape" size="sm">
            {rows.length} worker(s)
          </Badge>
          <DocHint
            title="ORM par worker"
            version={ORM_DOC}
            summary="Sonde ORM lean de CHAQUE worker du pod (cumuls par process), agrégée par le master → vue cohérente."
            sections={[
              {
                label: "Pourquoi ici",
                body: "Le diagnostic détaillé par connecteur (plus bas) tombe sur 1 worker au hasard (round-robin). Cette table, elle, couvre TOUS les workers.",
              },
            ]}
          />
        </Group>
        <Button
          component={Link}
          to="/nodefony/cluster"
          variant="subtle"
          size="compact-xs"
          leftSection={<IconServer size={14} />}
        >
          Salle des machines
        </Button>
      </Group>
      <ScrollArea.Autosize mah={280} type="auto">
        <Table stickyHeader highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Worker</Table.Th>
              <Table.Th>Santé</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Connect.</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Requêtes</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Lentes</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Erreurs</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>EWMA</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Reconnex.</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ w, o }, i) => {
              const r = buildHealth(
                ormHealthInputs(
                  o,
                  ratesByPid.get(w.instanceId) ?? {
                    errPerMin: null,
                    reconPerMin: null,
                  },
                ),
              );
              return (
                <Table.Tr key={w.instanceId}>
                  <Table.Td>
                    <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                      worker {i + 1}{" "}
                      <Text span c="dimmed" ff="monospace">
                        pid {w.instanceId}
                      </Text>
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={r.color}>
                      {r.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={o.connected < o.connectors ? "orange" : undefined}
                    >
                      {o.connected}/{o.connectors}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text size="xs" ff="monospace">
                      {fmtNum(o.queryTotal)}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={o.slowTotal > 0 ? "orange" : undefined}
                    >
                      {o.slowTotal}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={o.errorTotal > 0 ? "red" : undefined}
                    >
                      {o.errorTotal}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text size="xs" ff="monospace">
                      {o.maxEwmaMs == null ? "—" : fmtMs(o.maxEwmaMs)}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text size="xs" ff="monospace">
                      {o.reconnectTotal}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </Card>
  );
}

/**
 * Dashboard ORM — vue d'ensemble EXPLOITABLE du modèle de données : KPIs
 * (connecteurs, entités, relations, **lignes réelles**), classements live
 * (**top tables par volume** via `COUNT(*)`, **entités & lignes par domaine**),
 * **santé du modèle** (orphelines, colonnes non introspectées, types de relations)
 * et cartes connecteurs. Exporte le modèle (DBML / JSON Schema). Le rendu visuel
 * du modèle (ERD) vit dans `/nodefony/databases`.
 *
 * Data plane `/nodefony/orm/api` : `orms` + `graph` (rapides) ; `counts`
 * (COUNT(*) par entité, plus lent) chargé séparément → la page peint aussitôt,
 * les volumes se remplissent ensuite.
 */
export const OrmOverview = observer(() => {
  const store = useStore();
  const ui = useUi();

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
  // Diagnostic des connexions (per-instance) : état, ping/latence, erreurs,
  // reconnexions. `reload` = re-ping live (bouton « Tester »).
  const health = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<ConnHealth[]>(
          "/nodefony/orm/api/connection/health",
        ),
      [store],
    ),
  );
  // Source effective du diagnostic : push HUB (temps réel) sinon fetch HTTP
  // (1er paint + bouton « Tester »).
  const [liveHealth, setLiveHealth] = useState<ConnHealth[] | null>(null);
  const healthList = useMemo(
    () => liveHealth ?? health.data ?? [],
    [liveHealth, health.data],
  );
  const healthByName = useMemo(() => {
    const m: Record<string, ConnHealth> = {};
    for (const h of healthList) m[h.name] = h;
    return m;
  }, [healthList]);

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
        : entities.filter((e) => e.orm === activeOrm),
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

  // Temps réel : abonnement HUB (push WS) via <OrmHealthLive/>. Le switch
  // monte/démonte l'abonné (ref-compté) → 0 travail serveur quand OFF.
  // Interrupteur GLOBAL partagé (UiStore) — le même sur toutes les pages realtime.
  // OFF au (re)chargement (opt-in par session) → la page démarre statique (1 fetch
  // HTTP). OFF → on relâche `liveHealth`.
  const live = ui.realtimeLive;
  // Granularité (cadence du canal) — préférence persistée, défaut 5 s. En cadence
  // auto, sert de PLANCHER (cadence la plus rapide souhaitée).
  const [liveMs, setLiveMs] = useState<number>(
    () => Number(lsGet("nf.orm.liveMs")) || 5000,
  );
  // Cadence ADAPTATIVE (AIMD) : politique GLOBALE de la socket, pilotée depuis le Hub
  // (/nodefony/hub). Cette page la SUIT (elle ne la règle pas localement).
  const auto = ui.adaptiveCadence;
  // Cadence réelle appliquée par l'AIMD (lecture seule) → badge feedback sur la page.
  const [effectiveMs, setEffectiveMs] = useState<number>(liveMs);
  // Flux ORM par connecteur (débit/s + latence EWMA + historique sparkline), live-only.
  const [flowByName, setFlowByName] = useState<Record<string, ConnFlow>>({});
  const prevFlowRef = useRef<{
    ts: number;
    totals: Record<string, number>;
  } | null>(null);
  const onFlow = useCallback((payload: unknown) => {
    const r = payload as FlowReport;
    if (!r || !Array.isArray(r.connectors)) return;
    const prev = prevFlowRef.current;
    const dt = prev ? (r.ts - prev.ts) / 1000 : 0;
    setFlowByName((cur) => {
      const next: Record<string, ConnFlow> = { ...cur };
      for (const c of r.connectors) {
        const p = prev?.totals[c.connector];
        const rate =
          p != null && dt > 0
            ? Math.max(0, (c.total - p) / dt)
            : (next[c.connector]?.rate ?? 0);
        const hist = [...(next[c.connector]?.hist ?? []), rate].slice(
          -FLOW_HISTORY,
        );
        next[c.connector] = { rate, ewmaMs: c.ewmaMs, hist };
      }
      return next;
    });
    const totals: Record<string, number> = {};
    for (const c of r.connectors) totals[c.connector] = c.total;
    prevFlowRef.current = { ts: r.ts, totals };
  }, []);
  // ── Sonde LEAN pod (canal `realtime:health`) — cluster-aware ──────────────
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

  // Taux ORM par worker (delta des cumuls entre 2 snapshots pod) — erreurs/min &
  // reconnexions/min. Ref = derniers cumuls vus ; state = taux dérivés (→ rerender).
  const prevOrmRef = useRef<
    Map<string, { ts: number; err: number; recon: number }>
  >(new Map());
  const [ratesByPid, setRatesByPid] = useState<Map<string, OrmRate>>(new Map());
  useEffect(() => {
    if (!normRt) return;
    setRatesByPid((cur) => {
      const next = new Map(cur);
      const seen = new Set<string>();
      for (const inst of normRt.instances) {
        const o = inst.orm;
        if (!o) continue;
        seen.add(inst.instanceId);
        const prev = prevOrmRef.current.get(inst.instanceId);
        const dtMin = prev ? (normRt.ts - prev.ts) / 60000 : 0;
        if (prev && dtMin > 0) {
          next.set(inst.instanceId, {
            errPerMin: Math.max(0, (o.errorTotal - prev.err) / dtMin),
            reconPerMin: Math.max(0, (o.reconnectTotal - prev.recon) / dtMin),
          });
        } else if (!next.has(inst.instanceId)) {
          next.set(inst.instanceId, { errPerMin: null, reconPerMin: null });
        }
        prevOrmRef.current.set(inst.instanceId, {
          ts: normRt.ts,
          err: o.errorTotal,
          recon: o.reconnectTotal,
        });
      }
      // Purge des pid disparus (respawn → l'ancien tombe).
      for (const id of next.keys())
        if (!seen.has(id)) {
          next.delete(id);
          prevOrmRef.current.delete(id);
        }
      return next;
    });
  }, [normRt]);

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
    if (!live) {
      setLiveHealth(null);
      setFlowByName({});
      prevFlowRef.current = null;
      setLiveRt(null);
      setRatesByPid(new Map());
      prevOrmRef.current = new Map();
    }
  }, [live]);
  useEffect(() => lsSet("nf.orm.liveMs", String(liveMs)), [liveMs]);

  // Santé connexions agrégée (per-instance) : latence ⌀, erreurs, reconnexions.
  const connHealth = useMemo(() => {
    let errors = 0;
    let recon = 0;
    let pingSum = 0;
    let pingN = 0;
    for (const h of healthList) {
      errors += h.errorCount;
      recon += h.reconnectCount;
      if (h.pingOk && h.pingMs != null) {
        pingSum += h.pingMs;
        pingN += 1;
      }
    }
    return { errors, recon, avgPing: pingN ? pingSum / pingN : null };
  }, [healthList]);

  // Volume global : plus grosse table + nb de tables peuplées (KPI « Lignes »).
  const volume = useMemo(() => {
    let populated = 0;
    let topName = "";
    let topRows = 0;
    for (const e of entities) {
      const c = countMap[e.name];
      if (typeof c === "number" && c > 0) {
        populated += 1;
        if (c > topRows) {
          topRows = c;
          topName = e.name;
        }
      }
    }
    return { populated, topName, topRows };
  }, [entities, countMap]);

  // Top 12 tables par volume (lignes), liées au détail de l'entité.
  const topEntities = useMemo<RankItem[]>(
    () =>
      scopedEntities
        .map((e) => ({
          key: `${e.orm}:${e.name}`,
          label: e.name,
          value: countMap[e.name] ?? -1,
          href: `/nodefony/orm-entity?name=${encodeURIComponent(
            e.name,
          )}&orm=${encodeURIComponent(e.orm)}`,
        }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [scopedEntities, countMap],
  );

  const topDomainsByEntities = useMemo<RankItem[]>(
    () =>
      Object.entries(agg.entitiesByDomain)
        .map(([k, v]) => ({ key: k, label: k, value: v }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [agg.entitiesByDomain],
  );

  const topDomainsByRows = useMemo<RankItem[]>(
    () =>
      Object.entries(agg.rowsByDomain)
        .map(([k, v]) => ({ key: k, label: k, value: v }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [agg.rowsByDomain],
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

  return (
    <Stack gap="lg">
      <PageHeader
        sticky
        title="Dashboard ORM"
        subtitle={
          isClusterMode
            ? `Cluster — ${workers.length} worker(s) · schéma identique, runtime agrégé`
            : "Connecteurs, modèle de données & volumes réels"
        }
        actions={
          <Group gap="xs">
            {live && <span className="nf-live-dot" aria-hidden />}
            <HoverCard
              width={250}
              shadow="md"
              position="bottom"
              withinPortal
              openDelay={120}
              closeDelay={120}
            >
              <HoverCard.Target>
                <div>
                  <Switch
                    size="sm"
                    checked={live}
                    onChange={(e) =>
                      ui.setRealtimeLive(e.currentTarget.checked)
                    }
                    label="Temps réel"
                    aria-label="abonnement temps réel (socket Nodefony) du diagnostic connexions"
                  />
                </div>
              </HoverCard.Target>
              <HoverCard.Dropdown>
                <Group gap={6} mb={6}>
                  <IconBolt size={14} />
                  <Text size="xs" fw={600}>
                    {auto
                      ? "Cadence désirée (plancher)"
                      : "Granularité du canal"}
                  </Text>
                </Group>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={String(liveMs)}
                  onChange={(v) => setLiveMs(Number(v))}
                  data={[
                    { label: "2 s", value: "2000" },
                    { label: "5 s", value: "5000" },
                    { label: "10 s", value: "10000" },
                    { label: "30 s", value: "30000" },
                  ]}
                />
                <Text size="xs" c="dimmed" mt={6}>
                  {auto
                    ? "Cadence auto (AIMD) ACTIVE — réglée globalement dans le Hub. Cette valeur sert de plancher : la socket part de là et l'ajuste seule selon la charge serveur."
                    : "Cadence des pushes de la socket (sondes ORM). Plus court = plus réactif, mais plus de sondes par seconde côté serveur. (Cadence auto réglable dans le Hub.)"}
                </Text>
              </HoverCard.Dropdown>
            </HoverCard>
            {auto && live ? (
              <Badge
                size="sm"
                variant="light"
                color="grape"
                title="Cadence auto (AIMD) — cadence réelle appliquée. Recule sous charge serveur, remonte quand c'est fluide. Réglage global dans le Hub."
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                auto ~
                {effectiveMs < 1000
                  ? `${effectiveMs}ms`
                  : `${effectiveMs / 1000}s`}
              </Badge>
            ) : null}
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
        }
      />

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
      {live && (
        <RealtimeHealthLive
          intervalMs={liveMs}
          adaptive={auto}
          onData={setLiveRt}
        />
      )}

      <Grid>
        {/* Connecteurs — vendors présents + ratio up. Clic → onglet Connecteurs. */}
        <KpiCard
          label="Connecteurs"
          accent="brand"
          icon={<IconDatabase size={20} />}
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
                    : "1 process : la latence EWMA & la part de requêtes lentes n'apparaissent que si le flux ORM est actif (NODEFONY_ORM_FLOW=1).",
                },
              ]}
            />
          }
          footer={
            <Stack gap={6}>
              <Group gap="xs" wrap="nowrap">
                <Badge
                  size="sm"
                  variant="light"
                  color={(verdict.result?.color ?? "gray") as MantineColor}
                >
                  {verdict.result?.label ?? "—"}
                </Badge>
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
              </Group>
              <Group gap="xs" wrap="nowrap">
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
                {isClusterMode && verdict.worstPid && (
                  <Text size="xs" c="dimmed">
                    pire : pid {verdict.worstPid}
                  </Text>
                )}
                {!isClusterMode && connHealth.avgPing != null && (
                  <Badge
                    size="sm"
                    variant="light"
                    color="teal"
                    leftSection={<IconBolt size={11} />}
                  >
                    ⌀ {fmtMs(connHealth.avgPing)}
                  </Badge>
                )}
                {!isClusterMode && connHealth.errors > 0 && (
                  <Badge
                    size="sm"
                    variant="light"
                    color="red"
                    leftSection={<IconAlertTriangle size={11} />}
                  >
                    {connHealth.errors}
                  </Badge>
                )}
                {!isClusterMode && connHealth.recon > 0 && (
                  <Badge
                    size="sm"
                    variant="light"
                    color="orange"
                    leftSection={<IconReload size={11} />}
                  >
                    {connHealth.recon}
                  </Badge>
                )}
              </Group>
            </Stack>
          }
        />

        {/* Entités — relations + domaines. Clic → onglet Modèle. */}
        <KpiCard
          label="Entités"
          accent="indigo"
          icon={<IconTable size={20} />}
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
          <Tabs.List mb="md">
            <Tabs.Tab
              value="connecteurs"
              leftSection={<IconDatabase size={16} />}
            >
              Connecteurs ({list.length})
            </Tabs.Tab>
            <Tabs.Tab value="modele" leftSection={<IconAffiliate size={16} />}>
              Modèle de données
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="connecteurs">
            {/* Cluster : breakdown ORM lean PAR worker (vue pod cohérente). */}
            {isClusterMode && (
              <ClusterOrmStrip workers={workers} ratesByPid={ratesByPid} />
            )}
            {/* Compartiment Connecteurs */}
            <Card withBorder radius="md" p="md">
              <Group gap="xs" mb="md">
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
                      body: "Un connecteur = une instance ORM (Drizzle, Sequelize, Mongoose…) reliée à une base, enregistrée dans le registre process-wide.",
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
              {isClusterMode && (
                <Alert
                  variant="light"
                  color="blue"
                  icon={<IconInfoCircle size={18} />}
                  mb="md"
                  title="Diagnostic détaillé = 1 worker"
                >
                  En cluster, le diagnostic par connecteur ci-dessous (ping,
                  latence, pool, stockage) provient d'UN worker au hasard (pid
                  indiqué dans chaque carte). Vue pod cohérente → KPI « Santé
                  ORM » + table « ORM par worker » ci-dessus, ou la page
                  Cluster.
                </Alert>
              )}
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
            </Card>
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
                        title="Entités par domaine"
                        icon={<IconCategory size={18} />}
                        hint={`${scopedEntities.length} entité(s) classée(s) sur ${agg.domainCount} domaine(s) · ${scopeLabel}.`}
                        right={
                          <Badge variant="light" color="gray" size="sm">
                            {agg.domainCount}
                          </Badge>
                        }
                      >
                        <RankBars items={topDomainsByEntities} color="indigo" />
                      </Panel>
                    </Grid.Col>

                    <Grid.Col span={{ base: 12, lg: 6 }}>
                      <Panel
                        title="Lignes par domaine"
                        icon={<IconCategory size={18} />}
                        hint={`${fmtNum(agg.rowsTotal)} ligne(s) réparties sur ${Object.keys(agg.rowsByDomain).length} domaine(s) peuplé(s) · ${scopeLabel}.`}
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
                        hint={`${agg.orphans} entité(s) sans relation · ${agg.relationTotal} relation(s) sur ${scopedEntities.length} entité(s) · ${scopeLabel}.`}
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
                            <Text size="sm">
                              Entités orphelines (0 relation)
                            </Text>
                            <Badge
                              variant="light"
                              color={agg.orphans ? "orange" : "teal"}
                            >
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
});

export default OrmOverview;
