import { RequestContext } from "nodefony";
import { anonymousUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import { AuthenticationError } from "../../errors/AuthenticationError";
import type {
  IRealtimeAuthenticator,
  IRealtimeHandshake,
  IRealtimeToken,
} from "../realtime/realtimeContracts";
import { UserRealtimeToken } from "../realtime/UserRealtimeToken";

/**
 * Authenticator realtime de la **session BFF** — équivalent WS du
 * {@link SessionAuthenticator} HTTP.
 *
 * ── Pourquoi il NE re-lit PAS la base ──────────────────────────────────────
 * Un handshake WebSocket est une requête upgrade HTTP qui traverse le MÊME
 * pipeline : `startSession` (reprise L1 du cookie) **puis** `firewall.handleSecurity`
 * tournent AVANT que le `RealtimeController` ne fasse son handshake. Sur une zone
 * data plane, le firewall a donc DÉJÀ : (1) chargé la session, (2) re-résolu
 * l'identité via le provider `users` (rôles frais), (3) posé l'`IUser` dans l'ALS
 * (`RequestContext.set("user", …)`) et appliqué le Zero Trust (un anonyme est
 * fermé AVANT d'arriver ici). Re-décoder le cookie + re-charger la session ici
 * referait 2 lectures base **redondantes** par connexion — sur le différenciateur
 * temps réel, un coût évitable. → on **réutilise** l'identité déjà en ALS.
 *
 * Le `RealtimeController.onHandshake` s'exécute dans la même bulle ALS que le
 * firewall (un seul `RequestContext.run` enveloppe handshake + frames) → la
 * lecture est sûre et synchrone.
 *
 * Asymétrie de révocation HTTP↔WS (assumée, J3b) : le jeton est figé au handshake
 * (les frames lisent un cache O(1), jamais la base) → une révocation prend effet
 * **à la reconnexion**, pas à la frame suivante. Révocation immédiate forte = J4
 * (JWT + canal « token révoqué »). C'est l'état de l'art (Socket.IO/Phoenix figent
 * aussi l'identité au handshake).
 */
export class SessionRealtimeAuthenticator implements IRealtimeAuthenticator {
  readonly name = "session-realtime";

  /** Une identité authentifiée a-t-elle été résolue (par le firewall) au handshake ? */
  supports(_handshake: IRealtimeHandshake): boolean {
    return isAuthenticatedUser(RequestContext.getUser());
  }

  /**
   * Promeut l'identité déjà résolue (ALS) en jeton realtime — 0 lecture base.
   *
   * @throws AuthenticationError — aucune identité authentifiée en ALS (ne devrait
   *   pas arriver sur une zone data plane : le firewall ferme l'anonyme en amont ;
   *   filet défensif fail-closed → le hub ferme la socket en 4001).
   */
  async authenticate(_handshake: IRealtimeHandshake): Promise<IRealtimeToken> {
    const user = RequestContext.getUser();
    if (!isAuthenticatedUser(user)) {
      // `async` → rejet de la Promise (pas un throw sync) : honore le contrat
      // `Promise<IRealtimeToken>` et le `await … catch` du hub au handshake.
      throw new AuthenticationError("Invalid realtime session");
    }
    return new UserRealtimeToken(user);
  }
}

/**
 * Vrai si `user` est un utilisateur AUTHENTIFIÉ (≠ anonyme). Le firewall pose
 * `token.getUser()` dans l'ALS : soit l'`IUser` réel, soit `anonymousUser`
 * (singleton). Tout ce qui n'est pas l'anonyme et porte un `identifier` est
 * une identité valide.
 */
function isAuthenticatedUser(user: unknown): user is IUser {
  return (
    !!user &&
    user !== anonymousUser &&
    typeof (user as IUser).identifier === "string"
  );
}

export default SessionRealtimeAuthenticator;
