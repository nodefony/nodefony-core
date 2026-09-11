/** Index OpenSearch par défaut des logs Nodefony (write transport ↔ read driver). */
export const DEFAULT_OPENSEARCH_INDEX = "nodefony-logs";

/**
 * Construit l'en-tête `Authorization: Basic …` si un utilisateur est fourni — sinon
 * objet vide (dev = plugin sécurité désactivé, HTTP sans auth). Node-only (`Buffer`).
 *
 * @param username - utilisateur (absent → pas d'auth).
 * @param password - mot de passe.
 * @returns en-tête prêt à étaler, ou `{}`.
 */
export function basicAuthHeader(
  username?: string,
  password?: string,
): Record<string, string> {
  if (!username) return {};
  const token = Buffer.from(`${username}:${password ?? ""}`).toString("base64");
  return { authorization: `Basic ${token}` };
}

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

/** Nom du modèle d'index posé par le transport. */
export const OPENSEARCH_TEMPLATE_NAME = "nodefony-logs";

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
  } as T & { "@timestamp": string };
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
 * @returns le corps du `PUT _index_template/<nom>`.
 */
export function buildIndexTemplate(index: string): Record<string, unknown> {
  return {
    index_patterns: [`${index}*`],
    template: {
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
        },
      },
    },
  };
}
