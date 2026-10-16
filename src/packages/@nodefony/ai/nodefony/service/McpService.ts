import { Service, Module, injectable } from "nodefony";
import type { IMcpService } from "../interfaces/IMcpService";
import type { IAiConfig, IMcpConfig } from "../config/config";
import { defineAiConfig } from "../config/defineModuleConfig";

/**
 * Service `mcp` — le point d'accès unique aux réglages de la porte MCP.
 *
 * La porte, les outils et les commandes LISENT ici les réglages effectifs
 * (défauts du schéma fusionnés avec ce que l'application passe dans
 * `use("@nodefony/ai", { mcp: … })`) au lieu de relire la configuration chacun
 * de son côté : deux lectures finissent par diverger.
 *
 * Coût : la config est validée UNE fois, à la construction ; rien n'est attaché
 * au chemin de requête, aucun minuteur, aucun registre peuplé — le module est
 * un socle chargé partout, il ne doit rien coûter tant que personne ne
 * l'appelle.
 *
 * Deux noms, comme tout service : `@inject("McpService")` (classe) et
 * `container.get("mcp")` (instance).
 */
@injectable()
class McpService extends Service implements IMcpService {
  module: Module;
  private readonly cfg: IAiConfig;

  constructor(module: Module) {
    const merged = defineAiConfig(module.options);
    super(
      "mcp",
      module.container ?? undefined,
      module.notificationsCenter,
      merged,
    );
    this.module = module;
    this.cfg = merged;
  }

  /**
   * Réglages effectifs de la porte MCP.
   *
   * @returns la section `mcp` validée et gelée — jamais une copie à muter
   */
  settings(): IMcpConfig {
    return this.cfg.mcp;
  }

  /**
   * La porte répond-elle ? Faux si le module OU la porte est coupé.
   *
   * @returns `true` quand `enabled` et `mcp.enabled` valent tous deux `true`
   */
  isEnabled(): boolean {
    return this.cfg.enabled && this.cfg.mcp.enabled;
  }
}

export default McpService;
