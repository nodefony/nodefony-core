import type { IColumnInfo } from "@nodefony/orm-core";
import type { SqlDialect } from "../../config/config";
import type { ISchemaReader } from "./catalog";

/**
 * L'écart entre le schéma DÉCLARÉ dans le code et le schéma RÉELLEMENT en base.
 *
 * ## Pourquoi ce calcul existe, et ce qu'il permet que personne d'autre ne fait
 *
 * Les outils de migration connaissent **deux** choses : les fichiers et
 * l'historique. Ils en déduisent « tout est appliqué » et s'arrêtent là. Ils ne
 * regardent jamais la base elle-même.
 *
 * Croiser une **troisième** source rend visible un incident courant et coûteux :
 * *l'historique est complet, aucune migration n'est en attente — et pourtant la
 * base ne correspond pas au code*. Quelqu'un a modifié la base à la main, un
 * correctif d'urgence n'a pas été reporté, deux environnements ont divergé.
 *
 * Le même calcul sert deux usages qui n'ont l'air d'avoir aucun rapport :
 *
 * - en développement, il **répare tout seul** le cas de loin le plus fréquent —
 *   le back a ajouté un champ, la table existe déjà, et la colonne manque ;
 * - en production, il **signale** la divergence, sans jamais rien réparer.
 *
 * ## Deux règles non négociables
 *
 * **1. Ce qui est EN PLUS est ignoré.** Le diff signale ce qui MANQUE, jamais
 * ce qu'il trouve en trop. Ce n'est pas de la prudence, c'est une condition
 * d'existence : toute application qui écrit des migrations libres (une vue, un
 * déclencheur, une colonne ajoutée à une table d'entité) a une base
 * légitimement et en permanence différente du schéma déclaré. Signaler le
 * surplus allumerait le voyant à vie chez ces utilisateurs — donc il serait
 * appris comme du bruit, donc il serait mort.
 *
 * **2. Le rattrapage est STRICTEMENT additif.** Il ajoute une colonne absente,
 * et seulement si elle accepte le vide. Jamais de suppression, jamais de
 * changement de type, jamais de passage en obligatoire — et jamais de valeur
 * inventée pour remplir une colonne obligatoire. Tout le reste est publié comme
 * un écart, avec le geste, et attend une décision humaine.
 */

/** Une colonne attendue par le code et absente de la base. */
export interface ISchemaGap {
  /** Table concernée, telle qu'elle s'appelle en base. */
  table: string;
  /** Colonne attendue. */
  column: string;
  /** Type SQL attendu, dans le dialecte du connecteur. */
  type: string;
  /** La colonne accepte-t-elle le vide ? (seules celles-ci se rattrapent) */
  nullable: boolean;
}

/** Ce que la comparaison a trouvé. */
export interface ISchemaComparison {
  /**
   * Colonnes manquantes qui acceptent le vide — rattrapables sans rien
   * inventer. C'est le cas fréquent : un champ ajouté par le back.
   */
  additive: ISchemaGap[];
  /**
   * Colonnes manquantes et OBLIGATOIRES — jamais rattrapées : les poser
   * exigerait d'inventer une valeur pour les lignes existantes, ce qui est une
   * décision métier, pas une décision d'outil.
   */
  blocking: ISchemaGap[];
  /** Tables entièrement absentes de la base. */
  missingTables: string[];
}

/**
 * Nomme ce qui manque, en trois mots plutôt qu'en trois lignes.
 *
 * Un refus qui dit « la base diverge » sans dire OÙ oblige à rouvrir un client
 * SQL — c'est-à-dire exactement le geste que ces commandes existent pour éviter.
 *
 * Écrite ici parce qu'elle a DEUX lecteurs, et qu'ils doivent nommer l'écart de
 * la même façon : l'adoption d'une base existante, et le générateur quand il
 * n'a rien à écrire. Deux formulations pour un même fait apprendraient à leurs
 * lecteurs qu'il s'agit de deux problèmes.
 *
 * @param c - les écarts, tels que la comparaison les rend.
 * @returns une énumération courte, prête à entrer dans une phrase.
 */
