import { open, type FileHandle } from "node:fs/promises";
import type { ILogDriver, ILogQueryCriteria, IPduLike } from "./ILogDriver";
import { filterPdus } from "./filterPdus";

/** Octets max relus depuis la FIN du fichier à chaque query (anti-OOM). Défaut 8 MiB. */
export const DEFAULT_MAX_SCAN_BYTES = 8 * 1024 * 1024;

export interface FileLogDriverOptions {
  /** Chemin du fichier JSONL (1 enregistrement Pdu sérialisé — forme wire — par ligne). */
  path: string;
  /**
   * Plafond d'octets relus depuis la fin du fichier à chaque `query` (anti-OOM).
   * Un fichier de logs peut atteindre plusieurs Go → on ne lit JAMAIS tout : on
   * relit la QUEUE (les logs récents = ce qu'un viewer veut), bornée. Défaut 8 MiB.
   */
  maxScanBytes?: number;
}

/**
 * Driver `file` du Log Backplane (LB.2) — destination de logs **JSONL queryable**
 * (persistante, dev/VPS). Chaque ligne est un Pdu sérialisé en forme wire plate
 * (`JSON.stringify`), produit côté WRITE par un transport file `format:"json"` ;
 * ce format plat est aussi celui qu'ingèrent Promtail (Loki) / Filebeat (OpenSearch)
 * sans transformation → le driver file est le tremplin testable vers les drivers
 * prod (LB.4).
 *
 * La `query` RELIT le fichier — chemin **FROID** (admin/debug), `async`, **JAMAIS**
 * dans le pipeline requête. Elle borne la lecture aux derniers `maxScanBytes` octets
 * (anti-OOM), réhydrate chaque ligne en {@link IPduLike} (SANS instancier un `Pdu`,
 * donc 0 effet de bord uid/provider), puis délègue le filtrage à {@link filterPdus}
 * (même logique que le driver `memory` — une logique, N façades).
 *
 * Robustesse : fichier absent / illisible → résultat vide (un viewer ne doit pas
 * crasher) ; lignes vides ou JSON corrompu (write tronqué par un crash) → ignorées.
 *
 * @param options - chemin du JSONL + plafond de scan optionnel.
 * @returns un `ILogDriver` `file` queryable (Node-only).
 */
export function createFileLogDriver(options: FileLogDriverOptions): ILogDriver {
  const path = options.path;
  const maxScanBytes = options.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES;
  return {
    name: "file",
    // write:true = persistant (≠ ring volatile memory) ; query:true = relecture
    // filtrée ; stream:false = un fichier n'alimente pas le tap temps réel (le bus
    // syslog:stream reste indépendant du driver de relecture).
    capabilities: { write: true, query: true, stream: false },
    query: async (criteria: ILogQueryCriteria) => {
      const records = await scanJsonlTail(path, maxScanBytes);
      return filterPdus(records, criteria);
    },
  };
}

/**
 * Relit la QUEUE d'un fichier JSONL (bornée à `maxScanBytes` octets depuis la
 * FIN, anti-OOM) et la réhydrate en {@link IPduLike}[] — SANS instancier de
 * `Pdu` (0 effet de bord uid/provider). Brique de scan **PARTAGÉE** par le
 * driver `file` (LB.2, un seul fichier) et le driver `cluster-file` (LB.5, qui
 * scanne les `nodefony-<pid>.jsonl` de tous les workers). Fichier absent /
 * illisible → tableau vide (jamais throw). Lignes vides ou JSON corrompu (write
 * tronqué par un crash) → ignorées.
 *
 * @param path - chemin du fichier JSONL.
 * @param maxScanBytes - plafond d'octets relus depuis la fin du fichier.
 * @returns enregistrements dans l'ordre du fichier (FIFO, ancien → récent).
 */
export async function scanJsonlTail(
  path: string,
  maxScanBytes: number,
): Promise<IPduLike[]> {
  const text = await readTail(path, maxScanBytes);
  if (text.length === 0) return [];
  const records: IPduLike[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const rec = parseLine(line);
    if (rec) records.push(rec);
  }
  return records;
}

/**
 * Lit les derniers `maxBytes` octets du fichier (borne anti-OOM). Si le fichier
 * dépasse, on jette le 1ᵉʳ fragment de ligne partielle (lecture démarrée au milieu
 * d'une ligne). Fichier absent / illisible → string vide (jamais throw côté query).
 */
async function readTail(path: string, maxBytes: number): Promise<string> {
  let opened: FileHandle;
  try {
    opened = await open(path, "r");
  } catch {
    return ""; // fichier absent ou illisible → résultat vide
  }
  // `FileHandle` implémente `Symbol.asyncDispose` (Node 24) → close() automatique
  // en sortie de scope, sur CHAQUE `return` comme sur throw. Remplace le
  // `try/finally { fh.close() }` manuel — libération déterministe, leak-proof.
  await using fh = opened;
  const { size } = await fh.stat();
  if (size === 0) return "";
  const start = size > maxBytes ? size - maxBytes : 0;
  const length = size - start;
  const buf = Buffer.allocUnsafe(length);
  await fh.read(buf, 0, length, start);
  let text = buf.toString("utf8");
  if (start > 0) {
    // Lecture démarrée au milieu d'une ligne → jeter ce 1ᵉʳ fragment partiel.
    const nl = text.indexOf("\n");
    text = nl === -1 ? "" : text.slice(nl + 1);
  }
  return text;
}

/** Parse une ligne JSONL en {@link IPduLike}, ou `null` si corrompue / non-Pdu. */
function parseLine(line: string): IPduLike | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null; // write tronqué par un crash / ligne corrompue → ignorée
  }
  return coerceRecord(raw);
}

/**
 * Narrowing SÛR d'un objet JSON relu (entrée externe = disque) vers {@link IPduLike}.
 * Rejette ce qui n'est pas un enregistrement de log (les 3 champs discriminants
 * `severityName`/`moduleName`/`timeStamp` manquent ou de mauvais type) ; complète
 * les champs accessoires avec des défauts sûrs. 0 `any`, 0 instanciation de Pdu.
 */
export function coerceRecord(raw: unknown): IPduLike | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.severityName !== "string" ||
    typeof o.moduleName !== "string" ||
    typeof o.timeStamp !== "number"
  ) {
    return null;
  }
  const rec: IPduLike = {
    uid: typeof o.uid === "number" ? o.uid : 0,
    severity: typeof o.severity === "number" ? o.severity : 7,
    severityName: o.severityName,
    moduleName: o.moduleName,
    msgid: typeof o.msgid === "string" ? o.msgid : "",
    msg: typeof o.msg === "string" ? o.msg : "",
    timeStamp: o.timeStamp,
    pid: typeof o.pid === "number" ? o.pid : 0,
    payload: o.payload,
  };
  if (typeof o.requestId === "string") rec.requestId = o.requestId;
  return rec;
}
