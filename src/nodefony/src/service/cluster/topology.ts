import path from "node:path";
import { resolveWorkerCount } from "./cpuQuota";

/**
 * Réglage de topologie de l'application — la « molette » côté DevOps (remplace le
 * rôle de `instances` dans l'ancien `pm2.config.ts`, retiré en cloud-native).
 *
 * - `1` — VRAI mono-process : aucune machinerie cluster (pas de master, pas de
 *   backplane, pas d'agrégateur). C'est le défaut cloud-native (1 process = 1 pod,
 *   scaling horizontal délégué à l'orchestrateur k8s/HPA).
 * - `"auto"` — nb de workers résolu **cgroup-aware** (quota CPU du conteneur, jamais
 *   `os.cpus()`). Pour une grosse VM / VPS / gros pod sans orchestrateur.
 * - `<N>` — nombre explicite de workers.
 */
export type WorkersSetting = number | "auto";

/**
 * Bloc `cluster` de la config app — lisible **sans kernel** (le master fork les
 * workers AVANT de booter le moindre Kernel : il doit donc lire ce réglage seul).
 * Doit rester kernel-free pour pouvoir être importé directement par le master.
 */
export interface IClusterConfig {
  /** Nombre de workers / topologie. Défaut : `1` (mono-process cloud-native). */
  workers: WorkersSetting;
}

/** D'où vient la valeur `workers` retenue — pour le log de diagnostic au boot. */
export type TopologySource = "flag" | "env" | "config" | "default";

/** Résultat résolu de la topologie : nombre de workers + provenance. */
export interface Topology {
  /** Nombre de workers à forker. `1` = mono-process (aucune machinerie cluster). */
  workers: number;
  /** Provenance de la valeur (CLI `--workers`, env, config app, défaut). */
  source: TopologySource;
}

/** Seams de {@link resolveTopology} — tous injectables (résolution pure, testable sans FS). */
export interface ResolveTopologyOptions {
  /** CLI `--workers <n|auto>` (chaîne Commander). Priorité MAX (override opérateur). */
  flag?: string;
  /** Override `NODEFONY_WORKERS` (Docker/k8s). Défaut : lecture de `process.env`. */
  env?: string;
  /** Valeur de la config app `cluster.workers` (le knob DevOps par défaut). */
  config?: WorkersSetting;
}

/**
 * Traduit un réglage `WorkersSetting` (ou chaîne CLI/env) en nombre de workers
 * résolu, ou `undefined` si la valeur est absente / invalide (→ source suivante).
 *
 * `"auto"` → {@link resolveWorkerCount} (cgroup-aware) ; un nombre `> 0` → idem en
 * `requested` (honoré tel quel). Tout le reste (vide, `0`, non-numérique) → `undefined`.
 */
function coerce(
  value: string | WorkersSetting | undefined,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "auto") {
    return resolveWorkerCount();
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return resolveWorkerCount({ requested: n });
}

/**
 * Résout LA topologie de lancement — source unique de vérité pour « combien de
 * workers ». Ordre de priorité (premier défini gagne) :
 *
 * 1. **CLI `--workers`** — override explicite de l'opérateur (jamais borné).
 * 2. **env `NODEFONY_WORKERS`** — override déploiement (Docker/k8s, sans éditer de fichier).
 * 3. **config app `cluster.workers`** — le knob DevOps par défaut (remplace PM2 `instances`).
 * 4. **défaut `1`** — mono-process cloud-native.
 *
 * @returns `{ workers, source }` — `workers >= 1` toujours.
 */
export function resolveTopology(opts: ResolveTopologyOptions = {}): Topology {
  const fromFlag = coerce(opts.flag);
  if (fromFlag !== undefined) {
    return { workers: fromFlag, source: "flag" };
  }
  const envRaw = opts.env ?? process.env.NODEFONY_WORKERS;
  const fromEnv = coerce(envRaw);
  if (fromEnv !== undefined) {
    return { workers: fromEnv, source: "env" };
  }
  const fromConfig = coerce(opts.config);
  if (fromConfig !== undefined) {
    return { workers: fromConfig, source: "config" };
  }
  return { workers: 1, source: "default" };
}

/**
 * Lit le bloc `cluster` de la config app de façon **standalone** (best-effort), sans
 * booter de Kernel — c'est tout ce dont le master a besoin pour décider du fork.
 *
 * Importe le fichier compilé `dist/nodefony/config/cluster/cluster.config.js` sous
 * `appPath` (défaut `process.cwd()`, = `Kernel.path`). Toute erreur (fichier absent,
 * import KO) → `null` : la résolution retombe alors sur CLI/env/défaut. Le fichier
 * config DOIT rester kernel-free pour être importable ici.
 *
 * @param appPath - racine de l'app (défaut `process.cwd()`).
 * @returns la valeur `cluster.workers`, ou `null` si introuvable.
 */
export async function loadClusterConfig(
  appPath: string = process.cwd(),
): Promise<WorkersSetting | null> {
  try {
    const file = path.resolve(
      appPath,
      "dist/nodefony/config/cluster/cluster.config.js",
    );
    const mod = (await import(file)) as {
      default?: IClusterConfig;
    };
    const workers = mod.default?.workers;
    return workers === undefined ? null : workers;
  } catch {
    return null;
  }
}