export function summarizeGap(c: ISchemaComparison): string {
  const bouts: string[] = [];
  if (c.missingTables.length > 0) {
    bouts.push(`table(s) absente(s) : ${c.missingTables.join(", ")}`);
  }
  const colonnes = [...c.blocking, ...c.additive].map(
    (g) => `${g.table}.${g.column}`,
  );
  if (colonnes.length > 0) {
    bouts.push(`colonne(s) absente(s) : ${colonnes.join(", ")}`);
  }
  return bouts.join(" · ");
}

/** La base s'écarte-t-elle du code ? */
export function hasGap(c: ISchemaComparison): boolean {
  return (
    c.additive.length > 0 || c.blocking.length > 0 || c.missingTables.length > 0
  );
}

/** Le schéma attendu d'une table, tel que le code le déclare. */
export interface IExpectedTable {
  table: string;
  columns: IColumnInfo[];
}

/**
 * Compare le schéma déclaré au schéma réel, table par table.
 *
 * Une requête par table, et **au démarrage uniquement** : rien de ceci n'existe
 * dans le chemin d'une requête.
 *
 * @param reader - lecteur de catalogue du porteur (ORM connecté, ou pilote).
 * @param expected - schéma attendu (cf `DrizzleOrm.describeTables`).
 * @returns les écarts, séparés selon qu'ils se rattrapent ou non.
 */
export async function compareSchema(
  reader: ISchemaReader,
  expected: readonly IExpectedTable[],
): Promise<ISchemaComparison> {
  const additive: ISchemaGap[] = [];
  const blocking: ISchemaGap[] = [];
  const missingTables: string[] = [];
  for (const attendue of expected) {
    if (!(await reader.tableExists(attendue.table))) {
      missingTables.push(attendue.table);
      continue;
    }
    // La base peut rendre les noms dans une autre casse que le code (MySQL sur
    // un système de fichiers insensible, notamment) : comparer sur une forme
    // normalisée évite d'annoncer manquante une colonne qui est là.
    const reelles = new Set(
      (await reader.columnsOf(attendue.table)).map((c) => c.toLowerCase()),
    );
    for (const col of attendue.columns) {
      if (reelles.has(col.name.toLowerCase())) {
        continue;
      }
      const gap: ISchemaGap = {
        table: attendue.table,
        column: col.name,
        type: col.type,
        nullable: col.nullable,
      };
      // Une clé primaire ne s'ajoute pas après coup, même déclarée nullable :
      // la poser change l'identité des lignes existantes.
      if (col.nullable && !col.primaryKey) {
        additive.push(gap);
      } else {
        blocking.push(gap);
      }
    }
  }
  return { additive, blocking, missingTables };
}

/** Échappe un identifiant dans le dialecte visé. */
function ident(name: string, dialect: SqlDialect): string {
  return dialect === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/**
 * Le `ALTER TABLE` qui pose une colonne manquante.
 *
 * Aucune valeur par défaut n'est émise, et aucune contrainte : la colonne est
 * ajoutée telle que le code la déclare, nullable. Ajouter un défaut ici
 * reviendrait à inventer la donnée des lignes existantes.
 *
 * @param gap - la colonne manquante (elle DOIT accepter le vide).
 * @param dialect - dialecte du connecteur.
 * @returns le SQL, prêt à exécuter.
 * @throws Error si l'on tente de rattraper une colonne obligatoire.
 */
export function additiveSql(gap: ISchemaGap, dialect: SqlDialect): string {
  if (!gap.nullable) {
    throw new Error(
      `Rattrapage refusé : la colonne « ${gap.table}.${gap.column} » est ` +
        `obligatoire. La poser exigerait d'inventer une valeur pour les lignes ` +
        `déjà présentes — c'est une décision métier, pas une décision d'outil.`,
    );
  }
  return (
    `ALTER TABLE ${ident(gap.table, dialect)} ` +
    `ADD COLUMN ${ident(gap.column, dialect)} ${gap.type}`
  );
}
