/**
 * Tests d'INFÉRENCE TYPES — `IRealtimePeer` / `JsonRpcPeer` paramétrés
 * (pattern Socket.IO typed-events, P13 Bloc A étape 4).
 *
 * Pas de runtime à valider — la sécurité s'obtient à la **compile** :
 * - `expectType<T>(x)` échoue si `x` n'est pas `T` (helper compile-only).
 * - `@ts-expect-error` impose qu'une ligne PRODUISE une erreur TS (sinon TS la flag).
 *
 * Le tout vit dans une fonction `_typeOnly()` jamais appelée : TS vérifie le corps,
 * mais le code ne s'exécute pas (les `declare const` y sont purement typage).
 * Mocha lit le fichier pour le marqueur `describe/it` final ; rien d'autre ne tourne.
 */

import { describe, it } from "mocha";
import {
  JsonRpcPeer,
  type IRealtimePeer,
  type JsonRpcPeerOptions,
} from "../realtime/JsonRpcPeer";
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

/**
 * Bloc compile-only. Jamais appelé ; sert exclusivement à faire passer le typage
 * sous le contrôle de `tsc --noEmit`.
 */
function _typeOnly(): void {
  // ── Côté CLIENT (Emit=ClientToServer, Listen=ServerToClient) ────────────
  declare const clientOpts: JsonRpcPeerOptions<
    ClientToServer,
    ServerToClient,
    AppActions
  >;
  declare const clientPeer: JsonRpcPeer<
    ClientToServer,
    ServerToClient,
    AppActions
  >;

  // `request` — retour typé fort
  expectType<Promise<{ pong: boolean; ts: number }>>(
    clientPeer.request("chat:ping"),
  );
  expectType<Promise<{ msg: string }>>(
    clientPeer.request("chat:fetch", { id: "x" }),
  );

  // `notify` — payload typé fort
  clientPeer.notify("chat:send", { room: "42", msg: "hi" });

  // `register` — handler typé fort (symétrie JSON-RPC)
  clientPeer.register("chat:ping", () => ({ pong: true, ts: Date.now() }));

  // ── Garde-fous : erreurs ATTENDUES (négatives) ─────────────────────────
  // @ts-expect-error : RPC inconnue → ❌
  clientPeer.request("chat:unknown");
  // @ts-expect-error : payload mal typé sur chat:fetch
  clientPeer.request("chat:fetch", { wrong: true });
  // @ts-expect-error : canal inconnu sur notify
  clientPeer.notify("chat:nope", { foo: 1 });
  // @ts-expect-error : payload mal formé sur canal connu
  clientPeer.notify("chat:send", { room: 42 });

  // ── Côté SERVEUR (Emit=ServerToClient, Listen=ClientToServer) ─────────
  declare const serverPeer: JsonRpcPeer<
    ServerToClient,
    ClientToServer,
    AppActions
  >;

  serverPeer.notify("chat:room42", { ts: 0, msg: "hello" });
  serverPeer.notify("presence", { user: "alice", online: true });

  // @ts-expect-error : canal client-only → le serveur ne peut pas l'émettre
  serverPeer.notify("chat:send", { room: "x", msg: "x" });

  // ── RÉTRO-COMPAT — peer sans paramétrage (défauts permissifs) ─────────
  declare const rawPeer: JsonRpcPeer; // = JsonRpcPeer<Default, Default, Default>

  const r1: Promise<unknown> = rawPeer.request("anything", { foo: 1 });
  expectType<Promise<unknown>>(r1);
  rawPeer.notify("any-channel", { bar: 2 });
  rawPeer.register("any-method", () => "ok");

  // ── Phantom usage des declare (forme paramétrée des options + peer) ───
  expectType<JsonRpcPeerOptions<ClientToServer, ServerToClient, AppActions>>(
    clientOpts,
  );
  expectType<IRealtimePeer<ClientToServer, AppActions>>(clientPeer);
}

// ── Marqueur Mocha (le fichier n'a pas de vrai runtime à tester) ─────────

describe("JsonRpcPeer — type inference (compile-only)", () => {
  it("compiles when types match the contract", () => {
    /* compile = green ; le bloc _typeOnly() ci-dessus n'est jamais exécuté. */
    void _typeOnly; // évite "declared but never read"
  });
});
