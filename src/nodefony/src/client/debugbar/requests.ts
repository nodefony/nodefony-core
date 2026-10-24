/**
 * Jointure navigateur ↔ serveur de la debug bar : une ligne par requête que le
 * navigateur a VUE (méthode, chemin, statut, durée, échec réseau), avec dessous
 * les lignes que le serveur a écrites pour elle — même `requestId`. Les lignes
 * serveur qu'aucune requête du navigateur ne réclame (autres clients, tâches de
 * fond) restent dans le même flux, à leur rang.
 *
 * Fonction PURE : l'onglet la rappelle à chaque rendu sur les deux listes déjà
 * bornées (`NetworkModel`, `FEED_MAX`) — rien n'est gardé entre deux appels.
 */
import type { FeedLog } from "./model";
import type { NetEntry } from "./network";

/** Une requête vue par le navigateur, et les lignes serveur qui la concernent. */
export interface IRequestRow {
  kind: "request";
  net: NetEntry;
  /** Lignes du serveur de même `requestId`, dans leur ordre d'arrivée. */
  logs: FeedLog[];
  /** Rang dans le flux : l'envoi par le navigateur (`performance.now()`). */
  at: number;
}

/** Une ligne serveur qu'aucune requête du navigateur ne réclame. */
export interface ILogRow {
  kind: "log";
  log: FeedLog;
  /** Rang dans le flux : la réception par la page (`performance.now()`). */
  at: number;
}

/** Ligne du flux « Requêtes ». */
export type FlowRow = IRequestRow | ILogRow;

/**
 * Rattache chaque ligne serveur à la requête du navigateur de même `requestId`,
 * et rend le flux trié du plus récent au plus ancien.
 *
 * Les deux rangs sont lus sur l'horloge de la PAGE (`NetEntry.startedAt`,
 * `FeedLog.at`) : l'horodatage du serveur ne sert jamais à ordonner. Une
 * requête sans `requestId` (en attente, échec réseau, réponse sans en-tête)
 * reste une ligne, sans lignes serveur.
 *
 * @param net - appels observés par le navigateur.
 * @param logs - lignes serveur reçues, dans leur ordre d'arrivée, déjà filtrées.
 * @returns le flux, le plus récent en tête.
 */
export function joinRequests(
  net: readonly NetEntry[],
  logs: readonly FeedLog[],
): FlowRow[] {
  const rows: FlowRow[] = [];
  let byRequestId: Map<string, IRequestRow> | null = null;
  for (const entry of net) {
    const row: IRequestRow = {
      kind: "request",
      net: entry,
      logs: [],
      at: entry.startedAt,
    };
    rows.push(row);
    if (entry.requestId !== null) {
      byRequestId ??= new Map();
      byRequestId.set(entry.requestId, row);
    }
  }
  for (const log of logs) {
    const owner =
      log.requestId === undefined ? undefined : byRequestId?.get(log.requestId);
    if (owner) owner.logs.push(log);
    else rows.push({ kind: "log", log, at: log.at });
  }
  rows.sort((a, b) => b.at - a.at);
  return rows;
}
