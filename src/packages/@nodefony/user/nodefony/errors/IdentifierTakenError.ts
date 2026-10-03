import { nodefonyError } from "nodefony";

/**
 * Un compte local porte déjà cet identifiant — l'identifiant est UNIQUE dans
 * l'annuaire, quel que soit le dépôt (index unique en SQL et en document,
 * refus explicite en mémoire).
 *
 * `code = 409`. Comme {@link UserNotFoundError}, le détail reste côté serveur
 * (journal, audit) : le client d'un flux de connexion reçoit un échec uniforme.
 */
export class IdentifierTakenError extends nodefonyError {
  constructor(detail: string) {
    super(`Identifier already taken: ${detail}`, 409);
  }
}

export default IdentifierTakenError;
