/**
 * Tests de TYPAGE du décorateur `@services()` face à la config d'un module.
 *
 * Ce que ces sentinelles protègent : le CLAUDE.md racine impose « interfaces
 * préfixées `I` » ET `extends Module<IXConfig>` pour typer `this.config`. Or
 * `@services()` contraignait son argument à `new (...args) => Module`, soit
 * `Module<Record<string, unknown>>` (le défaut du générique). TypeScript
 * n'accorde d'**index signature implicite** qu'aux *alias de type*, jamais aux
 * *interfaces* : une `interface IXConfig` n'est donc pas assignable à
 * `Record<string, unknown>`, et le décorateur échouait en TS1238/TS1270 — dont
 * le message ("Unable to resolve signature of class decorator") ne nomme jamais
 * la vraie cause.
 *
 * Autrement dit : le framework documentait une convention qui cassait la
 * compilation de qui la suit. Les modules du repo y échappaient par accident,
 * leurs `IXConfig` étant des **alias** Zod (`export type IHttpConfig = …`).
 *
 * Les deux formes doivent compiler, et cette symétrie est le contrat :
 *  - `interface IXConfig { … }`  ← la convention documentée
 *  - `type XConfig = { … }`      ← ce qui marchait déjà par chance
 *
 * Couvert par `npm run typecheck` (`tsgo -p tsconfig.tests.json`).
 */

import { describe, it } from "vitest";
import Module from "../kernel/Module";
import Service from "../Service";
import { services } from "../kernel/decorators/kernelDecorator";

// ── Un service minimal, juste pour alimenter le décorateur ────────────────
class DummyService extends Service {}

// ── Forme 1 : INTERFACE (la convention `I` du CLAUDE.md) ──────────────────
// C'est CE cas qui cassait. Sans l'assouplissement de la contrainte, la ligne
// `@services([...])` ci-dessous lève TS1238/TS1270.
interface IBillingConfig {
  rate: number;
  currency: string;
}

@services([DummyService])
class BillingModule extends Module<IBillingConfig> {
  static readonly path: string = import.meta.url;
}

// ── Forme 2 : ALIAS de type (ce que font les modules du repo) ─────────────
// Doit continuer de compiler — garde anti-régression de l'existant.
type ShippingConfig = {
  carrier: string;
};

@services([DummyService])
class ShippingModule extends Module<ShippingConfig> {
  static readonly path: string = import.meta.url;
}

// ── Forme 3 : module SANS config (défaut du générique) ────────────────────
// Le cas le plus courant ; doit rester intact.
@services([DummyService])
class PlainModule extends Module {
  static readonly path: string = import.meta.url;
}

// ── Le décorateur doit RENDRE le type d'origine, pas l'élargir ────────────
// (`@services()` renvoie `T`, donc la classe décorée reste elle-même : sa
// config typée doit rester lisible côté consommateur.)
declare const billing: InstanceType<typeof BillingModule>;

function _typeOnly(): void {
  const rate: number = billing.config.rate;
  const currency: string = billing.config.currency;
  (void rate, currency);
}

void _typeOnly;
void ShippingModule;
void PlainModule;

describe("@services() et la config typée d'un module", () => {
  it("accepte une interface de config aussi bien qu'un alias (compile-only)", () => {
    // La preuve est faite par `tsgo -p tsconfig.tests.json`. Ce cas existe pour
    // que la sentinelle apparaisse dans le rapport vitest.
  });
});
