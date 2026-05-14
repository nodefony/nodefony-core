// Redéfinis localement — import circulaire impossible (IKernel → ICommand → Kernel → Service → IService → IKernel)
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

export type { KernelEventKey };

export interface ICommand {
  name: string;
  kernelEvent: KernelEventKey;
  action(...args: unknown[]): Promise<unknown>;
}
