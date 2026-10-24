/**
 * Index OpenSearch par défaut (write transport ↔ read driver). Deux applications
 * d'un même OpenSearch se séparent en déclarant chacune `log.opensearch.index`.
 */
export const DEFAULT_OPENSEARCH_INDEX = "nodefony-logs";

/**
 * Le champ temporel que TOUT l'écosystème attend — Grafana, les tableaux de bord
 * OpenSearch, les motifs d'index.
 *
 * 🔴 Ce n'est pas une préférence de nommage, c'est une condition d'existence de
 * la vue chronologique. Un horodatage écrit en entier (millisecondes depuis
 * l'époque) est stocké en `long`, et le défaut ne se voit JAMAIS à l'écriture :
 * elle réussit, et la relecture par le pilote du framework réussit aussi,
 * puisqu'il trie ce nombre. Il n'apparaît que lorsqu'un outil TIERS ouvre
 * l'index — c'est-à-dire au moment où l'on veut enfin regarder ses journaux.
 * Mesuré : 28 440 entrées correctement stockées, et pas une seule vue par le
 * temps ; une requête de documents bruts refusée (« Field [timeStamp] of type
 * [long] doesn't support formats ») ; un tri par date rendant
 * `-9223372036854775808` sur chaque document, sans une erreur.
 */
export const OPENSEARCH_TIMESTAMP_FIELD = "@timestamp";

/**
 * Le document indexé : l'enregistrement wire, plus `@timestamp` en ISO 8601.
 *
 * `timeStamp` (entier) est CONSERVÉ : c'est lui que le pilote de relecture du
 * framework filtre et trie, et le retirer réparerait un outil tiers en cassant
 * le nôtre. Les deux champs disent la même instant, dans les deux grammaires qui
 * ont chacune leur lecteur.
 *
 * @param record - l'enregistrement wire (`pduToRecord`).
 * @returns le document à indexer.
 */
export function toOpenSearchDocument<T extends { timeStamp: number }>(
  record: T,
): T & { "@timestamp": string } {
  return {
    ...record,
    [OPENSEARCH_TIMESTAMP_FIELD]: new Date(record.timeStamp).toISOString(),
  };
}

/**
 * Le modèle d'index qui DÉCLARE le type des champs, au lieu de le laisser deviner.
 *
 * Sans lui, le correctif du transport ne tient que sur les index qui existent
 * déjà : un déploiement vierge crée son index au premier document, avec un
 * mapping dynamique, et personne ne repassera derrière. Le modèle est ce qui
 * garantit le type le jour où un index naît — c'est le volet qu'on oublie.
 *
 * ⚠️ Un type ne se modifie PAS après coup dans OpenSearch : les index existants
 * gardent le leur. Ils vivent avec, ou se réindexent.
 *
 * @param index - le nom de l'index cible (le motif couvre `<index>*`).
 * @param pipeline - pipeline d'ingestion à brancher par défaut, SEULEMENT s'il a
 *   été posé : un index qui désigne un pipeline absent refuse chaque document.
 * @returns le corps du `PUT _index_template/<nom>`.
 */
export function buildIndexTemplate(
  index: string,
  pipeline?: string,
): Record<string, unknown> {
  return {
    index_patterns: [`${index}*`],
    template: {
      ...(pipeline === undefined
        ? {}
        : { settings: { "index.default_pipeline": pipeline } }),
      mappings: {
        properties: {
          [OPENSEARCH_TIMESTAMP_FIELD]: { type: "date" },
          // Conservé en `long` : c'est la grammaire du pilote de relecture, qui
          // filtre par bornes numériques.
          timeStamp: { type: "long" },
          uid: { type: "long" },
          severity: { type: "long" },
          pid: { type: "long" },
          severityName: { type: "keyword" },
          moduleName: { type: "keyword" },
          msgid: { type: "keyword" },
          requestId: { type: "keyword" },
          msg: { type: "text" },
          payload: { type: "text" },
          // Ligne d'accès de production, rangée par le pipeline
          // ({@link buildAuditPipeline}) : agrégeable par statut, chemin, durée.
          http: {
            properties: {
              method: { type: "keyword" },
              status: { type: "integer" },
              family: { type: "keyword" },
              url: { type: "keyword", ignore_above: 2048 },
              path: { type: "keyword", ignore_above: 1024 },
              durationMs: { type: "float" },
              scheme: { type: "keyword" },
              type: { type: "keyword" },
              host: { type: "keyword" },
              remoteAddress: { type: "keyword" },
              userIdentifier: { type: "keyword" },
              userAgent: { type: "keyword", ignore_above: 512 },
              requestId: { type: "keyword" },
              ts: { type: "keyword" },
            },
          },
        },
      },
    },
  };
}

/** Nom du pipeline d'ingestion d'un index — un par index, comme son modèle. */
export function auditPipelineName(index: string): string {
  return `${index}-audit`;
}

/**
 * Pipeline d'ingestion qui RANGE la ligne d'accès de production : sa charge est
 * l'enregistrement JSON du journal d'audit (`msgid: "audit"`, méthode, URL,
 * statut, durée…), qu'OpenSearch ne sait pas agréger tant qu'il reste du texte.
 * Le pipeline le déplie sous `http.*` et en tire `http.path` (sans hôte ni
 * requête) et `http.family` (`2xx`…`5xx`) : les vues par statut, par chemin
 * et par latence.
 *
 * Posé à côté de l'index, il vaut pour TOUT émetteur : le transport du
 * framework comme le collecteur de l'hébergeur. Il ne touche que les lignes
 * `audit`, et ne fait jamais échouer une indexation (`ignore_failure`).
 *
 * @returns le corps du `PUT _ingest/pipeline/<nom>`.
 */
export function buildAuditPipeline(): Record<string, unknown> {
  return {
    description:
      "Nodefony : champs HTTP de la ligne d'accès (msgid audit) sous http.*",
    processors: [
      {
        json: {
          if: "ctx.msgid == 'audit' && ctx.payload instanceof String",
          field: "payload",
          target_field: "http",
          ignore_failure: true,
        },
      },
      {
        script: {
          if: "ctx.http instanceof Map && ctx.http.status instanceof Number",
          ignore_failure: true,
          source:
            "int s = ((Number) ctx.http.status).intValue(); if (s >= 100 && s < 600) { ctx.http.family = (s / 100) + 'xx'; }",
        },
      },
      {
        script: {
          if: "ctx.http instanceof Map && ctx.http.url instanceof String",
          ignore_failure: true,
          source:
            "String u = ctx.http.url; int s = u.indexOf('://'); if (s >= 0) { int p = u.indexOf('/', s + 3); u = p >= 0 ? u.substring(p) : '/'; } int q = u.indexOf('?'); if (q >= 0) { u = u.substring(0, q); } ctx.http.path = u;",
        },
      },
    ],
  };
}
