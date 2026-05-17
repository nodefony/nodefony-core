import Container from "../Container";
import Service from "../Service";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import RollupService from "./rollup/rollupService";
import type { RollupOptions, RollupWatcher, OutputOptions } from "rollup";

/**
 * Hook appelé par le Watcher après chaque rebuild Rollup d'un module en mode dev.
 * Reçoit le module rebuildé et l'`OutputOptions` Rollup (`output.dir` = chemin
 * du dist fraîchement écrit).
 *
 * Le hook DOIT être idempotent : il peut être appelé plusieurs fois pour le
 * même module pendant une session (chaque modif fichier déclenche un rebuild).
 */
export type HotReloadHook = (
  module: Module,
  output: OutputOptions,
) => Promise<void> | void;

/**
 * Watcher — façade légère au-dessus du service Rollup pour le mode dev.
 *
 * Deux rôles :
 *
 * 1. **Lance un watcher Rollup par module** via {@link createRollupWatcher}.
 *    Délègue à `rollupService.watch`, qui écrit le bundle sur disque et émet
 *    `rollup:bundle:end` à chaque rebuild.
 * 2. **Dispatche les rebuilds vers des hot-reload hooks** via {@link register}.
 *    Chaque consommateur (Router, Sequelize, etc.) enregistre une fonction
 *    `hotReload(module, output)` appelée après chaque rebuild de SON module.
 *
 * Pas de `chokidar` : Rollup watch surveille déjà les fichiers source via son
 * resolver — éviter la double surveillance.
 *
 * Lazy alloc : la map de hooks et le listener sur `rollupService` ne sont
 * alloués qu'au premier `register()`. Sans HMR consommateur, coût = 0.
 */
class Watcher extends Service {
  /** Map moduleName → hook. `null` tant qu'aucun module n'est enregistré. */
  private hooks: Record<string, HotReloadHook> | null = null;
  /** Référence du listener attaché à `rollupService` — null si détaché. */
  private bundleEndListener:
    | ((module: Module, output: OutputOptions) => Promise<void>)
    | null = null;

  constructor(kernel: Kernel) {
    super("watcher", kernel.container as Container);
    this.kernel?.once("onTerminate", () => {
      this.detachListener();
      this.hooks = null;
    });
  }

  /**
   * Crée un watcher Rollup pour un module — façade vers `rollupService.watch`.
   *
   * @throws Si le service `rollup` n'est pas enregistré dans le container.
   */
  async createRollupWatcher(
    module: Module,
    options: RollupOptions,
  ): Promise<RollupWatcher> {
    const service = this.get<RollupService>("rollup");
    if (!service) {
      throw new Error("service Rollup not defined");
    }
    return service.watch(module, options);
  }

  /**
   * Enregistre un hot-reload hook pour un module.
   *
   * Le hook sera appelé après chaque event `rollup:bundle:end` émis par
   * `rollupService` concernant ce module (match strict par `module.name`).
   *
   * Au premier `register`, alloue la map et attache UN SEUL listener sur
   * `rollupService` — les `register` suivants ré-utilisent ce listener.
   * Économise N×listeners pour N modules abonnés.
   *
   * @param moduleName - `module.name` du module dont on veut être notifié
   * @param hotReload  - callback appelé après chaque rebuild (peut throw : les
   *                     erreurs sont catchées et loguées en `ERROR`)
   * @throws Si le service `rollup` n'est pas enregistré.
   */
  register(moduleName: string, hotReload: HotReloadHook): void {
    if (this.hooks === null) {
      this.hooks = Object.create(null) as Record<string, HotReloadHook>;
      this.attachListener();
    }
    this.hooks[moduleName] = hotReload;
  }

  /**
   * Retire le hot-reload hook d'un module. Si plus aucun hook n'est enregistré
   * après la suppression, détache le listener du `rollupService` et libère la
   * map (`null` à nouveau, prêt pour un nouveau cycle de `register`).
   */
  unregister(moduleName: string): void {
    if (!this.hooks) return;
    delete this.hooks[moduleName];
    if (Object.keys(this.hooks).length === 0) {
      this.detachListener();
      this.hooks = null;
    }
  }

  /** Liste les modules ayant un hook enregistré (debug, tests). */
  getRegisteredModules(): string[] {
    return this.hooks ? Object.keys(this.hooks) : [];
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private attachListener(): void {
    const rollupService = this.get<RollupService>("rollup");
    if (!rollupService) {
      throw new Error("service Rollup not defined");
    }
    this.bundleEndListener = async (module: Module, output: OutputOptions) => {
      const hook = this.hooks?.[module.name];
      if (!hook) return;
      try {
        await hook(module, output);
      } catch (e) {
        this.log(e, "ERROR", `Watcher hotReload ${module.name}`);
      }
    };
    rollupService.on("rollup:bundle:end", this.bundleEndListener);
  }

  private detachListener(): void {
    if (!this.bundleEndListener) return;
    const rollupService = this.get<RollupService>("rollup");
    if (rollupService) {
      rollupService.off("rollup:bundle:end", this.bundleEndListener);
    }
    this.bundleEndListener = null;
  }
}

export default Watcher;
