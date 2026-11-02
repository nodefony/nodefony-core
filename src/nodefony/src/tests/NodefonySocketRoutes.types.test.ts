/**
 * Tests de TYPES — les routes du pont typées par le contrat (`serverRoutes`).
 *
 * Une seule source : le schéma que la route VALIDE, référencé par `typeof`. Le
 * client en déduit le corps de `post`/`put`/`patch`/`delete`, la query de `get`
 * et le résultat de chacune. Un chemin hors contrat reste libre.
 *
 * Chaque `@ts-expect-error` est une morsure : s'il cesse de mordre, TS2578 casse
 * le typecheck. Bloc `_typeOnly` jamais appelé — aucune socket n'est ouverte.
 */

import { describe, it } from "vitest";
import { z } from "zod";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import { expectType } from "../realtime/RealtimeEventMap";
import type {
  ContractRouteSchemas,
  IRealtimeContract,
} from "../realtime/RealtimeEventMap";

const SendBody = z.object({
  text: z.string().trim().min(1).max(2000),
  to: z.string().optional(),
});
const HistoryQuery = z.object({ limit: z.number().int() });
const PageQuery = z.object({ page: z.number().optional() });
const IdParams = z.object({ id: z.string() });

interface ChatMessage {
  text: string;
  at: Date;
}

interface ChatContract extends IRealtimeContract {
  serverRoutes: {
    "POST /chat/send": { body: typeof SendBody; result: { sentAt: number } };
    "GET /chat/history": { query: typeof HistoryQuery; result: ChatMessage[] };
    "GET /chat/rooms": { query: typeof PageQuery; result: string[] };
    "DELETE /chat/message": { result: void };
    "GET /chat/messages/{id}": { params: typeof IdParams; result: ChatMessage };
    "DELETE /chat/messages/{id}": { result: { deleted: string } };
  };
}

