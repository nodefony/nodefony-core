import type { ICookie, ICookieOptions } from "./ICookie";

export type SessionStatusType = "none" | "active" | "disabled";
export type SessionStrategyType = "none" | "migrate" | "invalidate";
export type FlashBagType = Record<string, unknown>;
export type MetaBagType = Record<string, unknown>;

/**
 * Intent d'activation de session déclaré par une route (décorateur `@UseSession`
 * de `@nodefony/framework`, ou présence d'un paramètre `@Session`). Lu au point
 * d'activation **unique** du pipeline (HTTP comme WS) : c'est lui — et non plus un
 * `sessionAutoStart` global « démarre partout » — qui décide d'ouvrir une session.
 *
 * - `readOnly` : la session est lue/reprise mais **jamais persistée** (0 write storage).
 * - `eager` : active tôt (seam P6 — régénération d'ID post-authentification).
 */
export interface SessionIntent {
  readOnly?: boolean;
  eager?: boolean;
}

/**
 * Données de session **sérialisées** échangées avec un {@link ISessionStorage}
 * (blob opaque persisté/restauré). La forme métier riche (ProtoService/bags) est
 * l'affaire de `Session` ; le storage ne manipule que cette projection JSON-safe.
 */
export interface ISerializedSession {
  Attributes: Record<string, unknown>;
  metaBag: Record<string, unknown>;
  flashBag: Record<string, unknown>;
  user: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Projection **redactée** d'une session pour l'ADMINISTRATION (data plane Studio,
 * `/nodefony/http/api/sessions`). Construite par allowlist — **jamais** par `delete`
 * après coup — donc ne porte par construction ni `Attributes` ni `flashBag` (données
 * métier potentiellement sensibles), ni l'**id de session brut** (= la valeur du
 * cookie ; le posséder = être connecté).
 *
 * À la place : {@link ISessionSummary.ref}, pseudonyme HMAC stable et **non
 * réversible** (cf `SessionsService.sessionRef`). Standard « appareils connectés »
 * GitHub/Google : on montre une référence, jamais le jeton de session.
 */
export interface ISessionSummary {
  /** Pseudonyme `HMAC(secret, id)` tronqué (préfixe `sess_…`). JAMAIS l'id brut. */
  ref: string;
  /** Identifiant de l'utilisateur porté par la session (chaîne vide = anonyme). */
  user: string;
  /** Vrai si la session porte un utilisateur authentifié (`user` non vide). */
  authenticated: boolean;
  /** IP capturée au login (`metaBag.ip`), ou `null` si non capturée / anonyme. */
  ip: string | null;
  /** User-Agent capturé au login (`metaBag.ua`), ou `null` si non capturé. */
  ua: string | null;
  /** Création de la session (epoch ms), ou `null` si inconnue. */
  createdAt: number | null;
  /** Dernière persistance (epoch ms), ou `null` si inconnue. */
  updatedAt: number | null;
  /** Réserve multi-tenant (toujours `null` en mono-tenant — slot coût-0). */
  tenantId: string | null;
}

/**
 * Entrée **brute** d'énumération renvoyée par {@link ISessionStorage.listAll} :
 * l'id opaque RÉEL + le blob sérialisé. Usage strictement **interne au process**
 * (le service en a besoin pour calculer le `ref` et révoquer par id) — n'est
 * JAMAIS sérialisée vers une réponse HTTP : `SessionsService` la projette en
 * {@link ISessionSummary} (redaction par construction).
 *
 * Optimisation côté stores SQL/NoSQL : `data.Attributes`/`data.flashBag` peuvent
 * être renvoyés vides (les secrets ne quittent alors jamais la base) — seuls
 * `user`/`metaBag`/timestamps sont nécessaires à la projection.
 */
export interface ISessionRecord {
  /** Identifiant opaque réel de la session (interne — jamais exposé via l'API). */
  id: string;
  data: ISerializedSession;
}

