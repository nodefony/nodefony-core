import type {
  IHeldHostStatus,
  IHeldServiceDeclaration,
  IHeldServicesClient,
} from "nodefony";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../interfaces/IViteSupervisor";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { FrontendSupervisorStartError } from "../src/errors/FrontendError";
import { ViteFamily, type ViteSupervisorOptions } from "./viteFamily";
import { heldViteDeclaration } from "./viteFingerprint";

/** Le démarrage en attente : tenu au premier `ready`, rejeté à `errored`. */
interface IPendingStart {
  resolve(): void;
  reject(error: Error): void;
}

/** Message d'une cause inconnue, sans `as`. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Le superviseur Vite d'une famille sous `nodefony development` : l'hôte est
 * PORTÉ par le superviseur de développement (ADR-0030), il survit aux
 * redémarrages du serveur. ADAPTATEUR `IViteSupervisor` sur le client des
 * services portés du cœur (`kernel.heldServices("frontend")`) : il écrit la
 * config, déclare la famille dans le plan du propriétaire, et lit l'instantané
 * que le superviseur pousse — `status()` est une lecture de champ, sans
 * allocation ni aller-retour, sur le chemin chaud du relais `/_vite/`.
 *
 * Il n'ARRÊTE pas l'hôte : `stop()` cesse seulement d'écouter. Le superviseur
 * arrête ce que le plan suivant ne déclare plus, ce que la liste des
 * propriétaires ne nomme plus, et tout à la fin de la session. Même hôte, même
 * famille ({@link ViteFamily}) que `ViteProcessSupervisor`, qui sert quand le
 * serveur tient Vite lui-même.
 *
 * Les journaux de Vite ne passent pas par ici : l'hôte écrit dans ses tubes,
 * que le superviseur ingère (ADR-0030 §D8).
 */
export class HeldViteSupervisor implements IViteSupervisor {
  readonly #family: ViteFamily;
  readonly #client: IHeldServicesClient;
  #unwatch: (() => void) | null = null;
  #pending: IPendingStart | null = null;
  #startPromise: Promise<void> | null = null;

  /**
   * @param opts - les options de la famille.
   * @param client - le client des services portés du propriétaire, dont le
   *   plan attend déjà la clé de cette famille (`expect`).
   */
  constructor(opts: ViteSupervisorOptions, client: IHeldServicesClient) {
    this.#family = new ViteFamily(opts);
    this.#client = client;
  }

  /**
   * Déclare la famille dans le plan et attend Vite prêt. Idempotent : prêt →
   * rien ; démarrage en cours → la même promesse.
   *
   * @throws FrontendSupervisorStartError si la config n'a pu s'écrire, si le
   *   superviseur refuse le plan ou ne l'acquitte pas, ou si l'hôte finit
   *   `errored`.
   */
  start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    _viteConfigUnused: Record<string, unknown>,
  ): Promise<void> {
    if (this.#family.status().state === "ready") return Promise.resolve();
    if (this.#startPromise) return this.#startPromise;
    if (entries.length === 0) {
      this.#client.withdraw(this.#family.key);
      return Promise.reject(new FrontendSupervisorStartError("no entries"));
    }
    this.#startPromise = this.#start(entries).finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  /**
   * Cesse d'écouter les états de l'hôte — sans l'arrêter : il appartient au
   * superviseur, qui le garde pour le serveur suivant. Idempotent.
   */
  stop(): Promise<void> {
    this.#unwatch?.();
    this.#unwatch = null;
    this.#settle(new FrontendSupervisorStartError("stopped before ready"));
    return Promise.resolve();
  }

  /** L'instantané courant — lecture de champ, sans allocation (ADR-0030 §D5). */
  status(): IViteSupervisorStatus {
    return this.#family.status();
  }

  async #start(entries: ReadonlyArray<IResolvedFrontendEntry>): Promise<void> {
    const family = this.#family;
    const client = this.#client;
    family.begin(entries);
    const ready = new Promise<void>((resolve, reject) => {
      this.#pending = { resolve, reject };
    });
    // Rejeté avant d'être attendu (états rejoués avant l'acquittement) : la
    // cause revient à l'`await` plus bas, jamais en rejet orphelin.
    ready.catch(() => {});
    // Écouter AVANT de déclarer : un service gardé voit son état rejoué avant
    // même l'acquittement du plan (ADR-0030 §D5).
    this.#unwatch ??= client.watch(family.key, this.#onStatus);
    let declaration: IHeldServiceDeclaration;
    try {
      const configFile = await family.writeConfig(entries);
      declaration = await heldViteDeclaration(family, entries, configFile);
    } catch (error) {
      // Le plan ne doit pas attendre une famille qui ne viendra pas.
      client.withdraw(family.key);
      this.#pending = null;
      throw new FrontendSupervisorStartError(reasonOf(error), error);
    }
    try {
      await client.submit(declaration);
    } catch (error) {
      this.#pending = null;
      throw new FrontendSupervisorStartError(reasonOf(error), error);
    }
    await ready;
  }

  readonly #onStatus = (status: IHeldHostStatus): void => {
    this.#family.onStatus(status);
    if (status.state === "ready") this.#settle(null);
    else if (status.state === "errored") {
      this.#settle(
        new FrontendSupervisorStartError(
          status.lastError ?? `vite ${status.state}`,
        ),
      );
    }
  };

  /** Tient (`null`) ou rejette le démarrage en attente, une seule fois. */
  #settle(error: Error | null): void {
    const pending = this.#pending;
    if (pending === null) return;
    this.#pending = null;
    if (error === null) pending.resolve();
    else pending.reject(error);
  }
}

export default HeldViteSupervisor;
