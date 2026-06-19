import { nodefonyError } from "nodefony";

/**
 * Erreur de **gestion** d'une clé API (création/révocation) — porte un `code`
 * HTTP que l'adaptateur framework mappe par duck-typing (il n'importe jamais les
 * classes de `@nodefony/security`).
 *
 *  - `400` — entrée invalide (nom vide, scope hors catalogue) ;
 *  - `409` — plafond `apiKeys.maxPerSubject` atteint ;
 *  - `503` — store de jetons indisponible (clés activées mais non provisionnées).
 *
 * Distincte de l'**authentification** d'une clé présentée (→ `AuthenticationError`
 * 401, message uniforme anti-énumération).
 */
export class ApiKeyError extends nodefonyError {
  constructor(message: string, code: 400 | 409 | 503) {
    super(message, code);
  }
}

export default ApiKeyError;
