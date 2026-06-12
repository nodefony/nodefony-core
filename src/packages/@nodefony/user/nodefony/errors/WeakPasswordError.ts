import { nodefonyError } from "nodefony";

/**
 * Mot de passe refusé par la politique (connu-compromis / interdit) — `code = 400`.
 *
 * Levée par `UserService.createUser`/`changePassword` quand le
 * {@link IPasswordBlocklist} branché rejette le candidat. Le message reste
 * générique : ni la source de la liste ni le mot de passe ne sont exposés.
 */
export class WeakPasswordError extends nodefonyError {
  constructor() {
    super("Password rejected by policy", 400);
  }
}

export default WeakPasswordError;
