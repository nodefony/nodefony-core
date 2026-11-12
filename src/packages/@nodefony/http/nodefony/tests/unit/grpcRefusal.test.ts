/// <reference types="node" />
//
// Refus d'un appel gRPC au format de son protocole — fonctions pures
// (ADR-0026 D5 point 2, D13 point 2 et sa précision du lot 3, #695).
//
import { describe, expect, it } from "vitest";
import {
  connectRefusalCode,
  GRPC_WIRE_CONNECT,
  GRPC_WIRE_CONNECT_STREAM,
  GRPC_WIRE_GRPC,
  GRPC_WIRE_NONE,
  GRPC_WIRE_WEB,
  grpcCodeName,
  grpcWireOf,
  prepareGrpcRefusal,
  transportRefusalCode,
  type GrpcWire,
  type IGrpcRefusalTarget,
} from "../../src/grpc/refusal";

describe("grpcWireOf — le protocole se lit aux en-têtes", () => {
  const cases: Array<[string, Record<string, string>, GrpcWire]> = [
    ["gRPC nu", { "content-type": "application/grpc" }, GRPC_WIRE_GRPC],
    [
      "gRPC +proto",
      { "content-type": "application/grpc+proto" },
      GRPC_WIRE_GRPC,
    ],
    ["gRPC +json", { "content-type": "application/grpc+json" }, GRPC_WIRE_GRPC],
    [
      "gRPC paramètre",
      { "content-type": "application/grpc; x=1" },
      GRPC_WIRE_GRPC,
    ],
    ["gRPC-Web", { "content-type": "application/grpc-web" }, GRPC_WIRE_WEB],
    [
      "gRPC-Web +proto",
      { "content-type": "application/grpc-web+proto" },
      GRPC_WIRE_WEB,
    ],
    [
      "gRPC-Web texte",
      { "content-type": "application/grpc-web-text" },
      GRPC_WIRE_WEB,
    ],
    [
      "Connect en flux",
      { "content-type": "application/connect+proto" },
      GRPC_WIRE_CONNECT_STREAM,
    ],
    [
      "Connect unaire",
      { "content-type": "application/proto", "connect-protocol-version": "1" },
      GRPC_WIRE_CONNECT,
    ],
    ["JSON ordinaire", { "content-type": "application/json" }, GRPC_WIRE_NONE],
    ["formulaire", { "content-type": "text/plain" }, GRPC_WIRE_NONE],
    ["sans type", {}, GRPC_WIRE_NONE],
    // Un sous-type qui COMMENCE par grpc sans en être un n'est pas du gRPC.
    ["grpcx", { "content-type": "application/grpcx" }, GRPC_WIRE_NONE],
    ["grpc-webx", { "content-type": "application/grpc-webx" }, GRPC_WIRE_NONE],
    [
      "grpc-other",
      { "content-type": "application/grpc-other" },
      GRPC_WIRE_NONE,
    ],
  ];
  for (const [label, headers, wire] of cases) {
    it(`${label} → ${wire}`, () => {
      expect(grpcWireOf(headers)).to.equal(wire);
    });
  }

  it("GET Connect (`connect=v1`, sans en-tête propre) → Connect unaire", () => {
    expect(grpcWireOf({}, true)).to.equal(GRPC_WIRE_CONNECT);
  });
});

describe("transportRefusalCode — table des refus de transport (D13 point 2)", () => {
  const table: Array<[number, boolean, number]> = [
    [400, false, 13],
    [401, false, 16],
    [403, false, 16],
    [401, true, 7],
    [403, true, 7],
    [404, false, 12],
    [405, false, 12],
    [421, false, 14],
    [429, false, 14],
    [502, false, 14],
    [503, false, 14],
    [504, false, 14],
    [500, false, 2],
    [413, false, 2],
  ];
  for (const [status, identified, code] of table) {
    it(`${status}${identified ? " identifié" : ""} → ${code} ${grpcCodeName(code)}`, () => {
      expect(transportRefusalCode(status, identified)).to.equal(code);
    });
  }
});

describe("connectRefusalCode — le code que le client Connect DÉDUIT du statut", () => {
  it("405 et 421 → unknown (le statut voyage, le code s'y accorde)", () => {
    expect(connectRefusalCode(405, false)).to.equal(2);
    expect(connectRefusalCode(421, false)).to.equal(2);
  });

  it("le reste suit la table gRPC : 404 → 12, 429 → 14, 400 → 13", () => {
    expect(connectRefusalCode(404, false)).to.equal(12);
    expect(connectRefusalCode(429, false)).to.equal(14);
    expect(connectRefusalCode(400, false)).to.equal(13);
  });

  it("401/403 : règle d'identité (D5)", () => {
    expect(connectRefusalCode(403, false)).to.equal(16);
    expect(connectRefusalCode(401, true)).to.equal(7);
  });
});

