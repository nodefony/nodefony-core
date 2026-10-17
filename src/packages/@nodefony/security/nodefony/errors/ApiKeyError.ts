import { nodefonyError } from "nodefony";

/**
 * Erreur de **gestion** d'une clé API (création/révocation) — porte un `code`
 * HTTP que l'adaptateur framework mappe par duck-typing (il n'importe jamais les
 * classes de `@nodefony/security`).
 *
 *  - `400` — entrée invalide (nom vide, scope hors catalogue) ;
 *  - `403` — scope demandé que le porteur ne peut pas obtenir (`grantableScopes`,
 *    ou `admin:*` sans le rôle d'administration) ;
 *  - `409` — plafond `apiKeys.maxPerSubject` atteint ;
 *  - `503` — store de jetons indisponible (clés activées mais non provisionnées).
 *
 * Distincte de l'**authentification** d'une clé présentée (→ `AuthenticationError`
 * 401, message uniforme anti-énumération).
 */
export class ApiKeyError extends nodefonyError {
  // oxlint-disable-next-line no-useless-constructor -- pas redondant : il RESTREINT `code` aux quatre statuts admis ci-dessus, là où le parent accepte n'importe quel nombre
  constructor(message: string, code: 400 | 403 | 409 | 503) {
    super(message, code);
  }
}

export default ApiKeyError;
