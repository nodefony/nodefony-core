import { mysqlTable, varchar, text as mysqlText } from "drizzle-orm/mysql-core";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";

/**
 * Décor d'une application qui DÉCLARE une table à elle, pour le banc
 * d'adoption en ligne de commande.
 *
 * ## Pourquoi ce fichier existe
 *
 * `orm:migrate:baseline --from-database` n'adopte que les tables de
 * l'APPLICATION : celles du framework ont leurs propres migrations, et sont
 * exclues de la lecture. Le dépôt, lui, ne déclarait aucune entité applicative
 * — l'adoption n'avait donc rien à lire, et la commande ne pouvait pas être
 * exercée sur un démarrage réel. Ce fichier fournit cette table manquante, et
 * seulement quand un banc la demande.
 *
 * ## Pourquoi il lit l'environnement, ce qu'un fichier d'entité ne fait jamais
 *
 * Deux processus séparés doivent voir la MÊME table : l'application qui démarre
 * (pour l'inscrire au registre) et l'outil de génération, qui importe ce
 * fichier sans rien savoir de l'application. L'environnement est le seul canal
 * qu'ils partagent. Et surtout, la table doit être INVISIBLE par défaut : un
 * export permanent entrerait dans toute génération lancée depuis le dépôt, et
 * ferait proposer la création d'une table de banc à un utilisateur du
 * framework.
 *
 * ## La grammaire
 *
 * `NF_ADOPT_FIXTURE=<dialecte>` — `sqlite`, `postgres` ou `mysql`.
 * `NF_ADOPT_FIXTURE=<dialecte>+slug` — la même table, avec le champ que
 * l'agent ajoute après l'adoption : c'est lui qui doit produire un `ALTER`, et
 * non un second `CREATE TABLE`.
 * `NF_ADOPT_FIXTURE=<dialecte>+usurpe` — une table de l'application qui porte
 * le nom d'une table du FRAMEWORK. Décrire ici une table que les migrations du
 * framework créent déjà produirait un second `CREATE TABLE` pour elle : la
 * migration passerait sur une base vierge et échouerait sur toute base déjà
 * migrée, c'est-à-dire en production et nulle part ailleurs. La génération doit
 * REFUSER, et ce refus n'était prouvé que par sa brique.
 *
 * Une valeur absente n'exporte AUCUNE table : le fichier s'importe, et il n'y
 * a rien à trouver dedans. C'est voulu — la découverte des entités lit le
 * disque, pas le registre.
 */
export const ADOPT_FIXTURE_TABLE = "adopt_cli_article";

/**
 * Table du FRAMEWORK dont la variante « usurpe » prend le nom.
 *
 * Choisie parce qu'elle ne sert qu'aux routes idempotentes : rien de ce que le
 * banc fait par ailleurs n'en dépend, et le refus attendu porte sur le NOM, pas
 * sur ce que la table contient.
 */
export const USURPED_FRAMEWORK_TABLE = "idempotency_key";

/** Connecteur du décor — celui de l'application, comme une entité normale. */
export const ADOPT_FIXTURE_CONNECTOR = "default";

/** Lecture de la consigne : le dialecte visé, et le champ ajouté ou non. */
const consigne = (process.env.NF_ADOPT_FIXTURE ?? "").trim();
const [dialecte, variante] = consigne.split("+");
const avecSlug = variante === "slug";
const usurpe = variante === "usurpe";

/**
 * La table telle que l'application la déclare — ou `undefined` hors banc.
 *
 * Le type est délibérément `unknown` : les trois variantes n'ont pas de type
 * commun en Drizzle, et personne ici ne lit de colonne. Ce qui compte est que
 * la découverte reconnaisse un objet `Table`, ce qu'elle fait à l'exécution.
 */
export const adoptFixtureTable: unknown =
  dialecte === "sqlite"
    ? sqliteTable(ADOPT_FIXTURE_TABLE, {
        id: sqliteText("id").primaryKey(),
        title: sqliteText("title").notNull(),
        ...(avecSlug ? { slug: sqliteText("slug") } : {}),
      })
    : dialecte === "postgres"
      ? pgTable(ADOPT_FIXTURE_TABLE, {
          id: pgText("id").primaryKey(),
          title: pgText("title").notNull(),
          ...(avecSlug ? { slug: pgText("slug") } : {}),
        })
      : dialecte === "mysql"
        ? mysqlTable(ADOPT_FIXTURE_TABLE, {
            // MySQL refuse une clé primaire sur un `text` sans longueur : le
            // décor est celui que le moteur PERMET, pas la transposition
            // littérale des deux autres.
            id: varchar("id", { length: 36 }).primaryKey(),
            title: mysqlText("title").notNull(),
            ...(avecSlug ? { slug: mysqlText("slug") } : {}),
          })
        : undefined;

/**
 * Une table de l'application qui porte le nom d'une table du framework.
 *
 * Exportée UNIQUEMENT sous la consigne « +usurpe » : un export permanent
 * entrerait dans toute génération lancée depuis le dépôt et ferait refuser
 * celle-ci pour de bon. Sa forme n'a aucune importance — c'est son NOM que la
 * génération doit reconnaître, avant même de regarder ses colonnes.
 */
export const usurpedFixtureTable: unknown =
  !usurpe || dialecte === undefined
    ? undefined
    : dialecte === "sqlite"
      ? sqliteTable(USURPED_FRAMEWORK_TABLE, {
          key: sqliteText("key").primaryKey(),
        })
      : dialecte === "postgres"
        ? pgTable(USURPED_FRAMEWORK_TABLE, {
            key: pgText("key").primaryKey(),
          })
        : dialecte === "mysql"
          ? mysqlTable(USURPED_FRAMEWORK_TABLE, {
              key: varchar("key", { length: 190 }).primaryKey(),
            })
          : undefined;

/**
 * Inscrit la table du décor au registre des entités, si un banc l'a demandée.
 *
 * À appeler depuis `onKernelRegister`, avant que l'adaptateur ne se connecte :
 * c'est le registre, et lui seul, qui dit à l'adoption ce que l'application
 * déclare sur ce connecteur.
 *
 * @returns `true` si une table a été inscrite, `false` hors banc.
 */
export function registerAdoptFixtureEntity(): boolean {
  if (adoptFixtureTable === undefined) {
    return false;
  }
  entityRegistry.register({
    connector: ADOPT_FIXTURE_CONNECTOR,
    module: "test",
    name: ADOPT_FIXTURE_TABLE,
    schema: adoptFixtureTable,
  });
  return true;
}
