/**
 * Le noyau dans sa topologie de processus — famille CLUSTER de `Kernel.ts`,
 * détenue par COMPOSITION : le Kernel porte UNE instance (`clusterLink`),
 * allouée au constructeur (le rôle est lu dès `setCli`). Elle est le SEUL
 * propriétaire de l'identité du processus (`typeCluster`, `pid`, `workerId`,
 * `worker`), que le Kernel expose en accesseurs ; elle porte la bannière
 * `SERVER` ({@link KernelCluster.logEnv}), l'entrée dans le cluster (corps
 * d'`initCluster` : {@link KernelCluster.announceRole} puis
 * {@link KernelCluster.join}), l'écoute des messages de CONTRÔLE venus du
 * primaire, et l'enveloppe IPC héritée `process:msg`
 * ({@link KernelCluster.sendMessage}).
 *
 * **Deux contrats sur un même tube, jamais fondus.** L'IPC d'un worker va au
 * primaire du cluster ; l'IPC d'un serveur de développement va au superviseur.
 * Les messages du cluster portent un `kind: "nf:…"` (`clusterMessage.ts`) ou
 * l'enveloppe `type: "process:msg"` ; ceux du superviseur portent
 * `channel: "nf-dev"` (`devChannel.ts`, `DevChannelMessage`). Un message de
 * l'un ne doit jamais être pris pour l'autre, ni l'inverse — c'est pourquoi
 * `sendMessage` est ICI et non dans `supervisorLink.ts` : son pair naturel
 * est le primaire (c'est à lui que `process.send` d'un worker parle), son
 * discriminant est `type`, et l'union `DevChannelMessage` ne doit pas grossir.
 *
 * Module FEUILLE à l'exécution : les imports de `./Kernel` et `./CliKernel`
 * sont des `import type`, effacés à la compilation.
 */
import cluster, { type Worker } from "node:cluster";
import type { SendHandle } from "node:child_process";
import { logColor } from "../syslog/logColor";
import {
  isClusterMessage,
  CLUSTER_RT_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
} from "../service/cluster/clusterMessage";
import type { Msgid, Pci, Severity } from "../syslog/Pdu";
import type { DebugType, EnvironmentType } from "../types/globals";
import type { IRunProfile } from "./runProfile";
import type { KernelEventsType } from "./Kernel";
import type CliKernel from "./CliKernel";

/** Rôle du processus dans la topologie, tel que porté par `typeCluster`. */
export type ClusterType = "master" | "worker";

/** Rôle annoncé par l'évènement `onCluster` (la casse est celle de l'évènement). */
export type ClusterRole = "MASTER" | "WORKER";

/** Ce que la classe lit de `node:cluster` — injectable pour éprouver un worker sans forker. */
export interface IClusterTopology {
  readonly isPrimary: boolean;
  readonly isWorker: boolean;
  /** Le worker courant — absent dans le primaire (`cluster.worker` est optionnel). */
  readonly worker?: Worker | undefined;
}

/**
 * Ce que la classe touche du processus : son pid, l'écoute des messages du
 * primaire, et l'envoi IPC — injectable pour éprouver la branche worker et
 * l'enveloppe sans parler au vrai parent.
 */
export interface IClusterProcess {
  readonly pid: number;
  on(event: "message", listener: (message: unknown) => void): unknown;
  send?(
    message: unknown,
    sendHandle?: SendHandle,
    options?: { swallowErrors?: boolean; keepOpen?: boolean | undefined },
    callback?: (error: Error | null) => void,
  ): boolean;
}

/**
 * Ce que la famille CLUSTER demande au noyau, et rien de plus. Tout est lu à
 * l'APPEL. `runProfile` est le seul champ ÉCRIT : `logEnv()` y recopie
 * `cli.runProfile` — un piège d'origine, conservé à l'identique (une méthode
 * de rendu qui mute l'état ; verrouillé par test). `Kernel` satisfait cette
 * forme structurellement.
 */
export interface IClusterHost {
  /** Toujours `false` (posé avant `runProfile` au constructeur du Kernel) — branche morte conservée. */
  readonly console: boolean;
  /** Le BootReporter possède l'en-tête : la bannière `SERVER` n'est pas ré-imprimée. */
  readonly reporterOwnsHeader: boolean;
  /** CLI attachée au noyau, ou `null` en mode programmatique. */
  readonly cli: CliKernel | null;
  /** Profil d'exécution — RECOPIÉ depuis la CLI par {@link KernelCluster.logEnv}. */
  runProfile: IRunProfile;
  readonly environment: EnvironmentType;
  readonly appEnvironment: { readonly environment: string };
  readonly debug: DebugType;
  /** Émetteur synchrone du noyau (`onCluster`, `onMessage`). */
  fire(event: KernelEventsType, ...args: unknown[]): boolean;
  /** Journal du noyau (hérité de `Service`). */
  log(pci: Pci, severity?: Severity, msgid?: Msgid): unknown;
}

/**
 * Identité du processus, bannière `SERVER`, entrée dans le cluster et IPC de
 * contrôle. Verrouillé par `tests/kernelCluster.test.ts`.
 */
export class KernelCluster {
  /** `master` dans le primaire, `worker` dans un processus forké par `node:cluster`. */
  typeCluster: ClusterType;
  /** PID de ce processus — rafraîchi à {@link announceRole}. */
  pid: number;
  /** Identifiant du worker (`cluster.worker.id`), `undefined` dans le primaire. */
  workerId: number | undefined;
  /** Le worker courant, `undefined` dans le primaire. */
  worker: Worker | undefined;

