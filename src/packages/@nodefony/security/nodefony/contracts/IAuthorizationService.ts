import type { IToken } from "./IToken";

/**
 * Service d'autorisation (niveau C de la sécurité, P6) — décide si un token a le
 * droit d'effectuer une action (`attribute`) sur un sujet (`subject`).
 *
 * Distinct de l'authentification (firewall = *QUI es-tu*) : l'autorisation
 * répond *PEUX-tu faire ça* via un jury de {@link IAccessVoter} agrégé en
 * **affirmative + DENY veto** (un seul `DENY` bloque ; sinon un `GRANT` suffit ;
 * silence total → `DENY`, Zero Trust).
 *
 * Consommé par les décorateurs (`@IsGranted`, J7) au hook `beforeResolve`, et
 * par le verrou de frame WS (« 1 garde = N transports ») : la même décision sert
 * REST et socket sans double implémentation.
 */
export interface IAuthorizationService {
  /**
   * Le token a-t-il le droit demandé ? `false` = accès refusé (le caller
   * répond 403).
   *
   * @param token - identité résolue par le firewall (jamais `null` — anonyme inclus).
   * @param attribute - droit demandé : un rôle (`"ROLE_ADMIN"`), une permission
   *   (`"PERM_project_edit"`) ou un attribut métier libre (`"project.edit"`).
   * @param subject - objet ciblé (entité, canal, path…) — passé aux voters
   *   contextuels (ownership, multi-tenant). `undefined` pour un droit global.
   * @returns `true` si accordé, `false` sinon (DENY veto, ou aucun GRANT).
   */
  decide(token: IToken, attribute: string, subject?: unknown): Promise<boolean>;
}
