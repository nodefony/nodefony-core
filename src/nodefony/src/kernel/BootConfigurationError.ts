/**
 * Erreur de **configuration** détectée pendant le boot — TOUJOURS fatale (dev
 * ET prod) pour un module critique, là où un échec de boot ordinaire n'est
 * fatal qu'en production (fail-soft dev).
 *
 * **Pourquoi cette classe existe** : le fail-soft de boot protège la DX (un
 * module optionnel cassé ne bloque pas le dev) — mais il devient un PIÈGE
 * quand l'échec vient d'une configuration EXPLICITE de l'utilisateur : une
 * infra déclarée (`NF_DATABASE_URL`) injoignable, une entité non portée sur le
 * dialecte demandé… Continuer en « dégradé » = session/users/tokens morts en
 * silence, avec un serveur qui répond 200 sur ses routes statiques (vécu :
 * login impossible, cause noyée dans un WARNING). Une erreur de configuration
 * ne se répare pas en continuant : elle se répare en la corrigeant → le boot
 * s'interrompt avec le message actionnable.
 *
 * Usage (module/service au boot) :
 * ```ts
 * throw new BootConfigurationError(
 *   `connecteur "default" (postgres) injoignable — démarrer l'infra déclarée ` +
 *     `NF_DATABASE_URL ou retirer la variable. Cause : ${cause.message}`,
 *   { cause },
 * );
 * ```
 *
 * Le tag `critical = false` d'un module reste respecté : un module déclaré
 * non-critique ne tue jamais le process, même sur une erreur de configuration.
 */
export class BootConfigurationError extends Error {
  override name = "BootConfigurationError";

  /**
   * Type guard TOLÉRANT aux copies multiples du package (dual-package /
   * bundles) : reconnaît l'instance OU toute `Error` portant le `name` de la
   * classe — un `instanceof` seul raterait une erreur construite par une autre
   * copie de `nodefony`.
   */
  static is(error: unknown): boolean {
    return (
      error instanceof BootConfigurationError ||
      (error instanceof Error && error.name === "BootConfigurationError")
    );
  }
}

export default BootConfigurationError;
