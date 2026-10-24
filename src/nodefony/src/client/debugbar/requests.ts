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

/** Une requête du navigateur, telle que la liste l'affiche. */
export interface IRequestItem {
  kind: "request";
  /** Clé stable de la ligne (`r` + l'id local de l'appel). */
  key: string;
  row: IRequestRow;
  /** Ses lignes serveur qui passent la recherche — toutes, si la requête la passe elle-même. */
  logs: FeedLog[];
  /** Ses lignes serveur suivent-elles, en retrait ? */
  expanded: boolean;
}

/** Une ligne serveur, telle que la liste l'affiche. */
export interface ILogItem {
  kind: "log";
  /** Clé stable de la ligne (`l` + son rang d'arrivée `seq`). */
  key: string;
  log: FeedLog;
  /** Sous sa requête (en retrait), ou orpheline dans le flux. */
  child: boolean;
}

/** Ligne affichée, à plat : la vue fenêtrée ne connaît que des lignes de même hauteur. */
export type FlowItem = IRequestItem | ILogItem;

/** Ce qui façonne le flux affiché : le dépliage et la recherche. */
export interface IFlowOptions {
  /** Ids locaux (`NetEntry.id`) des requêtes dépliées. */
  expanded: ReadonlySet<number> | null;
  /** Recherche, déjà en minuscules ; vide : tout passe. */
  query: string;
}

/**
 * Une ligne serveur passe-t-elle la recherche ? Texte, module, catégorie et
 * requête — la seule règle de recherche du flux.
 *
 * @param query - recherche, déjà en minuscules
 */
export function logMatchesQuery(l: FeedLog, query: string): boolean {
  return (
    l.text.toLowerCase().includes(query) ||
    l.module.toLowerCase().includes(query) ||
    l.msgid.toLowerCase().includes(query) ||
    (l.requestId ?? "").toLowerCase().includes(query)
  );
}

/**
 * Une requête du navigateur passe-t-elle la recherche par elle-même ?
 * Méthode, chemin, statut et `requestId`.
 *
 * @param query - recherche, déjà en minuscules
 */
export function requestMatchesQuery(e: NetEntry, query: string): boolean {
  return (
    e.method.toLowerCase().includes(query) ||
    e.path.toLowerCase().includes(query) ||
    (e.status !== null && String(e.status).includes(query)) ||
    (e.requestId ?? "").toLowerCase().includes(query)
  );
}

/**
 * Met le flux à plat pour la liste : chaque requête, puis — dépliée — ses
 * lignes serveur dessous ; les orphelines à leur rang.
 *
 * La recherche garde une requête qui la passe elle-même (avec toutes ses
 * lignes), ou dont au moins une ligne la passe : celle-ci est alors DÉPLIÉE
 * sur ces seules lignes — chercher un message, c'est vouloir le voir.
 *
 * @param rows - le flux de {@link joinRequests}, le plus récent en tête
 * @param opts - dépliage et recherche
 * @returns les lignes dans l'ordre d'affichage
 */
export function flattenFlow(
  rows: readonly FlowRow[],
  opts: IFlowOptions,
): FlowItem[] {
  const { query, expanded } = opts;
  const out: FlowItem[] = [];
  for (const row of rows) {
    if (row.kind === "log") {
      if (query === "" || logMatchesQuery(row.log, query))
        out.push({
          kind: "log",
          key: `l${row.log.seq}`,
          log: row.log,
          child: false,
        });
      continue;
    }
    const { net } = row;
    let logs = row.logs;
    let open = expanded?.has(net.id) === true;
    if (query !== "" && !requestMatchesQuery(net, query)) {
      logs = logs.filter((l) => logMatchesQuery(l, query));
      if (logs.length === 0) continue;
      open = true;
    }
    out.push({ kind: "request", key: `r${net.id}`, row, logs, expanded: open });
    if (!open) continue;
    for (const log of logs)
      out.push({ kind: "log", key: `l${log.seq}`, log, child: true });
  }
  return out;
}
