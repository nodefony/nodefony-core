import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Jeton synchronizer CSRF — modèle **double-submit signé** (OWASP CSRF Prevention
 * Cheat Sheet, « Signed Double-Submit Cookie »). Le token est
 * `nonce.HMAC-SHA256(secret, nonce)` (base64url), posé dans un cookie LISIBLE
 * (`csrf-token`, non HttpOnly) ET rejoué par le client dans l'en-tête
 * `x-csrf-token`. La défense `@CsrfProtect` exige les deux PRÉSENTS, ÉGAUX
 * (double-submit) et la signature HMAC VALIDE.
 *
 * **Stateless** (aucune session requise) → couvre le BFF (cookie de session) ET
 * l'API JWT sans coupler au stockage de session. Le secret HMAC empêche un script
 * tiers de forger un token (il ne peut pas calculer la signature) ; le double
 * submit empêche un attaquant cross-site d'en injecter un (il ne peut ni écrire
 * l'en-tête custom — préflight CORS — ni lire le cookie de la victime — SameSite + SOP).
 *
 * Pure et synchrone (1 HMAC à l'émission, 1 à la vérif) — payé UNIQUEMENT sur les
 * routes `@CsrfProtect` (la défense globale Fetch Metadata reste primaire, hot-path
 * GET = 0).
 *
 * @see OWASP CSRF Prevention Cheat Sheet · RFC 9110 §15.5.4 (403).
 */
export class CsrfTokenManager {
  readonly #secret: Buffer;

  /** Octets aléatoires du nonce (144 bits) — imprévisible, compact en base64url. */
  static readonly #NONCE_BYTES = 18;

  constructor(secret: string) {
    this.#secret = Buffer.from(secret, "utf8");
  }

  /** Émet un token signé `nonce.signature` (base64url). */
  issue(): string {
    const nonce = randomBytes(CsrfTokenManager.#NONCE_BYTES).toString(
      "base64url",
    );
    return `${nonce}.${this.#sign(nonce)}`;
  }

  /**
   * Vérifie une mutation `@CsrfProtect` : en-tête ET cookie présents, ÉGAUX
   * (double-submit, comparaison à temps constant) et signature HMAC valide. Tout
   * écart → `false` (le firewall lève alors un 403). Jamais d'exception.
   *
   * @param headerToken - valeur de l'en-tête `x-csrf-token` rejouée par le client.
   * @param cookieToken - valeur du cookie `csrf-token` posé par le serveur.
   */
  verify(
    headerToken: string | undefined,
    cookieToken: string | undefined,
  ): boolean {
    if (!headerToken || !cookieToken) return false;
    // Double-submit : l'en-tête doit refléter EXACTEMENT le cookie.
    if (!CsrfTokenManager.#timingSafeEqual(headerToken, cookieToken)) {
      return false;
    }
    const dot = headerToken.lastIndexOf(".");
    if (dot < 1 || dot === headerToken.length - 1) return false;
    const nonce = headerToken.slice(0, dot);
    const signature = headerToken.slice(dot + 1);
    return CsrfTokenManager.#timingSafeEqual(signature, this.#sign(nonce));
  }

  /** HMAC-SHA256 du nonce, base64url. */
  #sign(nonce: string): string {
    return createHmac("sha256", this.#secret).update(nonce).digest("base64url");
  }

  /** Comparaison à temps constant (longueurs différentes → false sans fuite de timing). */
  static #timingSafeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}

export default CsrfTokenManager;
