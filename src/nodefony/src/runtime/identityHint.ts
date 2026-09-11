import type { IKernel } from "../types/IKernel";

/** Nom du module qui porte l'authentification dans une application Nodefony. */
const SECURITY_MODULE = "security";

/**
 * Le geste qui donne une IDENTITÉ dans cette application — ou `null`.
 *
 * Protéger une route est immédiat : un décorateur, et le générateur le pose.
 * L'APPELER ensuite ne l'est pas, et c'est le trou qu'on a mesuré — 33 minutes
 * sur 89 dans un essai réel, entre le premier refus et l'abandon. Le framework
 * refusait correctement, expliquait bien SON refus, et laissait celui qui
 * venait d'écrire la route sans aucun moyen de l'essayer : il disait comment
 * DIAGNOSTIQUER, jamais comment obtenir une identité.
 *
 * La phrase rendue ici est donc un GESTE, sur le modèle des refus de
 * `create entity` (cause, conséquence, geste) — et elle se CONSTATE : une
 * application sans module d'identité n'a pas la commande, lui prescrire serait
 * l'envoyer sur un `command not found`.
 *
 * **Hors développement, cette fonction rend `null`** : la même phrase serait
 * l'oracle que les codes de refus s'interdisent d'être (« il te manque
 * ROLE_ADMIN » renseigne autant l'attaquant que le développeur). Une absence
 * de mode vaut production, jamais l'inverse — même règle que le détail d'un
 * refus temps réel.
 *
 * @param kernel - le kernel de l'application, s'il est connu.
 * @returns la phrase à joindre au refus, ou `null` (production, ou kernel
 *   inconnu — dans le doute on ne dit rien).
 */
export function identityHint(
  kernel: IKernel | null | undefined,
): string | null {
  const env = kernel?.environment;
  if (!env || env !== "development") return null;
  if (!(SECURITY_MODULE in (kernel?.modules ?? {}))) {
    return (
      `cette application n'a AUCUN module d'identité : rien ne peut donc ` +
      `s'authentifier, et toute route gardée refusera. Ajoute @nodefony/security ` +
      `et @nodefony/user (npm i), puis use("@nodefony/security", {…}) dans ` +
      `nodefony.config.ts — ou retire la garde de cette route`
    );
  }
  return (
    `pour ESSAYER cette route, il te faut une identité : crée un compte avec ` +
    `\`npx nodefony security:user:add <identifiant> --admin\`, puis authentifie-toi ` +
    `(POST /nodefony/security/api/auth/login, {"username","password"}) — la ` +
    `session obtenue porte tes rôles. Une application générée en contenu ` +
    `COMPLET seede un compte au premier démarrage et l'annonce dans son ` +
    `journal de boot (contexte USERS)`
  );
}