/** Réponse factice : statut et en-têtes posés. */
function target(): IGrpcRefusalTarget & {
  status: number;
  message: string | undefined;
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    status: 0,
    message: undefined,
    headers,
    setStatusCode(status, message) {
      this.status = status;
      this.message = message;
    },
    setHeader(name, value) {
      headers.set(name, value);
    },
  };
}

describe("prepareGrpcRefusal — la forme écrite par protocole", () => {
  it("gRPC : 200, statut dans les en-têtes (Trailers-Only), corps vide, type recopié", () => {
    const t = target();
    const body = prepareGrpcRefusal(
      t,
      GRPC_WIRE_GRPC,
      404,
      false,
      "application/grpc+proto",
    );
    expect(body).to.equal("");
    expect(t.status).to.equal(200);
    expect(t.headers.get("content-type")).to.equal("application/grpc+proto");
    expect(t.headers.get("grpc-status")).to.equal("12");
    expect(t.headers.get("grpc-message")).to.equal("unimplemented");
  });

  it("gRPC-Web : même forme, type gRPC-Web recopié", () => {
    const t = target();
    prepareGrpcRefusal(
      t,
      GRPC_WIRE_WEB,
      405,
      false,
      "application/grpc-web-text",
    );
    expect(t.status).to.equal(200);
    expect(t.headers.get("content-type")).to.equal("application/grpc-web-text");
    expect(t.headers.get("grpc-status")).to.equal("12");
  });

  it("le message ne porte JAMAIS le texte de l'erreur : seul le nom du code", () => {
    const t = target();
    prepareGrpcRefusal(t, GRPC_WIRE_GRPC, 403, true, "application/grpc");
    expect(t.headers.get("grpc-status")).to.equal("7");
    expect(t.headers.get("grpc-message")).to.equal("permission_denied");
  });

  it("Connect unaire : statut du refus, Error JSON à code TEXTE", () => {
    const t = target();
    const body = prepareGrpcRefusal(
      t,
      GRPC_WIRE_CONNECT,
      404,
      false,
      "application/proto",
    );
    expect(t.status).to.equal(404);
    expect(t.headers.get("content-type")).to.equal("application/json");
    expect(JSON.parse(String(body))).to.deep.equal({ code: "unimplemented" });
    expect(t.headers.has("grpc-status")).to.equal(false);
  });

  it("Connect unaire 405 : unknown, statut 405 gardé (conformité unexpected-verb)", () => {
    const t = target();
    const body = prepareGrpcRefusal(
      t,
      GRPC_WIRE_CONNECT,
      405,
      false,
      undefined,
    );
    expect(t.status).to.equal(405);
    expect(JSON.parse(String(body))).to.deep.equal({ code: "unknown" });
  });

  it("Connect unaire : un 403 sans identité part en 401 unauthenticated (D5)", () => {
    const t = target();
    const body = prepareGrpcRefusal(
      t,
      GRPC_WIRE_CONNECT,
      403,
      false,
      undefined,
    );
    expect(t.status).to.equal(401);
    expect(JSON.parse(String(body))).to.deep.equal({ code: "unauthenticated" });
  });

  it("Connect unaire : un 401 d'un appelant identifié part en 403 permission_denied", () => {
    const t = target();
    const body = prepareGrpcRefusal(t, GRPC_WIRE_CONNECT, 401, true, undefined);
    expect(t.status).to.equal(403);
    expect(JSON.parse(String(body))).to.deep.equal({
      code: "permission_denied",
    });
  });

  it("Connect en flux : 200 et un message de fin (drapeau 0x02, longueur, JSON)", () => {
    const t = target();
    const body = prepareGrpcRefusal(
      t,
      GRPC_WIRE_CONNECT_STREAM,
      404,
      false,
      "application/connect+proto",
    );
    expect(t.status).to.equal(200);
    expect(t.headers.get("content-type")).to.equal("application/connect+proto");
    expect(body).to.be.instanceOf(Uint8Array);
    const frame = body as Uint8Array;
    expect(frame[0]).to.equal(0x02);
    const length = new DataView(frame.buffer).getUint32(1);
    expect(length).to.equal(frame.byteLength - 5);
    const json = new TextDecoder().decode(frame.subarray(5));
    expect(JSON.parse(json)).to.deep.equal({
      error: { code: "unimplemented" },
    });
  });
});
