import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isPidAlive } from "../../service/dev/devProcess";
import type { ILogDriver, ILogQueryCriteria, IPduLike } from "./ILogDriver";
import { filterPdus } from "./filterPdus";
import { DEFAULT_MAX_SCAN_BYTES, scanJsonlTail } from "./FileLogDriver";

/** Préfixe des fichiers JSONL par worker (cf `Kernel.initializeLog`). */
const DEFAULT_PREFIX = "nodefony-";
/** Suffixe des fichiers JSONL queryables. */
const DEFAULT_SUFFIX = ".jsonl";
/**
 * Plafond du NOMBRE de fichiers scannés par query (garde-fou anti-OOM). Le coût
 * mémoire d'une query = `maxFiles × maxScanBytes` au pire → borné explicitement.
 * Au-delà, on garde les `maxFiles` fichiers les plus RÉCENTS (mtime) — un cluster
 * sain a ≤ N workers (≈ cœurs), ce plafond ne mord qu'en cas de logs orphelins
 * (workers morts non nettoyés) ou d'un dossier pollué.
 */
const DEFAULT_MAX_FILES = 64;

export interface ClusterFileLogDriverOptions {
  /** Dossier contenant les `nodefony-<pid>.jsonl` de tous les workers. */
  dir: string;
  /** Préfixe des fichiers à agréger (défaut `"nodefony-"`). */
  prefix?: string;
  /** Suffixe des fichiers à agréger (défaut `".jsonl"`). */
  suffix?: string;
  /** Plafond d'octets relus depuis la fin de CHAQUE fichier (anti-OOM, défaut 8 MiB). */
  maxScanBytes?: number;
  /** Plafond du nombre de fichiers scannés (anti-OOM, défaut 64). */
  maxFiles?: number;
}

/**
 * Driver `cluster-file` du Log Backplane (LB.5) — **vue cluster unifiée** des
 * logs. En cluster, chaque worker écrit SON propre `nodefony-<pid>.jsonl` (fd par
 * worker = pas de lock d'inode partagé, cf LB.W) → une `query` sur le driver
 * `file` (LB.2) ne voit que le fichier du worker courant. Ce driver **globbe le
 * dossier** : il scanne tous les `nodefony-*.jsonl`, fusionne leurs Pdu et les
 * trie chronologiquement pour reconstituer le flux de logs de TOUT le cluster.
 *
 * La `query` est un chemin **FROID** (admin/debug), `async`, **JAMAIS** dans le
 * pipeline requête. Anti-OOM à deux niveaux : `maxScanBytes` borne la lecture par
 * fichier (à la queue, les logs récents) et `maxFiles` borne le nombre de fichiers
 * (les plus récents par mtime si dépassement). Chaque fichier est réhydraté par
 * la brique partagée {@link scanJsonlTail} (même format/robustesse que le driver
 * `file`), puis le filtrage final délègue à {@link filterPdus} — une logique, N
 * façades.
 *
 * **Tri inter-worker** : l'`uid` d'un Pdu est un compteur monotone PAR PROCESS →
 * il N'EST PAS comparable entre workers (chaque process repart de zéro). La fusion
 * trie donc par `timeStamp` (epoch ms, horloge partagée), puis départage par `pid`
 * (groupe stable par worker) et enfin par `uid` (chronologie exacte INTRA-worker,
 * y compris à `timeStamp` égal). À `timeStamp` égal entre deux workers, l'ordre
 * relatif est indéterminable (pas de séquence globale) mais reste **stable**.
 *
 * @param options - dossier + motif des fichiers + plafonds anti-OOM.
 * @returns un `ILogDriver` `cluster-file` queryable (Node-only).
 */
export function createClusterFileLogDriver(
  options: ClusterFileLogDriverOptions,
): ILogDriver {
  const dir = options.dir;
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const suffix = options.suffix ?? DEFAULT_SUFFIX;
  const maxScanBytes = options.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  return {
    name: "cluster-file",
    // write:true = persistant (chaque worker append son JSONL) ; query:true =
    // relecture agrégée ; stream:false = un dossier n'alimente pas le tap live.
    capabilities: { write: true, query: true, stream: false },
    query: async (criteria: ILogQueryCriteria) => {
      const files = await listLogFiles(dir, prefix, suffix, maxFiles);
      if (files.length === 0) return { rows: [], total: 0, truncated: false };
      // Scan parallèle borné (≤ maxFiles fichiers, chacun ≤ maxScanBytes).
      const perFile = await Promise.all(
        files.map((f) => scanJsonlTail(f, maxScanBytes)),
      );
      const merged: IPduLike[] = [];
      for (const records of perFile) {
        for (const rec of records) merged.push(rec);
      }
      // Fusion chronologique globale (oldest→newest) AVANT filterPdus, qui
      // suppose une entrée FIFO. uid non comparable cross-process → timeStamp.
      merged.sort(byChrono);
      return filterPdus(merged, criteria);
    },
  };
}

