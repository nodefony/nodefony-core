/**
 * Le message d'un **semis de compte qui a échoué** — celui que l'erreur, seule,
 * ne peut pas écrire.
 *
 * Le problème est un partage d'information, pas un défaut de code.
 * {@link WeakPasswordError} nomme la règle enfreinte et **rien d'autre** : ni le
 * compte visé, ni la valeur refusée, parce qu'un message d'erreur finit dans un
 * journal. Le seul à savoir QUI était semé, et D'OÙ venait le mot de passe, est
 * l'appelant. Tant que les deux moitiés restent séparées, l'exploitant lit
 * « Mot de passe refusé : contient l'identifiant du compte » sans savoir quel
 * compte, ni quoi corriger — vécu : une application générée ne démarrait plus,
 * et la seule trace utile était une ligne perdue dans un journal détaché.
 *
 * Ce module réunit les deux moitiés, une fois pour tout le monde : le gabarit
 * d'application, le dépôt de développement du framework et toute application
 * qui sème ses propres comptes appellent la MÊME fonction. Recopier ce message
 * dans chaque semis le ferait diverger en silence — et c'est le message, pas le
 * code, qui fait la différence entre dix secondes et une demi-heure.
 */

/** Ce que l'appelant sait du semis, et que l'erreur ignore. */
export interface ISeedFailureContext {
  /** Identifiant du compte qu'on tentait de semer (`"admin"`). */
  identifier: string;
  /**
   * Variable d'environnement qui porte le mot de passe (`"NF_ADMIN_PASSWORD"`).
   */
  envVar: string;
  /**
   * Le mot de passe venait-il de {@link envVar} ?
   *
   * `false` = il vient d'un défaut écrit dans le code de l'application. Envoyer
   * corriger une variable que personne n'a posée ferait chercher là où il n'y a
   * rien : le remède n'est alors pas le même geste.
   */
  fromEnv: boolean;
  /** Le compte visait-il un rôle d'administration ? Décide du `--admin` du remède. */
  admin?: boolean;
}

/**
 * Rédige le message d'un semis raté : QUEL compte, QUELLE règle, QUEL geste.
 *
 * Les trois sont indissociables. Un message qui nomme la règle sans le compte
 * laisse chercher lequel ; un message qui nomme le compte sans le geste laisse
 * l'exploitant devant un constat. Et la dernière phrase dit ce que le lecteur se
 * demande immédiatement : l'application tourne-t-elle encore ?
 *
 * @param cause - ce que la création du compte a levé.
 * @param context - ce que l'appelant est seul à savoir.
 * @returns le message à journaliser, sans saut de ligne (il part en `ERROR`).
 */
export function describeSeedFailure(
  cause: unknown,
  context: ISeedFailureContext,
): string {
  const { identifier, envVar, fromEnv, admin = false } = context;
  const why = seedFailureReason(cause);
  const remedy = fromEnv
    ? `Corrige ${envVar}`
    : `Ce mot de passe est le défaut écrit dans le code de l'application — ` +
      `pose ${envVar} (\`.env.local\`, gestionnaire de secrets)`;
  return (
    `Le compte "${identifier}" n'a PAS été semé : ${why}. ${remedy}, ou crée ` +
    `le compte à la main : \`npx nodefony security:user:add ${identifier}` +
    `${admin ? " --admin" : ""}\`. Le démarrage continue — l'application ` +
    `tourne, sans ce compte.`
  );
}

/**
 * La cause, en clair — la règle de la politique quand il y en a une.
 *
 * La règle se lit sur la PROPRIÉTÉ `violation`, jamais par `instanceof` : une
 * application qui se retrouve avec deux copies de `@nodefony/user` (hissage npm,
 * lien local, monorepo) verrait le test de classe échouer et perdrait la seule
 * information utile — au pire endroit, celui où l'on explique un échec.
 *
 * @param cause - ce qui a été levé.
 * @returns la règle enfreinte, ou le message de l'erreur.
 */
function seedFailureReason(cause: unknown): string {
  const violation = (cause as { violation?: unknown } | null)?.violation;
  if (typeof violation === "string" && violation.length > 0) {
    return `mot de passe refusé (${violation})`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
