import cluster from "node:cluster";
import CliKernel from "../CliKernel";
import type Kernel from "../Kernel";
import {
  startClusterMaster,
  ClusterLog,
} from "../../service/cluster/clusterMaster";
import { Topology } from "../../service/cluster/topology";
import {
  defaultDevPorts,
  discoverDevProcesses,
  findRuntimeConflict,
  probePorts,
  splitByProject,
  type DevProcessInfo,
  type PortState,
  type RuntimeMode,
} from "../../service/dev/devProcess";
import { SysExit } from "../../cli/sysexits";

/** Libellé FR d'un mode runtime, pour les messages d'erreur. */
function modeLabelFr(mode: RuntimeMode): string {
  if (mode === "dev") return "développement";
  if (mode === "cluster") return "cluster";
  return "production";
}

/**
 * Points d'injection du garde anti-collision — permettent de l'ÉPROUVER sans monter un
 * vrai superviseur ni tuer le processus de test. Défauts = les implémentations réelles,
 * donc le chemin de production reste celui qu'on teste. Même patron que `devStop`, qui
 * injecte déjà sa sonde de ports.
 */
export interface RuntimeConflictDeps {
  /** Racine du projet (défaut : `process.cwd()`). */
  cwd?: string;
  /** Inventaire des runtimes du poste (défaut : `discoverDevProcesses`). */
  discover?: () => DevProcessInfo[];
  /** Résolution du cwd d'un pid, pour le scoping projet (défaut : lecture système). */
  getCwd?: (pid: number) => string | null;
  /** Sonde de ports (défaut : `probePorts`) — c'est ELLE qui fait le constat. */
  probe?: (ports: readonly number[]) => Promise<PortState[]>;
  /** Sortie du process en cas de refus (défaut : `process.exit`). */
  exit?: (code: number) => void;
}

/**
 * Garde anti-collision (symétrique du superviseur dev) : un runtime prod/cluster ne
 * démarre PAS par-dessus un AUTRE runtime **de CE projet** (dev/prod/cluster d'un mode
 * différent). Fail-loud + exit — jamais de kill auto cross-mode (le runtime préexistant
 * est intentionnel). Primaire seulement (les workers forkés héritent d'un primaire déjà
 * validé). `ps` indisponible → liste vide → on retombe sur l'`EADDRINUSE` natif
 * (best-effort, ex. conteneur minimaliste sans `ps`).
 *
 * **Scopé au projet** (`splitByProject`, égalité stricte du cwd — la MÊME règle que
 * `stop`, `status` et le superviseur : une seconde implémentation dériverait). Le motif
 * du garde est la collision de PORTS ; or deux projets Nodefony cohabitent désormais
 * (`servers.portPolicy: "auto"` en dev, ports déclarés en prod). Refuser un `production`
 * parce que le dev d'une AUTRE app tourne, c'était crier au loup sur le cas nominal —
 * et un garde qui se déclenche sur le cas nominal n'est plus lu.
 *
 * **La collision se CONSTATE, elle ne se déduit pas d'une présence de process.** Un
 * process enregistré ne détient pas forcément un port : un superviseur de développement
 * dont l'enfant a été tué (kill -9 d'un banc, OOM, plantage) survit orphelin, n'écoute
 * RIEN, et reste visible de `ps`. Refuser la production sur sa seule existence, c'est
 * l'interdire à cause d'un fantôme — sur un pod, un démarrage qui échoue sans qu'aucun
 * port ne soit pris. Le chemin dev le constatait déjà (`detachedStart` → `probePorts`) ;
 * cette dissymétrie était le défaut. On sonde donc les ports DÉCLARÉS
 * (`defaultDevPorts` — même source que `status` et `stop`) : aucun tenu ⇒ on AVERTIT et
 * on laisse démarrer, l'`EADDRINUSE` natif restant le filet ultime.
 */
export async function assertNoConflictingRuntime(
  intended: RuntimeMode,
  log: ClusterLog,
  deps: RuntimeConflictDeps = {},
): Promise<void> {
  const cwd = deps.cwd ?? process.cwd();
  const { mine } = splitByProject(
    (deps.discover ?? discoverDevProcesses)(),
    cwd,
    deps.getCwd,
  );
  const conflict = findRuntimeConflict(mine, intended);
  if (conflict.length === 0) return;
  const pids = conflict.map((p) => p.pid).join(", ");
  const held = (await (deps.probe ?? probePorts)(defaultDevPorts(cwd)))
    .filter((p) => p.listening)
    .map((p) => p.port);
  if (held.length === 0) {
    log(
      `un runtime Nodefony ${modeLabelFr(conflict[0].mode)} de CE projet est enregistré ` +
        `(pid ${pids}) mais ne détient AUCUN port — résidu probable (son serveur a été ` +
        `tué). Démarrage ${modeLabelFr(intended)} MAINTENU. Pour nettoyer : nodefony stop`,
      "WARNING",
    );
    return;
  }
  log(
    `⛔ un runtime Nodefony ${modeLabelFr(conflict[0].mode)} de CE projet tourne déjà ` +
      `(pid ${pids}) et tient le(s) port(s) ${held.join(", ")} — démarrage ` +
      `${modeLabelFr(intended)} refusé. Arrête-le d'abord : nodefony stop`,
    "CRITIC",
  );
  (deps.exit ?? ((c: number) => process.exit(c)))(SysExit.UNAVAILABLE);
}

