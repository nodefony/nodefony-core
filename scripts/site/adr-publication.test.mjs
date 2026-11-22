import { describe, expect, it } from "vitest";
import { adrPublicationDefects } from "./lib/adr-publication.mjs";

const relPath = "adr/0026-service-grpc.md";
const guide =
  "Le comment : [le guide](../../src/packages/@nodefony/framework/docs/grpc.md).";

describe("adrPublicationDefects — un ADR publié dit son statut et son guide", () => {
  it("un ADR complet passe", () => {
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "accepted" },
        body: guide,
      }),
    ).toEqual([]);
  });

  it("refuse un ADR sans statut, ou au statut inconnu", () => {
    expect(adrPublicationDefects({ relPath, meta: {}, body: guide })).toEqual([
      "sans statut (`status` au frontmatter)",
    ]);
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "ok" },
        body: guide,
      })[0],
    ).toMatch(/statut inconnu/);
  });

  it("refuse un ADR qui ne renvoie qu'à d'autres ADR", () => {
    const body =
      "Voir [ADR-0021](0021-temps-reel.md) et [scénarios](scenarios/grpc.md).";
    expect(
      adrPublicationDefects({ relPath, meta: { status: "accepted" }, body }),
    ).toEqual([
      "sans lien vers un guide hors de `adr/` (le « comment » du même sujet)",
    ]);
  });

  it("un ADR remplacé doit dire par lequel", () => {
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "superseded" },
        body: guide,
      }),
    ).toContain("remplacé sans dire par quel ADR");
  });

  it("ne juge que les ADR numérotés", () => {
    expect(
      adrPublicationDefects({ relPath: "guides/x.md", meta: {}, body: "" }),
    ).toEqual([]);
    expect(
      adrPublicationDefects({ relPath: "adr/README.md", meta: {}, body: "" }),
    ).toEqual([]);
  });
});
