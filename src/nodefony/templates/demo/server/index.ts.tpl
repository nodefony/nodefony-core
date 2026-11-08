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

/**
 * <%= it.pkgName %> — la démo de <%= it.appName %> : ce que Nodefony sait faire,
 * dans du code qui tourne.
 *
 * Un module PRIVÉ comme un autre (`modules/demo/`), posé par
 * `create app --demo` : ses routes vivent sous `/demo`, sa zone de pare-feu
 * dans sa propre config (`nodefony/config/security.ts`). La retirer tient en
 * deux gestes — supprimer ce dossier, retirer sa ligne `use(…)` du manifeste
 * de `nodefony.config.ts` — et l'application reste entière.
 */

declare module "nodefony" {
  interface NodefonyModuleConfig {
    "<%= it.pkgName %>": IDemoConfigInput;
  }
}

@controllers([PartnerController])
@services([AppInfoService, AppBannerService])
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
   * Publie le schéma au Kernel : c'est par lui qu'il applique le nom court
   * `NF_KEYCLOAK_MACHINE_SECRET` déclaré dans `./nodefony/config/config.ts`.
   */
  override configSchema(): unknown {
    return demoConfigJsonSchema();
  }
}

export default DemoModule;

export type { IDemoConfigInput } from "./nodefony/config/config";
