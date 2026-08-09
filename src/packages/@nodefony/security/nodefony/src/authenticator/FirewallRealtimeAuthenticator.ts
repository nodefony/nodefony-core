import { Nodefony, RequestContext } from "nodefony";
import { anonymousUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import { AuthenticationError } from "../../errors/AuthenticationError";
import type { IToken } from "../../contracts/IToken";
import type {
  IRealtimeAuthenticator,
  IRealtimeHandshake,
  IRealtimeToken,
} from "../realtime/realtimeContracts";
import { UserRealtimeToken } from "../realtime/UserRealtimeToken";

/**
 * Authenticator realtime des identités résolues par le **firewall** — équivalent
 * WS de tout ce que le pipeline HTTP sait authentifier.
 *
 * ── Pourquoi il NE re-lit PAS la base ──────────────────────────────────────
 * Un handshake WebSocket est une requête upgrade HTTP qui traverse le MÊME
 * pipeline : `startSession` (reprise L1 du cookie) **puis** `firewall.handleSecurity`
 * tournent AVANT que le `RealtimeController` ne fasse son handshake. Sur une zone
 * data plane, le firewall a donc DÉJÀ : (1) authentifié (session, JWT, clé API…),
 * (2) re-résolu l'identité via le provider `users` (rôles frais), (3) posé
 * l'`IUser` **et le jeton** dans l'ALS et appliqué le Zero Trust (un anonyme est
 * fermé AVANT d'arriver ici). Re-décoder le credential ici referait des lectures
 * base **redondantes** par connexion — sur le différenciateur temps réel, un coût
 * évitable. → on **réutilise** l'identité déjà en ALS.
 *
 * Le `RealtimeController.onHandshake` s'exécute dans la même bulle ALS que le
 * firewall (un seul `RequestContext.run` enveloppe handshake + frames) → la
 * lecture est sûre et synchrone.
 *
 * ── Il n'est PAS l'authenticator « de la session » ──────────────────────────
 * Son nom d'origine (`SessionRealtimeAuthenticator`) décrivait le premier mode
 * branché, pas son rôle : il promeut **toute** identité que le firewall a posée,
 * y compris un agent authentifié par jeton porteur, sans cookie ni session. La
 * confusion a coûté cher — un durcissement pensé pour la session a été appliqué
 * à toutes les identités, et une connexion JWT parfaitement valide se faisait
 * révoquer au motif qu'elle n'avait pas de session. D'où le nom actuel : il dit
 * d'où vient l'identité (le firewall), pas comment elle a été prouvée.
 *
 * ── Révocation : un invariant, deux preuves ────────────────────────────────
 * L'invariant est unique — **une socket ne survit pas à l'identité qui l'a
 * ouverte** — mais la preuve dépend du mode, parce que ce sont deux mécanismes
 * de révocation différents :
 *
 * | Mode                       | Ce qui rend l'identité morte                     |
 * | -------------------------- | ------------------------------------------------ |
 * | session BFF (`session`)    | session détruite, expirée, ou passée à un autre  |
 * | jeton porteur (JWT, clé…)  | `exp` atteint · `jti` denylisté · `invalidBefore` |
 *
 * Le jeton est figé au handshake (les frames lisent un cache O(1), jamais la
 * base) ; la re-validation tourne sur le tick du hub (`REVOCATION_REVALIDATE_MS`)
 * et devant chaque `api.request`. Une révocation prend donc effet en une fenêtre,
 * pas à la frame suivante — c'est l'état de l'art (Socket.IO/Phoenix figent aussi
 * l'identité au handshake).
 */
export class FirewallRealtimeAuthenticator implements IRealtimeAuthenticator {
  readonly name = "firewall-realtime";

  /**
   * Accès **paresseux** au store de révocation des jetons porteurs. Résolu au
   * plus tôt à la première re-validation d'une socket à jeton — jamais au boot,
   * jamais pour une session. Absent (`null`) → seule la borne `exp` du jeton
   * fait foi.
   */
  readonly #resolveStore: (() => IRealtimeRevocationStore | null) | null;

  /**
   * @param resolveStore - fournit le store de révocation des jetons (le firewall
   *   passe une closure sur son container). Omis → mode dégradé documenté :
   *   seules les bornes portées par le jeton lui-même sont vérifiables.
   */
  constructor(
    resolveStore: (() => IRealtimeRevocationStore | null) | null = null,
  ) {
    this.#resolveStore = resolveStore;
  }

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
    // Le jeton du firewall SAIT comment l'identité a été prouvée — on le lui
    // demande plutôt que de le deviner. Absent (zone historique) → on retombe
    // sur le mode le plus strict, la session : un repli sûr, jamais permissif.
    const issued = readFirewallToken();
    const type =
      typeof issued?.type === "string" && issued.type ? issued.type : "session";

    const revalidate =
      type === "session"
        ? buildSessionRevalidator(user.identifier)
        : this.#buildBearerRevalidator(issued as IToken, user.identifier, type);

    // Les scopes suivent l'identité : sans eux, `ScopeVoter` verrait un jeton
    // machine sans aucun droit délégué et refuserait tout. Vide pour un humain,
    // qui n'est pas downscopé (cf `NON_SCOPABLE_TOKEN_TYPES`).
    const scopes = issued ? issued.getScopes() : undefined;

    return new UserRealtimeToken(user, revalidate, type, scopes);
  }

  /**
   * Re-validation d'une identité portée par un **jeton** (JWT, clé API, OAuth) :
   * rejoue les trois conditions qui tuent un jeton, sans jamais parler de session.
   *
   * `exp` est vérifié **sans personne** (la borne voyage dans le jeton) ; le store
   * n'ajoute que la révocation *avant terme*. C'est pourquoi un store en panne ne
   * coupe pas les sockets d'agents : ce serait une panne de disponibilité déguisée
   * en mesure de sécurité, alors que la borne du jeton tient toujours.
   */
  #buildBearerRevalidator(
    issued: IToken,
    identifier: string,
    type: string,
  ): (nowMs?: number) => Promise<boolean> {
    const claims =
      issued.getAttribute<Record<string, unknown>>("claims") ?? EMPTY_CLAIMS;
    const expMs = secondsToMs(claims.exp);
    const iatMs = secondsToMs(claims.iat);
    const jti =
      issued.getAttribute<string>("jti") ??
      (typeof claims.jti === "string" ? claims.jti : null);
    const resolveStore = this.#resolveStore;

    // Rien ne pourra JAMAIS invalider cette socket si elle n'a ni borne propre
    // (`exp`), ni prise pour le store — lequel ne sait révoquer que par `jti`
    // (ciblé) ou par `iat` (en masse). La laisser vivre, c'est une connexion
    // éternelle adossée à une identité qu'on ne sait plus vérifier → fail-closed,
    // et FAIL-LOUD pour qu'on le sache.
    //
    // 🔴 La condition porte sur ce qu'on PEUT vérifier, pas sur la présence d'un
    // store. Formulée « pas de borne ET pas de store », elle laissait passer le
    // cas réel : un store présent, et un jeton dont aucune borne n'était arrivée
    // jusqu'ici — le store était alors interrogé avec `jti = null` et
    // `iat = null`, donc ne pouvait répondre que « toujours valable ». C'est
    // ainsi qu'un jeton d'un émetteur tiers ouvrait une socket immortelle.
    const nothingCanInvalidate =
      expMs === null &&
      (resolveStore === null || (jti === null && iatMs === null));
    if (nothingCanInvalidate) {
      Nodefony.getKernel()?.log?.(
        `Realtime ${type} token "${identifier}" carries neither an expiry nor any ` +
          `revocation handle ("jti"/"iat") — connection will be revoked (fail-closed). ` +
          `Ensure the authenticator forwards the token claims.`,
        "WARNING",
      );
      return () => Promise.resolve(false);
    }

    return async (nowMs: number = Date.now()): Promise<boolean> => {
      if (expMs !== null && nowMs >= expMs) return false;
      if (!resolveStore) return true; // borne seule, déjà vérifiée ci-dessus
      let store: IRealtimeRevocationStore | null;
      try {
        store = resolveStore();
      } catch {
        // Store injoignable → on s'en tient à ce que le jeton prouve tout seul.
        return expMs !== null;
      }
      if (!store) return expMs !== null;
      try {
        if (jti !== null && (await store.isJtiDenied(jti))) return false;
        const invalidBefore = await store.getInvalidBefore(identifier);
        if (invalidBefore !== null && iatMs !== null && iatMs < invalidBefore) {
          return false;
        }
        return true;
      } catch {
        return expMs !== null;
      }
    };
  }
}

