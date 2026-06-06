import type { ReactNode } from "react";
import {
  IconAtom2,
  IconBroadcast,
  IconCircuitResistor,
  IconCloudDataConnection,
  IconDatabase,
  IconDeviceDesktop,
  IconFileText,
  IconPlugConnected,
  IconRoute,
  IconRouter,
  IconSearch,
  IconSend,
  IconServer,
  IconShieldLock,
  IconStack2,
} from "@tabler/icons-react";
import type { LiveNodeData } from "../../components/ui";
import type { NormalizedHealth } from "../../utils/realtimeHealth";
import { mapTwinArchLive } from "./twinArchitecture";
import type { ConnectorRow, KernelInfo } from "./useTwinTopology";

/* ════════════════════════════════════════════════════════════════════════
 * twinSchemas — le MODÈLE de la carte (data-driven) + le REGISTRE des schémas.
 *
 * Un « schéma » = des briques positionnées + des liens + des frontières. La
 * carte (`TwinMap`) en rend N'IMPORTE LEQUEL → forage multi-niveaux :
 *
 *   root  ──(clic bp-realtime)──▶  bp-realtime-detail  (loopback/IPC/Redis/Kafka)
 *         ──(clic bp-logs)─────▶  bp-logs-detail       (stdout/file/Loki/OpenSearch)
 *
 * Deux gestes par brique : CLIC = entrer dans `enter` (sous-schéma) ; ⓘ INFO =
 * ouvrir le dialog (liens + docs). Les nœuds externes (clients, bases, backends
 * d'infra) sont hors frontière ; ils peuvent être surlignés « actif » (config).
 * ════════════════════════════════════════════════════════════════════════ */

export interface Pt {
  x: number;
  y: number;
}

export interface SchemaBrick {
  id: string;
  title: string;
  color: string;
  icon: ReactNode;
  pos: Pt;
  emphasis?: boolean;
  /** Nœud EXTERNE (hors frontière, décoratif, pas de ⓘ). */
  external?: boolean;
  /** Id du sous-schéma ouvert au CLIC (forage). Absent → clic ouvre le dialog. */
  enter?: string;
  /** La brique a une fiche ⓘ (dialog liens/docs). */
  info?: boolean;
}

export interface SchemaLink {
  from: string;
  to: string;
  /** Traverse une frontière de process (tracé pointillé). */
  cross?: boolean;
}

export interface SchemaBoundary {
  y: number;
  label: string;
}

export interface TwinSchema {
  id: string;
  title: string;
  bricks: SchemaBrick[];
  links: SchemaLink[];
  boundaries: SchemaBoundary[];
}

/** Contexte de données pour construire un schéma + sa couche live. */
export interface SchemaCtx {
  info: KernelInfo | null;
  normalized: NormalizedHealth | null;
  activity: number;
  connectors: ConnectorRow[];
}

/** Couleur d'accent d'un connecteur selon son ORM. */
function vendorColor(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v.includes("drizzle")) return "lime";
  if (v.includes("sequelize")) return "blue";
  if (v.includes("mongoose")) return "green";
  return "teal";
}

/* ─── Schéma RACINE : l'architecture runtime ──────────────────────────────── */

/**
 * Schéma racine — câble les CONNECTEURS RÉELS (connus) directement sur la carte
 * (vision directe), sous l'ORM, reliés aux bases. Une brique par connecteur
 * (≤ 5 affichés), forable via ⓘ.
 */
