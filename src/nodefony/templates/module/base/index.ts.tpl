import { Kernel, Module<% if (it.service) { %>, services<% } %> } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type <%= it.pascal %>ConfigInput } from "./nodefony/config/config";
import { define<%= it.pascal %>Config } from "./nodefony/config/defineModuleConfig";
<% if (it.service) { %>import <%= it.pascal %>Service from "./nodefony/service/<%= it.pascal %>Service";
<% } %>
/**
 * <%= it.pkgName %> — <%= it.description %>

 *
 * Module applicatif : un workspace npm à part entière
 * (`<%= it.moduleDir %>/<%= it.name %>/`), chargé par le manifeste `modules` de
 * `nodefony.config.ts`. Le Kernel l'importe PAR SON NOM (`<%= it.pkgName %>`) —
 * d'où le workspace, qui le rend résolvable.
 */

/**
 * Rend la config du module typée à l'appel : `use("<%= it.pkgName %>", { … })`
 * dans `nodefony.config.ts` propose les clés du schéma et refuse les fautes de
 * frappe, au lieu d'avaler un `Record<string, unknown>`.
 */
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "<%= it.pkgName %>": <%= it.pascal %>ConfigInput;
  }
}

// Les controllers du module se déclarent ici — `nodefony create controller <nom>
// --module <%= it.name %>` les ajoute à cette liste (et à ce dossier) tout seul.
@controllers([])
<% if (it.service) { %>@services([<%= it.pascal %>Service])
<% } %>class <%= it.pascal %>Module extends Module {
  constructor(kernel: Kernel) {
    super("<%= it.name %>", kernel, import.meta.url, config);
  }

  /**
   * Valide la config au boot — défauts du schéma fusionnés avec ce que l'app
   * passe dans `use()`. Une clé inconnue ou mal typée plante ICI, avec le champ
   * fautif nommé, plutôt qu'en `undefined.x` au premier appel en production.
   */
  override async onKernelRegister(): Promise<this> {
    this.options = define<%= it.pascal %>Config(
      (this.options as <%= it.pascal %>ConfigInput) ?? {},
    );
    return this;
  }
}

export default <%= it.pascal %>Module;
