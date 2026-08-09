import { nodefonyError } from "nodefony";

/**
 * Le jeton n'a pas pu être VÉRIFIÉ — `code = 503`, et surtout **pas 401**.
 *
 * Levée quand ce qui sait valider un jeton est absent ou en panne : aucun
 * vérificateur posé au conteneur, émetteur injoignable, jeu de clés
 * inutilisable. Le jeton n'est alors ni valide ni invalide — on n'en sait
 * rien, et c'est une information différente.
 *
 * **Pourquoi une erreur distincte.** Répondre 401 à une panne envoie le client
 * chercher un autre jeton, qui échouera pareil : la boucle de renouvellement
 * remplace la panne par une tempête de requêtes, pendant que le tableau de bord
 * affiche une hausse d'« échecs d'authentification » qui ne désigne aucun
 * coupable. Le 503 dit la vérité — le service ne peut pas répondre — et le
 * client légitime attend au lieu d'insister.
 *
 * C'est la même distinction que celle tenue par le vérificateur lui-même, où
 * un refus rend `null` et une panne lève : la porte doit la conserver jusqu'à
 * la réponse, sinon elle est perdue là où elle sert.
 *
 * Le message est **constant**, et c'est structurel : il est rendu au client. La
 * cause technique — nom de l'émetteur défaillant, URL du jeu de clés, erreur
 * réseau — vit dans {@link detail}, que seul le journal lit. Composer la cause
 * dans le message revient à publier la topologie interne de l'authentification
 * à qui présente un jeton quelconque, et le rendu d'erreur de développement y
 * ajoute la pile d'appels par-dessus.
 */
export class UnverifiableTokenError extends nodefonyError {
  /** Cause technique, destinée au JOURNAL — jamais au client. */
  readonly detail?: string;

  /**
   * @param detail - cause technique pour le journal ; n'apparaît jamais dans le
   *          message rendu au client
   */
  constructor(detail?: string) {
    super("Token verification unavailable", 503);
    this.detail = detail;
  }
}

export default UnverifiableTokenError;
