/**
 * Helpers **purs** (0 JSX, 0 dépendance React) de la page Log Backplane —
 * couleurs de sévérité, formatage d'horodatage, extraction du message, méta des
 * drivers, normalisation wire. Séparés des composants visuels (`LogVisuals.tsx`)
 * pour être testables et partagés sans tirer de rendu.
 */
import type { MantineColor } from "@mantine/core";
import type { BackplaneMeta, LogRecord, Severity } from "./logsTypes";
import { SEVERITIES } from "./logsTypes";

/** Version de la documentation embarquée (badges des fiches `DocHint`). */
export const LOGS_DOC = "v2.0";

/**
 * Couleur Mantine par sévérité RFC 5424. Les 4 sévérités « hautes »
 * (ERROR→EMERGENCY) sont rouges : l'attention va au grave, pas au bruit.
 */
export const SEVERITY_COLOR: Record<string, MantineColor> = {
  DEBUG: "gray",
  INFO: "blue",
  NOTICE: "cyan",
  WARNING: "yellow",
  ERROR: "red",
  CRITIC: "red",
  ALERT: "red",
  EMERGENCY: "red",
};

/** Sévérités considérées « alerte » (ligne surlignée, compteur santé). */
const ALERT_SEVERITIES: ReadonlySet<string> = new Set([
  "ERROR",
  "CRITIC",
  "ALERT",
  "EMERGENCY",
]);

/** Sévérités rendues en badge plein (les plus graves) vs allégé. */
const FILLED_SEVERITIES: ReadonlySet<string> = new Set([
  "CRITIC",
  "ALERT",
  "EMERGENCY",
]);

/** Couleur d'une sévérité (défaut gris si inconnue). */
export function severityColor(name: string): MantineColor {
  return SEVERITY_COLOR[name] ?? "gray";
}

/** Variante de badge : plein pour les sévérités critiques, allégé sinon. */
export function severityVariant(name: string): "filled" | "light" {
  return FILLED_SEVERITIES.has(name) ? "filled" : "light";
}

/** `true` si la sévérité justifie un surlignage de ligne (erreur/critique). */
export function isAlertSeverity(name: string): boolean {
  return ALERT_SEVERITIES.has(name);
}

/**
 * Extrait le texte affichable d'un enregistrement : `payload` string en
 * priorité (cas courant, garde les codes ANSI), sinon `msg`, sinon une
 * sérialisation JSON défensive du payload objet.
 */
export function recordMessage(rec: LogRecord): string {
  if (typeof rec.payload === "string") return rec.payload;
  if (rec.msg) return rec.msg;
  try {
    return JSON.stringify(rec.payload);
  } catch {
    return String(rec.payload);
  }
}

/** `HH:MM:SS` (heure locale). */
export function fmtClock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

/** Millisecondes sur 3 chiffres (`007`) — séparé pour un rendu en `dimmed`. */
export function fmtMillis(ts: number): string {
  return String(new Date(ts).getMilliseconds()).padStart(3, "0");
}

/** Horodatage complet lisible (détail Pdu) : `JJ/MM/AAAA HH:MM:SS.mmm`. */
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString();
  return `${date} ${d.toTimeString().slice(0, 8)}.${fmtMillis(ts)}`;
}

/** Type d'icône d'un driver (mappé vers un composant dans `LogVisuals.tsx`). */
export type DriverIconKind =
  "memory" | "file" | "cluster" | "search" | "generic";

/** Métadonnée d'affichage d'un driver de relecture. */
export interface DriverMeta {
  /** Libellé lisible (≠ nom technique). */
  label: string;
  /** Explication courte du driver (pédagogie de l'UI). */
  description: string;
  /** Icône à afficher. */
  icon: DriverIconKind;
  /** `true` = driver futur (placeholder vision, pas encore branché). */
  upcoming?: boolean;
}

/** Catalogue d'affichage des drivers connus (le registry pilote l'existence réelle). */
const DRIVER_META: Record<string, DriverMeta> = {
  memory: {
    label: "Mémoire (ring buffer)",
    description:
      "Le ring buffer volatile du Syslog EST le stockage : relecture instantanée, " +
      "borné aux N derniers logs, perdu au redémarrage. Driver par défaut en dev.",
    icon: "memory",
  },
  file: {
    label: "Fichier JSONL",
    description:
      "Pdu persistés en JSON Lines sur disque (1 fichier par worker, nodefony-<pid>.jsonl), " +
      'relus par scan borné. Node-only (LB.2). Activé par config (log.queryDriver: "file").',
    icon: "file",
  },
  "cluster-file": {
    label: "Cluster (fichiers agrégés)",
    description:
      "Vue UNIFIÉE du cluster : agrège les nodefony-<pid>.jsonl de TOUS les workers, " +
      "fusionnés par horodatage. C'est LE driver de relecture à utiliser en cluster " +
      "(les autres ne voient que le worker courant). Node-only (LB.5).",
    icon: "cluster",
  },
  loki: {
    label: "Grafana Loki",
    description:
      "Agrégation de logs cloud-native (labels + LogQL), légère (indexe les labels, " +
      "pas un index full-text). Push HTTP batché + relecture LogQL, vue cluster native (LB.4). " +
      'Activer : log.queryDriver="loki" + LOKI_URL (docker --profile loki).',
    icon: "search",
  },
  opensearch: {
    label: "OpenSearch",
    description:
      "Recherche plein-texte distribuée, rétention longue (fork Apache 2.0 d'Elasticsearch — " +
      "OSI, licence non-SSPL). Indexation _bulk + recherche _search (LB.4). " +
      'Activer : log.queryDriver="opensearch" + OPENSEARCH_URL (docker --profile opensearch).',
    icon: "search",
  },
};

