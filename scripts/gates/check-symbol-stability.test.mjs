/**
 * Le gate des symboles expérimentaux d'un paquet stable (ADR-0026 D11),
 * éprouvé sur ses fonctions pures : lecture du tableau, comparaison dans les
 * deux sens, page qui documente un symbole.
 */
import { describe, expect, it } from "vitest";
import {
  compareSymbolSets,
  pageDocumentsSymbol,
  readSymbolTable,
  TABLE_HEADING,
} from "./check-symbol-stability.mjs";

const policy = [
  "## Surfaces expérimentales",
  "",
  "| Paquet | Pourquoi |",
  "| --- | --- |",
  "| `@nodefony/ai` | MCP |",
  "",
  TABLE_HEADING,
  "",
  "| Symbole | Paquet | Pourquoi |",
  "| --- | --- | --- |",
  "| `GrpcController` | `@nodefony/framework` | gRPC |",
  "| `IRequestTrace.rpc` | `@nodefony/http` | gRPC |",
  "",
  "## Les versions vont par quinze",
  "",
  "| `ne-pas-lire` | `@nodefony/x` | hors section |",
].join("\n");

describe("readSymbolTable", () => {
  it("lit symbole et paquet de sa seule section, jusqu'au titre suivant", () => {
    expect(readSymbolTable(policy)).toEqual([
      "@nodefony/framework GrpcController",
      "@nodefony/http IRequestTrace.rpc",
    ]);
  });

  it("section absente : null, pas une liste vide qui passerait pour « rien d'étiqueté »", () => {
    expect(readSymbolTable("## Surfaces expérimentales\n")).toBe(null);
  });
});

describe("compareSymbolSets", () => {
  it("refuse l'écart dans les deux sens", () => {
    expect(
      compareSymbolSets(
        ["nodefony buildReportDevtools", "@nodefony/http IRpcCall"],
        ["@nodefony/http IRpcCall", "@nodefony/http Retire"],
      ),
    ).toEqual({
      missing: ["nodefony buildReportDevtools"],
      stale: ["@nodefony/http Retire"],
    });
  });
});

describe("pageDocumentsSymbol", () => {
  it("nommé entre accents graves ou par une ancre de code", () => {
    expect(
      pageDocumentsSymbol("La classe `GrpcController`.", ["GrpcController"]),
    ).toBe(true);
    expect(
      pageDocumentsSymbol("Voir GrpcController.ts#GrpcController.", [
        "GrpcController",
      ]),
    ).toBe(true);
    expect(
      pageDocumentsSymbol("GrpcController sans marque.", ["GrpcController"]),
    ).toBe(false);
    expect(pageDocumentsSymbol("`GrpcController`", [])).toBe(false);
  });
});