function rootSchema(connectors: ConnectorRow[]): TwinSchema {
  const conns = connectors.slice(0, 4);
  const c = conns.length;
  const connBricks: SchemaBrick[] = conns.map((conn, i) => ({
    id: `conn-${conn.name}`,
    title: conn.name,
    color: vendorColor(conn.vendor),
    icon: <IconDatabase size={18} />,
    pos: { x: c <= 1 ? 24 : 24 + (i - (c - 1) / 2) * 14, y: 72 },
    info: true,
  }));
  const connLinks: SchemaLink[] =
    c === 0
      ? [{ from: "orm", to: "ext-db", cross: true }]
      : conns.flatMap((conn) => [
          { from: "orm", to: `conn-${conn.name}` },
          { from: `conn-${conn.name}`, to: "ext-db", cross: true },
        ]);
  return {
    id: "root",
    title: "Architecture runtime",
    boundaries: [
      { y: 11, label: "Frontière · entrée (clients ↑)" },
      { y: 91, label: "Frontière · sortie (infrastructure ↓)" },
    ],
    bricks: [
      {
        id: "ext-clients",
        title: "Clients · navigateurs",
        color: "gray",
        icon: <IconDeviceDesktop size={16} />,
        pos: { x: 50, y: 5 },
        external: true,
      },
      {
        id: "http",
        title: "Entrée HTTP",
        color: "blue",
        icon: <IconServer size={20} />,
        pos: { x: 35, y: 18 },
        info: true,
        enter: "http-detail",
      },
      {
        id: "ws",
        title: "Entrée WebSocket",
        color: "cyan",
        icon: <IconPlugConnected size={20} />,
        pos: { x: 65, y: 18 },
        info: true,
      },
      {
        id: "kernel",
        title: "Kernel · Pipeline",
        color: "indigo",
        icon: <IconAtom2 size={22} />,
        pos: { x: 50, y: 39 },
        emphasis: true,
        info: true,
        enter: "kernel-detail",
      },
      {
        id: "orm",
        title: "ORM",
        color: "teal",
        icon: <IconDatabase size={20} />,
        pos: { x: 24, y: 56 },
        info: true,
        enter: "orm-view",
      },
      {
        id: "realtime",
        title: "Realtime Hub",
        color: "grape",
        icon: <IconBroadcast size={20} />,
        pos: { x: 72, y: 55 },
        info: true,
        enter: "realtime-view",
      },
      ...connBricks,
      {
        id: "bp-realtime",
        title: "Fond de panier · Realtime",
        color: "orange",
        icon: <IconCircuitResistor size={20} />,
        pos: { x: 56, y: 86 },
        info: true,
        enter: "bp-realtime-detail",
      },
      {
        id: "bp-logs",
        title: "Fond de panier · Logs",
        color: "orange",
        icon: <IconFileText size={20} />,
        pos: { x: 79, y: 86 },
        info: true,
        enter: "bp-logs-detail",
      },
      {
        id: "ext-db",
        title: "Bases de données",
        color: "gray",
        icon: <IconDatabase size={16} />,
        pos: { x: 24, y: 95 },
        external: true,
      },
    ],
    links: [
      { from: "ext-clients", to: "http", cross: true },
      { from: "ext-clients", to: "ws", cross: true },
      { from: "http", to: "kernel" },
      { from: "ws", to: "kernel" },
      { from: "ws", to: "realtime" },
      { from: "kernel", to: "orm" },
      { from: "kernel", to: "realtime" },
      ...connLinks,
      { from: "realtime", to: "bp-realtime" },
      { from: "kernel", to: "bp-logs" },
    ],
  };
}

/* ─── Schémas DÉTAIL : les fonds de panier et leurs backends (par config) ──── */

interface DriverDef {
  id: string;
  label: string;
  icon: ReactNode;
  topo: string;
  /** true = service d'infra EXTÉRIEUR (franchit la frontière du process). */
  external: boolean;
}

// loopback (en mémoire) + IPC (entre workers du même pod) = INTERNES au framework.
// Redis + Kafka = services d'infra EXTÉRIEURS.
const RT_DRIVERS: DriverDef[] = [
  {
    id: "loopback",
    label: "Loopback",
    icon: <IconCircuitResistor size={16} />,
    topo: "en mémoire",
    external: false,
  },
  {
    id: "ipc",
    label: "IPC cluster",
    icon: <IconCloudDataConnection size={16} />,
    topo: "workers du pod",
    external: false,
  },
  {
    id: "redis",
    label: "Redis",
    icon: <IconDatabase size={16} />,
    topo: "N hôtes",
    external: true,
  },
  {
    id: "kafka",
    label: "Kafka",
    icon: <IconStack2 size={16} />,
    topo: "N hôtes · replay",
    external: true,
  },
];

