import { RequestContext } from "nodefony";
import type { IUser, UserService } from "@nodefony/user";
import {
  Controller,
  controller,
  Get,
  IsGranted,
  RequireAuthentication,
  CurrentUser,
  Scope,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { recordInitializeRun } from "./initializeProbe";

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
// Par requête : le mouchard de `initialize()` compte les requêtes qui
// atteignent le contrôleur — la preuve qu'une requête refusée (401/403) n'y
// arrive jamais. En singleton, il ne compterait que la première.
@Scope("request")
@controller("/nodefony/test/secure")
class SecureController extends Controller {
  constructor(context: ContextType) {
    super("SecureController", context);
  }

  /**
   * Mouchard d'ORDRE (banc `pipeline-order`) — ce controller vit en zone
   * protégée : si `initialize()` tourne alors que la requête finit en 401/403,
   * c'est que du code utilisateur s'exécute avant l'authentification. On note
   * donc le passage ET ce qu'on avait sous la main (identité, session).
   *
   * @see `nodefony/secure/initializeProbe.ts` · lecture publique via
   *   `/nodefony/test/pipeline-order/probe`.
   */
  async initialize(): Promise<this> {
    const user = RequestContext.getUser() as IUser | undefined;
    recordInitializeRun(
      user?.identifier ?? null,
      Boolean(this.context?.session),
    );
    return this;
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

  /**
   * Preuve `@RequireAuthentication` — l'ÂGE de la connexion : servie à une
   * session ouverte au mot de passe il y a moins de 2 s, refusée en 401
   * « step-up » (RFC 9470, `max_age="2"`) ensuite. Le seuil est court pour que
   * le banc n'attende que 2 s.
   */
  @Get("/step-up/recent")
  @RequireAuthentication({ maxAge: 2, amr: ["pwd"] })
  stepUpRecent() {
    return this.renderJson({ fresh: true });
  }

  /**
   * Preuve `@RequireAuthentication` — le MOYEN : exige un code à usage unique
   * (`otp`). Une session ouverte au seul mot de passe est refusée en 401.
   */
  @Get("/step-up/otp")
  @RequireAuthentication({ amr: ["otp"] })
  stepUpOtp() {
    return this.renderJson({ otp: true });
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