  private readonly host: IClusterHost;
  private readonly topology: IClusterTopology;
  private readonly proc: IClusterProcess;

  /**
   * @param host - le noyau, lu à chaque appel.
   * @param topology - `node:cluster` par défaut (injectable).
   * @param proc - `process` par défaut (injectable).
   */
  constructor(
    host: IClusterHost,
    topology: IClusterTopology = cluster,
    proc: IClusterProcess = process,
  ) {
    this.host = host;
    this.topology = topology;
    this.proc = proc;
    this.typeCluster = topology.isPrimary ? "master" : "worker";
    this.pid = proc.pid;
    this.workerId = topology.worker?.id;
    this.worker = topology.worker;
  }

  /** @returns `true` dans le processus primaire du cluster. */
  clusterIsMaster(): boolean {
    return this.topology.isPrimary;
  }

  /**
   * La bannière `SERVER` : profil, rôle cluster, environnements, debug.
   *
   * ⚠️ Piège conservé : avec une CLI attachée, RECOPIE `cli.runProfile` dans
   * `host.runProfile` avant de rendre — une méthode de rendu qui mute l'état.
   *
   * @returns la ligne, retour chariot compris.
   */
  logEnv(): string {
    const host = this.host;
    if (host.cli) {
      host.runProfile = host.cli.runProfile;
    }
    const profileLabel = host.runProfile.servers ? "server" : "console";
    let txt = `      \x1b ${logColor.blue(profileLabel)} `;
    txt += ` ${logColor.magenta("Cluster")} : ${this.typeCluster} `;
    txt += ` ${logColor.magenta("Nodefony Environment")} : ${host.environment}  `;
    txt += ` ${logColor.magenta("App Environment")} : ${
      host.appEnvironment.environment
    }  `;
    txt += ` ${logColor.magenta("Debug")} : ${String(host.debug)}\n`;
    return txt;
  }

  /**
   * Première moitié de l'entrée dans le cluster : rafraîchit le pid, puis
   * imprime la bannière `SERVER` — sauf quand le BootReporter possède l'en-tête
   * ou que la CLI boote en silence — et rend le rôle. Le Kernel vide ensuite
   * les `MODULE ADD` différés (ils paraissent SOUS la bannière) avant
   * {@link join}.
   *
   * @returns le rôle, ou `null` quand rien ne doit suivre (branche
   *   `console && --json`, morte puisque `console` est toujours `false` —
   *   conservée telle quelle).
   */
  announceRole(): ClusterRole | null {
    this.pid = this.proc.pid;
    const host = this.host;
    if (host.console && host.cli?.commander?.opts().json) {
      return null;
    }
    if (this.topology.isPrimary) {
      this.printBanner();
      return "MASTER";
    }
    if (this.topology.isWorker) {
      this.printBanner();
      return "WORKER";
    }
    return null;
  }

  private printBanner(): void {
    const host = this.host;
    if (!host.reporterOwnsHeader && !host.cli?.quietBoot)
      console.log(this.logEnv());
  }

  /**
   * Seconde moitié de l'entrée dans le cluster : un worker adopte son identité
   * (`workerId`, `worker`) ; le rôle est annoncé par `onCluster` ; un worker
   * écoute enfin les messages de CONTRÔLE du primaire. Cette écoute vit
   * autant que le processus (un worker ne quitte pas son cluster) — elle n'est
   * posée qu'UNE fois, au boot, jamais par requête.
   *
   * @param role - le rôle rendu par {@link announceRole}.
   */
  join(role: ClusterRole): void {
    const host = this.host;
    if (role === "WORKER") {
      this.workerId = this.topology.worker?.id;
      this.worker = this.topology.worker;
    }
    host.fire("onCluster", role, host, this.proc);
    if (role !== "WORKER") return;
    this.proc.on("message", (msg) => {
      // Canal IPC partagé : les publications realtime (nf:rt) et les snapshots de sonde
      // agrégée (nf:probe:snap) sont consommés par leurs propres listeners (ClusterBackplane
      // / ClusterProbeClient) → ne PAS les logger ni les re-fire ici, sinon flood au rythme
      // du fan-out / de la cadence sonde. On ne relaie que les messages de contrôle (rares).
      if (
        isClusterMessage(msg) &&
        (msg.kind === CLUSTER_RT_KIND ||
          msg.kind === CLUSTER_PROBE_SNAPSHOT_KIND)
      ) {
        return;
      }
      host.log(msg, "INFO", "IPC MESSAGE");
      host.fire("onMessage", msg);
    });
  }

  /**
   * Enveloppe IPC héritée (`type: "process:msg"`, convention PM2) vers le
   * processus parent — le primaire du cluster pour un worker. Hors du canal
   * `nf-dev` : autre pair, autre discriminant.
   *
   * @param message - la charge, placée sous `data`.
   * @param handle - handle à transmettre avec le message (`process.send`).
   * @param options - options de `process.send`.
   * @param callback - rappel d'envoi de `process.send`.
   * @returns ce que rend `process.send`.
   * @throws Error Sans canal IPC (`process.send` absent).
   */
  sendMessage(
    message: unknown,
    handle?: SendHandle,
    options?: { swallowErrors?: boolean; keepOpen?: boolean | undefined },
    callback?: (error: Error | null) => void,
  ): boolean {
    if (this.proc.send) {
      return this.proc.send(
        {
          type: "process:msg",
          data: message,
        },
        handle,
        options,
        callback,
      );
    }
    throw new Error(`process.send not found `);
  }
}