// stdout/console + fichier = LOCAUX (process/disque du pod). Loki + OpenSearch = EXTÉRIEURS.
const LOG_DRIVERS: DriverDef[] = [
  {
    id: "stdout",
    label: "stdout / console",
    icon: <IconFileText size={16} />,
    topo: "process",
    external: false,
  },
  {
    id: "file",
    label: "Fichier",
    icon: <IconFileText size={16} />,
    topo: "disque local",
    external: false,
  },
  {
    id: "loki",
    label: "Loki",
    icon: <IconSearch size={16} />,
    topo: "Grafana",
    external: true,
  },
  {
    id: "opensearch",
    label: "OpenSearch",
    icon: <IconSearch size={16} />,
    topo: "Kibana",
    external: true,
  },
];

/**
 * Détail d'un fond de panier : le hub au centre, ses drivers de part et d'autre
 * de la frontière du process — INTERNES (loopback/IPC, stdout/file) au-dessus
 * (gérés par le framework), EXTÉRIEURS (Redis/Kafka, Loki/OpenSearch) en dessous.
 * Seuls les liens vers l'extérieur franchissent la frontière (`cross`).
 */
function driverDetailSchema(
  id: string,
  title: string,
  hubBrick: SchemaBrick,
  drivers: DriverDef[],
): TwinSchema {
  const bricks: SchemaBrick[] = [
    { ...hubBrick, pos: { x: 50, y: 20 }, enter: undefined },
  ];
  const links: SchemaLink[] = [];
  const place = (list: DriverDef[], y: number, cross: boolean) => {
    const n = list.length;
    list.forEach((d, i) => {
      const x = n <= 1 ? 50 : 18 + (i / (n - 1)) * 64;
      bricks.push({
        id: `drv-${d.id}`,
        title: d.label,
        color: "gray",
        icon: d.icon,
        pos: { x, y },
        external: true,
      });
      links.push({ from: hubBrick.id, to: `drv-${d.id}`, cross });
    });
  };
  place(
    drivers.filter((d) => !d.external),
    47,
    false,
  ); // interne framework (au-dessus)
  place(
    drivers.filter((d) => d.external),
    82,
    true,
  ); // infra externe (en dessous)
  return {
    id,
    title,
    boundaries: [
      { y: 64, label: "Frontière du process · infrastructure externe ↓" },
    ],
    bricks,
    links,
  };
}

/**
 * Détail du KERNEL (brique majeure) — ses sous-systèmes internes : HttpKernel,
 * WebsocketKernel, Container DI, Router/Controllers, Boot/Lifecycle. Tout est
 * INTERNE au process (aucune frontière externe). Le détail de chaque sous-bloc
 * = backlog (« le schéma de toutes les briques, une par une »).
 */
