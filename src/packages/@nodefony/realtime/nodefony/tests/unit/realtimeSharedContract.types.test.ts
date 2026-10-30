import { describe, it } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import type { ContextType } from "@nodefony/http";
import {
  expectType,
  type EventsMap,
  type ActionsMap,
  type IRealtimeContract,
  type ContractClientEmit,
  type ContractClientListen,
} from "nodefony";
import { implementRealtimeContract } from "../../src/server/implementRealtimeContract.js";
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
// Par la SOURCE, comme `NodefonySocket` : via `"nodefony"`, le contrat serait lu
// dans `dist/types`, et la garde `@ts-expect-error` ci-dessous jugerait un build.
import type { IRealtimeSocket } from "../../../../../../nodefony/src/realtime/IRealtimeSocket.js";

/**
 * Test d'INFÉRENCE de TYPES (compile-only) — le « contrat de canaux typé partagé »
 * (L3). Une map déclarée **UNE fois** type le CLIENT et le SERVEUR : refactor-safe
 * bout-en-bout (renommer un canal casse à la compile des 2 côtés), autocomplétion
 * des deux côtés — le typage ne s'arrête plus à la frontière réseau.
 *
 * Pendant DX de `NodefonySocket.types.test.ts`, mais étendu au serveur
 * (`RealtimeController` générique). `_typeOnly` n'est jamais appelé : `declare` +
 * `void` = typage pur. La vérité est rendue par la gate `tsc --noEmit` (esbuild,
 * lui, efface les types → vitest ne « voit » que des `it` triviaux).
 */

