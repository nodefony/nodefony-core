import { HostHolder } from "nodefony";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../interfaces/IViteSupervisor";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { FrontendSupervisorStartError } from "../src/errors/FrontendError";
import {
  VITE_HOST_MODULE,
  ViteFamily,
  type ViteSupervisorOptions,
} from "./viteFamily";

export {
  browserReachableHost,
  type IViteSupervisorLogger,
  type ViteSupervisorOptions,
} from "./viteFamily";

/**
 * Le superviseur Vite d'une famille TENU PAR LE SERVEUR — `--no-watch`,
 * `start`, production, et tout lancement sans superviseur de développement.
 * ADAPTATEUR `IViteSupervisor` sur le teneur `HostHolder` du cœur (ADR-0030
 * §D2). Sous `nodefony development`, c'est `HeldViteSupervisor` qui sert :
 * même hôte, même famille ({@link ViteFamily}), tenu par le superviseur.
 *
 * Vite tourne dans un HÔTE (`viteHost.ts`) qui le pilote par son API : « prêt »
 * et le port réel arrivent par le canal `nf-held`, jamais en lisant la sortie de
 * Vite. Lancement, recul de relance, preuve de vie, arrêt de l'arbre et attente
 * de sa mort sont ceux du teneur — SEULE implémentation de ce cycle.
 */
export class ViteProcessSupervisor implements IViteSupervisor {
  readonly #family: ViteFamily;
  #held: HostHolder | null = null;
  #startPromise: Promise<void> | null = null;
  /**
   * Époque : avancée par `stop()`. Un démarrage qui reprend après un `await`
   * sous une époque passée s'interrompt — sinon un hôte naissait APRÈS
   * l'arrêt, que plus personne ne tenait.
   */
  #epoch = 0;

  constructor(opts: ViteSupervisorOptions) {
    this.#family = new ViteFamily(opts);
  }

  /**
   * Démarre l'hôte et attend Vite prêt. Idempotent : prêt → rien ; démarrage en
   * cours → la même promesse.
   *
   * @throws FrontendSupervisorStartError si Vite n'a pas pu démarrer.
   */
  start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    _viteConfigUnused: Record<string, unknown>,
  ): Promise<void> {
    const state = this.#family.status().state;
    if (state === "ready") return Promise.resolve();
    if (this.#startPromise) return this.#startPromise;
    if (state === "stopping") {
      return Promise.reject(
        new FrontendSupervisorStartError("cannot start while stopping"),
      );
    }
    if (entries.length === 0) {
      return Promise.reject(new FrontendSupervisorStartError("no entries"));
    }
    this.#startPromise = this.#start(entries).finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  /**
   * Arrête l'hôte et attend la mort de son arbre. Idempotent. Un démarrage en
   * vol est interrompu, et attendu : quand `stop()` rend la main, aucun hôte
   * ne naîtra plus.
   */
  async stop(): Promise<void> {
    this.#epoch++;
    const pending = this.#startPromise;
    const held = this.#held;
    const state = held?.status().state;
    if (held !== null && state !== "idle" && state !== "stopped") {
      await held.stop();
    }
    // Le démarrage reprend sous une époque passée et s'interrompt — ou a
    // déjà échoué : son rejet appartient à l'appelant de `start()`.
    if (pending !== null) await pending.catch(() => {});
  }

  /** L'instantané courant — lecture de champ, sans allocation (ADR-0030 §D5). */
  status(): IViteSupervisorStatus {
    return this.#family.status();
  }

  async #start(entries: ReadonlyArray<IResolvedFrontendEntry>): Promise<void> {
    const epoch = this.#epoch;
    const family = this.#family;
    family.begin(entries);
    let configFile: string;
    try {
      configFile = await family.writeConfig(entries);
    } catch (error) {
      // Le contrat promet une `FrontendSupervisorStartError` : un ENOENT brut
      // ne disait pas QUI avait échoué.
      const reason = error instanceof Error ? error.message : String(error);
      throw new FrontendSupervisorStartError(reason, error);
    }
    // Un teneur par démarrage : sa spécification (config, titre) en dépend. Le
    // précédent (démarrage raté, relances épuisées) n'a plus d'hôte vivant —
    // l'arrêter ne coûte rien et ne laisse rien derrière.
    await this.#held?.stop();
    // Un `stop()` est passé pendant ces attentes : aucun hôte ne doit naître.
    if (epoch !== this.#epoch) {
      throw new FrontendSupervisorStartError("stopped before ready");
    }
    const held = new HostHolder({
      key: family.key,
      module: VITE_HOST_MODULE,
      spec: family.hostSpec(entries, configFile),
      cwd: family.options.cwd,
      env: { ...process.env, ...family.addedEnv() },
      ...family.tuning(),
      // Sans lecteur, le teneur FERME les sorties de l'hôte (un tube jamais lu
      // se remplit et bloque l'écrivain) : rien n'est lu pour rien.
      ...(family.options.pipeLogs ? { onOutput: family.relay } : {}),
      onStatus: (status) => family.onStatus(status),
    });
    this.#held = held;
    try {
      await held.start();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new FrontendSupervisorStartError(reason, error);
    }
  }
}

export default ViteProcessSupervisor;