/**
 * Surface MINIMALE du store de jetons consommée ici : les deux lectures qui
 * disent si un jeton a été révoqué avant son terme. Typée localement plutôt
 * qu'importée d'`ITokenStore` — ce module n'a besoin ni du reste du contrat ni
 * du couplage, et un test peut fournir un double en deux lignes.
 */
export interface IRealtimeRevocationStore {
  /** `true` si ce `jti` a été mis sur la denylist et n'est pas encore expiré. */
  isJtiDenied(jti: string): Promise<boolean>;
  /** Seuil de révocation en masse du porteur (epoch ms), ou `null`. */
  getInvalidBefore(subjectId: string): Promise<number | null>;
}

const EMPTY_CLAIMS: Record<string, unknown> = Object.freeze({});

/** Claim temporel JWT (secondes, RFC 7519) → epoch ms, ou `null` si absent/invalide. */
function secondsToMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value * 1000
    : null;
}

/** Le jeton posé dans l'ALS par `firewall.handleSecurity`, s'il y en a un. */
function readFirewallToken(): IToken | undefined {
  return (RequestContext.get() as { token?: IToken } | undefined)?.token;
}

/**
 * Forme MINIMALE de la session BFF lue au handshake (typage structurel, **0
 * import `@nodefony/http`**) : son `id` + son `storage` re-lisible.
 */
