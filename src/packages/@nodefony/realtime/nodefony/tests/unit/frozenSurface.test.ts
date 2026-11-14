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
import type {
  RealtimeClosedReason,
  RealtimeDeniedReason,
} from "../../../../../../nodefony/src/realtime/RealtimeEventMap.js";
import {
  FROZEN_CLOSE_CODES,
  FROZEN_CLOSED_REASONS,
  FROZEN_CONTRACT_TYPES,
  FROZEN_CONTRACT_VALUES,
  FROZEN_DENIED_REASONS,
  FROZEN_PERSONAL_CHANNEL,
  FROZEN_PRESENCE_API,
  FROZEN_PRESENCE_BUS_CHANNELS,
  FROZEN_PRESENCE_BUS_FIELDS,
  FROZEN_PRESENCE_COUNTERS,
  FROZEN_PRESENCE_FRAME,
  FROZEN_PRESENCE_METHODS,
  FROZEN_PRESENCE_POLICY,
  FROZEN_PRESENCE_VALUES,
  FROZEN_REFUSAL_COUNTERS,
} from "./frozenSurface.fixture";
import type {
  IPresenceAlive,
  IPresenceBatch,
  IPresenceChannelDelta,
  IPresenceChannelState,
  IPresenceRequest,
  IPresenceStatePart,
} from "../../src/backplane/presenceMessage";
import type {
  IPresenceEntry,
  IRealtimePresenceChanges,
  IRealtimePresenceHead,
  IRealtimePresenceList,
} from "../../../../../../nodefony/src/realtime/RealtimeEventMap.js";
import type {
  IChannelPolicy,
  IChannelPresenceOptions,
} from "../../../../../../nodefony/src/realtime/channelAdmission.js";
import type { IPresenceProbe } from "../../../../../../nodefony/src/realtime/platformHealth.js";
import type * as reactBinding from "../../../../../../nodefony/src/client/react/index.js";
import type * as vueBinding from "../../../../../../nodefony/src/client/vue/index.js";
import type * as angularBinding from "../../../../../../nodefony/src/client/angular/index.js";
import type * as svelteBinding from "../../../../../../nodefony/src/client/svelte/index.js";
// Les index PUBLICS du cœur, par la source (même raison que `closeCodes`).
import * as core from "../../../../../../nodefony/src/index.js";
import * as coreClient from "../../../../../../nodefony/src/client/index.js";
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";

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
  `${string}${"Rejected" | "Denied" | "TimedOut" | "Saturated" | "Discarded"}Total`
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
// Idem pour les motifs de fin d'abonnement (`realtime:closed`).
type ClosedReasons = (typeof FROZEN_CLOSED_REASONS)[number];
export type ClosedReasonsPublished = Assert<
  Subset<NamesOf<Published<ClosedReasons>>, RealtimeClosedReason>
>;
export type ClosedReasonsClosed = Assert<
  Subset<RealtimeClosedReason, NamesOf<ClosedReasons>>
>;
export type ClosedReasonsPendingAbsent = Assert<
  None<Extract<NamesOf<Pending<ClosedReasons>>, RealtimeClosedReason>>
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

// Canal personnel : chaque nom figé existe sur le type qui le porte.
type Personal = (typeof FROZEN_PERSONAL_CHANNEL)[number];
interface IPersonalOwners {
  RealtimeHub: keyof RealtimeHub;
  NodefonySocket: keyof NodefonySocket;
  IRealtimeProbe: keyof IRealtimeProbe;
}
type PersonalOk<E> = E extends {
  name: infer N;
  on: infer O extends keyof IPersonalOwners;
}
  ? N extends IPersonalOwners[O]
    ? true
    : false
  : false;
export type PersonalPublished = Assert<
  [PersonalOk<Personal>] extends [true] ? true : false
>;

// ── Présence (ADR-0025, #760 étape 6) : ensembles FERMÉS, jugés à la compilation ──
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Fields = typeof FROZEN_PRESENCE_BUS_FIELDS;
type Frame = typeof FROZEN_PRESENCE_FRAME;
type Of<T extends readonly string[]> = T[number];
export type BusBatchFrozen = Assert<
  Same<keyof IPresenceBatch, Of<Fields["batch"]>>
>;
export type BusRequestFrozen = Assert<
  Same<keyof IPresenceRequest, Of<Fields["request"]>>
>;
export type BusStateFrozen = Assert<
  Same<keyof IPresenceStatePart, Of<Fields["state"]>>
>;
export type BusAliveFrozen = Assert<
  Same<keyof IPresenceAlive, Of<Fields["alive"]>>
>;
export type BusDeltaFrozen = Assert<
  Same<keyof IPresenceChannelDelta, Of<Fields["channelDelta"]>>
>;
export type BusStateChannelFrozen = Assert<
  Same<keyof IPresenceChannelState, Of<Fields["channelState"]>>
>;
export type FrameHeadFrozen = Assert<
  Same<keyof IRealtimePresenceHead, Of<Frame["head"]>>
