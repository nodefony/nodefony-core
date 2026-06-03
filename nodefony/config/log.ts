/**
 * Domaine de config : OBSERVABILITÉ — Syslog Nodefony (logger central).
 *
 * - `active` : master switch. `false` = aucun log (test silencieux).
 * - `debug`  : filtre des sources DEBUG.
 *     "*"  → tous les logs DEBUG
 *     []   → aucun DEBUG (seulement INFO/WARNING/ERROR/CRITIC)
 *     ["router", "sequelize"] → seulement ces sources en DEBUG
 * - `requestFormat` : format de log émis par HttpKernel pour CHAQUE requête
 *   HTTP/WS finie. Lu par HttpKernel.initialize() au boot, swap automatique :
 *     "auto"    : sélection auto selon l'environnement (DEFAULT recommandé)
 *                 → dev/development = "pretty", production = "json", autre = "default"
 *     "default" : verbeux multi-info legacy (cli-color, plusieurs champs)
 *     "pretty"  : 1 ligne courte colorée — recommandé DEV (P3.2)
 *                 → "INFO req : GET 200 /url 12ms 127.0.0.1 [a1b2c3d4]"
 *     "json"    : 1 PDU JSON canonique — recommandé PROD (P3.1 + P3.4 redaction)
 *                 → '{"ts":...,"requestId":...,"userId":...,"status":...}'
 *
 * Pour forcer un format peu importe l'env, mettre la valeur explicite
 * ("default" | "pretty" | "json"). Sinon laisser "auto".
 *
 * Override programmatique possible (custom logger, RFC 7807, NCSA, etc.) :
 *   httpKernel.setRequestLogger(new MyLogger())
 *
 * - `buffered` : bufférisation de la sortie console (perf débit sous forte
 *   concurrence — coalesce les écritures d'un même tick en 1 seul syscall).
 *     "auto" (DÉFAUT) : bufférise si stdout N'EST PAS un TTY (pipe/fichier =
 *                       prod/container/collecteur → débit) ; immédiat sur un
 *                       terminal (dev interactif → feedback ligne à ligne + spinner).
 *     true            : toujours bufférisé (ex. bench dans un terminal).
 *     false           : jamais (ex. `tail -f` non bufférisé en debug prod).
 *   stderr (ERROR+) reste TOUJOURS immédiat (durable même crash imminent).
 *
 * - `driver` / `file.sync` / `queryDriver` / `loki` / `opensearch` : sources
 *   12-factor centralisées dans `./env` (NF_LOG_DRIVER / NF_LOG_FILE_SYNC /
 *   NF_LOG_QUERY_DRIVER / LOKI_URL / OPENSEARCH_URL — doc + valeurs admises sur
 *   chaque champ d'env.ts). Sink d'ÉCRITURE (LB.W) vs relecture du BACKPLANE (LB.0+).
 *   Sans `file.path`, le Kernel ouvre `logs/nodefony-<pid>.log` (1 fd par worker).
 *   En prod l'orchestrateur fige la destination sans toucher au code.
 */
import { env } from "./env";

export const log = {
  active: true,
  debug: "*",
  requestFormat: "auto" as "auto" | "default" | "pretty" | "json",
  buffered: "auto" as boolean | "auto",
  driver: env.logDriver,
  file: { sync: env.logFileSync },
  queryDriver: env.logQueryDriver,
  // Destinations PROD (LB.4) — montées seulement si l'URL est fournie ET
  // `queryDriver` vaut leur nom (sinon fallback "memory" au boot, jamais de crash).
  // On POUSSE (transport batché) ET on RELIT la MÊME destination → cohérence write↔read.
  ...(env.lokiUrl ? { loki: { url: env.lokiUrl } } : {}),
  ...(env.opensearchUrl ? { opensearch: { url: env.opensearchUrl } } : {}),
};
