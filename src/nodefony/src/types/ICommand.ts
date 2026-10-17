// `kernel/runProfile` est un module feuille : l'importer ne recrée pas le cycle
// IKernel → ICommand → Kernel → Service → IService → IKernel, d'où le type canonique
// plutôt qu'un miroir recopié.
import type { RunLifetime } from "../kernel/runProfile";

// Redéfini localement — import circulaire impossible (IKernel → ICommand → Kernel → Service → IService → IKernel)
type KernelEventKey =
  | "onInit"
  | "onPreStart"
  | "onStart"
  | "onPreRegister"
  | "onRegister"
  | "onPreBoot"
  | "onBoot"
  | "onReady"
  | "onServersReady"
  | "onPostReady"
  | "onTerminate";

export type { KernelEventKey, RunLifetime };

export interface ICommand {
  name: string;
  kernelEvent: KernelEventKey;
  /**
   * Durée de vie DÉCLARÉE par la commande : `"oneshot"` (build/install/batch → terminate
   * une fois la phase atteinte) ou `"longrunning"` (daemon CONSOLE → le Kernel parke au
   * lieu de terminer, cf `Kernel.finishOrPark`). Capability déclarative, lue par le Kernel.
   */
  lifetime: RunLifetime;
  action(...args: unknown[]): Promise<unknown>;
}
