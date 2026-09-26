import { thrownMessage } from "../errors/thrownMessage";
/**
 * Ce qu'on répond quand le stockage de session est inutilisable.
 *
 * Une requête doit TOUJOURS recevoir une réponse. La sauvegarde de session a
 * lieu juste avant l'écriture des en-têtes : une exception qui remonte de là
 * laisse la socket ouverte, et le client attend jusqu'à son propre délai. Rien
 * dans ses journaux ne nomme la cause — l'exploitant cherche du côté du réseau
 * ou de la charge, et le banc de tenue dans la durée est resté rouge dix jours
 * pour cette seule raison.
 *
 * Le cas de loin le plus courant est une application mise en ligne **sans ses
 * migrations** : la table de session n'existe pas, et `session.store: "auto"`
 * retombe sur SQLite dès que l'ORM est chargé. C'est un oubli banal que le
 * framework doit rendre BRUYANT.
 *
 * Pourquoi 500 et non une réponse normale : une session qu'on ne sait pas
 * persister est une **dégradation**, pas une indisponibilité passagère. Servir
 * 200 laisserait croire que la connexion a été retenue alors que rien n'a été
 * écrit — c'est exactement la dégradation silencieuse que ce framework refuse.
 */

/** La conduite à tenir : ce qu'on répond, et ce qu'on écrit dans le journal. */
export interface ISessionStoreFailure {
  /** Le statut à servir — toujours 500 : le serveur n'a pas tenu sa part. */
  statusCode: number;
  /** Le corps servi au client : sobre, il ne divulgue aucun détail interne. */
  body: string;
  /** La ligne de journal côté serveur — elle NOMME la cause et le remède. */
  message: string;
}

/**
 * Reconnaît une table de session absente, quel que soit le dialecte.
 *
 * Chaque moteur formule le même défaut à sa façon, et aucun ne porte de code
 * commun : SQLite dit « no such table », PostgreSQL « relation ... does not
 * exist », MySQL « doesn't exist ». On reste volontairement large — le seul
 * enjeu est de savoir s'il faut PARLER DE MIGRATIONS, jamais de trancher une
 * branche de code.
 */
function looksLikeMissingTable(text: string): boolean {
  return (
    /no such table/i.test(text) ||
    /does ?n[o']?t exist/i.test(text) ||
    /undefined table/i.test(text) ||
    /unknown table/i.test(text)
  );
}

/**
 * Compose la réponse et le journal d'une panne du stockage de session.
 *
 * @param error - l'erreur remontée par le store.
 * @returns le statut, le corps à servir, et la ligne de journal.
 */
export function describeSessionStoreFailure(
  error: unknown,
): ISessionStoreFailure {
  const cause =
    error === null || error === undefined
      ? "cause inconnue"
      : thrownMessage(error);
  // Le remède d'abord : c'est ce que l'exploitant doit FAIRE. Un message qui
  // n'énonce qu'une cause envoie chercher là où il n'y a rien.
  const remedy = looksLikeMissingTable(cause)
    ? " La table de session est probablement absente : appliquer les migrations " +
      "(`nodefony orm:migrate`) avant de servir, ou choisir un autre stockage " +
      "(`http.session.store`)."
    : " Vérifier que le stockage de session déclaré sous `http.session.store` " +
      "est joignable ; à défaut, appliquer les migrations (`nodefony orm:migrate`).";

  return {
    statusCode: 500,
    // Sobre côté client : le détail reste dans le journal du serveur.
    body: "Internal Server Error — session store unavailable",
    message:
      `La session n'a pas pu être persistée — la requête est servie en 500 ` +
      `plutôt que laissée sans réponse. Cause : ${cause}.${remedy}`,
  };
}