// ── Contrat partagé, déclaré UNE seule fois ────────────────────────────────
interface ServerToClient extends EventsMap {
  "nodefony:dashboard": { cpu: number; mem: number };
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
declare const client: NodefonySocket<
  ClientToServer,
  ServerToClient,
  AppActions
>;

// Le contrat COMMUN, tel qu'un code isomorphe le tient (navigateur OU serveur).
declare const shared: IRealtimeSocket<ClientToServer, ServerToClient>;

function _typeOnly(): void {
  client.on("nodefony:dashboard", (p) => {
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
      this.notifyClient("nodefony:dashboard", { cpu: 12, mem: 34 });
      // @ts-expect-error payload mal formé sur un canal connu
      this.notifyClient("nodefony:dashboard", { cpu: "x" });
      // requestClient typé par AppActions (la MÊME map que le client)
      expectType<Promise<{ ok: boolean }>>(
        this.requestClient("client:confirm", { id: "42" }),
      );
      // @ts-expect-error params mal formés
      void this.requestClient("client:confirm", { wrong: true });
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

  // ── CONTRAT COMMUN : le RPC corrélé n'y est PAS (#630). Le navigateur a un pair
  //    unique (`NodefonySocket.request`), un handle serveur en a N : la promesse ne
  //    tenait que d'un côté.
  shared.publish("client:cmd", { action: "go" });
  // @ts-expect-error `request` n'appartient plus à IRealtimeSocket
  void shared.request("client:confirm", { id: "42" });
  // …mais reste sur la socket du navigateur, typée par le contrat d'actions.
  expectType<Promise<{ ok: boolean }>>(
    client.request("client:confirm", { id: "42" }),
  );
}

// ── CONTRAT UNIQUE (ADR-0022 §4) : déclaré une fois, lu par chaque côté dans SA
//    direction. `Date` y est volontaire : ce que le pair REÇOIT est ce que JSON en
//    fait (`string`), ce qu'il ENVOIE reste le type déclaré.
interface ChatContract extends IRealtimeContract {
  serverToClient: {
    "chat:room": { from: string; text: string; at: Date };
    [channel: `user:${string}`]: { unread: number };
  };
  clientToServer: { "chat:typing": { on: boolean; at: Date } };
  serverMethods: {
    "chat:send": { in: { text: string; at: Date }; out: { id: string } };
    "chat:history": { in: void; out: { last: Date } };
  };
  clientMethods: {
    "chat:confirm": { in: { at: Date }; out: { ok: boolean; at: Date } };
  };
}

declare const chatClient: ReturnType<
  typeof NodefonySocket.fromContract<ChatContract>
>;
declare const clientListen: ContractClientListen<ChatContract>;

const chat = implementRealtimeContract<ChatContract>();

function _contractOnly(): void {
  // ── CLIENT : la porte dérive les trois génériques, aucune inversion à la main.
  chatClient.on("chat:room", (m) => {
    expectType<string>(m.at); // reçu : ce que JSON fait d'une `Date`
  });
  // INVERSION : les noms de canaux du client restent ouverts (canaux dynamiques,
  // de plateforme) ; l'inversion se garde donc sur les cartes que la porte dérive.
  // @ts-expect-error ce que le client reçoit n'est pas ce qu'il émet
  const emitted: ContractClientEmit<ChatContract> = clientListen;
  void emitted;
  chatClient.on("user:42", (m) => expectType<number>(m.unread)); // canal à motif
  chatClient.publish("chat:typing", { on: true, at: new Date() }); // émis : déclaré
  chatClient.register("chat:confirm", (p) => {
    expectType<string>(p.at); // implémenteur : `in` lu par Jsonify
    return { ok: true, at: new Date() };
  });
  void chatClient
    .request("chat:send", { text: "x", at: new Date() })
    .then((r) => expectType<{ id: string }>(r));
  void chatClient
    .request("chat:history")
    .then((r) => expectType<string>(r.last)); // appelant : `out` lu par Jsonify

  // ── SERVEUR : la fabrique impose la table COMPLÈTE de `serverMethods`.
  class ChatRt extends chat.Controller {
    constructor(ctx: ContextType) {
      super("chat-rt", ctx);
    }
    protected realtimeActions() {
      return {
        "chat:send": (p: { text: string; at: string }) => this.send(p),
        "chat:history": () => ({ last: new Date() }),
      };
    }
    @chat.RealtimeAction("chat:send", { roles: ["ROLE_USER"] })
    send(p: { text: string; at: string }): { id: string } {
      return { id: p.text };
    }
    protected override realtimeInbound() {
      return {
        "chat:typing": (
          p: { on: boolean; at: string },
          reply: (m: { unread: number }) => void,
        ) => {
          expectType<string>(p.at);
          void reply;
        },
      };
    }
    protected override realtimeChannels() {
      return ["chat:room" as const, "user:7" as const];
    }
    demo(): void {
      this.notifyClient("chat:room", { from: "s", text: "t", at: new Date() });
      // @ts-expect-error CANAL HORS D'Emit : `chat:typing` est ce que le client émet
      this.notifyClient("chat:typing", { on: true, at: new Date() });
      void this.requestClient("chat:confirm", { at: new Date() }).then((r) =>
        expectType<string>(r.at),
      );
    }
  }
  void ChatRt;

  class MissingRt extends chat.Controller {
    // @ts-expect-error ACTION MANQUANTE : `chat:history` n'est pas servie
    protected realtimeActions() {
      return { "chat:send": () => ({ id: "1" }) };
    }
  }
  void MissingRt;

  class WrongShapeRt extends chat.Controller {
    // @ts-expect-error FORME FAUSSE : le résultat déclaré de `chat:send` est `{ id: string }`
    protected realtimeActions() {
      return {
        "chat:send": () => ({ id: 1 }),
        "chat:history": () => ({ last: new Date() }),
      };
    }
    // @ts-expect-error FORME FAUSSE au décorateur : `at` arrive en `string`, pas en `Date`
    @chat.RealtimeAction("chat:send")
    send(p: { text: string; at: Date }): { id: string } {
      return { id: p.text };
    }
    // @ts-expect-error NOM HORS CONTRAT au décorateur
    @chat.RealtimeAction("chat:unknown")
    other(): void {}
  }
  void WrongShapeRt;

  class WrongInboundRt extends chat.Controller {
    protected realtimeActions() {
      return {
        "chat:send": () => ({ id: "1" }),
        "chat:history": () => ({ last: new Date() }),
      };
    }
    // @ts-expect-error ENTRÉE MAL LUE : `at` arrive en `string`, pas en `Date`
    protected override realtimeInbound() {
      return { "chat:typing": (p: { on: boolean; at: Date }) => void p };
    }
    // @ts-expect-error CANAL ANNONCÉ hors de `serverToClient`
    protected override realtimeChannels() {
      return ["chat:typing" as const];
    }
  }
  void WrongInboundRt;

  class InvertedInboundRt extends chat.Controller {
    protected realtimeActions() {
      return {
        "chat:send": () => ({ id: "1" }),
        "chat:history": () => ({ last: new Date() }),
      };
    }
    // @ts-expect-error INVERSION : `chat:room` est émis par le serveur, pas une entrée
    protected override realtimeInbound() {
      return { "chat:room": () => undefined };
    }
  }
  void InvertedInboundRt;

  // Un contrat SANS `serverMethods` (tableau de bord) : la table vide suffit.
  interface DashContract extends IRealtimeContract {
    serverToClient: { "dash:cpu": { load: number } };
  }
  const dash = implementRealtimeContract<DashContract>();
  class DashRt extends dash.Controller {
    protected realtimeActions() {
      return {};
    }
  }
  void DashRt;
}

describe("Realtime — contrat de canaux typé partagé (L3, compile-only)", () => {
  it("compile : un contrat unique, lu par chaque côté dans sa direction", () => {
    void _contractOnly;
  });
  it("compile : une seule map type le client ET le serveur", () => {
    void _typeOnly;
  });
});
