import { ADMIN_DEFAULT_ROLE } from "../kernel/adminPlane/adminRbac";
import { rolesFromScopes } from "../kernel/adminPlane/adminCaller";

/**
 * Ce qu'une porte MCP sait d'elle-même et de son appelant, au moment de dire
 * quels rôles celui-ci porte.
 *
 * Les trois champs sont séparés parce qu'ils répondent à trois questions
 * distinctes que confondre a déjà coûté : « cette porte exige-t-elle une
 * autorisation ? », « une identité a-t-elle été prouvée ? », « qu'ouvre-t-elle ? ».
 */
export interface IMcpGatePosture {
  /**
   * La porte déclare-t-elle un serveur d'autorisation ?
   *
   * ⚠️ À ne PAS confondre avec `authenticated`. Une porte protégée peut tolérer
   * l'anonyme ; une porte non protégée n'a personne à authentifier. Ce sont ces
   * deux cas — tous deux « non authentifiés » — qui doivent recevoir des
   * réponses opposées.
   */
  protected: boolean;
  /** Un jeton a-t-il été vérifié pour cet appel ? */
  authenticated: boolean;
  /** Scopes que le serveur d'autorisation a réellement accordés. */
  scopes: readonly string[];
}

/**
 * Quels rôles porte l'appelant d'une porte MCP — **la règle, à un seul endroit**.
 *
 * ⭐ Toute porte MCP passe par ici, y compris celles qu'un module créera plus
 * tard (gestion d'agents, passerelles métier). C'est délibéré : la question
 * « que vaut un appelant sur ma porte » a exactement une bonne réponse, et
 * laisser chaque porte la réécrire garantit qu'une copie finira plus permissive
 * que les autres sans que rien ne le signale — c'est déjà ce qui s'est produit
 * quand la lecture d'administration fabriquait un administrateur.
 *
 * Les trois postures :
 *
 * | La porte | L'appelant | Ce qu'il porte |
 * | --- | --- | --- |
 * | non protégée | quiconque l'atteint | `operatorRoles` — sa protection est son PÉRIMÈTRE |
 * | protégée | jeton vérifié | ce que ses SCOPES ouvrent, rien de plus |
 * | protégée | anonyme toléré | **rien** — la déclaration d'autorisation serait vidée de son sens |
 *
 * Le premier cas n'est pas du laxisme : une porte sans serveur d'autorisation
 * est bornée par son module (`policy: "dev"`) et par ses gardes de transport,
 * et qui l'atteint lit déjà les sources de l'application. Lui refuser la
 * lecture n'ajouterait aucune barrière et rendrait l'outillage inutile. Ce qui
 * compte, c'est que ce soit un CHOIX écrit — pas un administrateur fabriqué au
 * fond d'une fonction de lecture.
 *
 * @param posture - ce que la porte sait d'elle-même et de cet appel.
 * @param operatorRoles - ce qu'accorde une porte NON protégée. Une porte qui
 *   veut être plus stricte passe une liste plus courte, voire vide ; elle n'a
 *   pas à réécrire la règle pour autant.
 * @returns les rôles à poser sur `IMcpCaller.roles`.
 */
export function mcpCallerRoles(
  posture: IMcpGatePosture,
  operatorRoles: readonly string[] = [ADMIN_DEFAULT_ROLE],
): readonly string[] {
  if (!posture.protected) return operatorRoles;
  return posture.authenticated ? rolesFromScopes(posture.scopes) : [];
}
