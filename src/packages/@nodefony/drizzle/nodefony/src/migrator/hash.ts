import { createHash } from "node:crypto";

/**
 * Empreinte d'un fichier de migration : **normalisée** et **auto-descriptive**.
 *
 * Deux gestes, deux raisons distinctes.
 *
 * **Normalisée** (CRLF → LF) : Windows est un impératif produit, et un checkout
 * sous `core.autocrlf` réécrit les `.sql`. Hacher les octets bruts ferait
 * diverger toutes les empreintes de celles posées par l'image Linux qui a migré
 * la base d'équipe — arrêt sur dérive permanent, pour un non-changement. Le
 * garde-fou reste entier : toute modification RÉELLE du SQL déclenche l'arrêt,
 * seule la représentation des fins de ligne cesse de compter.
 *
 * **Préfixée de son algorithme** (`sha256:<hex>`) : c'est la seule porte de
 * sortie pour introduire un jour un autre algorithme en RECONNAISSANT les
 * lignes anciennes, sans réécrire une seule base de production.
 *
 * @param content - contenu du fichier `.sql`, tel que lu sur le disque.
 * @returns l'empreinte préfixée, telle qu'elle est stockée en base.
 */
export function migrationHash(content: string): string {
  return `sha256:${createHash("sha256").update(normalizeSql(content), "utf8").digest("hex")}`;
}

/**
 * Normalise les fins de ligne d'un contenu SQL.
 *
 * @param content - contenu brut.
 * @returns le même contenu, fins de ligne en LF.
 */
export function normalizeSql(content: string): string {
  return content.replace(/\r\n/g, "\n");
}
