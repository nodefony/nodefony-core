import type { RealtimeIdentity } from "nodefony";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

/**
 * Vue PUBLIQUE de l'identité d'une connexion, annoncée au client par `realtime:welcome` — tirée de l'identité d'admission quand le jeton en produit une.
 *
 * Un objet NEUF, champ par champ, et jamais l'identité d'admission elle-même :
 * celle-ci porte `issuer` et `account`, qui restent au serveur — la sérialiser
 * telle quelle les enverrait au client (ADR-0021 §S10 point 1). Les tableaux
 * de rôles et de scopes, eux, sont repris par RÉFÉRENCE : gelés une fois à la
 * construction de l'identité, ils ne se recopient pas.
 *
 * Un jeton sans `getIdentity` (authentificateur tiers) annonce `id: null` : son
 * identifiant stable n'est pas connu, et le déduire du login serait le défaut
 * même que `id` corrige.
 *
 * @param token - jeton figé à la poignée de main.
 * @returns l'identité à placer dans le `welcome`.
 */
export function welcomeIdentityOf(token: IRealtimeToken): RealtimeIdentity {
  const who = token.getIdentity?.();
  if (who !== undefined) {
    return {
      type: who.type,
      authenticated: who.authenticated,
      id: who.id,
      userIdentifier: who.userIdentifier,
      roles: who.roles,
      scopes: who.scopes,
    };
  }
  return {
    type: token.type,
    authenticated: token.isAuthenticated(),
    id: null,
    userIdentifier: token.getUserIdentifier(),
    roles: token.getRoles(),
    scopes: token.getScopes(),
  };
}
