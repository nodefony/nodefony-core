/**
 * Helpers **purs** (0 JSX, 0 dépendance React) de la page Log Backplane —
 * couleurs de sévérité, formatage d'horodatage, extraction du message, méta des
 * drivers, normalisation wire. Séparés des composants visuels (`LogVisuals.tsx`)
 * pour être testables et partagés sans tirer de rendu.
 */
import type { MantineColor } from "@mantine/core";
import type { LogRecord, Severity } from "./logsTypes";
import { SEVERITIES } from "./logsTypes";

/** Version de la documentation embarquée (badges des fiches `DocHint`). */
export const LOGS_DOC = "v1.0";

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
  | "memory"
  | "file"
  | "cluster"
  | "search"
  | "generic";

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
      "relus par scan borné. Node-only (LB.2). Activé par config (log.queryDriver: \"file\").",
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
      description: "Driver de destination personnalisé enregistré dans le registry.",
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
 * Normalise un objet wire (snapshot REST ou frame `syslog:stream`) en
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
 * Compte les enregistrements par sévérité (pour les chips compteurs cliquables).
 * Retourne un objet indexé par nom de sévérité connu.
 */
export function countBySeverity(records: LogRecord[]): Record<Severity, number> {
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
