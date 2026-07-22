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

import { describe, it } from "vitest";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  expectType,
  type ActionNames,
  type ActionsMap,
  type EventNames,
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

// ── Fixtures compile-only ────────────────────────────────────────────────
// `declare const` est ILLÉGAL dans un corps de fonction (TS1184) : les fixtures
// vivent au scope module (ambient → aucun emit runtime, `_typeOnly` jamais appelé).

// Côté CLIENT : Emit=ClientToServer, Listen=ServerToClient, Actions=AppActions
declare const client: RealtimeClient<
  ClientToServer,
  ServerToClient,
  AppActions
>;
// RÉTRO-COMPAT — client sans paramétrage (défauts permissifs)
declare const rawClient: RealtimeClient;

// ═══════════════════════════════════════════════════════════════════════════
// SENTINELLES — TROUS DE TYPAGE du code source, prouvés ici et RAPPORTÉS (le
// source n'est PAS modifié par ce test). Elles CASSERONT quand les trous seront
// bouchés → elles forcent à restaurer les garde-fous marqués ⚠️ plus bas.
// ═══════════════════════════════════════════════════════════════════════════

// TROU 1 — BOUCHÉ. `EventNames`/`ActionNames` filtrent l'index signature héritée
// par la convention `interface X extends EventsMap|ActionsMap` : ils rendent
// l'union des clés LITTÉRALES. Deux conséquences, toutes deux vérifiées plus bas :
// (a) un nom inconnu est refusé ; (b) la branche « hors map → Promise<T> » du type
// conditionnel redevient ATTEIGNABLE (elle était morte), ce qui rend aussi son
// handler variadique au wildcard `on("*")`.
// @ts-expect-error : "nom-inconnu" n'est pas une action déclarée d'AppActions
const _actionNameUnknownRefused: ActionNames<AppActions> = "nom-inconnu";
// @ts-expect-error : "canal-inconnu" n'est pas un canal déclaré de ServerToClient
const _eventNameUnknownRefused: EventNames<ServerToClient> = "canal-inconnu";

function _typeOnly(): void {
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

  // ── method hors map → retombe sur `Promise<T>`, T HONORÉ (TROU 1 bouché) ──
  // La branche « hors map » du type conditionnel était morte tant que
  // `ActionNames<AppActions>` valait `string`. Elle est de nouveau atteignable :
  // le `T` explicite est respecté (et non plus écrasé en `unknown`).
  expectType<Promise<{ uptime: number }>>(
    client.request<"nodefony:kernel:ping", { uptime: number }>(
      "nodefony:kernel:ping",
    ),
  );

  // ── ⚠️ Garde-fou INOPÉRANT — TROU 3 (le seul encore ouvert) ──────────────
  // `params: { wrong: true }` sur une RPC dont le contrat dit `in: void` DEVRAIT
  // être refusé. La surcharge HISTORIQUE `request<T>(method: string, params?:
  // unknown, timeoutMs?)` est un ATTRAPE-TOUT : quand la surcharge typée échoue,
  // TS retombe dessus et accepte n'importe quoi. Un `@ts-expect-error` ici serait
  // « unused » — d'où cette ligne nue.
  //
  // Elle NE PEUT PAS être retirée sans breaking change : les deux formes se
  // disputent le 1ᵉʳ générique (`<T>` = résultat / `<K>` = nom de méthode). Tout
  // `request<MonType>("ma:methode")` du repo — `ping()`, Studio `nodefony:scaffold:run` —
  // devrait devenir `request<"ma:methode", MonType>`. Décision produit en attente.
  client.request("chat:ping", { wrong: true }); // devrait ❌

  // ── RÉTRO-COMPAT — client sans paramétrage (défauts permissifs) ────────
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
