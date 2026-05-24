import os from "node:os";
import fs from "node:fs";

/**
 * Lecteur de fichier système — abstrait pour rendre la résolution cgroup testable
 * sans conteneur. Retourne le contenu du fichier, ou `null` si absent / illisible.
 */
export type FileReader = (path: string) => string | null;

/** Lecteur par défaut : lecture synchrone, `null` au lieu de throw (fichier cgroup absent hors conteneur). */
const defaultRead: FileReader = (path) => {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * Lit le quota CPU effectif depuis les cgroups Linux — cgroup v2 (`cpu.max`) puis
 * v1 (`cpu.cfs_quota_us` / `cpu.cfs_period_us`).
 *
 * C'est LA correction du bug de l'ancien cluster JS : `os.cpus().length` lit l'hôte
 * (ex. 64 cœurs) et IGNORE la limite cgroup du conteneur (ex. 2 cœurs) → fork de 64
 * workers throttlés + OOM. Le quota cgroup est la seule source de vérité en conteneur.
 *
 * @param read - lecteur de fichier injectable (tests). Défaut : `fs.readFileSync`.
 * @returns le nombre de cœurs alloués (fractionnaire possible, ex. `0.5`, `2.5`), ou
 *   `null` si illimité (`max`) / cgroup absent (hors conteneur ou non-Linux).
 */
export function readCgroupCpuQuota(
  read: FileReader = defaultRead,
): number | null {
  // cgroup v2 — "<quota> <period>" en µs, ou "max <period>" si illimité.
  const v2 = read("/sys/fs/cgroup/cpu.max");
  if (v2 !== null) {
    const [quota, period] = v2.trim().split(/\s+/);
    if (quota === "max") {
      return null;
    }
    const q = Number(quota);
    const p = Number(period);
    return q > 0 && p > 0 ? q / p : null;
  }
  // cgroup v1 — fichiers séparés. quota = -1 → illimité.
  const quotaStr = read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
  const periodStr = read("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
  if (quotaStr !== null && periodStr !== null) {
    const q = Number(quotaStr.trim());
    const p = Number(periodStr.trim());
    if (q > 0 && p > 0) {
      return q / p;
    }
  }
  return null;
}

/** Options de {@link resolveWorkerCount} — tous les seams sont injectables pour les tests. */
export interface ResolveWorkerOptions {
  /** `--workers N` explicite. Prioritaire et NON borné (harnais : forker plus de workers que de cœurs pour tester le backplane). */
  requested?: number;
  /** Quota cgroup pré-calculé (tests). Si omis → lecture cgroup réelle. `null` = illimité. */
  cgroupQuota?: number | null;
  /** Parallélisme schedulable (tests). Défaut : `os.availableParallelism()`. */
  availableParallelism?: number;
}

/**
 * Résout le nombre de workers à forker, dans l'ordre de priorité :
 *
 * 1. `requested` explicite (`--workers N`) si `> 0` — honoré **tel quel**, jamais borné.
 * 2. Quota CPU cgroup (conteneur) → arrondi au plus proche, borné par le parallélisme schedulable.
 * 3. `os.availableParallelism()` (Node 19+, respecte l'affinité CPU) — fallback hors conteneur.
 *
 * @returns un entier `>= 1` (jamais 0).
 */
export function resolveWorkerCount(opts: ResolveWorkerOptions = {}): number {
  // 1. Explicite — l'opérateur sait ce qu'il veut (y compris sur-souscrire pour les tests).
  if (
    opts.requested !== undefined &&
    Number.isFinite(opts.requested) &&
    opts.requested > 0
  ) {
    return Math.max(1, Math.floor(opts.requested));
  }
  const parallelism = opts.availableParallelism ?? os.availableParallelism();
  // 2. cgroup — limite réelle du conteneur, bornée par les cœurs schedulables.
  const quota =
    opts.cgroupQuota !== undefined ? opts.cgroupQuota : readCgroupCpuQuota();
  if (quota !== null && quota > 0) {
    return Math.max(1, Math.min(Math.round(quota), parallelism));
  }
  // 3. Hors conteneur — parallélisme schedulable.
  return Math.max(1, parallelism);
}
