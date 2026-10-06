/**
 * Les briques JSON-RPC 2.0 partagées (`jsonrpc/`) confrontées à la
 * spécification — une ligne par exigence, la clause citée.
 *
 * Ces fonctions sont le socle des DEUX portes du framework (pair temps réel,
 * serveur MCP) : une erreur ici serait commise deux fois, et invisible dans les
 * bancs de chaque porte, qui éprouvent leur réaction et non le prédicat.
 *
 * Les exemples marqués « §7 » sont ceux de la spécification elle-même
 * (https://www.jsonrpc.org/specification, section « Examples »).
 */
import { describe, it, expect } from "vitest";
import {
  JSON_RPC_VERSION,
  JsonRpcError,
  JsonRpcServerError,
  classifyJsonRpcFrame,
  isJsonRpcErrorObject,
  isJsonRpcId,
  isNotification,
  jsonRpcFailure,
  jsonRpcNotification,
  jsonRpcRequest,
  jsonRpcSuccess,
  type JsonRpcFrameKind,
} from "../jsonrpc/index";

describe("JSON-RPC 2.0 — les constantes", () => {
  it("les cinq codes standard ont la valeur de §5.1", () => {
    expect(JsonRpcError).toStrictEqual({
      PARSE_ERROR: -32700,
      INVALID_REQUEST: -32600,
      METHOD_NOT_FOUND: -32601,
      INVALID_PARAMS: -32602,
      INTERNAL_ERROR: -32603,
    });
  });

  it("la plage serveur va de -32099 à -32000, -32000 étant le défaut", () => {
    expect(JsonRpcServerError).toStrictEqual({
      DEFAULT: -32000,
      MIN: -32099,
      MAX: -32000,
    });
    // Aucun code standard n'empiète sur la plage serveur.
    for (const code of Object.values(JsonRpcError)) {
      expect(
        code < JsonRpcServerError.MIN || code > JsonRpcServerError.MAX,
      ).toBe(true);
    }
  });

  it("la version vaut exactement « 2.0 » (§4 : MUST be exactly)", () => {
    expect(JSON_RPC_VERSION).toBe("2.0");
  });
});

describe("JSON-RPC 2.0 — classifyJsonRpcFrame", () => {
  const cases: [string, unknown, JsonRpcFrameKind][] = [
    // ── requêtes ────────────────────────────────────────────────────────────
    [
      "§7 appel à paramètres positionnels",
      { jsonrpc: "2.0", method: "subtract", params: [42, 23], id: 1 },
      "request",
    ],
    [
      "§7 appel à paramètres nommés",
      {
        jsonrpc: "2.0",
        method: "subtract",
        params: { subtrahend: 23, minuend: 42 },
        id: 3,
      },
      "request",
    ],
    [
      "§7 appel de méthode inconnue (id chaîne)",
      { jsonrpc: "2.0", method: "foobar", id: "1" },
      "request",
    ],
    ["§4 id zéro", { jsonrpc: "2.0", method: "x", id: 0 }, "request"],
    [
      "§4 id fractionnaire (SHOULD NOT, toléré)",
      { jsonrpc: "2.0", method: "x", id: 1.5 },
      "request",
    ],
    [
      "§4.2 params primitif — non jugé ici, chaque porte tranche",
      { jsonrpc: "2.0", method: "x", id: 1, params: "bar" },
      "request",
    ],
    // ── notifications ───────────────────────────────────────────────────────
    [
      "§7 notification à paramètres",
      { jsonrpc: "2.0", method: "update", params: [1, 2, 3, 4, 5] },
      "notification",
    ],
    [
      "§7 notification sans paramètres",
      { jsonrpc: "2.0", method: "foobar" },
      "notification",
    ],
    // ── réponses ────────────────────────────────────────────────────────────
    ["§7 réponse de succès", { jsonrpc: "2.0", result: 19, id: 1 }, "response"],
    [
      "§5 `result: null` est un succès",
      { jsonrpc: "2.0", result: null, id: 1 },
      "response",
    ],
    [
      "§7 réponse d'erreur",
      {
        jsonrpc: "2.0",
        error: { code: -32601, message: "Method not found" },
        id: "1",
      },
      "response",
    ],
    [
      "§5.1 `data` libre",
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "m", data: { status: 409 } },
        id: 2,
      },
      "response",
    ],
    // ── invalides ───────────────────────────────────────────────────────────
    ["valeur nulle", null, "invalid"],
    ["chaîne", "x", "invalid"],
    ["nombre", 1, "invalid"],
    ["§7 objet sans protocole", { foo: "boo" }, "invalid"],
    [
      "§7 `method` non chaîne",
      { jsonrpc: "2.0", method: 1, params: "bar" },
      "invalid",
    ],
    ["§7 lot vide", [], "invalid"],
    ["§7 lot invalide", [1, 2, 3], "invalid"],
    [
      "§6 lot (refusé : aucune porte ne le sert)",
      [{ jsonrpc: "2.0", method: "x", id: 1 }],
      "invalid",
    ],
    ["§4 `jsonrpc` absent", { method: "x", id: 1 }, "invalid"],
    ["§4 `jsonrpc` « 1.0 »", { jsonrpc: "1.0", method: "x", id: 1 }, "invalid"],
    ["§4 `jsonrpc` nombre 2", { jsonrpc: 2, method: "x", id: 1 }, "invalid"],
    [
      "§4 id null (MCP : MUST NOT be null)",
      { jsonrpc: "2.0", method: "x", id: null },
      "invalid",
    ],
    ["§4 id objet", { jsonrpc: "2.0", method: "x", id: {} }, "invalid"],
    ["§4 id booléen", { jsonrpc: "2.0", method: "x", id: true }, "invalid"],
    ["§4 id tableau", { jsonrpc: "2.0", method: "x", id: [1] }, "invalid"],
    ["§5 ni `result` ni `error`", { jsonrpc: "2.0", id: 1 }, "invalid"],
    [
      "§5 `result` ET `error` (both MUST NOT)",
      {
        jsonrpc: "2.0",
        id: 1,
        result: 1,
        error: { code: -32000, message: "e" },
      },
      "invalid",
    ],
    [
      "§5.1 `error` chaîne",
      { jsonrpc: "2.0", id: 1, error: "boom" },
      "invalid",
    ],
    [
      "§5.1 code d'erreur non entier",
      { jsonrpc: "2.0", id: 1, error: { code: -32000.5, message: "m" } },
      "invalid",
    ],
    [
      "§5.1 message d'erreur absent",
      { jsonrpc: "2.0", id: 1, error: { code: -32000 } },
      "invalid",
    ],
    [
      "§5 erreur à id null — non corrélable, laissée à la porte",
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      "invalid",
    ],
    [
      "réponse sans id",
      { jsonrpc: "2.0", error: { code: -32603, message: "m" } },
      "invalid",
    ],
  ];

  for (const [title, frame, expected] of cases) {
    it(`${title} → ${expected}`, () => {
      expect(classifyJsonRpcFrame(frame)).toBe(expected);
    });
  }

  it("ne lit que des propriétés : une frame gelée se classe sans erreur", () => {
    expect(
      classifyJsonRpcFrame(Object.freeze({ jsonrpc: "2.0", method: "x" })),
    ).toBe("notification");
  });
});

