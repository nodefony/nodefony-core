/**
 * Contrat d'un outil **Model Context Protocol** — défini dans le CORE.
 *
 * Vit ici, et non dans le module qui sert la porte HTTP, pour la raison qui
 * gouverne déjà {@link IAdminApi} : un outil peut être produit par n'importe
 * quel niveau de la pile — un module métier d'application, un adapter ORM, un
 * futur module IA — et le contrat doit donc résider au plus bas niveau commun.
 * Un contrat logé dans un module `policy: "dev"` obligerait toute application
 * voulant déclarer un outil à dépendre d'un paquet qui disparaît en production.
 *
 * Séparation des rôles :
 *  - Ce fichier = **producteur**. Un module déclare *quels* outils il offre, par
 *    `getMcpTools()`, sans rien connaître du transport ni du protocole.
 *  - `mcp/server.ts` (core) = **protocole**. Il reçoit des outils déjà résolus.
 *  - Un controller de module = **transport**. Il traduit HTTP ↔ JSON-RPC.
 */

/**
 * Ce que rend un outil — du contenu, et l'aveu d'un échec métier.
 *
 * Un échec métier se dit par `isError`, jamais par une exception : le protocole
 * réserve ses erreurs aux fautes de protocole. La distinction compte pour
 * l'agent — une erreur de protocole signifie « tu t'y prends mal », un `isError`
 * signifie « ta demande est recevable, voici pourquoi elle n'aboutit pas » ;
 * c'est la seconde qu'il peut corriger seul.
 */
export interface IMcpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Un outil tel que `tools/list` le publie — sans son implémentation. */
export interface IMcpToolDefinition {
  /**
   * Identifiant d'appel. Forme admise : `[a-zA-Z0-9_-]{1,64}`.
   *
   * Ce nom ne reste pas dans le serveur — il voyage jusque dans le contexte du
   * modèle. Un nom hors forme n'échoue pas franchement : il produit des appels
   * que rien ne résout.
   */
  name: string;
  /**
   * ⭐ **Le premier critère de déclenchement de l'outil**, avant toute
   * considération technique. Un modèle n'appelle pas ce qu'il ne comprend pas :
   * dire ce que l'outil REND et QUAND s'en servir, pas seulement son nom.
   */
  description: string;
  /** Schéma JSON des arguments attendus. */
  inputSchema: Record<string, unknown>;
}

/**
 * Un outil exécutable : ce que `tools/list` publie, plus ce qui répond.
 *
 * C'est le contrat qu'un module implémente pour ajouter un outil à la porte MCP
 * de son application. Le handler ne reçoit QUE les arguments de l'agent : tout
 * ce dont il a besoin par ailleurs (services, kernel, connexions) est capturé
 * par fermeture au moment de la déclaration — le déclarant est un module, il a
 * déjà tout sous la main.
 *
 * @example
 * ```ts
 * import { Module, mcpText, type IMcpTool } from "nodefony";
 *
 * class Shop extends Module {
 *   getMcpTools(): IMcpTool[] {
 *     return [{
 *       name: "shop_stock",
 *       description:
 *         "Stock réel d'une référence produit. À utiliser avant de proposer " +
 *         "une commande — la réponse vient de la base, pas d'un cache.",
 *       inputSchema: {
 *         type: "object",
 *         properties: { sku: { type: "string", description: "Référence" } },
 *         required: ["sku"],
 *       },
 *       handler: async (args) => mcpText(await this.stock(String(args.sku))),
 *     }];
 *   }
 * }
 * ```
 */
export interface IMcpTool extends IMcpToolDefinition {
  /** Implémentation. Un échec métier se rend en `isError`, pas en exception. */
  handler: (
    args: Record<string, unknown>,
  ) => IMcpToolResult | Promise<IMcpToolResult>;
}
