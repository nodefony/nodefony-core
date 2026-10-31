import { describe, expect, it } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import type { IRealtimeProbe } from "../../interfaces/IRealtimeProbe.js";
import type { IRealtimeContract } from "nodefony";
import * as realtime from "../../../index.js";
import type {
  ContractPolicyNames,
  ContractRealtimeMethodHandlers,
  ContractRealtimePublish,
  IContractRealtimeHub,
  RealtimeContractOf,
} from "../../../index.js";
// Par la SOURCE du cœur : via `"nodefony"`, on jugerait un `dist` qui peut dater.
import * as closeCodes from "../../../../../../nodefony/src/realtime/closeCodes.js";
import type { RealtimeDeniedReason } from "../../../../../../nodefony/src/realtime/RealtimeEventMap.js";
import {
  FROZEN_CLOSE_CODES,
  FROZEN_CONTRACT_TYPES,
  FROZEN_CONTRACT_VALUES,
  FROZEN_DENIED_REASONS,
  FROZEN_REFUSAL_COUNTERS,
} from "./frozenSurface.fixture";

/**
 * Surface temps réel figée par 10.0 (ADR-0021 §S9, §S11 ; ADR-0022 §6) : ce que
 * le code expose doit être EXACTEMENT ce que la fixture déclare — rien de moins
 * pour une entrée publiée, rien de plus hors de la fixture, et une entrée encore
 * attendue (`ticket`) ne doit pas exister au code : le ticket qui la livre retire
 * son `ticket` dans le même commit.
 */

// ── Types : motifs et compteurs de refus, ensembles FERMÉS ─────────────────
type Assert<T extends true> = T;
type Entry = { readonly name: string; readonly ticket?: number };
type Published<E> = E extends { ticket: number } ? never : E;
type Pending<E> = E extends { ticket: number } ? E : never;
type NamesOf<E> = E extends { name: infer N } ? N : never;
type Subset<A, B> = [A] extends [B] ? true : false;
type None<A> = [A] extends [never] ? true : false;

type Reasons = (typeof FROZEN_DENIED_REASONS)[number];
type Counters = (typeof FROZEN_REFUSAL_COUNTERS)[number];
/** Une clé de sonde est un compteur de REFUS si son nom le dit (S9 : un par cause). */
type RefusalKeys = Extract<
  keyof IRealtimeProbe,
  `${string}${"Rejected" | "Denied" | "TimedOut" | "Saturated"}Total`
>;

// Chaque motif publié existe ; aucun motif hors fixture ; aucun attendu déjà livré.
export type ReasonsPublished = Assert<
  Subset<NamesOf<Published<Reasons>>, RealtimeDeniedReason>
>;
export type ReasonsClosed = Assert<
  Subset<RealtimeDeniedReason, NamesOf<Reasons>>
>;
export type ReasonsPendingAbsent = Assert<
  None<Extract<NamesOf<Pending<Reasons>>, RealtimeDeniedReason>>
>;
// Idem pour les compteurs de refus de la sonde du hub.
export type CountersPublished = Assert<
  Subset<NamesOf<Published<Counters>>, keyof IRealtimeProbe>
>;
export type CountersClosed = Assert<Subset<RefusalKeys, NamesOf<Counters>>>;
export type CountersPendingAbsent = Assert<
  None<Extract<NamesOf<Pending<Counters>>, keyof IRealtimeProbe>>
>;

// Types de la porte du contrat : chaque nom figé est importé par l'index public
// (sinon cette table ne compile pas), et la table ne porte que des noms figés.
interface IProbeContract extends IRealtimeContract {
  serverToClient: { "probe:tick": { n: number } };
  serverMethods: { "probe:ping": { in: void; out: { ok: boolean } } };
}
interface IContractTypeExports {
  ContractRealtimePublish: ContractRealtimePublish<IProbeContract>;
  IContractRealtimeHub: IContractRealtimeHub<IProbeContract>;
  ContractRealtimeMethodHandlers: ContractRealtimeMethodHandlers<IProbeContract>;
  ContractPolicyNames: ContractPolicyNames<IProbeContract>;
  RealtimeContractOf: RealtimeContractOf<
    typeof realtime.ContractRealtimeController
  >;
}
type ContractTypes = (typeof FROZEN_CONTRACT_TYPES)[number];
export type ContractTypesPublished = Assert<
  Subset<NamesOf<Published<ContractTypes>>, keyof IContractTypeExports>
>;
export type ContractTypesClosed = Assert<
  Subset<keyof IContractTypeExports, NamesOf<ContractTypes>>
>;

const pending = (e: Entry): string =>
  e.ticket === undefined ? "" : ` (attendu de #${e.ticket})`;

describe("surface temps réel figée par 10.0", () => {
  const exported = new Map<string, number>(
    Object.entries(closeCodes).flatMap(([name, value]) =>
      typeof value === "number" ? [[name, value] as const] : [],
    ),
  );

  it("chaque code de fermeture publié porte son nom et sa valeur, au registre", () => {
    for (const e of FROZEN_CLOSE_CODES) {
      if ("ticket" in e) continue;
      expect(exported.get(e.name), e.name).toBe(e.code);
    }
  });

  it("un code attendu n'existe pas encore : son ticket retire `ticket` en le livrant", () => {
    for (const e of FROZEN_CLOSE_CODES) {
      if (!("ticket" in e)) continue;
      expect(
        exported.has(e.name),
        `${e.name} est livré : retirer « ticket: ${e.ticket} » de la fixture`,
      ).toBe(false);
    }
  });

  it("le registre n'exporte aucun code hors de la fixture, ni deux fois la même valeur", () => {
    const frozen = new Map<string, number>(
      FROZEN_CLOSE_CODES.map((e) => [e.name, e.code]),
    );
    for (const [name, code] of exported) {
      expect(
        frozen.get(name),
        `${name} = ${code} n'est pas dans la surface figée`,
      ).toBe(code);
    }
    const codes = FROZEN_CLOSE_CODES.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("la porte du contrat exporte chaque valeur figée, depuis l'index public", () => {
    const values: Record<string, unknown> = realtime;
    for (const e of FROZEN_CONTRACT_VALUES) {
      expect(typeof values[e.name], e.name).toBe("function");
    }
  });

  it("la sonde du hub n'expose comme compteurs de refus que ceux de la fixture", () => {
    const probe = new RealtimeHub().probe();
    const refusals = Object.keys(probe).filter((k) =>
      /(?:Rejected|Denied|TimedOut|Saturated)Total$/u.test(k),
    );
    const frozen = new Map<string, Entry>(
      FROZEN_REFUSAL_COUNTERS.map((e) => [e.name, e]),
    );
    for (const key of refusals) {
      const e = frozen.get(key);
      expect(
        e,
        `${key} n'est pas dans la surface figée (ADR-0021 §S9)`,
      ).toBeDefined();
      expect(
        e?.ticket,
        `${key} est livré${e === undefined ? "" : pending(e)} : retirer son « ticket » de la fixture`,
      ).toBeUndefined();
    }
    for (const e of FROZEN_REFUSAL_COUNTERS) {
      if ("ticket" in e) continue;
      expect(refusals, e.name).toContain(e.name);
    }
  });
});
