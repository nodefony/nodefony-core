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
import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import FrontendService from "./nodefony/service/FrontendService";
import FrontendBuild from "./nodefony/command/frontend-build";
import FrontendDev from "./nodefony/command/frontend-dev";
import FrontendStatus from "./nodefony/command/frontend-status";

@services([FrontendService])
class Frontend extends Module {
  constructor(kernel: Kernel) {
    super("frontend", kernel, import.meta.url, config);
    this.addCommand(FrontendBuild);
    this.addCommand(FrontendDev);
    this.addCommand(FrontendStatus);
  }

  override async onKernelReady(): Promise<this> {
    return this;
  }
}

export default Frontend;
export { Frontend };

// Service injectable.
export { FrontendService };

// Builders / Supervisors / Presets — exposés pour extension par d'autres modules.
export { default as ViteBuilder } from "./nodefony/src/builders/ViteBuilder";
export { default as ViteProcessSupervisor } from "./nodefony/service/ViteProcessSupervisor";
export { default as ViteConfigGenerator } from "./nodefony/service/ViteConfigGenerator";
export { default as TemplateHelper } from "./nodefony/src/template/TemplateHelper";
export { default as react19Preset } from "./nodefony/src/presets/react19-vite";
export { default as vue3Preset } from "./nodefony/src/presets/vue3-vite";
export { default as vanillaPreset } from "./nodefony/src/presets/vanilla-vite";

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
export type { FrontendConfig } from "./nodefony/config/config";
