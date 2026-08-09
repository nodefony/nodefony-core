import { Kernel, Module, services } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type DevkitConfigInput } from "./nodefony/config/config";
import { defineDevkitConfig } from "./nodefony/config/defineModuleConfig";
import DevkitService from "./nodefony/service/DevkitService";
import DevkitController from "./nodefony/controllers/DevkitController";
import McpController from "./nodefony/controllers/McpController";
import OAuthMetadataController from "./nodefony/controllers/OAuthMetadataController";
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
@controllers([DevkitController, McpController, OAuthMetadataController])
@services([DevkitService])
class DevkitModule extends Module {
  /**
   * ⚠️ Ce module ne pose PLUS de commande CLI.
   *
   * `devkit:card` vivait ici, et n'existait donc que lorsque le module était
   * chargé : hors développement (`policy: "dev"`) le CLI répondait
   * `unknown command`, et sur une application non encore construite le Kernel
   * refusait de démarrer avant elle. Une carte de visite qui disparaît selon
   * l'environnement n'accueille personne. Elle est désormais servie par le cœur
   * (`nodefony card`, alias `devkit:card`, standalone 0-boot — fast-path de
   * `CliKernel.start`), qui ne lit que des fichiers.
   *
   * Ce module garde la porte HTTP : elle, et elle seule, connaît les modules
   * réellement CHARGÉS.
   */
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
export {
  DevkitService,
  DevkitController,
  McpController,
  OAuthMetadataController,
};

// Serveur MCP — ce module n'expose QUE la porte (`McpController`, ci-dessus).
// Le protocole, les gardes, le catalogue intégré et la collecte des outils
// vivent au cœur et s'importent de `nodefony` : `handleMcpMessage`,
// `checkMcpAccess`, `collectMcpTools`, `mcpText`, `IMcpTool`. Les republier ici
// donnerait deux surfaces pour une même brique — et le jour où l'une bougerait,
// l'autre continuerait de passer ses tests.

// Brique PURE, réutilisable par une autre porte (CLI, presse-papier, MCP) : la
// carte se compose à partir d'un état injecté, pas d'un Kernel. « Une source,
// plusieurs portes » — le jour où une deuxième porte existe, elle n'aura rien à
// réécrire.
export { buildCard } from "./nodefony/src/card";

// Config — schéma Zod (source de vérité) + builder
export { defineDevkitConfig } from "./nodefony/config/defineModuleConfig";
export {
  devkitConfigSchema,
  type DevkitConfig,
  type DevkitConfigInput,
} from "./nodefony/config/config";

// Contrats publics
export type {
  IDevkitAppInfo,
  IDevkitCard,
  IDevkitCardInput,
  IDevkitDoor,
  IDevkitService,
  IDevkitVerb,
} from "./nodefony/interfaces/IDevkitService";
