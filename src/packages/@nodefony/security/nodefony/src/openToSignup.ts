import type { ISecurityConfig } from "../config/config";

/** Une zone que la connexion OAuth ouvre à quiconque obtient un compte. */
export interface IOpenToSignupZone {
  /** Nom de la zone (`areas.<nom>`). */
  zone: string;
  /** Fournisseurs OAuth qui créent les comptes à la volée, triés. */
  providers: readonly string[];
  /** Le constat, en une phrase — la MÊME au démarrage, dans la console et dans `doctor`. */
  message: string;
  /** Les deux gestes qui le soldent, prêts à taper. */
  action: string;
}

/**
 * Les zones protégées qui n'exigent aucun rôle alors que la connexion OAuth
 * crée les comptes à la volée — c'est-à-dire ouvertes à tout compte que le
 * fournisseur délivre.
 *
 * Une zone sans `roles` laisse passer toute identité authentifiée : c'est un
 * défaut voulu. Il devient un piège quand `oauth2.allowSignup` vaut `true`
 * (le défaut) : avec Google ou GitHub, « authentifié » veut dire « n'importe
 * qui sur Internet ». Une zone est donc retenue quand TOUT ceci est vrai :
 * protégée, sans `anonymous`, sans `roles`, avec `session` (c'est par la
 * session qu'un compte OAuth entre), et `oauth2` actif avec au moins un
 * fournisseur et `allowSignup`.
 *
 * Le remède est une DÉCLARATION : `roles: ["ROLE_USER"]` ne change rien au
 * comportement (un compte créé reçoit ce rôle) mais écrit l'intention.
 *
 * Calculée au démarrage et dans `describe()`, jamais par requête. C'est la
 * SEULE implémentation de la règle : `doctor` lit son résultat par le plan
 * d'administration, il ne la recalcule pas.
 *
 * @param config - la configuration de sécurité validée.
 * @returns les zones concernées, dans l'ordre de déclaration ; vide sinon.
 */
export function findZonesOpenToSignup(
  config: Pick<ISecurityConfig, "areas" | "oauth2">,
): IOpenToSignupZone[] {
  const { oauth2 } = config;
  if (!oauth2.enabled || !oauth2.allowSignup) return [];
  const providers = Object.keys(oauth2.providers).sort();
  if (providers.length === 0) return [];

  const found: IOpenToSignupZone[] = [];
  for (const [zone, area] of Object.entries(config.areas)) {
    if (!area.security) continue;
    if (area.roles.length > 0) continue;
    if (area.authenticators.includes("anonymous")) continue;
    if (!area.authenticators.includes("session")) continue;
    const who = providers.join(", ");
    found.push({
      zone,
      providers,
      message:
        `la zone « ${zone} » est ouverte à tout compte que ${who} ` +
        `${providers.length > 1 ? "délivrent" : "délivre"} : ` +
        "elle n'exige aucun rôle, et la connexion OAuth crée les comptes à la " +
        "volée (`oauth2.allowSignup`)",
      action:
        `pour l'assumer, déclarer \`roles: ["ROLE_USER"]\` sur \`areas.${zone}\` ; ` +
        "pour la fermer, poser `oauth2.allowSignup: false` (un compte local " +
        "préexistant devient alors requis)",
    });
  }
  return found;
}
