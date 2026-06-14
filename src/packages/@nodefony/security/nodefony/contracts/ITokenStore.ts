/**
 * État serveur des jetons longue durée (PAT, refresh tokens), denylist des access
 * tokens révoqués (`jti`) et seuil de révocation **en masse** par porteur.
 *
 * Pourquoi un store : un access token signé (JWT) est auto-porté et **non
 * révocable** avant son `exp`. La sécurité « révocable » du mode hybride (logout
 * partout, ban, fuite, rotation de refresh) **exige** un état serveur — RFC 9700
 * §4.14 (rotation + détection de rejeu) + liaison scope/ressource du refresh.
 * **Pluggable** par backend (mémoire/fichier/ORM/Redis) comme les stores de session.
 *
 * Trois structures complémentaires :
 *  1. **records** ({@link IAccessTokenRecord}) — PAT + refresh persistants ;
 *  2. **denylist `jti`** — révocation ciblée d'UN access avant son `exp` ;
 *  3. **seuil par porteur** (`invalidBefore`) — révocation EN MASSE (tout access
 *     auto-porté émis avant un instant T est rejeté → « déconnexion globale » / ban).
 */

/** Raison de révocation d'un jeton — tracée pour l'audit de sécurité. */
export type TokenRevokeReason =
  | "logout" // déconnexion volontaire
  | "rotated" // refresh remplacé par rotation (cycle normal OWASP)
  | "reuse_detected" // rejeu d'un refresh déjà tourné → famille coupée (RFC 9700)
  | "manual" // révocation explicite (console / API)
  | "compromised" // fuite signalée
  | "subject_disabled" // porteur banni / désactivé
  | "expired_cleanup"; // purge GC

/**
 * Permission **fine-grained** sur une ressource (modèle GitHub fine-grained PAT).
 *
 * **Slot** : non exploité tant que les scopes simples suffisent ; la colonne
 * existe dès maintenant pour éviter une migration le jour où on l'active.
 */
export interface IResourcePermission {
  /** Type de ressource (ex. `"repo"`, `"project"`). */
  type: string;
  /** Identifiants ciblés (omis = toutes les ressources de ce type). */
  ids?: string[];
  /** Permissions accordées sur ces ressources. */
  perms: Array<"read" | "write">;
}

/** Contexte d'un usage de jeton (audit « last used »). */
export interface ITokenUsage {
  /** Instant d'usage (epoch ms). */
  at: number;
  /** IP source, si disponible. */
  ip?: string | null;
  /** User-Agent source, si disponible. */
  userAgent?: string | null;
}

/**
 * Enregistrement d'un jeton persistant — un PAT (clé API style GitHub) ou un
 * refresh token. Le secret n'est JAMAIS stocké en clair : seul `secretHash` vit
 * ici (le secret high-entropy est affiché une seule fois à la création).
 *
 * Modèle **single-table** : un même schéma porte PAT et refresh ; les champs non
 * pertinents pour un `kind` valent `null` (ex. `family`/`audience` pour un PAT,
 * `prefix` pour un refresh opaque). Horodatages en epoch **millisecondes**
 * (`Date.now()`) ; les claims JWT (secondes, RFC 7519 NumericDate) sont dérivés
 * à la signature.
 *
 * `AccessTokenRow` (forme renvoyée par les repositories ORM) est **identique** à
 * cette interface → zéro mapping entre le store et l'entité.
 */
export interface IAccessTokenRecord {
  // ── Identité du record ──────────────────────────────────────────────────────
  /** Identifiant unique : claim `jti` (refresh) / id public (PAT). */
  id: string;
  /** Nature : clé API personnelle (`pat`) ou refresh token (`refresh`). */
  kind: "pat" | "refresh";
  /** Libellé humain (« CI deploy », « app mobile ») — affiché dans la console. */
  name: string;
  /** Préfixe public affichable (« nf_a1b2c3… ») pour l'UI/lookup ; `null` pour un refresh opaque. */
  prefix: string | null;

