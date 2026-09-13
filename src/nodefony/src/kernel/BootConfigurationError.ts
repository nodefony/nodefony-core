import { SysExit } from "../cli/sysexits";

/**
 * Erreur de **configuration** détectée pendant le boot — TOUJOURS fatale, dans
 * TOUS les environnements et pour TOUT module, là où un échec de boot ordinaire
 * n'est fatal qu'en production pour un module critique (fail-soft ailleurs).
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
 * 🔴 **Le tag `critical = false` ne s'applique PAS ici**, et c'est délibéré. Les
 * deux répondent à des questions différentes : `critical = false` dit « cette
 * application peut tourner SANS ce module » — une affirmation sur sa
 * DISPONIBILITÉ ; cette erreur dit « ce que l'utilisateur a écrit ne peut pas
 * être honoré » — une affirmation sur son INTENTION. Les confondre faisait
 * démarrer un module optionnel en IGNORANT sa configuration, avec pour seule
 * trace un avertissement dans le journal.
 *
 * Ce que cela ne change pas : un module optionnel dont l'INFRA est absente
 * (Redis éteint) ne lève pas cette erreur — il propage une `Error` ordinaire,
 * qui reste fail-soft en développement. C'est ce qui rend l'arbitrage sûr, et
 * c'est ce qu'il fallait vérifier avant de le rendre : au moment de la décision,
 * dans les cinq modules `critical = false` du dépôt, la seule source de cette
 * erreur était la validation de configuration ({@link parseModuleConfig}).
 */
export class BootConfigurationError extends Error {
  override name = "BootConfigurationError";

  /**
   * Code de sortie du process — `EX_CONFIG` (78), pas le `EX_SOFTWARE` (70) par
   * défaut. Une faute de CONFIGURATION n'est pas une erreur interne : un script
   * appelant, un orchestrateur ou une chaîne d'intégration doivent pouvoir les
   * distinguer sans lire un journal. Les autres refus de configuration du boot
   * rendaient déjà ce code (cf `Kernel.bootConfigError`) — le porter ICI évite
   * qu'un refus sorte en 78 et son voisin en 70 selon le producteur.
   *
   * Lu par duck-typing (`(e as { exitCode?: number }).exitCode`) sur le chemin
   * d'abandon du boot, comme pour `nodefonyError`.
   */
  exitCode: number = SysExit.CONFIG;

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
