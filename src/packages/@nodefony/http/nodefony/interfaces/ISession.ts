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
