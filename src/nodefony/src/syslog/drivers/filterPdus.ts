import type Pdu from "../Pdu";
import {
  pduToRecord,
  type ILogQueryCriteria,
  type ILogQueryResult,
} from "./ILogDriver";

/** Plafond dur d'enregistrements renvoyés (anti-DoS mémoire/réseau). */
const MAX_LIMIT = 1000;
/** Limite par défaut quand `criteria.limit` est absent. */
const DEFAULT_LIMIT = 200;

/** Extrait le texte indexable d'un payload Pdu (string directe, sinon `msg`). */
const payloadText = (pdu: Pdu): string => {
  if (typeof pdu.payload === "string") return pdu.payload;
  if (typeof pdu.payload === "number" || typeof pdu.payload === "boolean") {
    return String(pdu.payload);
  }
  // Objet/Error/array : on n'essaie PAS de tout sérialiser dans le hot du filtre
  // (coût + risque) — `msg`/`moduleName`/`msgid` couvrent la recherche utile.
  return "";
};

/**
 * Filtre PUR d'un tableau de Pdu selon des critères — **0 I/O, 0 état, testable
 * sans serveur**. C'est LA logique de filtrage du Log Backplane, réutilisée par le
 * driver `memory` (sur `syslog.ringStack`), le futur driver `file` (sur les lignes
 * relues) et la future commande CLI `syslog:filter`. Une logique, trois façades.
 *
 * Critères combinés en **AND** (cf {@link ILogQueryCriteria}). Résultat trié du
 * plus **RÉCENT** au plus ancien (l'entrée naturelle d'un viewer de logs), puis
 * `offset`/`limit` appliqués. `total` = nombre de matchs AVANT pagination.
 *
 * Perf : scan linéaire O(N) sur un ring borné (≤ `maxStack`, ~100-1000). Chemin
 * FROID (admin/debug) → jamais dans le pipeline requête. La sérialisation
 * (Pdu→{@link ILogRecord}) n'est faite que sur la **fenêtre renvoyée**, pas sur
 * tous les matchs.
 *
 * @param pdus - snapshot de Pdu (ex. `syslog.ringStack`, ordre FIFO oldest→newest).
 * @param criteria - critères de filtrage (tous optionnels).
 * @returns enregistrements récents d'abord + total + flag de troncature.
 */
export function filterPdus(
  pdus: Pdu[],
  criteria: ILogQueryCriteria = {},
): ILogQueryResult {
  const { requestId, module, msgid, from, to, text } = criteria;

  // Normalisation des critères string (1× hors boucle).
  const severities =
    criteria.severity === undefined
      ? null
      : (Array.isArray(criteria.severity)
          ? criteria.severity
          : [criteria.severity]
        ).map((s) => s.toUpperCase());
  const moduleLc = module ? module.toLowerCase() : null;
  const msgidLc = msgid ? msgid.toLowerCase() : null;
  const textLc = text ? text.toLowerCase() : null;

  // Match (AND). Itère du plus récent au plus ancien pour collecter directement
  // dans l'ordre d'affichage et s'arrêter dès que la fenêtre est pleine.
  const matched: Pdu[] = [];
  for (let i = pdus.length - 1; i >= 0; i--) {
    const pdu = pdus[i]!;
    if (requestId !== undefined && pdu.requestId !== requestId) continue;
    if (severities && !severities.includes(pdu.severityName.toUpperCase()))
      continue;
    if (moduleLc && !pdu.moduleName.toLowerCase().includes(moduleLc)) continue;
    if (msgidLc && !String(pdu.msgid).toLowerCase().includes(msgidLc)) continue;
    if (from !== undefined && pdu.timeStamp < from) continue;
    if (to !== undefined && pdu.timeStamp > to) continue;
    if (textLc) {
      const hay = (
        payloadText(pdu) +
        " " +
        pdu.msg +
        " " +
        pdu.moduleName +
        " " +
        pdu.msgid
      ).toLowerCase();
      if (!hay.includes(textLc)) continue;
    }
    matched.push(pdu);
  }

  // `matched` est collecté du plus RÉCENT au plus ancien (itération fin→début du
  // ring = ordre `uid` décroissant). C'est le défaut `"desc"`. Pour `"asc"`
  // (chronologique), on renverse AVANT de paginer → l'`uid` croît dans `rows`.
  if (criteria.order === "asc") matched.reverse();

  const total = matched.length;
  const offset = criteria.offset && criteria.offset > 0 ? criteria.offset : 0;
  const limit = Math.min(
    criteria.limit && criteria.limit > 0 ? criteria.limit : DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const window = matched.slice(offset, offset + limit);
  return {
    rows: window.map(pduToRecord),
    total,
    truncated: offset + limit < total,
  };
}
