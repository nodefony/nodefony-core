import type { DynamicParam } from "../Container";
import type { Pci, Severity, Msgid, Message } from "../syslog/Pdu";
import type Syslog from "../syslog/Syslog";

/**
 * Contrat public d'un scope (Container enfant lié à un parent).
 * Étend IContainer et ajoute name + getParameters avec merge/deep.
 */
export interface IScope extends IContainer {
  readonly name: string;
  /**
   * `true` une fois le scope refermé par `leaveScope()` : ses services et
   * paramètres sont libérés, un `get()` y rend `null` et un `set()` lève. Un
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
  getParameters(
    name: string,
    merge?: boolean,
    deep?: boolean,
  ): Readonly<DynamicParam> | null;
}

/**
 * Contrat public du DI Container nodefony.
 * Container et Scope l'implémentent.
 */
export interface IContainer {
  readonly id: string;

  // ─── Services ──────────────────────────────────────────────────────────────
  set<T>(name: string, object: T): void;
  get<T = unknown>(name: string): T | null;
  remove(name: string): boolean;
  has(name: string): boolean;
  keys(): string[];
  entries(): [string, unknown][];

  // ─── Paramètres ────────────────────────────────────────────────────────────
  setParameters<T>(name: string, ele: T): DynamicParam | null;
  /**
   * Lit un paramètre. Le résultat est en LECTURE SEULE : pour une clé qu'un
   * scope ne surcharge pas, c'est le nœud du conteneur racine, partagé par
   * toutes les requêtes — gelé à la fin du démarrage.
   */
  getParameters(name: string): Readonly<DynamicParam> | null;
  /**
   * Fige l'arbre des paramètres (lecture seule en profondeur). Appelé par le
   * kernel à la fin de `onReady` ; un `setParameters` ultérieur lève.
   */
  freezeParameters(): void;

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