function kernelSchema(): TwinSchema {
  return {
    id: "kernel-detail",
    title: "Kernel · Pipeline",
    boundaries: [],
    bricks: [
      {
        id: "kernel",
        title: "Kernel",
        color: "indigo",
        icon: <IconAtom2 size={22} />,
        pos: { x: 50, y: 18 },
        emphasis: true,
        info: true,
      },
      {
        id: "k-http",
        title: "HttpKernel",
        color: "blue",
        icon: <IconServer size={18} />,
        pos: { x: 22, y: 48 },
      },
      {
        id: "k-ws",
        title: "WebsocketKernel",
        color: "cyan",
        icon: <IconPlugConnected size={18} />,
        pos: { x: 50, y: 48 },
      },
      {
        id: "k-di",
        title: "Container DI",
        color: "grape",
        icon: <IconCircuitResistor size={18} />,
        pos: { x: 78, y: 48 },
      },
      {
        id: "k-router",
        title: "Router · Controllers",
        color: "teal",
        icon: <IconCloudDataConnection size={18} />,
        pos: { x: 33, y: 80 },
      },
      {
        id: "k-boot",
        title: "Boot · Lifecycle",
        color: "orange",
        icon: <IconStack2 size={18} />,
        pos: { x: 67, y: 80 },
      },
    ],
    links: [
      { from: "kernel", to: "k-http" },
      { from: "kernel", to: "k-ws" },
      { from: "kernel", to: "k-di" },
      { from: "k-http", to: "k-router" },
      { from: "k-di", to: "k-boot" },
    ],
  };
}

/**
 * Détail de l'ENTRÉE HTTP — le voyage RÉEL d'une requête dans `HttpKernel`
 * (`handleHttp` / `handleFrontController`), de haut en bas :
 *   Serveurs (http/https/h2) → Contexte (requestId + scope ALS) → Route match
 *   (method+URL, hissé avant le parse) → Parse du body (busboy/JSON, sauté si
 *   `@Body({stream})`) → Firewall (`handleSecurity`) → Controller (resolver →
 *   action) → Réponse.
 * Branche FALLBACK : une route NON trouvée part vers le Static (sert un fichier,
 * sinon 404) puis rejoint la Réponse — static en fallback APRÈS le route-match
 * (≠ static-first → une route ne touche jamais le disque). Tout est INTERNE au
 * process (0 frontière). Live léger : seuls les serveurs pulsent (activité/8s).
 */
function httpSchema(): TwinSchema {
  return {
    id: "http-detail",
    title: "Entrée HTTP",
    boundaries: [],
    bricks: [
      {
        id: "h-servers",
        title: "Serveurs HTTP",
        color: "blue",
        icon: <IconServer size={20} />,
        pos: { x: 42, y: 9 },
        emphasis: true,
      },
      {
        id: "h-context",
        title: "Contexte · requestId",
        color: "blue",
        icon: <IconRoute size={18} />,
        pos: { x: 42, y: 24 },
      },
      {
        id: "h-route",
        title: "Route match",
        color: "teal",
        icon: <IconRouter size={18} />,
        pos: { x: 42, y: 39 },
      },
      {
        id: "h-parse",
        title: "Parse du body",
        color: "grape",
        icon: <IconStack2 size={18} />,
        pos: { x: 30, y: 55 },
      },
      {
        id: "h-firewall",
        title: "Firewall · Sécurité",
        color: "orange",
        icon: <IconShieldLock size={18} />,
        pos: { x: 30, y: 70 },
      },
      {
        id: "h-controller",
        title: "Controller",
        color: "indigo",
        icon: <IconAtom2 size={18} />,
        pos: { x: 30, y: 85 },
      },
      {
        id: "h-static",
        title: "Static · fallback",
        color: "gray",
        icon: <IconFileText size={18} />,
        pos: { x: 75, y: 55 },
      },
      {
        id: "h-response",
        title: "Réponse",
        color: "cyan",
        icon: <IconSend size={18} />,
        pos: { x: 58, y: 92 },
      },
    ],
    links: [
      { from: "h-servers", to: "h-context" },
      { from: "h-context", to: "h-route" },
      { from: "h-route", to: "h-parse" },
      { from: "h-parse", to: "h-firewall" },
      { from: "h-firewall", to: "h-controller" },
      { from: "h-controller", to: "h-response" },
      { from: "h-route", to: "h-static" },
      { from: "h-static", to: "h-response" },
    ],
  };
}

/* ─── Couche LIVE par schéma ───────────────────────────────────────────────── */