/** Méta d'affichage d'un driver (défaut générique si nom inconnu). */
export function driverMeta(name: string): DriverMeta {
  return (
    DRIVER_META[name] ?? {
      label: name,
      description:
        "Driver de destination personnalisé enregistré dans le registry.",
      icon: "generic",
    }
  );
}

/**
 * Drivers connus à présenter en **placeholder grisé** quand ils ne sont pas
 * enregistrés (le registry ne contient que les drivers montés — en prod, seul le
 * driver configuré). TOUS sont implémentés (LB.2/5/4) → activables par config
 * (`log.queryDriver` + URL pour loki/opensearch). Le `driverMeta(name).upcoming`
 * resterait pour un futur driver réellement « à venir ».
 */
export const PLACEHOLDER_DRIVERS: readonly string[] = [
  "file",
  "cluster-file",
  "loki",
  "opensearch",
];

/**
 * Drivers dont la relecture est **cohérente en cluster** (vue de TOUS les
 * workers) : `cluster-file` agrège les fichiers ; `elastic`/`loki` centralisent
 * côté backend. Les autres (`memory`, `file`) ne voient que le worker courant →
 * en cluster, l'UI avertit d'une vue partielle. Source unique de ce verdict.
 */
const CLUSTER_AWARE_DRIVERS: ReadonlySet<string> = new Set([
  "cluster-file",
  "loki",
  "opensearch",
]);

/** `true` si la relecture du driver est unifiée en cluster (pas de vue partielle). */
export function isClusterAware(name: string | null | undefined): boolean {
  return name != null && CLUSTER_AWARE_DRIVERS.has(name);
}

/**
 * Normalise un objet wire (snapshot REST ou frame `nodefony:syslog`) en
 * {@link LogRecord} typé. Défensif : rejette ce qui n'a pas de `severityName`
 * (frame parasite). Source unique de l'hydratation côté front.
 */
export function toRecord(d: unknown): LogRecord | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.severityName !== "string") return null;
  return {
    uid: typeof o.uid === "number" ? o.uid : 0,
    severity: typeof o.severity === "number" ? o.severity : 7,
    severityName: o.severityName,
    moduleName: typeof o.moduleName === "string" ? o.moduleName : "",
    msgid: typeof o.msgid === "string" ? o.msgid : "",
    msg: typeof o.msg === "string" ? o.msg : undefined,
    timeStamp: typeof o.timeStamp === "number" ? o.timeStamp : Date.now(),
    pid: typeof o.pid === "number" ? o.pid : 0,
    payload: o.payload,
    requestId: typeof o.requestId === "string" ? o.requestId : undefined,
  };
}

/**
 * Une **destination d'écriture** du fan-out (axe WRITE). 1 `log()` est copié vers
 * TOUTES les destinations `on` en même temps (≠ la LECTURE = une seule).
 */
export interface WriteDestination {
  id: string;
  /** Libellé lisible. */
  label: string;
  /** Détail : où / comment / pourquoi (ou raison du « non configuré »). */
  detail: string;
  /** `true` = reçoit réellement les écritures (montée / configurée ici). */
  on: boolean;
  /** Famille : ring volatil · sink texte LB.W · transport structuré. */
  kind: "ring" | "sink" | "transport";
  /** Pour les transports : nom de driver (icône / méta). */
  driverName?: string;
  /**
   * `true` = transport `ITransport` togglable à chaud (dev) — un `Switch` peut
   * l'activer/désactiver via `POST backplane/transport`. Faux pour ring/sink et
   * pour les transports jamais montés (ex. `loki` sans URL → exige sa config).
   */
  togglable?: boolean;
  /** Quel mécanisme couper : ring (mémoire), sink (texte) ou un transport. */
  toggleKind?: "ring" | "sink" | "transport";
  /** `ITransport.name` réel (clé du toggle `setTransportEnabled`). */
  transportName?: string;
  /** Ring uniquement : capacité max (plafond `maxStack`). */
  capacity?: number;
  /** Ring uniquement : remplissage courant. */
  used?: number;
}

