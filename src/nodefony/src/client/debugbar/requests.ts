/**
 * Les lignes de l'onglet « Requêtes » de la barre de débogage, mises à plat
 * pour la liste fenêtrée. Trois vues, trois sources — aucune jointure
 * recalculée sur le flux entier :
 *
 * - **Page** : les requêtes que la page a faites (`NetEntry`, bornées par
 *   `NetworkModel`) ; dépliée, une requête montre les lignes que le serveur a
 *   écrites pour elle, relues À LA DEMANDE par son `requestId`.
 * - **Direct** : le flux des lignes serveur reçues en temps réel — la ligne
 *   EST l'objet du tampon, sans enveloppe.
 * - **Journaux** : la recherche groupée par requête des Journaux de la console
 *   (`groupByRequest`) ; l'appel du navigateur de même `requestId` n'enrichit
 *   que la ligne.
 *
 * Fonctions PURES : rappelées seulement quand leur source change.
 */
import type { FeedLog } from "./model";
import type { NetEntry } from "./network";
import type { ILogRecord } from "../../syslog/drivers/ILogDriver";
import { isToolingCall } from "./profile";
import {
  parseAccessLine,
  type IAccessLine,
} from "../../syslog/drivers/pduConsole";

/** Les trois vues de l'onglet. */
export type FlowView = "page" | "live" | "server";

/** Une requête : vue par le navigateur, relue du serveur, ou les deux. */
export interface IRequestItem {
  kind: "request";
  /** Clé stable : `r<id local>` (navigateur) ou `q<requestId>` (serveur seul). */
  key: string;
  /** L'appel vu par le navigateur, s'il l'a vu. */
  net: NetEntry | null;
  /** La ligne d'accès écrite par le serveur, s'il l'a écrite. */
  access: IAccessLine | null;
  requestId: string | null;
  /** Lignes serveur connues : le compte du groupe, ou les lignes relues. `null` : inconnu. */
  count: number | null;
  expanded: boolean;
}

/** Une ligne serveur affichée sous sa requête, en retrait. */
export interface IChildItem {
  kind: "child";
  key: string;
  log: FeedLog;
}

/** Ligne affichée. Une ligne serveur au premier niveau est l'objet du tampon lui-même. */
export type FlowItem = IRequestItem | IChildItem | FeedLog;

/** Les lignes relues d'une requête : chargées, en cours, ou en échec. */
export type LinesState = FeedLog[] | "loading" | "error";

/** Clé stable d'une ligne affichée. */
export function flowKey(item: FlowItem): string {
  return "kind" in item ? item.key : `l${item.seq}`;
}

/**
 * Une ligne serveur relue (`ILogRecord`) au format du flux. Rang `seq` : son
 * `uid` — unique dans une réponse, et c'est tout ce que la clé exige.
 */
export function recordToLine(rec: ILogRecord): FeedLog {
  return {
    severity: rec.severity,
    name: rec.severityName,
    text: typeof rec.payload === "string" ? rec.payload : rec.msg,
    module: rec.moduleName,
    ts: rec.timeStamp,
    uid: rec.uid,
    msgid: rec.msgid,
    pid: rec.pid,
    requestId: rec.requestId,
    console: false,
    seq: rec.uid,
    at: 0,
  };
}

/**
 * Une ligne serveur passe-t-elle la recherche ? Texte, module, catégorie et
 * requête.
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

/** Ce qui déplie une requête et filtre ses lignes. */
export interface IExpandOptions {
  /** Clés des requêtes dépliées. */
  expanded: ReadonlySet<string> | null;
  /** Lignes relues, par `requestId`. */
  lines: ReadonlyMap<string, LinesState>;
  /** Filtre des lignes serveur (niveaux, module exclu). */
  keep: (l: FeedLog) => boolean;
}

/** Pousse une requête puis, dépliée, ses lignes relues qui passent le filtre. */
function pushRequest(
  out: FlowItem[],
  item: IRequestItem,
  opts: IExpandOptions,
): void {
  const state =
    item.requestId === null ? undefined : opts.lines.get(item.requestId);
  const kept = Array.isArray(state) ? state.filter(opts.keep) : null;
  if (kept !== null) item.count = kept.length;
  out.push(item);
  if (!item.expanded || kept === null) return;
  for (const log of kept)
    out.push({ kind: "child", key: `${item.key}.${log.seq}`, log });
}

/**
 * Vue **Page** : les requêtes de la page, la plus récente en tête.
 *
 * @param net - les appels de la page, du plus récent au plus ancien
 * @param query - recherche (méthode, chemin, statut, requête), en minuscules
 */
export function pageItems(
  net: readonly NetEntry[],
  query: string,
  opts: IExpandOptions,
  hideTooling = false,
): FlowItem[] {
  const out: FlowItem[] = [];
  for (const e of net) {
    // L'outillage (console, Vite, la socket de la barre) n'est pas ce que fait
    // l'application : masqué, sauf à le demander (puce « console et Vite »).
    if (hideTooling && isToolingCall(e)) continue;
    if (
      query !== "" &&
      !`${e.method} ${e.path} ${e.status ?? ""} ${e.requestId ?? ""}`
        .toLowerCase()
        .includes(query)
    )
      continue;
    const key = `r${e.id}`;
    pushRequest(
      out,
      {
        kind: "request",
        key,
        net: e,
        access: null,
        requestId: e.requestId,
        count: null,
        expanded: opts.expanded?.has(key) === true,
      },
      opts,
    );
  }
  return out;
}

/**
 * Vue **Journaux** : la réponse groupée du serveur, telle quelle. Une ligne de
 * groupe porte une requête (sa ligne d'accès, son compte) ; l'appel du
 * navigateur de même `requestId` l'enrichit (durée vue par le navigateur).
 *
 * @param rows - `ILogQueryResult.rows` d'une recherche `groupByRequest`
 * @param net - les appels de la page
 */
export function serverItems(
  rows: readonly ILogRecord[],
  net: readonly NetEntry[],
  opts: IExpandOptions,
): FlowItem[] {
  let byId: Map<string, NetEntry> | null = null;
  for (const e of net)
    if (e.requestId !== null) (byId ??= new Map()).set(e.requestId, e);
  const out: FlowItem[] = [];
  for (const rec of rows) {
    const rid = rec.requestId;
    if (rid === undefined) {
      out.push(recordToLine(rec));
      continue;
    }
    const key = `q${rid}`;
    pushRequest(
      out,
      {
        kind: "request",
        key,
        net: byId?.get(rid) ?? null,
        access: parseAccessLine(rec),
        requestId: rid,
        count: rec.lines ?? 1,
        expanded: opts.expanded?.has(key) === true,
      },
      opts,
    );
  }
  return out;
}
