import { nodefonyError } from "nodefony";

/**
 * Erreur de **gestion** d'un credential WebAuthn (enrôlement) — porte un `code`
 * HTTP que l'adaptateur framework mappe par duck-typing (il n'importe jamais les
 * classes de `@nodefony/security`).
 *
 *  - `409` — plafond `passkeys.maxPerUser` atteint.
 *
 * Distincte de la **cérémonie** elle-même (défi/signature/origine invalides →
 * `AuthenticationError` 401, message uniforme anti-énumération) : ici la
 * cérémonie a réussi cryptographiquement, c'est la politique du serveur qui
 * refuse d'enregistrer un credential de plus.
 */
export class WebAuthnError extends nodefonyError {
  // oxlint-disable-next-line no-useless-constructor -- pas redondant : il FIGE `code` à 409, seul statut que cette erreur puisse porter, là où le parent accepte n'importe quel nombre
  constructor(message: string, code: 409) {
    super(message, code);
  }
}

export default WebAuthnError;
