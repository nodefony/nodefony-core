import type { IEntity } from "../interfaces/IEntity";
import { entityRegistry } from "./EntityRegistry";
import { ormRegistry } from "./OrmRegistry";

/**
 * Entités inscrites sur un connecteur qu'aucun ORM n'a ouvert.
 *
 * Une telle entité ne sera servie par rien : son dépôt lèvera au premier
 * appel, loin de sa cause. Vécu : sur une infra MongoDB, le `User` d'une
 * application restait écrit en table SQL sur `default` — un connecteur que
 * Drizzle n'ouvre pas sur cette infra — et le boot n'en disait RIEN.
 *
 * @param entities - entités inscrites (registre des entités).
 * @param connectors - connecteurs ouverts (registre des ORM).
 * @returns les orphelines, dans l'ordre d'inscription.
 */
export function findOrphanEntities(
  entities: readonly IEntity[],
  connectors: readonly string[],
): IEntity[] {
  return entities.filter((e) => !connectors.includes(e.connector));
}

/**
 * La phrase qui NOMME les orphelines et le remède — `null` s'il n'y en a pas.
 *
 * @param orphans - entités sans connecteur ouvert.
 * @param connectors - connecteurs ouverts, cités pour situer la faute.
 * @param declared - connecteurs DÉCLARÉS par les modules ORM (leur configuration).
 */
export function describeOrphanEntities(
  orphans: readonly IEntity[],
  connectors: readonly string[],
  declared: readonly string[] = [],
): string | null {
  if (orphans.length === 0) return null;
  const name = (e: IEntity): string =>
    `${e.name}${e.module ? `@${e.module}` : ""} → « ${e.connector} »`;
  const open = `Connecteurs ouverts : ${connectors.length > 0 ? connectors.join(", ") : "aucun"}.`;
  // Un connecteur DÉCLARÉ mais jamais ouvert n'est pas une faute de
  // déclaration : un connecteur précédent a échoué au démarrage, et ceux qui le
  // suivent n'ont pas été construits. Accuser l'entité enverrait chercher dans
  // son fichier une cause qui est dans l'erreur de connexion, plus haut.
  const skipped = orphans.filter((e) => declared.includes(e.connector));
  const unknown = orphans.filter((e) => !declared.includes(e.connector));
  const parts: string[] = [];
  if (unknown.length > 0) {
    parts.push(
      `${unknown.length} entité(s) inscrite(s) sur un connecteur qu'aucun ORM n'a ouvert — ` +
        `rien ne les servira, leur dépôt lèvera au premier appel : ${unknown.map(name).join(", ")}. ` +
        `${open} Une entité doit suivre la base déclarée (NF_DATABASE_URL) : table SQL sur une ` +
        `infra SQL, document sur MongoDB. État réel : npx nodefony inspect entities.`,
    );
  }
  if (skipped.length > 0) {
    parts.push(
      `${skipped.length} entité(s) sur un connecteur DÉCLARÉ mais jamais ouvert : ` +
        `${skipped.map(name).join(", ")}. Ce n'est pas leur déclaration qui est en cause : ` +
        `un connecteur a échoué au démarrage (voir l'erreur de connexion plus haut), et ceux ` +
        `qui le suivent n'ont pas été ouverts. ${open}`,
    );
  }
  return parts.join(" ");
}

/** Les démarrages déjà rapportés — un Kernel ne le dit qu'une fois. */
const reported = new WeakSet<object>();

/**
 * Signale UNE fois par démarrage les entités orphelines, au moment où tous les
 * ORM sont ouverts.
 *
 * Appelée par chaque module ORM (Drizzle, Mongoose) à `onReady` : la règle vit
 * ici, une fois, et le premier appel la rend — le second se tait, sans quoi une
 * application qui charge les deux ORM lirait deux fois le même avertissement.
 * La garde porte sur le KERNEL et non sur le process : un process qui démarre
 * plusieurs noyaux (une suite de tests) doit être prévenu à chacun.
 *
 * @param log - journal du module appelant.
 * @param owner - le démarrage concerné (le Kernel), clé de la garde.
 * @param declared - connecteurs que l'appelant a DÉCLARÉS (sa configuration).
 * @returns le message rendu, ou `null` (rien à dire, ou déjà dit).
 */
export function reportOrphanEntities(
  log: (message: string, severity: "WARNING") => void,
  owner: object,
  declared: readonly string[] = [],
): string | null {
  if (reported.has(owner)) return null;
  reported.add(owner);
  const connectors = ormRegistry.list();
  const message = describeOrphanEntities(
    findOrphanEntities(entityRegistry.list(), connectors),
    connectors,
    declared,
  );
  if (message !== null) log(message, "WARNING");
  return message;
}