  // ── Porteur — RÉFÉRENCE LOGIQUE SOUPLE, *PAS* une clé étrangère ──────────────
  /**
   * Identité du porteur (id d'un utilisateur OU d'un service account).
   *
   * ⚠️ **Référence souple volontaire, pas une FK SQL `REFERENCES User(id)`** :
   *  (1) le porteur est **polymorphe** (`subjectType` user|service, futurs agents) —
   *      une FK ne pointe que vers une table ;
   *  (2) le store est **pluggable multi-backend** (tokens Redis/Mongo, users SQL) —
   *      une FK exigerait même base + même moteur ;
   *  (3) **découplage modules** — l'entité vit dans `@nodefony/security`, `User`
   *      dans `@nodefony/user` (user custom permis, `IUser.id` = `string|number`).
   * Intégrité assurée **à l'usage** (`userProvider.load(subjectId)` → porteur
   * disparu = jeton rejeté) ; suppression/ban gérés par `revokeAllForSubject`
   * (révoque + audite + cross-backend, > un `ON DELETE CASCADE`).
   */
  subjectId: string;
  /** Discriminant du porteur (humain vs machine). */
  subjectType: "user" | "service";
  /** Organisation/tenant (multi-tenant, façon orgs GitHub) — axe distinct du porteur ; `null` = global. */
  tenantId: string | null;

  // ── Autorisation / portée ───────────────────────────────────────────────────
  /** Capacités accordées à ce jeton (⊆ droits du porteur — downscoping). Ex. `["orders:read"]`. */
  scopes: string[];
  /** Audiences liées (claim `aud`, RFC 8707/9700) ; `[]` = audience de l'app. Liaison conservée à la rotation. */
  audience: string[];
  /** Permissions fine-grained (slot GitHub) ; `null` = portée par les seuls `scopes`. */
  resources: IResourcePermission[] | null;

  // ── Secret au repos ─────────────────────────────────────────────────────────
  /** Hash du secret présenté (jamais le secret) — clé de {@link ITokenStore.findByHash}. */
  secretHash: string;
  /** Algorithme de hachage du secret (agilité crypto, migration future). Ex. `"sha256"`. */
  hashAlg: string;

  // ── Provenance / contraintes (slots) ────────────────────────────────────────
  /** Client OAuth émetteur (slot OAuth2/arctic) ; `null` = non-OAuth. */
  clientId: string | null;
  /** Confirmation sender-constrained : `jkt` (DPoP RFC 9449) / `x5t#S256` (mTLS RFC 8705) ; `null` = bearer simple. */
  cnf: string | null;

  // ── Rotation / chaîne (refresh) ─────────────────────────────────────────────
  /** Famille de rotation : un refresh tourné conserve la famille (reuse detection) ; `null` pour un PAT. */
  family: string | null;
  /** `id` du successeur après rotation (chaîne d'audit) ; `null` = feuille active. */
  replacedBy: string | null;

  // ── Cycle de vie ────────────────────────────────────────────────────────────
  /** Création (epoch ms). */
  createdAt: number;
  /** Expiration (epoch ms) ; `null` = sans expiration (PAT longue durée). */
  expiresAt: number | null;
  /** Dernier usage (epoch ms) ou `null`. */
  lastUsedAt: number | null;
  /** IP du dernier usage (audit « last used from ») ; slot. */
  lastUsedIp: string | null;
  /** User-Agent du dernier usage (audit) ; slot. */
  lastUsedUserAgent: string | null;
  /** Instant de révocation (epoch ms) ou `null` si actif. */
  revokedAt: number | null;
  /** Raison de révocation (audit) ou `null`. */
  revokedReason: TokenRevokeReason | null;

  // ── Extensibilité ───────────────────────────────────────────────────────────
  /** Extras applicatifs libres (anti-migration), `{}` par défaut. */
  metadata: Record<string, unknown>;
}

