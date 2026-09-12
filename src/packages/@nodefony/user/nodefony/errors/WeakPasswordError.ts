import { nodefonyError } from "nodefony";

/**
 * Mot de passe refusé par la politique (connu-compromis / interdit) — `code = 400`.
 *
 * Levée par `UserService.createUser`/`changePassword` quand le
 * {@link IPasswordBlocklist} branché rejette le candidat. Le message NOMME la
 * règle enfreinte quand la politique sait la dire, et rien d'autre : ni la
 * source de la liste, ni le mot de passe — il finirait dans un journal.
 */
export class WeakPasswordError extends nodefonyError {
  /** La règle enfreinte, telle que la politique l'a nommée (`null` si muette). */
  readonly violation: string | null;

  /**
   * @param violation - règle enfreinte, en français. Omise, le message reste
   *   générique — c'est le cas d'une implémentation qui ne rend qu'un booléen.
   */
  constructor(violation?: string | null) {
    super(
      violation != null && violation.length > 0
        ? `Mot de passe refusé : ${violation}`
        : "Mot de passe refusé par la politique de l'application",
      400,
    );
    this.violation = violation ?? null;
  }
}

export default WeakPasswordError;
