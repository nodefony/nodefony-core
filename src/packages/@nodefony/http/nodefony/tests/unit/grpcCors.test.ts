/// <reference types="node" />
//
// ─── Listes CORS des protocoles RPC (#695, ADR-0026 D9) ──────────────────────
//
// `@nodefony/http` principal ne charge jamais Connect (pair facultatif, D12) :
// ses listes CORS y sont RECOPIÉES. Ce test les compare à l'original — une
// version de Connect qui change ses listes le fait tomber.
//
import { expect } from "vitest";
import { cors } from "@connectrpc/connect";
import {
  RPC_EXPOSED_HEADERS,
  grpcCorsCopy,
  rpcCorsLists,
} from "../../src/grpc/cors";
import { markGrpcRoute } from "../../src/grpc/refusal";

describe("Listes CORS RPC — copie de celles de Connect", () => {
  it("identiques à `cors` de @connectrpc/connect, élément par élément", () => {
    const copy = grpcCorsCopy();
    expect([...copy.allowedMethods]).to.deep.equal(cors.allowedMethods);
    expect([...copy.allowedHeaders]).to.deep.equal(cors.allowedHeaders);
    expect([...copy.exposedHeaders]).to.deep.equal(cors.exposedHeaders);
  });

  it("l'en-tête exposé est la liste de Connect, composée une fois", () => {
    expect(RPC_EXPOSED_HEADERS).to.equal(cors.exposedHeaders.join(", "));
  });

  // L'ordre compte : la déclaration d'une route gRPC est un état du processus.
  it("aucune liste tant qu'aucun service gRPC n'est déclaré ; les listes ensuite", () => {
    expect(rpcCorsLists()).to.equal(null);
    markGrpcRoute({});
    expect(rpcCorsLists()).to.equal(grpcCorsCopy());
  });
});