/**
 * Filtre d'énumération admin de {@link ISessionStorage.listAll}. Tous les champs
 * sont optionnels. Un store SQL peut honorer `user` (WHERE indexable) ; les autres
 * peuvent l'ignorer — `SessionsService.listAllSessions` ré-applique le filtre de
 * façon défensive. `tenantId` = slot multi-tenant (ignoré en mono-tenant).
 */
export interface ISessionListFilter {
  /** Restreint aux sessions d'un utilisateur (pour « déconnecter partout »). */
  user?: string;
  /** Slot multi-tenant — non scopé aujourd'hui (réserve coût-0). */
  tenantId?: string | null;
}

/**
 * Contrat **unique** d'un backend de stockage de session (File, Redis, SQL/Drizzle…).
 * Source de vérité unifiée — l'ex-doublon `sessionStorageInterface` (any) n'est plus
 * qu'un alias transitionnel. Enregistré dans le registre IoC `SessionsService.registerStorage`.
 */
export interface ISessionStorage {
  read(id: string): Promise<ISerializedSession>;
  write(id: string, data: ISerializedSession): Promise<ISerializedSession>;
  start(id: string): Promise<ISerializedSession>;
  open(): Promise<number>;
  close(): boolean;
  destroy(id: string): Promise<boolean>;
  gc(maxlifetime?: number): Promise<void>;
  /**
   * Énumère les sessions persistées — capacité d'**ADMINISTRATION** (gouvernance,
   * « déconnecter partout »), **optionnelle**. Un backend incapable de lister
   * (KV sans scan, edge…) l'omet : l'endpoint admin répond alors **501** (refus
   * honnête), jamais une liste vide trompeuse.
   *
   * Renvoie des {@link ISessionRecord} bruts (id réel + blob) — le service les
   * redacte. Coût **O(N)** assumé (admin, faible fréquence, pas de hot-path) ;
   * un index inverse `user → [id]` reste une optimisation future.
   *
   * @param filter - restriction optionnelle (ex. `user`) ; un store peut l'honorer
   *   (WHERE SQL) ou l'ignorer (le service ré-applique).
   */
  listAll?(filter?: ISessionListFilter): Promise<ISessionRecord[]>;
}

export interface ISession {
  id: string;
  name: string;
  status: SessionStatusType;
  saved: boolean;
  /** Vrai si la session a été mutée sans être encore persistée (dirty-tracking). */
  dirty: boolean;
  /** Lecture seule : la session est reprise mais jamais persistée (0 write storage). */
  readOnly: boolean;
  migrated: boolean;
  cookieSession: ICookie | null | undefined;
  flashBag: FlashBagType;
  strategy: SessionStrategyType;
  created?: Date;
  updated?: Date;
  user?: string;
  lifetime?: number;
  storage: ISessionStorage;

  // Lifecycle
  start(context: unknown): Promise<ISession>;
  save(user?: string): Promise<ISession>;
  invalidate(
    lifetime?: number,
    id?: string,
    options?: ICookieOptions,
  ): Promise<ISession>;
  destroy(cookieDelete?: boolean): Promise<boolean>;
  create(lifetime: number, id?: string, options?: ICookieOptions): ISession;
  /** Régénère un identifiant opaque CSPRNG en conservant l'état (anti session-fixation, seam P6). */
  regenerateId(): void;

  // Key/value attributes (Container API)
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  getAttributes(): unknown;

  // MetaBag
  getMetaBag(key: string): unknown;
  setMetaBag(key: string, value: unknown): unknown;
  getMetas(): MetaBagType;

  // FlashBag
  getFlashBag(key: string): unknown;
  setFlashBag(key: string, value: unknown): unknown;
  flashBags(): FlashBagType;
  clearFlashBag(key: string): void;
  clearFlashBags(): void;

  // Utils
  getName(): string;
  checkStatus(): "restart" | boolean;
  serialize(user?: string): ISerializedSession;
  deSerialize(data: ISerializedSession): void;
}
