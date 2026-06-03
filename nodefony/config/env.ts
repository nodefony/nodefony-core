/**
 * CATALOGUE des variables d'environnement lues par la CONFIG de l'application.
 *
 * Point UNIQUE : la config (`config.ts`, et bientôt `config/<domaine>.ts`) lit ses
 * variables d'environnement ICI — jamais `process.env.X` épars. Chaque entrée porte
 * une coercion typée + un défaut + sa doc (source 12-factor, valeurs admises). Les
 * secrets/URLs viennent de l'orchestrateur (k8s Secret, Cloud Run, -e) ou d'un
 * secret-manager ; le modèle d'onboarding complet est `.env.example`.
 *
 * Évalué une seule fois à l'import (après `loadEnv()` du bin → `process.env` peuplé).
 * Lit `process.env` UNIQUEMENT — aucun deref du kernel (cf règle config.ts top-level).
 */

// ─── Helpers de coercion (0 dépendance) ──────────────────────────────────────

/** Lit une string ; `undefined`/vide → `fallback` (ou `undefined`). */
function envStr(name: string): string | undefined;
function envStr(name: string, fallback: string): string;
function envStr(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** Lit un booléen 12-factor : `1`/`true`/`yes`/`on` (insensible à la casse) → true. */
function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** Lit une valeur d'un ensemble FERMÉ ; valeur hors-liste → `fallback` (sûr). */
function envEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = process.env[name];
  return v !== undefined && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

// ─── Types des ensembles fermés ──────────────────────────────────────────────

/** Drivers de SINK (écriture) des logs — où partent les lignes après coalescing. */
export const LOG_SINK_DRIVERS = ["stdout", "file", "null"] as const;
export type LogSinkDriver = (typeof LOG_SINK_DRIVERS)[number];

// ─── Catalogue ───────────────────────────────────────────────────────────────

/**
 * Variables d'environnement de la config app, lues + coercées une fois au boot.
 */
export const env = {
  /**
   * `NF_LOG_DRIVER` — sink d'écriture des logs (LB.W). Défaut `stdout` (cloud-native,
   * pipe non-bloquant). `file` = 1 fd async par worker (anti-goulet cluster) ;
   * `null` = bench. Valeur invalide → `stdout`.
   */
  logDriver: envEnum("NF_LOG_DRIVER", LOG_SINK_DRIVERS, "stdout"),

  /**
   * `NF_LOG_FILE_SYNC` — avec `driver:"file"`, `writeSync` direct par worker au lieu
   * du buffer async (fichier local rapide, axe W2). Défaut `false` (ne bloque jamais
   * l'event loop). Vrai si `1`/`true`/`yes`/`on`.
   */
  logFileSync: envBool("NF_LOG_FILE_SYNC", false),

  /**
   * `NF_LOG_QUERY_DRIVER` — driver de RELECTURE du log backplane (≠ sink d'écriture).
   * Défaut `memory` (ring volatile, dev). Valeurs : `memory` | `file` | `cluster-file`
   * | `loki` | `opensearch` (+ extensions du registre de fabriques). String libre :
   * la résolution finale (et le fallback `memory` si destination KO) est faite au boot.
   */
  logQueryDriver: envStr("NF_LOG_QUERY_DRIVER", "memory"),

  /**
   * `LOKI_URL` — destination PROD Loki (LB.4), active si `logQueryDriver === "loki"`.
   * Optionnel (sans URL → fallback `memory` au boot, jamais de crash).
   */
  lokiUrl: envStr("LOKI_URL"),

  /**
   * `OPENSEARCH_URL` — destination PROD OpenSearch (LB.4), active si
   * `logQueryDriver === "opensearch"`. Optionnel (fallback `memory` au boot).
   */
  opensearchUrl: envStr("OPENSEARCH_URL"),
} as const;
