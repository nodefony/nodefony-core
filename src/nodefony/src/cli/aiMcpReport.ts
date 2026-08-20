/**
 * Composition PURE de la configuration MCP d'un projet — `.mcp.json`.
 *
 * Séparée de l'écriture pour la même raison que `env`, `card` et `ai:sync` :
 * ce qui décide (que faut-il écrire ? est-ce déjà bon ?) s'éprouve sans toucher
 * au disque, donc se teste vraiment.
 *
 * ## Ce que ce fichier NE fait pas
 *
 * Il ne lance aucun serveur et n'en décrit aucun : le serveur MCP de Nodefony
 * est une **route** de l'application (`POST /nodefony/mcp`), servie par le
 * module `@nodefony/devkit`. Ce fichier ne produit que le **câblage** — le
 * papier qui dit à un agent où taper.
 */

import { stripTrailingSlashes } from "../Tools";

/** Nom de la clé sous laquelle notre serveur est déclaré. */
export const MCP_SERVER_KEY = "nodefony";

/** Fichier de configuration, à la racine du projet. */
export const MCP_CONFIG_FILE = ".mcp.json";

/** Une entrée de serveur MCP en transport HTTP. */
export interface IMcpServerEntry {
  /** Transport — seul `http` est produit ici (cf `type` de la spec). */
  type: "http";
  /** URL absolue de l'endpoint. */
  url: string;
}

/** Le document `.mcp.json` dans son entier. */
export interface IMcpConfigDocument {
  mcpServers: Record<string, IMcpServerEntry>;
  /** Tout ce que le projet y avait déjà mis est conservé tel quel. */
  [key: string]: unknown;
}

/** Ce que la commande a décidé de faire. */
export type McpConfigAction = "pose" | "remplace" | "inchange";

/** Résultat de la composition — ce qu'on écrira, et pourquoi. */
export interface IMcpConfigPlan {
  action: McpConfigAction;
  /** Document complet à écrire (identique à l'existant si `inchange`). */
  document: IMcpConfigDocument;
  /** URL retenue. */
  url: string;
  /** URL précédente, quand on remplace. */
  previousUrl?: string;
}

/**
 * Compose l'URL de l'endpoint MCP.
 *
 * @param origin - origine du serveur (`http://localhost:5151`)
 * @param endpointPath - chemin de l'endpoint, tel que le module le monte
 */
export function buildMcpUrl(origin: string, endpointPath: string): string {
  // `stripTrailingSlashes` et non `/\/+$/` : le motif backtracke sur une suite
  // de barres obliques (ReDoS polynomial), et le helper du cœur n'alloue rien
  // quand il n'y a rien à couper. Une règle = une implémentation.
  return `${stripTrailingSlashes(origin)}${endpointPath}`;
}

/**
 * Décide ce qu'il faut écrire dans `.mcp.json`.
 *
 * ⭐ **Le document existant est PRÉSERVÉ**, et pas seulement par politesse :
 * un projet y déclare ses autres serveurs MCP, et une commande de câblage qui
 * les emporterait serait une commande qu'on n'ose plus lancer. Seule la clé
 * `nodefony` est posée ou mise à jour.
 *
 * L'idempotence est au sens FORT : une URL déjà correcte rend `inchange`, donc
 * l'appelant n'écrit pas — l'horodatage du fichier ne bouge pas, et l'arbre
 * reste propre.
 *
 * @param existing - document déjà présent, ou `null`
 * @param url - URL de l'endpoint à déclarer
 */
export function planMcpConfig(
  existing: IMcpConfigDocument | null,
  url: string,
): IMcpConfigPlan {
  const base: IMcpConfigDocument = existing
    ? { ...existing, mcpServers: { ...existing.mcpServers } }
    : { mcpServers: {} };

  const previous = base.mcpServers[MCP_SERVER_KEY];
  const entry: IMcpServerEntry = { type: "http", url };
  base.mcpServers[MCP_SERVER_KEY] = entry;

  if (!previous) {
    return { action: "pose", document: base, url };
  }
  if (previous.url === url && previous.type === "http") {
    return { action: "inchange", document: base, url };
  }
  return {
    action: "remplace",
    document: base,
    url,
    previousUrl: previous.url,
  };
}

/**
 * Rend le plan pour un lecteur humain.
 *
 * Dit surtout **ce qui reste à faire** : écrire le fichier ne branche rien tant
 * que l'application ne tourne pas, et un agent déjà lancé ne relit pas sa
 * configuration. Taire ces deux conditions produirait le pire des retours — un
 * succès annoncé, suivi d'un outil introuvable.
 */
export function renderMcpPlan(
  plan: IMcpConfigPlan,
  file: string,
  dryRun: boolean,
): string {
  const verbe =
    plan.action === "pose"
      ? "posé"
      : plan.action === "remplace"
        ? "mis à jour"
        : "déjà à jour";
  const lignes = [
    dryRun
      ? `${file} — ${plan.action} (simulation, rien n'est écrit)`
      : `${file} — ${verbe}`,
    `  serveur « ${MCP_SERVER_KEY} » → ${plan.url}`,
  ];
  if (plan.previousUrl) {
    lignes.push(`  (remplaçait ${plan.previousUrl})`);
  }
  lignes.push(
    "",
    "Pour que ça réponde :",
    "  1. l'application doit TOURNER (npm run dev) — le serveur MCP est une de ses routes ;",
    "  2. redémarre ton agent, il ne relit pas sa configuration en cours de route.",
  );
  return `${lignes.join("\n")}\n`;
}
