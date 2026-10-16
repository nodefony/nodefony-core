import type { IMcpConfig } from "../config/config";

/**
 * API publique du service `mcp` (injectable, classe `McpService`).
 *
 * L'interface est le CONTRAT : ce que la porte, les autres modules et Studio
 * peuvent appeler. Tout ce qui n'est pas ici est un détail d'implémentation.
 */
export interface IMcpService {
  /** Réglages effectifs de la porte MCP (défauts + surcharges de l'app). */
  settings(): IMcpConfig;

  /** La porte répond-elle ? Faux si le module ou la porte est coupé. */
  isEnabled(): boolean;
}