/**
 * Contrat du store de jetons — implémentations enregistrées via
 * `registerTokenStore`, sélectionnées par config. Toutes les opérations sont
 * **asynchrones** (un backend ORM/Redis fait des I/O ; la référence mémoire
 * résout immédiatement).
 *
 * Les lectures (`findBy*`) renvoient l'enregistrement **brut** (même révoqué ou
 * expiré) — la **politique** (rejet, déclenchement de la détection de rejeu) est
 * du ressort de l'appelant, pas du stockage.
 */
export interface ITokenStore {
  // ── Records (PAT, refresh) ──────────────────────────────────────────────────
  /** Enregistre (ou remplace) un jeton persistant. */
  put(record: IAccessTokenRecord): Promise<void>;
  /** Recherche par identifiant (`jti`/id public). `null` si absent. */
  findById(id: string): Promise<IAccessTokenRecord | null>;
  /** Recherche par hash de secret présenté. `null` si absent. */
  findByHash(secretHash: string): Promise<IAccessTokenRecord | null>;
  /** Tous les jetons d'un porteur (console « mes jetons », révocation ciblée). */
  findBySubject(subjectId: string): Promise<IAccessTokenRecord[]>;
  /** Met à jour `lastUsedAt`/IP/UA (no-op si l'id est inconnu). */
  markUsed(id: string, usage: ITokenUsage): Promise<void>;
  /** Révoque un jeton (pose `revokedAt`+`revokedReason`) — idempotent. */
  revoke(id: string, reason: TokenRevokeReason): Promise<void>;
  /** Révoque TOUTE la famille de rotation (détection de rejeu, RFC 9700). */
  revokeFamily(family: string, reason: TokenRevokeReason): Promise<void>;

  // ── Denylist d'access tokens (jti) ──────────────────────────────────────────
  /**
   * Inscrit un `jti` d'access sur la denylist jusqu'à `expiresAt` (epoch ms) —
   * révocation immédiate avant l'`exp` du JWT. Au-delà, l'entrée est inutile.
   */
  denyJti(jti: string, expiresAt: number): Promise<void>;
  /** `true` si le `jti` est denylisté et non encore expiré. */
  isJtiDenied(jti: string): Promise<boolean>;

  // ── Révocation EN MASSE par porteur (logout global / ban) ────────────────────
  /**
   * Pose le seuil `invalidBefore` (epoch ms) d'un porteur : tout access auto-porté
   * dont `iat < invalidBefore` est rejeté. Couvre les JWT non stockés sans
   * denylister chaque `jti` (refresh/PAT se révoquent via `revoke`/`revokeFamily`).
   */
  revokeAllForSubject(subjectId: string, invalidBefore: number): Promise<void>;
  /** Seuil `invalidBefore` d'un porteur (epoch ms) ou `null` si aucun. */
  getInvalidBefore(subjectId: string): Promise<number | null>;

  // ── Maintenance ─────────────────────────────────────────────────────────────
  /**
   * Purge les entrées devenues inutiles : denylist `jti` expirée, records arrivés
   * à `exp`, PAT révoqués sans expiration au-delà de la fenêtre de rétention. Un
   * refresh révoqué par rotation est conservé jusqu'à son `exp` (= fenêtre de
   * détection de rejeu), puis purgé.
   *
   * **Déclenchement** : à planifier périodiquement par l'orchestrateur du store
   * (timer `unref` posé au boot, nettoyé à l'arrêt). Les backends à TTL natif
   * (Redis `EXPIRE`, Mongo TTL index) gèrent l'expiration eux-mêmes → leur `gc()`
   * se limite aux cas non couverts par le TTL. **Sans orchestrateur le store
   * s'accumule** — ne jamais laisser ce seam vide.
   *
   * @returns nombre d'entrées purgées.
   */
  gc(now?: number): Promise<number>;
}
