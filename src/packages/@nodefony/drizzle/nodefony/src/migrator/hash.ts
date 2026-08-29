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
 * Normalise un contenu SQL : marque d'ordre des octets retirée, fins de ligne en LF.
 *
 * Les deux gestes répondent au même fait — **le fichier a voyagé** — et doivent
 * donc vivre au même endroit, sous peine de ne corriger qu'une moitié du
 * problème.
 *
 * **La marque d'ordre des octets** (`U+FEFF`) est posée en tête par les
 * éditeurs Windows et par PowerShell (`>` et `Out-File` l'écrivent par défaut).
 * `fs.readFile(…, "utf8")` ne la retire pas : elle reste le premier caractère du
 * contenu. Sans ce nettoyage, la première ligne cesse d'être reconnue comme le
 * marqueur de format, et le refus affiche deux chaînes **visuellement
 * identiques** — « attendu ceci, lu cela », avec ceci et cela à l'œil pareils.
 * C'est le pire message d'erreur possible : celui qui n'apprend rien.
 *
 * @param content - contenu brut, tel que lu sur le disque.
 * @returns le même contenu, sans marque d'ordre des octets et en LF.
 */
export function normalizeSql(content: string): string {
  const sansBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return sansBom.replace(/\r\n/g, "\n");
}
