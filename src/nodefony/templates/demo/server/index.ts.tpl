import { Kernel, Module, services } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type IDemoConfigInput } from "./nodefony/config/config";
import {
  defineDemoConfig,
  demoConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
import PartnerController from "./nodefony/controllers/PartnerController";
import AppInfoService from "./nodefony/service/AppInfoService";
import AppBannerService from "./nodefony/service/AppBannerService";
import PartnerCallCommand from "./nodefony/command/PartnerCallCommand";
import DemoPageController from "./nodefony/controllers/DemoPageController";
import DemoController from "./nodefony/controllers/DemoController";
import DemoRealtimeController from "./nodefony/controllers/DemoRealtimeController";
import DemoPulseService from "./nodefony/service/DemoPulseService";
import ChatController from "./nodefony/controllers/ChatController";
import FirstStepsController from "./nodefony/controllers/FirstStepsController";
import SseController from "./nodefony/controllers/SseController";
import VideoController from "./nodefony/controllers/VideoController";
import ChatService from "./nodefony/service/ChatService";
import PartnerTokenService from "./nodefony/service/PartnerTokenService";
import PartnerTokenController from "./nodefony/controllers/PartnerTokenController";
import { registerDemoEntry } from "./nodefony/frontend/registerDemoEntry";

/**
 * <%= it.pkgName %> — la démo de <%= it.appName %> : ce que Nodefony sait faire,
 * dans du code qui tourne.
 *
 * Un module PRIVÉ comme un autre (`modules/demo/`), posé par
 * `create app --demo` : ses routes vivent sous `/demo`, sa zone de firewall
 * dans sa propre config (`nodefony/config/security.ts`). La retirer tient en
 * deux gestes — supprimer ce dossier, retirer sa ligne `use(…)` du manifeste
 * de `nodefony.config.ts` — et l'application reste entière.
 */

declare module "nodefony" {
  interface NodefonyModuleConfig {
    "<%= it.pkgName %>": IDemoConfigInput;
  }
}

@controllers([
  PartnerController,
  DemoPageController,
  DemoController,
  DemoRealtimeController,
  ChatController,
  FirstStepsController,
  SseController,
  VideoController,
  PartnerTokenController,
])
@services([
  AppInfoService,
  AppBannerService,
  DemoPulseService,
  ChatService,
  PartnerTokenService,
])
class DemoModule extends Module {
  constructor(kernel: Kernel) {
    super("demo", kernel, import.meta.url, config);
    this.addCommand(PartnerCallCommand);
  }

  /** Valide la config au boot — une clé inconnue arrête le démarrage, nommée. */
  override async onKernelRegister(): Promise<this> {
    this.options = defineDemoConfig(this.options);
    return this;
  }

  /**
   * Déclare le front React de la démo (`/demo`) auprès du FrontendService —
   * AVANT onKernelReady, pour que le superviseur Vite démarre avec lui.
   */
  override async onKernelBoot(): Promise<this> {
    registerDemoEntry(this);
    return this;
  }

  /**
   * Publie le schéma au Kernel : c'est par lui qu'il applique le nom court
   * `NF_KEYCLOAK_MACHINE_SECRET` déclaré dans `./nodefony/config/config.ts`.
   */
  override configSchema(): unknown {
    return demoConfigJsonSchema();
  }
}

export default DemoModule;

export type { IDemoConfigInput } from "./nodefony/config/config";