/**
 * Liste les fichiers de logs du dossier qui matchent `prefix`/`suffix`, bornée à
 * `maxFiles` (les plus récents par mtime si dépassement). Dossier absent/illisible
 * → tableau vide (un viewer ne crashe jamais).
 */
async function listLogFiles(
  dir: string,
  prefix: string,
  suffix: string,
  maxFiles: number,
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // dossier absent / illisible → vue cluster vide
  }
  const matches = names.filter(
    (n) => n.startsWith(prefix) && n.endsWith(suffix),
  );
  if (matches.length <= maxFiles) {
    return matches.map((n) => join(dir, n));
  }
  // Dépassement du garde-fou : ne garder que les `maxFiles` plus RÉCENTS (mtime).
  // stat parallèle (chemin froid). Fichier disparu entre readdir et stat → mtime 0.
  const withMtime = await Promise.all(
    matches.map(async (n) => {
      const full = join(dir, n);
      try {
        const s = await stat(full);
        return { full, mtime: s.mtimeMs };
      } catch {
        return { full, mtime: 0 };
      }
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, maxFiles).map((e) => e.full);
}

/** Options de {@link pruneOrphanLogFiles}. */
export interface IPruneOrphanLogFilesOptions {
  /** Préfixe des fichiers par worker (défaut `"nodefony-"`). */
  prefix?: string;
  /** Suffixe des fichiers par worker (défaut `".jsonl"`). */
  suffix?: string;
  /** Fichiers les plus RÉCENTS conservés quoi qu'il arrive (défaut 64 = la fenêtre du lecteur). */
  keep?: number;
  /** Constat de vivacité d'un pid — injecté par les tests. */
  isAlive?: (pid: number) => boolean;
}

/**
 * Supprime les journaux `nodefony-<pid>.jsonl` des workers MORTS que la relecture
 * ne verra plus jamais : ceux qui sortent de la fenêtre des `keep` plus récents.
 *
 * Chaque worker écrit son propre fichier et aucun ne le retire en mourant : sans
 * élagage le dossier ne fait que croître (mesuré : 5 592 fichiers, 16 Go). La
 * borne est celle du LECTEUR (`maxFiles`) — ce qu'il ne lit pas n'a pas de raison
 * d'être gardé, et le journal d'un worker qui vient de tomber reste visible.
 * Un fichier d'un pid VIVANT n'est jamais supprimé, quel que soit son rang ; un
 * nom hors motif (pid non numérique) n'est pas à nous et n'est pas touché.
 * Ne lève jamais : un fichier déjà retiré par un worker voisin est ignoré.
 *
 * @param dir - dossier des journaux par worker
 * @param options - motif, fenêtre conservée, constat de vivacité
 * @returns les chemins supprimés
 */
export async function pruneOrphanLogFiles(
  dir: string,
  options: IPruneOrphanLogFilesOptions = {},
): Promise<string[]> {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const suffix = options.suffix ?? DEFAULT_SUFFIX;
  const keep = options.keep ?? DEFAULT_MAX_FILES;
  const isAlive = options.isAlive ?? isPidAlive;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const owned: { full: string; pid: number; mtime: number }[] = [];
  for (const n of names) {
    if (!n.startsWith(prefix) || !n.endsWith(suffix)) continue;
    const id = n.slice(prefix.length, n.length - suffix.length);
    if (!/^\d+$/u.test(id)) continue;
    owned.push({ full: join(dir, n), pid: Number(id), mtime: 0 });
  }
  // Chemin nominal : un cluster sain tient dans la fenêtre → aucun stat.
  if (owned.length <= keep) return [];
  await Promise.all(
    owned.map(async (e) => {
      try {
        e.mtime = (await stat(e.full)).mtimeMs;
      } catch {
        // disparu entre readdir et stat : mtime 0, classé le plus ancien
      }
    }),
  );
  owned.sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  for (const e of owned.slice(keep)) {
    if (isAlive(e.pid)) continue;
    try {
      await unlink(e.full);
      removed.push(e.full);
    } catch {
      // déjà retiré (worker voisin) ou illisible : rien à faire
    }
  }
  return removed;
}

/**
 * Comparateur chronologique inter-worker (ordre ANCIEN → RÉCENT). `timeStamp`
 * (epoch ms partagé) prime ; à égalité, `pid` groupe par worker puis `uid` rétablit
 * la chronologie exacte intra-worker (compteur monotone par process).
 */
function byChrono(a: IPduLike, b: IPduLike): number {
  if (a.timeStamp !== b.timeStamp) return a.timeStamp - b.timeStamp;
  if (a.pid !== b.pid) return a.pid - b.pid;
  return a.uid - b.uid;
}
