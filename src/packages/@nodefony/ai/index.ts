import { Kernel, Module, services } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type IAiConfigInput } from "./nodefony/config/config";
import { defineAiConfig } from "./nodefony/config/defineModuleConfig";
import AiService from "./nodefony/service/AiService";

/**
 * @nodefony/ai — La boîte à outils IA de Nodefony : serveur MCP, puis les services de la couche agentique.
 *
 * Module applicatif : un workspace npm à part entière
 * (`src/packages/@nodefony/ai/`), chargé par le manifeste `modules` de
 * `nodefony.config.ts`. Le Kernel l'importe PAR SON NOM (`@nodefony/ai`) —
 * d'où le workspace, qui le rend résolvable.
 */

/**
 * Rend la config du module typée à l'appel : `use("@nodefony/ai", { … })`
 * dans `nodefony.config.ts` propose les clés du schéma et refuse les fautes de
 * frappe, au lieu d'avaler un `Record<string, unknown>`.
 */
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/ai": IAiConfigInput;
  }
}

// Les controllers du module se déclarent ici — `nodefony create controller <nom>
// --module ai` les ajoute à cette liste (et à ce dossier) tout seul.
@controllers([])
@services([AiService])
class AiModule extends Module {
  constructor(kernel: Kernel) {
    super("ai", kernel, import.meta.url, config);
  }

  /**
   * Valide la config au boot — défauts du schéma fusionnés avec ce que l'app
   * passe dans `use()`. Une clé inconnue ou mal typée plante ICI, avec le champ
   * fautif nommé, plutôt qu'en `undefined.x` au premier appel en production.
   */
  override async onKernelRegister(): Promise<this> {
    this.options = defineAiConfig(this.options);
    return this;
  }
}

export default AiModule;

// Type d'ENTRÉE de la config — c'est lui que le registre enregistre ci-dessus.
// Sans ce ré-export, `nodefony.config.ts` ne peut pas le nommer, donc pas faire
// entrer l'augmentation dans son programme : `use("@nodefony/ai", { … })`
// accepterait alors n'importe quelle clé, que Zod retirerait en silence au boot.
export type { IAiConfigInput } from "./nodefony/config/config";
