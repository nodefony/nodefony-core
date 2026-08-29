import { ormRegistry } from "@nodefony/orm-core";
import type { IMigrationPlan } from "./types";
import { verdictOf } from "./explain";
import { hasGap, type ISchemaComparison } from "./schemaDiff";

/**
 * La TROISIÈME source — la base elle-même.
 *
 * Les outils de migration en connaissent deux : les fichiers, et l'historique.
 * Ils en concluent « tout est appliqué » sans avoir jamais regardé la base. Ce
 * croisement rend visible l'incident qu'aucun d'eux ne voit :
 *
 * > l'historique est complet, aucune migration n'est en attente — **et pourtant
 * > la base ne correspond pas au code**.
 *
 * Quelqu'un a passé un `ALTER` à la main, un correctif d'urgence n'a pas été
 * reporté, deux environnements ont divergé.
 *
 * ## Ce qui rend ce calcul PAYABLE
 *
 * Il ne tourne que lorsque les deux premières sources n'ont plus rien à dire.
 * Tant qu'une migration est en attente, en échec ou manquante, le verdict est
 * déjà décidé par elle : comparer la base ne changerait pas la conclusion et
 * coûterait une requête par table. La divergence ne s'achète donc qu'au moment
 * précis où elle est la SEULE chose que l'on puisse encore apprendre.
 */

/**
 * Un connecteur capable de dire ce que le code déclare, et ce que la base a.
 *
 * Contrat minimal volontaire : il est satisfait par `DrizzleOrm`, sans que ce
 * fichier ait à l'importer — il vit sous `migrator/`, et l'applicateur ne doit
 * pas tirer l'adapter avec lui.
 */
interface IComparableOrm {
  isConnected(): boolean;
  compareToDeclared(): Promise<ISchemaComparison>;
}

/** Le connecteur enregistré sait-il se comparer à ce que le code déclare ? */
function comparable(connector: string): IComparableOrm | null {
  const orm = ormRegistry.get(connector) as unknown as
    Partial<IComparableOrm> | undefined;
  return typeof orm?.compareToDeclared === "function" &&
    typeof orm.isConnected === "function"
    ? (orm as IComparableOrm)
    : null;
}

/**
 * Ce qui diverge, NOMMÉ — ou `null` quand il n'y a rien à dire.
 *
 * Producteur UNIQUE de la troisième source : le verdict, la phrase française,
 * la charge utile `--json` et la sonde de disponibilité lisent tous ce même
 * retour. Rendre un booléen ici et recalculer le détail ailleurs ferait deux
 * lectures de la base pour une seule question, et deux réponses qui finiraient
 * par se contredire.
 *
 * Répond `null` sans rien interroger dans tous les cas où la réponse ne
 * changerait rien : plan déjà porteur d'un verdict, connecteur absent du
 * registre, connecteur non connecté, ORM d'une autre nature (mongoose n'a pas
 * de schéma déclaré à comparer). Répond `null` aussi quand la comparaison a eu
 * lieu et n'a rien trouvé — l'absence d'écart ne garde pas d'objet vide en
 * mémoire, et l'appelant n'a qu'un test à écrire.
 *
 * **Ne modifie jamais rien** — le rattrapage additif est le travail du mode de
 * schéma dérivé, au démarrage, et de lui seul.
 *
 * @param plan - plan calculé par l'applicateur, en lecture seule.
 * @returns les écarts nommés, ou `null` s'il n'y en a pas à publier.
 */
export async function describeDivergence(
  plan: IMigrationPlan,
): Promise<ISchemaComparison | null> {
  if (verdictOf(plan) !== "up-to-date") {
    return null;
  }
  const orm = comparable(plan.connector);
  if (!orm?.isConnected()) {
    return null;
  }
  try {
    const comparison = await orm.compareToDeclared();
    return hasGap(comparison) ? comparison : null;
  } catch {
    // La base n'a pas répondu, ou le catalogue est illisible : ce n'est PAS une
    // divergence, et le prétendre retiendrait un pod pour une panne qui a déjà
    // sa propre voie de signalement.
    return null;
  }
}
