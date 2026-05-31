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
export type DriverIconKind = "memory" | "file" | "search" | "generic";

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
      "Pdu persistés en JSON Lines sur disque, relus par scan. Node-only. (LB.2 — à venir)",
    icon: "file",
    upcoming: true,
  },
  elastic: {
    label: "Elasticsearch",
    description:
      "Indexation + recherche plein-texte distribuée, rétention longue. (LB.4 — à venir)",
    icon: "search",
    upcoming: true,
  },
  loki: {
    label: "Grafana Loki",
    description:
      "Agrégation de logs cloud-native (labels + LogQL). (LB.4 — à venir)",
    icon: "search",
    upcoming: true,
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

/** Drivers « vision » à présenter en placeholder s'ils ne sont pas encore enregistrés. */
export const UPCOMING_DRIVERS: readonly string[] = ["file", "elastic", "loki"];

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
