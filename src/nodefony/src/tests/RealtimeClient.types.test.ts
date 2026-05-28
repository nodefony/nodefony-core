/**
 * Tests d'INFÉRENCE TYPES — `RealtimeClient<Emit, Listen, Actions>` paramétré
 * (pattern Socket.IO typed-events, P13 Bloc A étape 4b).
 *
 * Pendant DX de `JsonRpcPeer.types.test.ts` mais côté `RealtimeClient` (front
 * isomorphe). Spécificités :
 * - les méthodes utilisent un **type conditionnel inline** (pas d'overloads)
 *   pour préserver les noms système (`__notice__`, `*`, `subscribe`/`unsubscribe`
 *   internes) à côté du contrat applicatif strict ;
 * - quand `Listen`/`Emit`/`Actions` portent une map stricte, les literals dans la
 *   map sont typés fort ; les literals hors map tombent sur `unknown`/permissif
 *   (autocomplete uniquement sur les noms du contrat).
 *
 * Wrap `_typeOnly()` jamais appelé — `declare const` purement typage.
 */

import { describe, it } from "mocha";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  expectType,
  type ActionsMap,
  type EventsMap,
} from "../realtime/RealtimeEventMap";

// ── Maps de test (contrat applicatif simulé) ──────────────────────────────

interface ServerToClient extends EventsMap {
  "chat:room42": { ts: number; msg: string };
  presence: { user: string; online: boolean };
}

interface ClientToServer extends EventsMap {
  "chat:send": { room: string; msg: string };
}

interface AppActions extends ActionsMap {
  "chat:ping": { in: void; out: { pong: boolean; ts: number } };
  "chat:fetch": { in: { id: string }; out: { msg: string } };
}

function _typeOnly(): void {
  // Côté CLIENT : Emit=ClientToServer, Listen=ServerToClient, Actions=AppActions
  declare const client: RealtimeClient<
    ClientToServer,
    ServerToClient,
    AppActions
  >;

  // ── ON / OFF : typage strict sur les canaux RÉCEPTIONNÉS (Listen) ───────
  const off1 = client.on("chat:room42", (payload) => {
    expectType<{ ts: number; msg: string }>(payload);
  });
  expectType<() => void>(off1);

  client.on("presence", (payload) => {
    expectType<{ user: string; online: boolean }>(payload);
  });

  // Event hors map (système) → handler permissif (RealtimeHandler variadique)
  client.on("__notice__", (...args) => {
    expectType<unknown[]>(args);
  });

  // ── EMIT / PUBLISH : typage strict sur les canaux SORTANTS (Emit) ──────
  client.emit("chat:send", { room: "42", msg: "hi" });
  client.publish("chat:send", { room: "42", msg: "hi" });

  // @ts-expect-error : payload mal formé sur canal connu
  client.emit("chat:send", { wrong: true });

  // ── SUBSCRIBE / UNSUBSCRIBE : autocomplete sur Listen, mais string accepté
  client.subscribe("chat:room42");
  client.subscribe("any-string"); // permissif (système)
  client.unsubscribe("presence");

  // ── REQUEST : typé fort si method ∈ Actions, sinon Promise<T> permissif
  expectType<Promise<{ pong: boolean; ts: number }>>(
    client.request("chat:ping"),
  );
  expectType<Promise<{ msg: string }>>(
    client.request("chat:fetch", { id: "x" }),
  );

  // method hors map → fallback Promise<T> permissif (avec T explicite)
  expectType<Promise<{ uptime: number }>>(
    client.request<"kernel:ping", { uptime: number }>("kernel:ping"),
  );

  // @ts-expect-error : RPC inconnue sans T explicite → param strict refusé
  client.request("chat:ping", { wrong: true });

  // ── RÉTRO-COMPAT — client sans paramétrage (défauts permissifs) ────────
  declare const rawClient: RealtimeClient;
  rawClient.on("any-event", (...args) => {
    expectType<unknown[]>(args);
  });
  rawClient.emit("any-channel", { foo: 1 });
  rawClient.publish("any-channel", { foo: 1 });
  expectType<Promise<unknown>>(rawClient.request("any-method"));
}

describe("RealtimeClient — type inference (compile-only)", () => {
  it("compiles when types match the contract", () => {
    void _typeOnly;
  });
});
