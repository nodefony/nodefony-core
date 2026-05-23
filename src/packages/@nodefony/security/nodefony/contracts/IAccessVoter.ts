import type { IToken } from "./IToken";

/**
 * Vote d'un {@link IAccessVoter}. Stratégie firewall = affirmative + DENY veto :
 * un seul DENY bloque ; sinon un GRANT suffit ; tous ABSTAIN → DENY (Zero Trust).
 */
export enum VoterVote {
  GRANT = "GRANT",
  DENY = "DENY",
  ABSTAIN = "ABSTAIN",
}

/**
 * Voter contextuel (niveau C de l'autorisation, P6.8) — décide d'un accès en
 * fonction du token ET du sujet (ex. « cet user édite-t-il SON projet ? »).
 *
 * Découverts par DI au boot (`@injectable`), indexés par `supports()`. Killer
 * feature pour le métier complexe (multi-tenant, ownership).
 */
export interface IAccessVoter {
  /** Ce voter sait-il décider de cet attribut/sujet ? */
  supports(attribute: string, subject?: unknown): boolean;

  /** Vote pour l'attribut donné sur le sujet donné. */
  vote(token: IToken, attribute: string, subject?: unknown): Promise<VoterVote>;
}
