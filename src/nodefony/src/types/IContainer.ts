import type { Pci, Severity, Msgid, Message } from "../syslog/Pdu";
import type Syslog from "../syslog/Syslog";

/**
 * Contrat public d'un scope (Container enfant lié à un parent).
 * Étend IContainer et ajoute name, l'état de fermeture et le rattachement d'objets.
 */
export interface IScope extends IContainer {
  readonly name: string;
  /**
   * `true` une fois le scope refermé par `leaveScope()` : ses services sont
   * libérés, un `get()` y rend `null` et un `set()` lève. Un
   * scope fermé ne se rouvre pas — on en ouvre un neuf.
   */
  readonly closed: boolean;
  /**
   * `true` si `name` est posé SUR ce scope — jamais un service hérité du
   * conteneur parent. `has()` suit la chaîne de prototypes et répondrait
   * `true` pour un singleton homonyme.
   */
  hasOwn(name: string): boolean;
  /**
   * Lie la durée de vie d'un objet à celle du scope : son `clean()`, s'il en a
   * un, est appelé à la fermeture du scope, dans l'ordre INVERSE des
   * rattachements (le dernier créé est nettoyé le premier).
   *
   * @throws Error si le scope est déjà fermé — l'objet ne serait jamais nettoyé.
   */
  own(instance: object): void;
}

/**
 * Contrat public du DI Container nodefony.
 * Container et Scope l'implémentent.
 */
export interface IContainer {
  readonly id: string;

  // ─── Services ──────────────────────────────────────────────────────────────
  set(name: string, object: unknown): void;
  // Générique de RETOUR voulu : l'appelant nomme le type du service qu'il
  // résout (`get<HttpKernel>("HttpKernel")`) — API publique du conteneur.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  get<T = unknown>(name: string): T | null;
  remove(name: string): boolean;
  has(name: string): boolean;
  keys(): string[];
  entries(): [string, unknown][];

  // ─── Scopes ────────────────────────────────────────────────────────────────
  addScope(name: string): object;
  enterScope(name: string): IScope;
  leaveScope(scope: IScope): void;
  removeScope(name: string): void;
  /** Nombre d'instances vivantes du scope nommé (introspection/sondes). */
  scopeCount(name: string): number;

  // ─── Logging ───────────────────────────────────────────────────────────────
  log(
    pci: Pci,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): ReturnType<Syslog["log"]> | void;

  // ─── Cycle de vie ──────────────────────────────────────────────────────────
  clean(): void;
  reset(): void;
}
