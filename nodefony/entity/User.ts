import { resolveInfra } from "nodefony";
import { defineEntity } from "@nodefony/orm-core";
import { createUserTable, FRAMEWORK_CONNECTOR } from "@nodefony/drizzle";
import type { SqlDialect } from "@nodefony/drizzle";

/**
 * Le dialecte SQL de cette application, déduit de l'infrastructure déclarée.
 *
 * `resolveInfra` est la fonction du cœur qui lit `NF_DATABASE_URL` — la MÊME que
 * le module Drizzle emploie pour choisir le dialecte de son connecteur. En
 * appeler une seconde, écrite ici, ferait que l'entité et la connexion pourraient
 * un jour désigner deux dialectes différents, sans que rien ne le signale.
 */
function appDialect(): SqlDialect {
  const database = resolveInfra(process.env).database;
  return database?.family === "sql" && database.dialect
    ? (database.dialect as SqlDialect)
    : "sqlite";
}

/**
 * L'entité `User` de CETTE application.
 *
 * Depuis que l'identité appartient au domaine, le framework ne livre plus la
 * table `User` dans ses migrations : l'application la possède, y ajoute ses
 * champs et en porte l'historique. Ce dépôt est lui-même une application — sans
 * cette entité, il ne tiendrait qu'en développement, où le schéma est dérivé du
 * code, et le dépôt de repli du framework refuserait de servir ailleurs.
 *
 * ## Ajouter un champ métier
 *
 * Ce dépôt n'en ajoute aucun : il éprouve le framework, il ne modélise aucun
 * métier. Une vraie application écrirait ses colonnes ici, à côté de celles du
 * contrat — et deux choses seraient alors à savoir :
 *
 * - **en écriture**, `IUserRepository` refuse un champ hors contrat (il est typé
 *   dessus) ; la porte est le dépôt GÉNÉRIQUE,
 *   `orm.getRepository<MonUtilisateur>("User")` ;
 * - **en lecture**, il n'y a rien à faire : les dépôts reportent sur
 *   l'utilisateur rendu toute colonne hors contrat.
 *
 * ## Pourquoi la table vient d'une fabrique, et n'est pas écrite à la main
 *
 * Une application ordinaire écrit son schéma Drizzle natif, pour le dialecte
 * choisi à sa création. Ce dépôt, lui, doit tourner sur les trois — sqlite en
 * développement, PostgreSQL et MySQL sur les bancs : figer un `sqliteTable` ici
 * casserait sous PostgreSQL, exactement le défaut que le chantier multi-dialecte
 * a corrigé. La fabrique publique du module rend la variante du dialecte
 * demandé, et aucune colonne n'est recopiée.
 */
/**
 * La table, EXPORTÉE — et pas seulement passée au descripteur.
 *
 * L'outil qui écrit les migrations est un process séparé : il ne voit pas les
 * objets d'une application démarrée, il lit les fichiers de `nodefony/entity/`
 * et y cherche les tables exportées. Une table seulement passée en argument y
 * serait invisible, et la migration s'écrirait SANS elle — sans un mot.
 */
export const userTable = createUserTable(appDialect());

export const AppUserEntity = defineEntity({
  name: "User",
  module: "app",
  connector: FRAMEWORK_CONNECTOR,
  schema: userTable,
});
