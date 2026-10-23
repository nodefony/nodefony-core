/**
 * `@nodefony/security/testing` — **identité d'essai et VRAI verrou de frame**,
 * pour éprouver un canal ou une action temps réel protégés.
 *
 * Le harnais de `@nodefony/realtime/testing` accepte une identité et un verrou,
 * mais n'en fournit aucun : `@nodefony/realtime` ne connaît pas la sécurité.
 * Faute de mieux, une application écrivait un jeton factice et un verrou qui ne
 * regardait que `isAuthenticated()` — son test passait, et n'éprouvait PAS la
 * politique de rôles du canal. Un canal mal protégé y était vert. Deux agents
 * sur deux l'ont fait, en recopiant le jeton que montrait le test généré.
 *
 * Ce module rend les deux pièces, et le verrou rendu est celui du pare-feu —
 * {@link buildFrameAuthorizer}, la même fabrique que le boot branche sur le hub,
 * avec la même hiérarchie de rôles et les mêmes canaux système. Seuls manquent
 * le journal d'audit (un refus en test n'est pas une transition de sécurité) et
 * les ZONES HTTP : une frame `api.request` y passe comme hors de toute zone, et
 * la garde d'une route s'éprouve par HTTP, pas ici.
 *
 * ```ts
 * import { getRealtimeHub } from "@nodefony/realtime";
 * import { createRealtimeHarness } from "@nodefony/realtime/testing";
 * import {
 *   createTestFrameAuthorizer,
 *   createTestIdentity,
 * } from "@nodefony/security/testing";
 *
 * const h = createRealtimeHarness((ctx) => new ChatController(ctx), {
 *   identity: createTestIdentity({ identifier: "alice", roles: ["ROLE_USER"] }),
 *   frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
 * });
 * ```
 *
 * @packageDocumentation
 */
import { RoleHierarchyWalker } from "../src/RoleHierarchyWalker";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IChannelPolicyResolver,
} from "../src/realtime/frameAuthorizer";
import type {
  FrameAuthorizer,
  IRealtimeToken,
} from "../src/realtime/realtimeContracts";

/** L'identité d'essai : qui se connecte, avec quels droits. */
export interface ITestIdentityOptions {
  /** Identifiant de l'utilisateur (défaut `"alice"`). */
  readonly identifier?: string;
  /** Rôles portés (défaut `["ROLE_USER"]`) — ceux qu'aurait résolus le pare-feu. */
  readonly roles?: readonly string[];
  /** Scopes portés (défaut aucun) — l'axe des jetons d'API, pas de la session. */
  readonly scopes?: readonly string[];
  /**
   * L'utilisateur rendu par `@CurrentUser()` et `RequestContext.getUser()`
   * (défaut `{ identifier, roles }`). Passer l'entité de l'application quand
   * l'action en lit d'autres champs.
   */
  readonly user?: unknown;
}

/**
 * Une identité de connexion AUTHENTIFIÉE, telle que le pare-feu l'aurait posée
 * au handshake.
 *
 * Pour éprouver un visiteur anonyme, ne rien passer au harnais : il pose alors
 * le jeton anonyme, comme le repli Zero Trust du runtime.
 *
 * @param options - identifiant, rôles, scopes, utilisateur.
 * @returns un jeton à passer en `identity` au harnais temps réel.
 */
export function createTestIdentity(
  options: ITestIdentityOptions = {},
): IRealtimeToken {
  const identifier = options.identifier ?? "alice";
  const roles = options.roles ?? ["ROLE_USER"];
  return new TestToken(
    identifier,
    roles,
    options.scopes ?? [],
    options.user ?? { identifier, roles: [...roles] },
  );
}

/** Le jeton que rend {@link createTestIdentity}. */
class TestToken implements IRealtimeToken {
  readonly type = "session";

  constructor(
    private readonly identifier: string,
    private readonly roles: readonly string[],
    private readonly scopes: readonly string[],
    private readonly user: unknown,
  ) {}

  getUserIdentifier(): string {
    return this.identifier;
  }

  isAuthenticated(): boolean {
    return true;
  }

  // Copies : un test qui modifierait la liste rendue ne changerait pas les
  // droits de la connexion — pas plus qu'au runtime.
  getRoles(): string[] {
    return [...this.roles];
  }

  getScopes(): string[] {
    return [...this.scopes];
  }

  // `getAttribute<T>` est typé par l'APPELANT : aucune implémentation ne peut
  // le vérifier. La surcharge le dit, au lieu de le cacher sous une conversion.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- forme imposée par IRealtimeToken
  getAttribute<T = unknown>(key: string): T | undefined;
  getAttribute(key: string): unknown {
    return key === "user" ? this.user : undefined;
  }
}

/** Écarts au pare-feu d'essai. */
export interface ITestFrameAuthorizerOptions {
  /**
   * Hiérarchie de rôles, à la forme de `roleHierarchy` de la configuration de
   * sécurité (défaut : aucune). La reprendre de l'application quand un rôle en
   * couvre un autre — `{ ROLE_ADMIN: ["ROLE_USER"] }`.
   */
  readonly roleHierarchy?: Record<string, readonly string[]>;
}

/**
 * Le VRAI verrou de frame du pare-feu, pour le harnais temps réel.
 *
 * C'est lui qui applique `@RealtimeChannel(nom, { roles })`,
 * `@RealtimeAction(nom, { roles })` et les canaux système : sans lui, une
 * politique déclarée n'est appliquée par personne — en test comme au runtime.
 *
 * @param channels - ce qui connaît les politiques déclarées : le hub temps réel
 *   (`getRealtimeHub()`), lu à CHAQUE frame — les politiques que le controller
 *   enregistre à sa construction y sont donc vues.
 * @param options - hiérarchie de rôles de l'application.
 * @returns le verrou à passer en `frameAuthorizer` au harnais.
 */
export function createTestFrameAuthorizer(
  channels: IChannelPolicyResolver,
  options: ITestFrameAuthorizerOptions = {},
): FrameAuthorizer {
  const walker = new RoleHierarchyWalker(options.roleHierarchy ?? {});
  return buildFrameAuthorizer(
    {
      // Aucune zone : la garde d'une route HTTP s'éprouve par HTTP.
      matchPath: () => null,
      hasRole: (userRoles, required) => walker.hasRole(userRoles, required),
    },
    { channelResolver: channels, systemRules: DEFAULT_SYSTEM_RULES },
  );
}
