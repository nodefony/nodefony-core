/**
 * @nodefony/frontend — module builder Vite multi-framework.
 *
 * Approche hybride découplée (POC `poc/frontend-child`) :
 *   - Vite tourne en process système isolé (`child_process.spawn`).
 *   - Nodefony rend l'index.html (templating natif), injecte les `<script>`
 *     Vite via le helper `FrontendService.renderTags(entryName)`.
 *   - Le navigateur tape DIRECT le port Vite pour les assets / HMR.
 *
 * Voir `nodefony/CLAUDE.md` du module pour les décisions d'archi figées.
 */
import type { IAdminRegistry } from "nodefony";
import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import {
  defineFrontendConfig,
  frontendConfigJsonSchema,
  type IFrontendConfigInput,
} from "./nodefony/config/defineModuleConfig";
import type { FrontendConfig } from "./nodefony/config/config";
import FrontendService from "./nodefony/service/FrontendService";
import { createFrontendAdminApi } from "./nodefony/src/FrontendAdminApi";
import FrontendBuild from "./nodefony/command/frontend-build";
import FrontendDev from "./nodefony/command/frontend-dev";
import FrontendStatus from "./nodefony/command/frontend-status";

// Augmente le registre du core (declaration merging) → `use("@nodefony/frontend", …)` typé.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/frontend": IFrontendConfigInput;
  }
}

@services([FrontendService])
class Frontend extends Module<FrontendConfig> {
  constructor(kernel: Kernel) {
    super("frontend", kernel, import.meta.url, config);
    this.addCommand(FrontendBuild);
    this.addCommand(FrontendDev);
    this.addCommand(FrontendStatus);
  }

  /** JSON Schema de la config frontend → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return frontendConfigJsonSchema();
  }

  /**
   * Phase `onRegister` : valide la config (défauts + override `module-frontend`)
   * via `defineFrontendConfig`, puis la ré-assigne à `this.options` AVANT
   * l'instanciation du `@services` (`FrontendService` lit `module.options` à sa
   * construction). Plante propre avec messages clairs si la config est invalide
   * (convention Zod figée 2026-05-28).
   */
  override async onKernelRegister(): Promise<this> {
    try {
      this.options = defineFrontendConfig(this.options as IFrontendConfigInput);
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/frontend] Invalid config: ${issues}`, {
        cause: e,
      });
    }
    return this;
  }

  /**
   * Phase `onBoot` : enregistre le producteur admin (`/nodefony/frontend/api/*`)
   * auprès du broker, AVANT que framework ne monte le data plane à `onReady`.
   * Handler lazy → le statut Vite est lu à la requête (superviseur démarré à
   * `onServersReady`, bien après ce hook).
   */
  override async onKernelBoot(): Promise<this> {
    const registry = this.kernel?.container?.get("adminBroker") as
      IAdminRegistry | undefined;
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (registry && svc && !registry.has("frontend")) {
      registry.register(createFrontendAdminApi(svc));
    }
    return this;
  }

  override async onKernelReady(): Promise<this> {
    return this;
  }
}

export default Frontend;
export { Frontend };

// Service injectable.
export { FrontendService };

// Producteur admin (data plane `/nodefony/frontend/api/*`).
export {
  createFrontendAdminApi,
  buildFrontendStatus,
} from "./nodefony/src/FrontendAdminApi";
export type {
  IFrontendStatusView,
  IViteInstanceView,
} from "./nodefony/src/FrontendAdminApi";

// Builders / Supervisors / Presets — exposés pour extension par d'autres modules.
export { default as ViteBuilder } from "./nodefony/src/builders/ViteBuilder";
export { default as ViteProcessSupervisor } from "./nodefony/service/ViteProcessSupervisor";
export { default as ViteConfigGenerator } from "./nodefony/service/ViteConfigGenerator";
export { default as TemplateHelper } from "./nodefony/src/template/TemplateHelper";
export { default as react19Preset } from "./nodefony/src/presets/react19-vite";
export { default as vue3Preset } from "./nodefony/src/presets/vue3-vite";
export { default as angularPreset } from "./nodefony/src/presets/angular-vite";
export { default as vanillaPreset } from "./nodefony/src/presets/vanilla-vite";
export { default as svelte5Preset } from "./nodefony/src/presets/svelte5-vite";

// Erreurs.
export {
  FrontendError,
  FrontendPresetUnknownError,
  FrontendSupervisorStartError,
  FrontendNoEntriesError,
} from "./nodefony/src/errors/FrontendError";

// Interfaces publiques.
export type {
  IFrontPreset,
  FrontPresetType,
} from "./nodefony/interfaces/IFrontPreset";
export type {
  IFrontBuilder,
  IFrontendModuleDeclaration,
  IResolvedFrontendEntry,
} from "./nodefony/interfaces/IFrontBuilder";
export type {
  IViteSupervisor,
  IViteSupervisorStatus,
  ViteSupervisorState,
} from "./nodefony/interfaces/IViteSupervisor";
export type { IFrontendService } from "./nodefony/interfaces/IFrontendService";

// Config — schéma Zod (source de vérité) + builder + JSON Schema (config Studio).
export {
  defineFrontendConfig,
  frontendConfigJsonSchema,
  type IFrontendConfigInput,
} from "./nodefony/config/defineModuleConfig";
export {
  frontendConfigSchema,
  type FrontendConfig,
} from "./nodefony/config/config";
