import { describe, it } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import type { ContextType } from "@nodefony/http";
import { expectType, type EventsMap, type ActionsMap } from "nodefony";
import { RealtimeClient } from "../../../../../../nodefony/src/client/realtime/RealtimeClient.js";

/**
 * Test d'INFÉRENCE de TYPES (compile-only) — le « contrat de canaux typé partagé »
 * (L3). Une map déclarée **UNE fois** type le CLIENT et le SERVEUR : refactor-safe
 * bout-en-bout (renommer un canal casse à la compile des 2 côtés), autocomplétion
 * des deux côtés — le typage ne s'arrête plus à la frontière réseau.
 *
 * Pendant DX de `RealtimeClient.types.test.ts`, mais étendu au serveur
 * (`RealtimeController` générique). `_typeOnly` n'est jamais appelé : `declare` +
 * `void` = typage pur. La vérité est rendue par la gate `tsc --noEmit` (esbuild,
 * lui, efface les types → vitest ne « voit » que des `it` triviaux).
 */

// ── Contrat partagé, déclaré UNE seule fois ────────────────────────────────
interface ServerToClient extends EventsMap {
  "dashboard:stats": { cpu: number; mem: number };
}
interface ClientToServer extends EventsMap {
  "client:cmd": { action: string };
}
interface AppActions extends ActionsMap {
  // RPC exposée par le CLIENT (`register`), appelée par le SERVEUR (`requestClient`).
  "client:confirm": { in: { id: string }; out: { ok: boolean } };
}

// ── CÔTÉ CLIENT : Emit=ClientToServer, Listen=ServerToClient, Actions=AppActions
// `declare const` est une déclaration AMBIANTE : elle n'existe qu'à la compilation
// (jamais instanciée au runtime). Elle doit vivre au niveau MODULE — un modificateur
// `declare` est illégal dans un corps de fonction (TS1184).
declare const client: RealtimeClient<
  ClientToServer,
  ServerToClient,
  AppActions
>;

function _typeOnly(): void {
  client.on("dashboard:stats", (p) => {
    expectType<{ cpu: number; mem: number }>(p);
  });
  client.register("client:confirm", (p) => {
    expectType<{ id: string }>(p);
    return { ok: true };
  });

  // ── CÔTÉ SERVEUR : Emit=ServerToClient (ce qu'il émet), Actions=AppActions
  //    (la MÊME map `AppActions`/`ServerToClient` que le client — l'intérêt de L3).
  class AppRt extends RealtimeController<ServerToClient, AppActions> {
    constructor(ctx: ContextType) {
      super("app-rt", ctx);
    }
    demo(): void {
      // notifyClient typé par ServerToClient (ce que le serveur ÉMET)
      this.notifyClient("dashboard:stats", { cpu: 12, mem: 34 });
      // @ts-expect-error payload mal formé sur un canal connu
      this.notifyClient("dashboard:stats", { cpu: "x" });
      // requestClient typé par AppActions (la MÊME map que le client)
      expectType<Promise<{ ok: boolean }>>(
        this.requestClient("client:confirm", { id: "42" }),
      );
      // @ts-expect-error params mal formés
      this.requestClient("client:confirm", { wrong: true });
    }
  }
  void AppRt;

  // ── RÉTRO-COMPAT : un controller NON paramétré est permissif SUR LES DEUX voies.
  //    `notifyClient` passe (`EventPayload<DefaultEventsMap, K>` = `unknown`) et
  //    `requestClient` aussi : `ActionParams` teste désormais la PRÉSENCE de la clé
  //    `in` avant d'inférer, donc le `in?` OPTIONNEL de `DefaultActionsMap` rend
  //    bien `unknown` (et non plus `undefined`, qui interdisait tout paramètre).
  //    L'asymétrie est levée — cf `src/nodefony/src/realtime/RealtimeEventMap.ts`.
  class RawRt extends RealtimeController {
    constructor(ctx: ContextType) {
      super("raw-rt", ctx);
    }
    demo(): void {
      this.notifyClient("any:channel", { whatever: 1 });
      void this.requestClient("any:method", { x: 1 });
    }
  }
  void RawRt;
}

describe("Realtime — contrat de canaux typé partagé (L3, compile-only)", () => {
  it("compile : une seule map type le client ET le serveur", () => {
    void _typeOnly;
  });
});