describe("JSON-RPC 2.0 — prédicats", () => {
  it("isJsonRpcId : chaîne ou nombre, jamais null, objet ni booléen", () => {
    for (const ok of ["a", "", 0, 1, -1, 1.5])
      expect(isJsonRpcId(ok)).toBe(true);
    for (const ko of [null, undefined, {}, [], true]) {
      expect(isJsonRpcId(ko)).toBe(false);
    }
  });

  it("isJsonRpcErrorObject : code ENTIER et message chaîne (§5.1)", () => {
    expect(isJsonRpcErrorObject({ code: -32600, message: "m" })).toBe(true);
    expect(isJsonRpcErrorObject({ code: 1, message: "", data: null })).toBe(
      true,
    );
    for (const ko of [
      null,
      "m",
      { code: "1", message: "m" },
      { code: 1.5, message: "m" },
      { code: 1 },
      { message: "m" },
    ]) {
      expect(isJsonRpcErrorObject(ko)).toBe(false);
    }
  });

  it("isNotification : vrai seulement SANS membre `id`", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "x" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", method: "x", id: null })).toBe(
      false,
    );
    expect(isNotification({ jsonrpc: "2.0", method: "x", id: 0 })).toBe(false);
  });
});

describe("JSON-RPC 2.0 — fabriques : forme EXACTE sur le fil", () => {
  it("chaque frame fabriquée est classée comme ce qu'elle prétend être", () => {
    expect(classifyJsonRpcFrame(jsonRpcRequest(1, "x"))).toBe("request");
    expect(classifyJsonRpcFrame(jsonRpcNotification("x", 1))).toBe(
      "notification",
    );
    expect(classifyJsonRpcFrame(jsonRpcSuccess("a", null))).toBe("response");
    expect(classifyJsonRpcFrame(jsonRpcFailure(2, -32601, "m"))).toBe(
      "response",
    );
  });

  it("`params` et `data` absents du fil quand ils ne sont pas donnés", () => {
    expect(JSON.stringify(jsonRpcRequest(1, "x"))).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"x"}',
    );
    expect(JSON.stringify(jsonRpcNotification("x"))).toBe(
      '{"jsonrpc":"2.0","method":"x"}',
    );
    expect(JSON.stringify(jsonRpcFailure(null, -32700, "m"))).toBe(
      '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"m"}}',
    );
    expect(JSON.stringify(jsonRpcFailure(1, -32000, "m", { s: 1 }))).toBe(
      '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"m","data":{"s":1}}}',
    );
    // §5 : `result` est REQUIRED sur un succès. `undefined` disparaîtrait du
    // fil et laisserait une frame qui n'est plus une réponse : il devient `null`.
    expect(JSON.stringify(jsonRpcSuccess(1, undefined))).toBe(
      '{"jsonrpc":"2.0","id":1,"result":null}',
    );
  });

  it("§5 : une frame émise ne porte JAMAIS `result` et `error` ensemble", () => {
    const success = jsonRpcSuccess(1, 0);
    const failure = jsonRpcFailure(1, -32603, "m");
    expect(Object.keys(success)).toEqual(["jsonrpc", "id", "result"]);
    expect(Object.keys(failure)).toEqual(["jsonrpc", "id", "error"]);
  });

  it("forme CONSTANTE : `params` est une clé même quand il vaut undefined", () => {
    // Une seule forme d'objet par fabrique : le moteur garde un accès
    // monomorphe sur le chemin chaud.
    expect(Object.keys(jsonRpcRequest(1, "x"))).toEqual([
      "jsonrpc",
      "id",
      "method",
      "params",
    ]);
    expect(Object.keys(jsonRpcNotification("x"))).toEqual([
      "jsonrpc",
      "method",
      "params",
    ]);
  });
});
