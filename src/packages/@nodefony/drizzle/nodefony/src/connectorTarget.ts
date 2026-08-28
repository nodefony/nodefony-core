import path from "node:path";
import type { Kernel } from "nodefony";
import type { SqlDialect } from "../config/config";
import type { IDrizzleConnectorConfig } from "../interfaces/IDrizzleConfig";

/**
 * OÙ vit la base d'un connecteur — **une seule implémentation, deux lecteurs**.
 *
 * Le service qui connecte l'application au démarrage et les commandes de
 * migration doivent désigner exactement la même base. Ce n'est pas une
 * commodité : quand les deux divergent, rien ne le signale. La commande décrit
 * alors une base que l'application n'utilise pas, annonce « à jour » ou
 * « appliqué », et rend le code de sortie du succès.
 *
 * C'est arrivé, et voici comment : `filename` est **optionnel sans défaut**
 * dans le schéma de configuration, parce que sa valeur dépend du kernel
 * (`<app>/var/databases/…`) et que le schéma reste pur. Une lecture naïve de la
 * configuration rend donc `undefined` — et le pilote SQLite retombe alors sur
 * une base **en mémoire**, vide, jetée à la fin du processus. Toutes les
 * migrations s'y « appliquent » parfaitement.
 *
 * La règle vit donc ici, et les deux appelants l'appellent.
 */

/**
 * Chemin SQLite par défaut d'un connecteur, résolu depuis le kernel.
 *
 * Sous `kernel.varDir` (`<app>/var`) — la base commune des données persistées :
 * un seul répertoire à sauvegarder et à ignorer du dépôt, et « où sont mes
 * données » a une réponse unique.
 *
 * @param kernel - kernel courant (`null` accepté : repli sur le répertoire courant).
 * @param name - nom du connecteur.
 * @returns le chemin absolu du fichier de base.
 */
export function defaultConnectorFilename(
  kernel: Kernel | null,
  name: string,
): string {
  const root =
    (typeof kernel?.path === "string" ? kernel.path : null) ?? process.cwd();
  // `.path` d'un FileClass est un `PathOrFileDescriptor` → on n'accepte que la
  // forme chaîne (un descripteur numérique ne se résout pas en chemin).
  const varPath = kernel?.varDir?.path;
  const base =
    typeof varPath === "string" ? varPath : path.resolve(root, "var");
  const file =
    name === "default" ? "nodefony-drizzle.db" : `nodefony-${name}.db`;
  return path.resolve(base, "databases", file);
}

/** Coordonnées complètes d'un connecteur, prêtes à ouvrir une connexion. */
export interface IConnectorTarget {
  dialect: SqlDialect;
  filename?: string;
  url?: string;
}

/**
 * Résout les coordonnées d'un connecteur : dialecte, et fichier ou URL.
 *
 * @param kernel - kernel courant, pour le chemin par défaut.
 * @param name - nom du connecteur.
 * @param cfg - configuration déclarée du connecteur.
 * @returns les coordonnées, avec le fichier SQLite TOUJOURS résolu.
 */
export function resolveConnectorTarget(
  kernel: Kernel | null,
  name: string,
  cfg: IDrizzleConnectorConfig,
): IConnectorTarget {
  const dialect: SqlDialect = cfg.dialect ?? "sqlite";
  if (dialect !== "sqlite") {
    return { dialect, url: cfg.url };
  }
  return {
    dialect,
    filename: cfg.filename ?? defaultConnectorFilename(kernel, name),
  };
}
