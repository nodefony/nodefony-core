/**
 * Placeholder CSRF — réécriture complète en S4 (P6.7) : défense par défaut
 * **SameSite + Origin check** (OWASP CSRF Cheat Sheet 2024) + décorateur
 * `@CsrfProtect({ttl})` HMAC double-submit opt-in pour les routes critiques.
 *
 * Conservé uniquement pour le typage du champ legacy `HttpContext.csrf`
 * (actuellement non utilisé côté http). Ne PAS étendre ici — voir roadmap P6.7.
 */
export class Csrf {}

export default Csrf;
