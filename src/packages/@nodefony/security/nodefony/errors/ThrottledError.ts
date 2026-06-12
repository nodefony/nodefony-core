import { nodefonyError } from "nodefony";

/**
 * Tentatives de login trop rapprochées — `code = 429` (RFC 6585 §4).
 *
 * Levée par `UserPasswordAuthenticator` quand le backoff progressif
 * ({@link LoginThrottler}) bloque encore l'identifiant saisi. Distincte du 401 :
 * un client légitime doit savoir QU'ATTENDRE (header `Retry-After`, posé par le
 * firewall), pas re-soumettre en boucle. Le message reste générique — la
 * politique de throttle (seuils, compteurs) n'est jamais détaillée au client.
 */
export class ThrottledError extends nodefonyError {
  /** Secondes restantes avant la prochaine tentative autorisée (header `Retry-After`). */
  readonly retryAfterS: number;

  constructor(retryAfterS: number) {
    super("Too many attempts", 429);
    this.retryAfterS = retryAfterS;
  }
}

export default ThrottledError;
