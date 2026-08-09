import { nodefonyError } from "nodefony";

/**
 * La ressource demandée à l'émission ne peut pas être servie — `code = 400`,
 * code d'erreur OAuth `invalid_target` (RFC 8707 §2).
 *
 * Le paramètre `resource` dit POUR QUI le jeton est demandé. Trois raisons de
 * refuser, et la RFC les couvre d'un seul code : « The requested resource is
 * invalid, missing, unknown, or malformed. »
 *
 * **Pourquoi refuser plutôt qu'ignorer.** Un `resource` accepté puis jeté rend
 * un jeton parfaitement valide… pour quelqu'un d'autre. Le client croit tenir
 * une clé pour la porte A, la présente, reçoit un `401`, et n'a aucun moyen de
 * comprendre que sa demande n'a jamais été honorée : l'erreur se manifeste chez
 * la ressource, loin de l'endroit où elle a été commise. Refuser à l'émission
 * met le diagnostic là où la faute est.
 *
 * **Le message est constant** et ne nomme pas les audiences acceptées : les
 * énumérer offrirait la carte des ressources protégées de l'application à qui
 * possède un simple identifiant. La valeur refusée, elle, vient du client — la
 * lui rendre ne lui apprend rien.
 */
export class InvalidTargetError extends nodefonyError {
  /** Code d'erreur OAuth à rendre au client (RFC 6749 §5.2 / RFC 8707 §2). */
  readonly oauthError = "invalid_target";
  /** Ce que le client a demandé, tel qu'il l'a écrit — pour le journal. */
  readonly requested?: string;

  /**
   * @param description - raison, destinée à `error_description` (aucune fuite :
   *          elle qualifie la DEMANDE, jamais la configuration du serveur)
   * @param requested - la valeur refusée, pour le journal
   */
  constructor(description: string, requested?: string) {
    super(description, 400);
    this.requested = requested;
  }
}

export default InvalidTargetError;
