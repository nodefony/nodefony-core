import { nodefonyError } from "nodefony";

/**
 * Erreur de **gestion** d'un credential WebAuthn (enrôlement) — porte un `code`
 * HTTP que l'adaptateur framework mappe par duck-typing (il n'importe jamais les
 * classes de `@nodefony/security`).
 *
 *  - `409` — plafond `passkeys.maxPerUser` atteint.
 *  - `421` — cérémonie demandée sous un hôte hors `trustedHosts` : aucun RP ID
 *    ne lui est attribué (RFC 9110 §15.5.20, même statut que la barrière du
 *    noyau HTTP).
 *
 * Distincte de la **cérémonie** elle-même (défi/signature/origine invalides →
 * `AuthenticationError` 401, message uniforme anti-énumération) : ici la
 * cérémonie a réussi cryptographiquement, c'est la politique du serveur qui
 * refuse d'enregistrer un credential de plus.
 */
export class WebAuthnError extends nodefonyError {
  // oxlint-disable-next-line no-useless-constructor -- pas redondant : il BORNE `code` aux seuls statuts que cette erreur puisse porter (409, 421), là où le parent accepte n'importe quel nombre
  constructor(message: string, code: 409 | 421) {
    super(message, code);
  }
}

export default WebAuthnError;
