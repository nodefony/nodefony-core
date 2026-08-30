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
 * Ce que la base porte face à ce que le code DÉCLARE, sans condition de verdict.
 *
 * Séparé de {@link describeDivergence} parce que les deux répondent à des
 * questions différentes, et que la seconde REFUSE de répondre avant que le plan
 * soit à jour — ce qui est juste pour un rapport d'état (un écart n'a de sens
 * qu'une fois tout appliqué) et faux pour qui doit décider AVANT d'agir.
 *
 * Le cas qui a exigé cette séparation : l'adoption d'une base existante. Elle
 * doit constater l'état RÉEL avant d'écrire quoi que ce soit dans l'historique
 * — après, il est trop tard, l'affirmation est déjà gravée.
 *
 * Ne modifie jamais rien, et ne jette jamais : une base muette n'est pas une
 * divergence, c'est une panne, qui a sa propre voie de signalement.
 *
 * @param connector - nom du connecteur à interroger.
 * @returns les écarts nommés, ou `null` (rien à dire, ou rien d'interrogeable).
 */
export async function gapAgainstDeclared(
  connector: string,
): Promise<ISchemaComparison | null> {
  const comparison = await comparisonAgainstDeclared(connector);
  return comparison !== null && hasGap(comparison) ? comparison : null;
}

/**
 * La comparaison BRUTE — ce que la base porte face au code, écart ou non.
 *
 * Séparée de {@link gapAgainstDeclared}, qui ne rend que les écarts : il existe
 * une question à laquelle « aucun écart » est une réponse pleine, et non un
 * silence. Celle-ci : *la base porte-t-elle DÉJÀ les tables que je m'apprête à
 * créer ?* Une base parfaitement conforme y répond « oui », et c'est justement
 * le cas où il ne faut pas écrire un `CREATE TABLE`.
 *
 * Ne modifie jamais rien, et ne jette jamais : une base muette n'est pas une
 * conformité, c'est une absence de réponse — rendue `null` pour que personne
 * ne conclue à sa place.
 *
 * @param connector - nom du connecteur à interroger.
 * @returns la comparaison, ou `null` si rien n'était interrogeable.
 */
export async function comparisonAgainstDeclared(
  connector: string,
): Promise<ISchemaComparison | null> {
  const orm = comparable(connector);
  if (!orm?.isConnected()) {
    return null;
  }
  try {
    return await orm.compareToDeclared();
  } catch {
    return null;
  }
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
  // La base n'a pas répondu, le connecteur n'est pas comparable, ou il n'y a
  // aucun écart : la brique ci-dessus le dit déjà, et une seconde lecture de la
  // base pour la même question finirait par rendre une autre réponse.
  return gapAgainstDeclared(plan.connector);
}