interface SessionLike {
  id?: unknown;
  storage?: {
    read(id: string): Promise<{ user?: unknown } | null | undefined>;
  };
}

/**
 * Re-validation d'une identité portée par la **session BFF** : re-lit la session
 * (par son id, capturé au handshake) et vérifie qu'elle est TOUJOURS vivante et
 * TOUJOURS celle de `identifier` — ce qui détecte la déconnexion comme le
 * changement de compte sur un navigateur partagé.
 *
 * Renvoie TOUJOURS un revalidateur (jamais `null`) : une identité authentifiée
 * par session DOIT rester révocable. Une lecture qui throw (store down, session
 * détruite) → invalide ; une session non re-lisible au handshake → invalide
 * aussi (fail-closed, cf ci-dessous).
 */
function buildSessionRevalidator(identifier: string): () => Promise<boolean> {
  const ctx = RequestContext.getContext<
    { session?: SessionLike } | undefined
  >();
  const session = ctx?.session;
  const id = session?.id;
  const storage = session?.storage;
  if (
    typeof id !== "string" ||
    !storage ||
    typeof storage.read !== "function"
  ) {
    // Une identité authentifiée PAR SESSION doit rester révocable. Si la session
    // n'est pas re-lisible au handshake (absente, sans id, ou sans store
    // exploitable), on ne peut PAS prouver qu'elle est toujours vivante → Zero
    // Trust FAIL-CLOSED : le revalidateur invalide la socket → révoquée au 1ᵉʳ
    // tick du hub (close 4001), au lieu de survivre silencieusement. Avant,
    // `null` faisait renvoyer `true` à `isValid()` en permanence : la socket
    // entrait au registre révocable mais n'en sortait jamais, sans aucune trace.
    // FAIL-LOUD : on journalise l'anomalie (identité de session sans session
    // revalidable = zone realtime hors du pipeline `startSession`, ou état
    // incohérent). ⚠️ Ce refus ne vaut QUE pour le mode session : un jeton
    // porteur n'a pas de session à relire, et n'a pas à en avoir une.
    Nodefony.getKernel()?.log?.(
      `Realtime session token "${identifier}" has no revalidatable session at handshake — connection will be revoked (fail-closed). Ensure the realtime zone runs after startSession.`,
      "WARNING",
    );
    return () => Promise.resolve(false);
  }
  return async (): Promise<boolean> => {
    try {
      const serialized = await storage.read(id);
      return !!serialized && serialized.user === identifier;
    } catch {
      return false;
    }
  };
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

export default FirewallRealtimeAuthenticator;
