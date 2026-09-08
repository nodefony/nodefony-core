/**
 * Barrel d'interfaces de la configuration de `@nodefony/http`.
 *
 * Ces types sont DÉRIVÉS du schéma Zod — leur source de vérité unique est
 * `../config/config.ts`, et ce fichier ne fait que les republier sous le chemin
 * d'interfaces attendu par la convention du dépôt (`nodefony/interfaces/I*.ts`).
 *
 * ⚠️ Un ré-export, jamais un alias (`export type IHttpConfig = HttpConfig`) :
 * un alias publierait DEUX noms pour le même type, tous deux dans les `.d.ts`
 * et l'autocomplétion du consommateur, sans que rien ne dise lequel est le bon.
 */
export type {
  /** Type de sortie (config normalisée + défauts appliqués). */
  IHttpConfig,
  /** Type d'entrée (toutes sections omissibles — défauts du schéma). */
  IHttpConfigInput,
} from "../config/config";