function _typeOnly(): void {
  const chat = NodefonySocket.fromContract<ChatContract>({ url: "/chat" });

  // ── POST : corps = entrée du schéma, résultat déduit ──────────────────────
  expectType<Promise<{ sentAt: number }>>(
    chat.post("/chat/send", { text: "salut" }),
  );
  void chat.post("/chat/send", { text: "salut", to: "bob" });
  // @ts-expect-error — clé fautive : `texte` n'existe pas dans le schéma
  void chat.post("/chat/send", { texte: "x" });
  // @ts-expect-error — le schéma EXIGE un corps
  void chat.post("/chat/send");
  // @ts-expect-error — mauvais type de champ
  void chat.post("/chat/send", { text: 42 });
  // @ts-expect-error — le résultat n'est pas une chaîne
  expectType<Promise<string>>(chat.post("/chat/send", { text: "a" }));

  // ── GET : query exigée quand un champ l'est, résultat lu par Jsonify ──────
  // `Date` a traversé le fil : il arrive en `string`.
  expectType<Promise<{ text: string; at: string }[]>>(
    chat.get("/chat/history", { query: { limit: 20 } }),
  );
  // @ts-expect-error — la query déclarée exige `limit`
  void chat.get("/chat/history");
  // @ts-expect-error — `limit` est un nombre
  void chat.get("/chat/history", { query: { limit: "20" } });
  // Query aux champs tous facultatifs : les options restent facultatives.
  expectType<Promise<string[]>>(chat.get("/chat/rooms"));

  // ── Route déclarée sans corps : aucun corps accepté ───────────────────────
  void chat.delete("/chat/message");
  // @ts-expect-error — la route déclarée n'a pas de corps
  void chat.delete("/chat/message", { id: 1 });

  // ── Hors contrat : tout est libre, résultat `T` ───────────────────────────
  expectType<Promise<unknown>>(chat.get("/ailleurs"));
  expectType<Promise<{ n: number }>>(chat.get<{ n: number }>("/ailleurs"));
  void chat.post("/ailleurs", { nimporte: "quoi" });
  void chat.patch("/ailleurs");

  // ── Le verbe compte : `GET /chat/send` n'est pas au contrat ───────────────
  expectType<Promise<unknown>>(chat.get("/chat/send"));

  // ── `mutate` n'existe plus ; `request` ne prend plus de chemin typé ───────
  // @ts-expect-error — renommé : `post`/`put`/`patch`/`delete`
  void chat.mutate("/chat/send", { method: "POST", idempotencyKey: "k" });

  // ── Routes à paramètres de chemin : on NOMME le gabarit, la socket le remplit ─
  // Schéma `params` déclaré : les valeurs sont son entrée.
  expectType<Promise<{ text: string; at: string }>>(
    chat.get("/chat/messages/{id}", { params: { id: "42" } }),
  );
  // @ts-expect-error — le gabarit porte `{id}` : les options sont exigées
  void chat.get("/chat/messages/{id}");
  // @ts-expect-error — `params` exigé
  void chat.get("/chat/messages/{id}", { timeoutMs: 10 });
  // @ts-expect-error — le schéma attend une chaîne
  void chat.get("/chat/messages/{id}", { params: { id: 42 } });
  // @ts-expect-error — `idd` n'est pas une variable de la route
  void chat.get("/chat/messages/{id}", { params: { idd: "42" } });
  // Sans schéma : une valeur par `{nom}` du gabarit, texte ou nombre.
  expectType<Promise<{ deleted: string }>>(
    chat.delete("/chat/messages/{id}", undefined, { params: { id: 7 } }),
  );
  // @ts-expect-error — `params` exigé
  void chat.delete("/chat/messages/{id}");
  // Hors contrat, le gabarit type quand même ses variables.
  expectType<Promise<unknown>>(
    chat.get("/ailleurs/{a}/{b}", { params: { a: 1, b: "z" } }),
  );
  // @ts-expect-error — `b` manque
  void chat.get("/ailleurs/{a}/{b}", { params: { a: 1 } });

  // ── Socket non paramétrée : permissive ────────────────────────────────────
  const raw = new NodefonySocket({ url: "/x" });
  expectType<Promise<unknown>>(raw.post("/chat/send", { texte: "x" }));
  // Sans contrat, la carte des routes n'a que son MOTIF (`GET /${string}`) :
  // aucune route n'y est déclarée, le résultat est celui que l'appelant annonce.
  expectType<Promise<{ name: string }[]>>(
    raw.get<{ name: string }[]>("/nodefony/kernel/api/modules"),
  );

  // ── Table serveur : le MÊME schéma, chaque route du contrat, rien d'autre ─
  const routes = {
    "POST /chat/send": { body: SendBody },
    "GET /chat/history": { query: HistoryQuery },
    "GET /chat/rooms": { query: PageQuery },
    "DELETE /chat/message": {},
    "GET /chat/messages/{id}": { params: IdParams },
    "DELETE /chat/messages/{id}": {},
  } satisfies ContractRouteSchemas<ChatContract>;
  void routes;
  const missing = {
    "POST /chat/send": { body: SendBody },
    "GET /chat/history": { query: HistoryQuery },
    "GET /chat/rooms": { query: PageQuery },
    "GET /chat/messages/{id}": { params: IdParams },
    "DELETE /chat/messages/{id}": {},
    // @ts-expect-error — `DELETE /chat/message` manque à la table
  } satisfies ContractRouteSchemas<ChatContract>;
  void missing;
  const wrongSchema = {
    // @ts-expect-error — un autre schéma que celui du contrat
    "POST /chat/send": { body: HistoryQuery },
    "GET /chat/history": { query: HistoryQuery },
    "GET /chat/rooms": { query: PageQuery },
    "DELETE /chat/message": {},
    "GET /chat/messages/{id}": { params: IdParams },
    "DELETE /chat/messages/{id}": {},
  } satisfies ContractRouteSchemas<ChatContract>;
  void wrongSchema;
  const missingParams = {
    "POST /chat/send": { body: SendBody },
    "GET /chat/history": { query: HistoryQuery },
    "GET /chat/rooms": { query: PageQuery },
    "DELETE /chat/message": {},
    // @ts-expect-error — le schéma `params` de la route manque
    "GET /chat/messages/{id}": {},
    "DELETE /chat/messages/{id}": {},
  } satisfies ContractRouteSchemas<ChatContract>;
  void missingParams;
}
void _typeOnly;

describe("NodefonySocket — routes du pont typées par le contrat (compile-only)", () => {
  it("compile : corps, query et résultat lus sur le schéma de la route", () => {
    // Le contrôle est fait par le typecheck (`tsgo --noEmit`) ; ce bloc rend la
    // suite visible au lanceur.
  });
});
