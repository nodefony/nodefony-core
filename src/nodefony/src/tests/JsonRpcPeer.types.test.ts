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

import { describe, it } from "vitest";
import {
  JsonRpcPeer,
  type IRealtimePeer,
  type JsonRpcPeerOptions,
} from "../realtime/JsonRpcPeer";
import {
  expectType,
  type ActionNames,
  type ActionParams,
  type ActionsMap,
  type DefaultActionsMap,
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
// ── Côté SERVEUR (Emit=ServerToClient, Listen=ClientToServer) ─────────
declare const serverPeer: JsonRpcPeer<
  ServerToClient,
  ClientToServer,
  AppActions
>;
// ── RÉTRO-COMPAT — peer sans paramétrage (défauts permissifs) ─────────
declare const rawPeer: JsonRpcPeer; // = JsonRpcPeer<Default, Default, Default>

// ═══════════════════════════════════════════════════════════════════════════
// SENTINELLES — deux TROUS DE TYPAGE du code source, prouvés ici et RAPPORTÉS
// (le source n'est PAS modifié par ce test). Chaque sentinelle CASSERA le jour
// où le trou sera bouché → elle force à restaurer les garde-fous marqués ⚠️.
// ═══════════════════════════════════════════════════════════════════════════

// TROU 1 — BOUCHÉ. `EventNames`/`ActionNames` filtrent l'index signature héritée
// de `Record<string, …>` via la convention `interface AppActions extends
// ActionsMap` : ils rendent l'union des clés LITTÉRALES déclarées, et non plus
// `string`. Ces deux garde-fous POSITIFS verrouillent l'acquis — un nom inconnu
// doit être refusé.
// @ts-expect-error : "nom-inconnu" n'est pas une action déclarée d'AppActions
const _actionNameUnknownRefused: ActionNames<AppActions> = "nom-inconnu";
// @ts-expect-error : "canal-inconnu" n'est pas un canal déclaré de ServerToClient
const _eventNameUnknownRefused: EventNames<ServerToClient> = "canal-inconnu";

// TROU 2 — BOUCHÉ. `ActionParams` teste la PRÉSENCE de la clé `in` avant
// d'inférer : le `in?` OPTIONNEL de `DefaultActionsMap` rend donc `unknown`, et
// non plus `undefined` (qui interdisait de passer le moindre paramètre à un peer
// NON paramétré — en contradiction avec la rétro-compat promise par sa TSDoc).
// Ce garde-fou POSITIF verrouille l'acquis : il casse si le type reperd sa
// permissivité (`undefined` n'accepterait pas ce `{ foo: 1 }`).
const _rawParamsArePermissive: ActionParams<DefaultActionsMap, "anything"> = {
  foo: 1,
};

/**
 * Bloc compile-only. Jamais appelé ; sert exclusivement à faire passer le typage
 * sous le contrôle de `tsc --noEmit`.
 */
function _typeOnly(): void {
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

  // ── Garde-fous NÉGATIFS qui FONCTIONNENT ───────────────────────────────
  // (clé DÉCLARÉE : le membre l'emporte sur l'index signature → payload typé)
  // @ts-expect-error : payload mal typé sur chat:fetch
  clientPeer.request("chat:fetch", { wrong: true });
  // @ts-expect-error : payload mal formé sur canal connu
  clientPeer.notify("chat:send", { room: 42 });

  // ── Garde-fous RESTAURÉS — TROU 1 bouché (cf sentinelles en tête de fichier)
  // Les maps ne fuient plus leur index signature : ces 3 lignes sont de nouveau
  // des erreurs de compilation, comme le contrat l'exige.
  // @ts-expect-error : RPC inconnue du contrat AppActions
  clientPeer.request("chat:unknown");
  // @ts-expect-error : canal inconnu du contrat
  clientPeer.notify("chat:nope", { foo: 1 });
  // @ts-expect-error : "chat:send" est un canal CLIENT->serveur, le serveur ne l'émet pas
  serverPeer.notify("chat:send", { room: "x", msg: "x" });

  // ── Côté SERVEUR (Emit=ServerToClient, Listen=ClientToServer) ─────────
  serverPeer.notify("chat:room42", { ts: 0, msg: "hello" });
  serverPeer.notify("presence", { user: "alice", online: true });

  // ── RÉTRO-COMPAT — peer sans paramétrage (défauts permissifs) ─────────
  // TROU 2 bouché : les DEUX formes compilent à nouveau, avec ET sans params.
  const r1: Promise<unknown> = rawPeer.request("anything");
  expectType<Promise<unknown>>(r1);
  expectType<Promise<unknown>>(rawPeer.request("anything", { foo: 1 }));
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
