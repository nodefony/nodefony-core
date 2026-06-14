import type { Container } from "nodefony";
import type { IAccessVoter } from "../../contracts/IAccessVoter";
import type { IToken } from "../../contracts/IToken";
import { VoterVote } from "../../contracts/IAccessVoter";
import { RoleHierarchyWalker } from "../RoleHierarchyWalker";

/**
 * Voter built-in **niveau A** — résout les attributs `ROLE_*` via la hiérarchie
 * de rôles ({@link RoleHierarchyWalker}).
 *
 * Vote `GRANT` si l'utilisateur possède le rôle (hiérarchie résolue : `ROLE_ADMIN`
 * hérite `ROLE_USER`), **`ABSTAIN` sinon** — jamais `DENY` : l'absence d'un rôle
 * ne doit pas opposer son veto aux autres axes (scope, ownership). C'est le
 * `default DENY` de l'`AuthorizationService` (tous ABSTAIN → refus) qui ferme la
 * porte, pas ce voter.
 *
 * Lit la hiérarchie depuis le container (`roleHierarchy`, posée par le firewall
 * au boot) en lazy — un walker vide gère quand même les rôles plats.
 */
export class RoleVoter implements IAccessVoter {
  #walker: RoleHierarchyWalker | null = null;

  constructor(private readonly container: Container) {}

  supports(attribute: string): boolean {
    return attribute.startsWith("ROLE_");
  }

  vote(token: IToken, attribute: string): Promise<VoterVote> {
    const walker = (this.#walker ??=
      this.container.get<RoleHierarchyWalker>("roleHierarchy") ??
      new RoleHierarchyWalker());
    const vote = walker.hasRole(token.getRoles(), attribute)
      ? VoterVote.GRANT
      : VoterVote.ABSTAIN;
    // Contrat IAccessVoter = async (les voters métier font des lookups DB) ;
    // ce voter est sync → Promise.resolve (pas de wrapper `async` inutile).
    return Promise.resolve(vote);
  }
}

export default RoleVoter;
