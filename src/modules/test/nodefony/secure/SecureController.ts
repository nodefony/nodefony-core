import { RequestContext } from "nodefony";
import type { IUser, UserService } from "@nodefony/user";
import {
  Controller,
  controller,
  Get,
  IsGranted,
  CurrentUser,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc d'intégration de la ZONE PROTÉGÉE `test-secure` (P6 J1).
 *
 * Politique de routes EXPLICITE : tout `/nodefony/test/secure/*` est capturé par
 * la zone firewall `test-secure` (`nodefony.config.ts`, authenticator
 * `userpassword`) — dossier `secure/` = préfixe `/secure` = nom de zone, le
 * caractère protégé se lit partout. Sans `Authorization: Basic` valide, AUCUNE
 * de ces actions n'est atteinte : le firewall répond 401 (+ `WWW-Authenticate`)
 * AVANT le controller. Le reste du module test reste public.
 */
@controller("/nodefony/test/secure")
class SecureController extends Controller {
  constructor(context: ContextType) {
    super("SecureController", context);
  }

  /** Preuve de passage du firewall — la route n'est servie qu'authentifié. */
  @Get("/ping")
  ping() {
    return this.renderJson({ pong: true, secure: true });
  }

  /**
   * Preuve P6 J7 — AUTORISATION déclarative `@IsGranted` (distincte de l'authn).
   * La zone authentifie (Basic) ; `@IsGranted("ROLE_ADMIN")` décide ENSUITE :
   *  - `admin` (ROLE_ADMIN) → 200,
   *  - `user` (ROLE_USER, authentifié mais sans le rôle) → **403** (pas 401),
   *  - sans Authorization → 401 (firewall, avant la garde).
   * `@CurrentUser()` injecte l'utilisateur de l'ALS (jamais le credential).
   */
  @Get("/admin-only")
  @IsGranted("ROLE_ADMIN")
  adminOnly(@CurrentUser() user: IUser) {
    return this.renderJson({ granted: true, identifier: user.identifier });
  }

  /** Identité propagée par le firewall dans l'ALS (`RequestContext`). */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
    });
  }

  /**
   * Preuve P6 J2 (migration bcrypt → argon2id) : FORMAT du hash stocké de
   * l'utilisateur COURANT — jamais le hash lui-même, et seulement à son
   * titulaire authentifié (zone protégée + banc dev-only). Après le premier
   * login réussi, `MigratingEncoder` doit avoir modernisé bcrypt → argon2id.
   */
  @Get("/encoder")
  async encoder() {
    const user = RequestContext.getUser() as IUser | undefined;
    const users = this.get<UserService>("users");
    const stored = user?.identifier
      ? await users?.findByIdentifier(user.identifier)
      : null;
    const hash = stored?.password ?? "";
    const format = hash.startsWith("$argon2id$")
      ? "argon2id"
      : /^\$2[aby]\$/.test(hash)
        ? "bcrypt"
        : "unknown";
    return this.renderJson({ format });
  }
}

export default SecureController;
