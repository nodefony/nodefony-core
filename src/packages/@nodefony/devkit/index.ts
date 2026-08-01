import { Kernel, Module, services } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type DevkitConfigInput } from "./nodefony/config/config";
import { defineDevkitConfig } from "./nodefony/config/defineModuleConfig";
import DevkitService from "./nodefony/service/DevkitService";
import DevkitController from "./nodefony/controllers/DevkitController";
/**
 * @nodefony/devkit — Outillage de developpement d une application Nodefony : carte de visite et portes de decouverte pour un agent
 *
 * Module applicatif : un workspace npm à part entière
 * (`src/packages/@nodefony/devkit/`), chargé par le manifeste `modules` de
 * `nodefony.config.ts`. Le Kernel l'importe PAR SON NOM (`@nodefony/devkit`) —
 * d'où le workspace, qui le rend résolvable.
 */

/**
 * Rend la config du module typée à l'appel : `use("@nodefony/devkit", { … })`
 * dans `nodefony.config.ts` propose les clés du schéma et refuse les fautes de
 * frappe, au lieu d'avaler un `Record<string, unknown>`.
 */
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/devkit": DevkitConfigInput;
  }
}

// Les controllers du module se déclarent ici — `nodefony create controller <nom>
// --module devkit` les ajoute à cette liste (et à ce dossier) tout seul.
@controllers([DevkitController])
@services([DevkitService])
class DevkitModule extends Module {
  constructor(kernel: Kernel) {
    super("devkit", kernel, import.meta.url, config);
  }

  /**
   * Valide la config au boot — défauts du schéma fusionnés avec ce que l'app
   * passe dans `use()`. Une clé inconnue ou mal typée plante ICI, avec le champ
   * fautif nommé, plutôt qu'en `undefined.x` au premier appel en production.
   */
  override async onKernelRegister(): Promise<this> {
    this.options = defineDevkitConfig(
      (this.options as DevkitConfigInput) ?? {},
    );
    return this;
  }
}

export default DevkitModule;