/**
 * Destinations d'écriture CONNUES à proposer si NON montées (fan-out possible).
 * Volontairement SANS `console` (= le sink stdout `write.sink`, pas un `ITransport`)
 * ni `http` (classe de base interne de Loki/OpenSearch) : ne lister que les vraies
 * destinations « produit » configurables.
 */
const KNOWN_TRANSPORTS = ["file", "loki", "opensearch", "syslog"] as const;

/**
 * Méta d'affichage d'un transport d'écriture (`ITransport.name`). `driverName`
 * (si présent) pointe vers un driver de relecture homonyme (icône / méta).
 */
function transportMeta(
  name: string,
  logDir?: string | null,
): {
  label: string;
  on: string;
  off: string;
  driverName?: string;
} {
  switch (name) {
    case "console":
      return {
        label: "Console (stdout)",
        on: "Logs formatés sur la sortie standard — destination #1 cloud-native (1 pod → stdout → collecteur).",
        off: "Transport console non monté.",
      };
    case "file":
      return {
        label: "Fichier JSONL",
        on: logDir
          ? `Pdu structurés en JSON Lines (1 « nodefony-<pid>.jsonl » par worker) dans ${logDir} — relus par les drivers « fichier » / « cluster ». Liste exacte : onglet Fichiers.`
          : "Pdu structurés en JSON Lines (1 .jsonl par worker), relus par les drivers « fichier » / « cluster ». En prod : logs → collecteur (pas de fichiers).",
        off: "Non activé (log.queryDriver: « file » ou « cluster-file »).",
        driverName: "file",
      };
    case "loki":
      return {
        label: "Grafana Loki",
        on: "Push HTTP batché (streams LogQL) vers Loki.",
        off: "Non configuré (LOKI_URL absent).",
        driverName: "loki",
      };
    case "opensearch":
      return {
        label: "OpenSearch",
        on: "Indexation _bulk batchée vers OpenSearch.",
        off: "Non configuré (OPENSEARCH_URL absent).",
        driverName: "opensearch",
      };
    case "syslog":
      return {
        label: "Syslog (RFC 5424)",
        on: "Émission vers un serveur syslog distant (rsyslog / journald, UDP/TCP).",
        off: "Transport syslog non monté.",
      };
    case "http":
      return {
        label: "HTTP générique",
        on: "POST batché des logs vers un endpoint HTTP custom.",
        off: "Transport HTTP non monté.",
      };
    default:
      return {
        label: name,
        on: "Transport d'écriture personnalisé monté.",
        off: "Transport personnalisé non monté.",
      };
  }
}

/**
 * Dérive le **fan-out d'écriture** depuis la méta backplane — la vérité de « où
 * part chaque log ». L'écriture est un fan-out (1 `log()` → N destinations `on`),
 * orthogonal à la LECTURE (un seul driver).
 *
 *  1. **Mémoire (ring)** — toujours alimenté (le `CircularBuffer` du Syslog).
 *  2. **Sink texte LB.W** — `write.sink` (stdout / fichier .log / null).
 *  3. **Transports `ITransport` montés** — `write.transports` est la **source de
 *     vérité** (les vraies destinations : console, file, loki, opensearch, syslog,
 *     http). On n'infère PLUS depuis les drivers de relecture → les transports
 *     write-only (console/syslog/http) deviennent visibles. Les transports connus
 *     non montés restent listés `on:false` (le fan-out possible).
 *
 * Fallback (`write.transports` absent = dist back périmé) : ancienne inférence
 * depuis les drivers `capabilities.write` (masque console/syslog/http).
 */
