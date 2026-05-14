import type { DynamicParam } from "../Container";
import type { Pci, Severity, Msgid, Message } from "../syslog/Pdu";
import type Syslog from "../syslog/Syslog";

/**
 * Contrat public d'un scope (Container enfant lié à un parent).
 * Étend IContainer et ajoute name + getParameters avec merge/deep.
 */
export interface IScope extends IContainer {
  readonly name: string;
  getParameters(
    name: string,
    merge?: boolean,
    deep?: boolean,
  ): DynamicParam | null;
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
  getParameters(name: string): DynamicParam | null;

  // ─── Scopes ────────────────────────────────────────────────────────────────
  addScope(name: string): object;
  enterScope(name: string): IScope;
  leaveScope(scope: IScope): void;
  removeScope(name: string): void;

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