/** Surligne le driver ACTIF (config) parmi les backends d'un détail backplane. */
function driverLive(
  activeId: string | undefined,
  ids: string[],
): Record<string, LiveNodeData> {
  const out: Record<string, LiveNodeData> = {};
  for (const id of ids) {
    const active = !!activeId && id.toLowerCase() === activeId.toLowerCase();
    out[`drv-${id}`] = {
      status: active ? "ok" : "idle",
      pulse: active,
      metrics: [
        {
          label: active ? "actif (config)" : "disponible",
          value: active ? "✓" : "—",
        },
      ],
    };
  }
  return out;
}

/**
 * Construit le schéma courant + sa couche live depuis l'id et le contexte.
 * Inconnu → racine (robuste au deep-link).
 */
export function buildSchema(
  schemaId: string,
  ctx: SchemaCtx,
): { schema: TwinSchema; live: Record<string, LiveNodeData> } {
  if (schemaId === "bp-realtime-detail") {
    const hub = rootSchema([]).bricks.find((b) => b.id === "bp-realtime")!;
    const active = ctx.normalized?.instances[0]?.backplane?.driver;
    const schema = driverDetailSchema(
      "bp-realtime-detail",
      "Fond de panier · Realtime",
      hub,
      RT_DRIVERS,
    );
    const live = {
      ...driverLive(
        active,
        RT_DRIVERS.map((d) => d.id),
      ),
      "bp-realtime": {
        status: "ok",
        metrics: [{ label: "driver", value: active ?? "loopback" }],
      } as LiveNodeData,
    };
    return { schema, live };
  }
  if (schemaId === "bp-logs-detail") {
    const hub = rootSchema([]).bricks.find((b) => b.id === "bp-logs")!;
    const active = ctx.info?.backplanes?.log?.driver;
    const schema = driverDetailSchema(
      "bp-logs-detail",
      "Fond de panier · Logs",
      hub,
      LOG_DRIVERS,
    );
    const live = {
      ...driverLive(
        active,
        LOG_DRIVERS.map((d) => d.id),
      ),
      "bp-logs": {
        status: "ok",
        metrics: [{ label: "driver", value: active ?? "—" }],
      } as LiveNodeData,
    };
    return { schema, live };
  }
  if (schemaId === "kernel-detail") {
    return {
      schema: kernelSchema(),
      live: {
        kernel: {
          status: "ok",
          metrics: [
            { label: "modules", value: String(ctx.info?.modules ?? "—") },
          ],
        },
      },
    };
  }
  if (schemaId === "http-detail") {
    const a = ctx.activity;
    return {
      schema: httpSchema(),
      live: {
        "h-servers": {
          status: a > 0 ? "ok" : "idle",
          pulse: a > 0,
          metrics: [{ label: "événements/8s", value: String(a) }],
        },
      },
    };
  }
  // Racine : archi runtime, live = sonde santé + activité logs + connecteurs réels.
  const connLive: Record<string, LiveNodeData> = {};
  for (const conn of ctx.connectors.slice(0, 5)) {
    connLive[`conn-${conn.name}`] = {
      status: conn.connected ? "ok" : "down",
      metrics: [{ label: conn.vendor, value: conn.driver }],
    };
  }
  return {
    schema: rootSchema(ctx.connectors),
    live: {
      ...mapTwinArchLive(ctx.normalized, ctx.info, ctx.activity),
      ...connLive,
    },
  };
}

/** Titre lisible d'un schéma (pour le fil d'Ariane). */
export function schemaTitle(schemaId: string): string {
  if (schemaId === "bp-realtime-detail") return "Fond de panier · Realtime";
  if (schemaId === "bp-logs-detail") return "Fond de panier · Logs";
  if (schemaId === "kernel-detail") return "Kernel · Pipeline";
  if (schemaId === "http-detail") return "Entrée HTTP";
  if (schemaId === "realtime-view") return "Realtime Hub";
  if (schemaId === "orm-view") return "Dashboard ORM";
  return "Architecture runtime";
}