export function writeDestinations(meta: BackplaneMeta): WriteDestination[] {
  const sink = meta.write.sink;
  // Sink configuré (≠ null) ET non muté à chaud.
  const sinkConfigured = sink !== "null" && sink !== "none";
  const sinkEnabled = meta.write.sinkEnabled !== false;
  const sinkOn = sinkConfigured && sinkEnabled;
  const ringEnabled = meta.write.ringEnabled !== false;
  const logDir = meta.write.logDir;
  const { buffered, bufferCapacity } = meta.counters;
  // Taille du ring : « X / Y entrées (Z% plein) » si la capacité est connue.
  const ringDetail = bufferCapacity
    ? `Pile tournante (ring buffer) : les ${bufferCapacity} derniers logs gardés en mémoire — ${buffered} / ${bufferCapacity} occupés (${Math.round(
        (buffered / bufferCapacity) * 100,
      )} % plein). Une fois plein, chaque nouveau log écrase le plus ancien (FIFO borné, O(1)). Relu par l'Explorer « mémoire » ; perdu au redémarrage.`
    : "Pile tournante (ring buffer) : les N derniers logs en mémoire ; le plus ancien dégage quand c'est plein. Relu par l'Explorer « mémoire » ; perdu au redémarrage.";
  const dests: WriteDestination[] = [
    {
      id: "ring",
      label: "Mémoire (ring)",
      detail: ringEnabled
        ? ringDetail
        : "Stockage mémoire COUPÉ — l'Explorer « mémoire » est vide. Les compteurs santé restent comptés. Réactiver pour relire en RAM.",
      on: ringEnabled,
      kind: "ring",
      togglable: true,
      toggleKind: "ring",
      // Capacité exposée à l'UI pour un badge « X / Y » dans la tuile.
      capacity: bufferCapacity,
      used: buffered,
    },
    {
      id: "sink",
      label:
        sink === "file"
          ? "Fichier texte (.log)"
          : sink === "stdout"
            ? "stdout (console)"
            : `sink « ${sink} »`,
      detail: !sinkConfigured
        ? "Sink texte désactivé par config (null) — aucune ligne texte écrite (bench)."
        : sinkEnabled
          ? sink === "file"
            ? "La ligne texte de chaque log est ajoutée à un fichier .log."
            : "La ligne texte part sur la sortie standard (console / collecteur)."
          : "Sink texte COUPÉ à chaud — plus aucune ligne en console/fichier. Réactiver pour rétablir.",
      on: sinkOn,
      kind: "sink",
      // Togglable seulement si configuré (sinon c'est un choix de config, pas un toggle).
      togglable: sinkConfigured,
      toggleKind: "sink",
    },
  ];

  const mounted = meta.write.transports;
  if (mounted) {
    const seen = new Set<string>();
    // `togglable` = transport connu du Syslog (monté OU désactivé à chaud) →
    // ré-activable par switch. Les KNOWN jamais montés ne le sont pas (config requise).
    const push = (name: string, on: boolean, togglable: boolean) => {
      if (seen.has(name)) return;
      seen.add(name);
      const m = transportMeta(name, logDir);
      const dest: WriteDestination = {
        id: `transport:${name}`,
        label: m.label,
        detail: on ? m.on : m.off,
        on,
        kind: "transport",
        togglable,
        toggleKind: "transport",
        transportName: name,
      };
      if (m.driverName) dest.driverName = m.driverName;
      dests.push(dest);
    };
    for (const t of mounted) push(t.name, t.enabled, true);
    for (const name of KNOWN_TRANSPORTS) push(name, false, false);
    return dests;
  }

  // Fallback : inférence depuis les drivers de relecture (ancien comportement).
  const writable = new Set(
    meta.drivers.filter((d) => d.capabilities.write).map((d) => d.name),
  );
  const has = (n: string) => writable.has(n);
  dests.push(
    {
      id: "jsonl",
      label: "Fichier JSONL",
      detail:
        has("file") || has("cluster-file")
          ? "Pdu structurés en JSON Lines (1 .jsonl par worker), relus par les drivers « fichier » / « cluster »."
          : "Non activé (log.queryDriver: « file » ou « cluster-file »).",
      on: has("file") || has("cluster-file"),
      kind: "transport",
      driverName: has("cluster-file") ? "cluster-file" : "file",
    },
    {
      id: "loki",
      label: "Grafana Loki",
      detail: has("loki")
        ? "Push HTTP batché (streams LogQL) vers Loki."
        : "Non configuré (LOKI_URL absent).",
      on: has("loki"),
      kind: "transport",
      driverName: "loki",
    },
    {
      id: "opensearch",
      label: "OpenSearch",
      detail: has("opensearch")
        ? "Indexation _bulk batchée vers OpenSearch."
        : "Non configuré (OPENSEARCH_URL absent).",
      on: has("opensearch"),
      kind: "transport",
      driverName: "opensearch",
    },
  );
  return dests;
}

/** État de la connexion temps réel → libellé + couleur (point d'état du bus). */
export function realtimeStateLabel(state: string): {
  label: string;
  color: MantineColor;
  live: boolean;
} {
  switch (state) {
    case "connected":
      return { label: "connecté", color: "teal", live: true };
    case "connecting":
      return { label: "connexion…", color: "yellow", live: false };
    case "reconnecting":
      return { label: "reconnexion…", color: "orange", live: false };
    case "error":
      return { label: "erreur", color: "red", live: false };
    default:
      return { label: "hors ligne", color: "gray", live: false };
  }
}

/**
 * Compte les enregistrements par sévérité (pour les chips compteurs cliquables).
 * Retourne un objet indexé par nom de sévérité connu.
 */
export function countBySeverity(
  records: LogRecord[],
): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
    Severity,
    number
  >;
  for (const r of records) {
    const s = r.severityName as Severity;
    if (s in counts) counts[s] += 1;
  }
  return counts;
}