>;
export type FrameListFrozen = Assert<
  Same<
    Exclude<keyof IRealtimePresenceList, keyof IRealtimePresenceHead>,
    Of<Frame["list"]>
  >
>;
export type FrameChangesFrozen = Assert<
  Same<keyof IRealtimePresenceChanges, Of<Frame["changes"]>>
>;
export type FrameEntryFrozen = Assert<
  Same<keyof IPresenceEntry, Of<Frame["entry"]>>
>;
export type PolicyKeyFrozen = Assert<
  (typeof FROZEN_PRESENCE_POLICY)["key"] extends keyof IChannelPolicy
    ? true
    : false
>;
export type PolicyOptionsFrozen = Assert<
  Same<
    keyof IChannelPresenceOptions,
    Of<(typeof FROZEN_PRESENCE_POLICY)["options"]>
  >
>;
type PresenceRefusals = Extract<
  keyof IPresenceProbe,
  `${string}${"Rejected" | "Denied" | "TimedOut" | "Saturated" | "Discarded"}Total`
>;
export type PresenceCountersFrozen = Assert<
  Same<PresenceRefusals, (typeof FROZEN_PRESENCE_COUNTERS)[number]["name"]>
>;
// Méthodes : chaque nom figé existe sur le type ou la liaison qui le porte.
interface IPresenceOwners {
  RealtimeHub: keyof RealtimeHub;
  NodefonySocket: keyof NodefonySocket;
  react: keyof typeof reactBinding;
  vue: keyof typeof vueBinding;
  angular: keyof typeof angularBinding;
  svelte: keyof typeof svelteBinding;
}
type PresenceMethod = (typeof FROZEN_PRESENCE_METHODS)[number];
type MethodOk<E> = E extends {
  name: infer N;
  on: infer O extends keyof IPresenceOwners;
}
  ? N extends IPresenceOwners[O]
    ? true
    : false
  : false;
export type PresenceMethodsPublished = Assert<
  [MethodOk<PresenceMethod>] extends [true] ? true : false
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
    // Élargi à `Entry` : une fois tous les codes livrés, le littéral n'a plus
    // aucune entrée `ticket` et le rétrécir donnerait `never`.
    const entries: readonly Entry[] = FROZEN_CLOSE_CODES;
    for (const e of entries) {
      if (e.ticket === undefined) continue;
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

  it("l'arrêt propre de la présence s'exporte depuis l'index public", () => {
    const values: Record<string, unknown> = realtime;
    for (const e of FROZEN_PRESENCE_VALUES) {
      expect(typeof values[e.name], e.name).toBe(e.kind);
    }
  });

  it("présence : canaux du bus et méthode de la trame, à leur valeur exacte", () => {
    for (const e of FROZEN_PRESENCE_BUS_CHANNELS)
      expect(core.PLATFORM_BUS_CHANNELS[e.key], e.key).toBe(e.value);
    expect(core.REALTIME_PRESENCE_METHOD).toBe(FROZEN_PRESENCE_FRAME.method);
  });

  it("présence : chaque valeur figée s'exporte depuis l'index public de son paquet", () => {
    const from: Record<string, Record<string, unknown>> = {
      nodefony: core,
      "nodefony/client": coreClient,
      "@nodefony/realtime": realtime,
    };
    for (const e of FROZEN_PRESENCE_API) {
      expect(typeof from[e.from]?.[e.name], `${e.from} → ${e.name}`).toBe(
        e.kind,
      );
    }
  });

  it("présence : le hub et la socket portent leurs méthodes figées à l'exécution", () => {
    const hub = new RealtimeHub();
    const owners: Record<string, Record<string, unknown>> = {
      RealtimeHub: { presence: hub.presence, endPresence: hub.endPresence },
      NodefonySocket: {
        onPresence: NodefonySocket.prototype.onPresence,
        presence: NodefonySocket.prototype.presence,
      },
    };
    for (const e of FROZEN_PRESENCE_METHODS) {
      if (!(e.on in owners)) continue; // liaisons : jugées par le type
      expect(typeof owners[e.on]?.[e.name], `${e.on}.${e.name}`).toBe(
        "function",
      );
    }
  });

  it("la sonde du hub n'expose comme compteurs de refus que ceux de la fixture", () => {
    const probe = new RealtimeHub().probe();
    const refusals = Object.keys(probe).filter((k) =>
      /(?:Rejected|Denied|TimedOut|Saturated|Discarded)Total$/u.test(k),
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

  it("le canal personnel expose ses noms figés à l'exécution", () => {
    const hub = new RealtimeHub();
    const owners: Record<string, Record<string, unknown>> = {
      RealtimeHub: { publishToUser: hub.publishToUser },
      NodefonySocket: { onUser: NodefonySocket.prototype.onUser },
      IRealtimeProbe: { localOnlyTotal: hub.probe().localOnlyTotal },
    };
    for (const e of FROZEN_PERSONAL_CHANNEL) {
      expect(owners[e.on]?.[e.name], `${e.on}.${e.name}`).toBeDefined();
    }
  });
});
