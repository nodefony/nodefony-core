import type { IAccessVoter } from "../../contracts/IAccessVoter";
import type { IToken } from "../../contracts/IToken";
import { VoterVote } from "../../contracts/IAccessVoter";

/**
 * Types de jetons **non scopables** — identité humaine interactive (session BFF
 * web/Studio/WS, login mot de passe) ou visiteur anonyme. Un scope `api:action`
 * ne bride JAMAIS un humain : il **downscope** un jeton MACHINE délégué (clé API,
 * JWT d'agent, OAuth). Tout type ABSENT de cette liste — présent (`apikey`/`jwt`/
 * `oauth2`) ou futur (`mtls`, `agent`…) — est considéré **scopable**, donc soumis
 * au filtre : **fail-closed côté machine** (un nouveau type délégué est bridé par
 * défaut, jamais ouvert par oubli).
 *
 * `type` est porté à l'identique par `IToken` (HTTP) ET `IRealtimeToken` (WS, pont
 * `api.request`) → ce voter reste transport-agnostique sans rien ajouter au contrat.
 */
const NON_SCOPABLE_TOKEN_TYPES = new Set<string>([
  "session",
  "userpassword",
  "anonymous",
]);

/**
 * Voter built-in **axe SCOPE** (P6.8) — applique les scopes `api:action` déclarés
 * par `@RequireScope`. Frère du {@link RoleVoter} sur l'autre axe : les rôles
 * disent QUI tu es, les scopes disent ce qu'une CLÉ déléguée a le droit de faire.
 *
 * `supports()` ne capte QUE la forme conventionnée `api:action` (un `:`, jamais
 * `ROLE_*`) → aucune collision avec le `RoleVoter` ni un voter métier (`doc.edit`).
 *
 * Vote :
 *  - **jeton non scopable** (humain/anonyme) → `GRANT` : le scope est un no-op,
 *    l'autorisation de l'humain est portée par ses rôles (`@IsGranted`), pas par
 *    un downscoping de clé ;
 *  - **jeton scopable** (clé API / JWT / OAuth) → `GRANT` si le scope exact est
 *    présent, sinon **`ABSTAIN`** (jamais `DENY` : l'absence d'un scope ne doit pas
 *    opposer un veto aux autres attributs OR d'une clause — c'est le default-DENY
 *    de l'`AuthorizationService`, tous ABSTAIN → refus, qui ferme la porte ;
 *    posture identique au `RoleVoter`).
 *
 * Pur : aucune dépendance (ni container, ni I/O) — il ne lit que le jeton déjà
 * résolu au handshake/à l'authentification. Instancié UNE fois au boot.
 */
export class ScopeVoter implements IAccessVoter {
  /** Capte les attributs scope `api:action` — ni `ROLE_*`, ni attribut métier sans `:`. */
  supports(attribute: string): boolean {
    return attribute.includes(":") && !attribute.startsWith("ROLE_");
  }

  vote(token: IToken, attribute: string): Promise<VoterVote> {
    // No-op pour une identité humaine : le scope ne contraint que les clés machine.
    if (NON_SCOPABLE_TOKEN_TYPES.has(token.type)) {
      return Promise.resolve(VoterVote.GRANT);
    }
    // Contrat IAccessVoter = async (voters métier font des lookups DB) ; ce voter
    // est sync (lecture O(n) du tableau de scopes, n petit) → Promise.resolve.
    return Promise.resolve(
      token.getScopes().includes(attribute)
        ? VoterVote.GRANT
        : VoterVote.ABSTAIN,
    );
  }
}

export default ScopeVoter;
