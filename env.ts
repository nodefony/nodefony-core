/**
 * CATALOGUE des variables d'environnement de l'application — `defineEnv`.
 *
 * SEUL point du projet qui lit `process.env`. Chaque variable est déclarée avec sa
 * coercion typée (string/number/boolean/enum), son défaut et sa doc ; `defineEnv`
 * lit la source UNE fois au boot, valide (zod) et retourne un objet **figé + typé**.
 *
 * Le type inféré (`typeof env`) alimente `ConfigContext<Env>` dans
 * `nodefony.config.ts` → `ctx.env.NF_LOG_DRIVER` est auto-complété + typé + documenté
 * en hover. Une valeur PRÉSENTE mais invalide (enum hors liste, nombre malformé) fait
 * échouer le boot avec un message clair nommant la variable (≠ fallback silencieux qui
 * masque un bug de déploiement) ; une valeur ABSENTE prend le défaut déclaré.
 *
 * Recette « lire une var d'env » : la déclarer ICI, puis lire `ctx.env.X` dans
 * `nodefony.config.ts`. Ne JAMAIS lire `process.env.X` ailleurs. Les secrets / URLs
 * viennent de l'orchestrateur (k8s Secret, Cloud Run, `-e`) ou d'un secret-manager ;
 * le modèle d'onboarding complet est `.env.example`.
 */
import { defineEnv, envBoolean, envEnum, envString } from "nodefony";

export const env = defineEnv({
  /**
   * Sink d'écriture des logs (LB.W). `stdout` = cloud-native (pipe non-bloquant) ;
   * `file` = 1 fd async par worker (anti-goulet en cluster) ; `null` = bench.
   * Recommandation prod : `stdout` (collecteur centralisé) ou `file` (sidecar).
   */
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
    description: "Sink d'écriture des logs : stdout | file | null.",
  }),

  /**
   * Avec `NF_LOG_DRIVER=file`, écrit en `writeSync` direct par worker au lieu du
   * buffer async (fichier local rapide). Défaut `false` (ne bloque jamais l'event
   * loop). Recommandation prod : `false` (laisser le buffer absorber les pics).
   */
  NF_LOG_FILE_SYNC: envBoolean({
    default: false,
    description: "Écriture synchrone du sink fichier (writeSync par worker).",
  }),

  /**
   * Driver de RELECTURE du log backplane (≠ sink d'écriture). `memory` (ring
   * volatile, dev) | `file` | `cluster-file` | `loki` | `opensearch`. La résolution
   * finale (et le fallback `memory` si la destination est KO) est faite au boot.
   */
  NF_LOG_QUERY_DRIVER: envString({
    default: "memory",
    description: "Driver de relecture du log backplane.",
  }),

  /**
   * Destination PROD Loki (LB.4), active si `NF_LOG_QUERY_DRIVER=loki`. Optionnelle
   * (sans URL → fallback `memory` au boot, jamais de crash).
   */
  LOKI_URL: envString({
    optional: true,
    description: "URL HTTP de la destination Loki (poussée + relecture).",
  }),

  /**
   * Destination PROD OpenSearch (LB.4), active si `NF_LOG_QUERY_DRIVER=opensearch`.
   * Optionnelle (sans URL → fallback `memory` au boot).
   */
  OPENSEARCH_URL: envString({
    optional: true,
    description: "URL HTTP de la destination OpenSearch (poussée + relecture).",
  }),
});