/** Arguments de {@link launchTopology}. */
export interface LaunchTopologyOptions {
  /** CliKernel courant (porte l'unique Kernel en cours de boot + l'environnement). */
  cli: CliKernel;
  /** Topologie déjà résolue (cf `resolveTopology`). */
  topo: Topology;
  /** Logger (msg + sévérité). */
  log: ClusterLog;
}

/**
 * Applique la topologie résolue — flow **PARTAGÉ** par les commandes de lancement
 * (`cluster`, `production`). Appelé depuis leur `onKernelStart` (phase `onStart`),
 * donc AVANT que l'unique Kernel ne démarre ses serveurs (`onReady → initServers`).
 *
 * **Un seul Kernel par process** (fin du double-boot historique) :
 * - `workers >= 2` && process primaire → **MASTER** : {@link startClusterMaster}
 *   (fork N workers + relay IPC + sonde pod). Ne boote AUCUN serveur HTTP ; le Kernel
 *   courant reste en `CONSOLE` et on **park** le flow (le master est un superviseur
 *   pur, gardé vivant par les listeners cluster + les timers de la sonde).
 * - sinon (mono-process `workers:1` OU process **worker** forké) → on bascule le Kernel
 *   courant en `SERVER` et on **rend la main** : son pipeline de boot continue de
 *   lui-même (`onReady → initServers → onPostReady`), les serveurs HTTP/WS montent et
 *   le process reste vivant via leurs handles. Plus aucun `new Kernel` ici.
 *
 * Vit dans `kernel/commands/` (et non `service/cluster/`) pour garder le service
 * cluster **kernel-free**.
 */
export async function launchTopology(
  opts: LaunchTopologyOptions,
): Promise<void> {
  const { cli, topo, log } = opts;

  // Avant tout fork/serveur : refuser de démarrer par-dessus un autre runtime Nodefony
  // (le cas inverse du « dev démarré sur prod »). Primaire uniquement — au fork, ce
  // process n'a pas encore posé son titre et `discoverDevProcesses` s'auto-exclut.
  if (cluster.isPrimary) {
    const intended: RuntimeMode = topo.workers >= 2 ? "cluster" : "prod";
    await assertNoConflictingRuntime(intended, log);
  }

  if (cluster.isPrimary && topo.workers >= 2) {
    log(
      `Cluster topology: ${topo.workers} workers (source: ${topo.source})`,
      "INFO",
    );
    // Master = superviseur + gateway IPC (relay realtime + sonde pod) ; pas de Kernel
    // HTTP. Le Kernel courant reste CONSOLE (servers:false) → son pipeline n'initialisera
    // aucun serveur. Profil long-running déclaré (introspection). On parke le flow : sans
    // ça, `onKernelStart` rendrait la main, le Kernel finirait son boot CONSOLE puis le
    // CLI terminerait le process → le master meurt → les workers échouent leur handshake
    // IPC. keepAlive INUTILE (le master est gardé vivant par les canaux IPC workers + les
    // timers de la sonde) → park sans timer, pour ne pas bloquer la sortie au shutdown.
    // L'arrêt passe par les signal handlers du ClusterManager (graceful shutdown).
    cli.setRunProfile({
      servers: false,
      lifetime: "longrunning",
      interactive: false,
    });
    startClusterMaster({ workers: topo.workers, log });
    await (cli.kernel as Kernel).park();
    return;
  }

  if (cluster.isPrimary) {
    log(
      `Topology: 1 process (source: ${topo.source}) — mono-process, no cluster machinery`,
      "INFO",
    );
  }
  // Mono-process OU worker forké : CE Kernel (déjà en cours de boot via le pipeline
  // CLI) démarre les serveurs. On adopte juste son profil serveur ; `onKernelStart` rend
  // ensuite la main et le boot se poursuit tout seul. Aucun park (les serveurs gardent le
  // process vivant), aucun second Kernel. Le MASTER (branche park ci-dessus) ne passe pas
  // ici → il reste sur le profil console par défaut (superviseur, 0 HTTP).
  cli.setRunProfile({
    servers: true,
    lifetime: "longrunning",
    interactive: false,
  });
}
