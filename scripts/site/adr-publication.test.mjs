import { describe, expect, it } from "vitest";
import { adrPublicationDefects } from "./lib/adr-publication.mjs";

const relPath = "adr/0026-service-grpc.md";
const isPublished = () => true;
const guide =
  "Le comment : [le guide](../../src/packages/@nodefony/framework/docs/grpc.md).";
const GUIDE_DEFECT =
  "sans lien vers un guide PUBLIÉ hors de `adr/` (le « comment » du même sujet)";

describe("adrPublicationDefects — un ADR publié dit son statut et son guide", () => {
  it("un ADR complet passe", () => {
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "accepted" },
        body: guide,
        isPublished,
      }),
    ).toEqual([]);
  });

  it("refuse un ADR sans statut, ou au statut inconnu", () => {
    expect(
      adrPublicationDefects({ relPath, meta: {}, body: guide, isPublished }),
    ).toEqual(["sans statut (`status` au frontmatter)"]);
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "ok" },
        body: guide,
        isPublished,
      })[0],
    ).toMatch(/statut inconnu/);
  });

  it("refuse un ADR qui ne renvoie qu'à d'autres ADR", () => {
    const body =
      "Voir [ADR-0021](0021-temps-reel.md) et [scénarios](scenarios/grpc.md).";
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "accepted" },
        body,
        isPublished,
      }),
    ).toEqual([GUIDE_DEFECT]);
  });

  it("un ADR remplacé doit dire par lequel", () => {
    expect(
      adrPublicationDefects({
        relPath,
        meta: { status: "superseded" },
        body: guide,
        isPublished,
      }),
    ).toContain("remplacé sans dire par quel ADR");
  });

  it("ne juge que les ADR numérotés", () => {
    expect(
      adrPublicationDefects({
        relPath: "guides/x.md",
        meta: {},
        body: "",
        isPublished,
      }),
    ).toEqual([]);
    expect(
      adrPublicationDefects({
        relPath: "adr/README.md",
        meta: {},
        body: "",
        isPublished,
      }),
    ).toEqual([]);
  });

  it("exige isPublished plutôt que de supposer tout publié", () => {
    expect(() =>
      adrPublicationDefects({ relPath, meta: {}, body: guide }),
    ).toThrow(/isPublished/);
  });
});

describe("adrPublicationDefects — le guide est PUBLIÉ, hors code ; le remplaçant est un lien", () => {
  const run = (body, published) =>
    adrPublicationDefects({
      relPath,
      meta: { status: "accepted" },
      body,
      isPublished: published,
    });
  const target = "../../src/x/docs/g.md";

  it("interroge isPublished avec le chemin de dépôt (docs/ + relatif)", () => {
    const seen = [];
    run(guide, (p) => {
      seen.push(p);
      return true;
    });
    expect(seen).toEqual(["src/packages/@nodefony/framework/docs/grpc.md"]);
  });

  it("une page non publiée, CLAUDE.md ou MEMORY.md ne sont pas un guide", () => {
    expect(run(guide, () => false)).toEqual([GUIDE_DEFECT]);
    expect(run("[x](../../src/x/CLAUDE.md)", () => true)).toEqual([
      GUIDE_DEFECT,
    ]);
    expect(run("[x](../../src/x/MEMORY.md)", () => true)).toEqual([
      GUIDE_DEFECT,
    ]);
  });

  it("ignore un lien dans un bloc de code ou en code en ligne", () => {
    expect(run(`\`\`\`md\n[g](${target})\n\`\`\`\n`, () => true)).toEqual([
      GUIDE_DEFECT,
    ]);
    expect(run(`Écrire \`[g](${target})\` ainsi.`, () => true)).toEqual([
      GUIDE_DEFECT,
    ]);
    // Le texte qui SUIT le bloc compte de nouveau.
    expect(run(`\`\`\`\nx\n\`\`\`\n[g](${target})`, () => true)).toEqual([]);
  });

  it("accepte un lien titré et un lien par référence", () => {
    expect(run(`[g](${target} "le guide")`, () => true)).toEqual([]);
    const ref = `Voir [g][ref].\n\n[ref]: ${target}\n`;
    expect(run(ref, () => true)).toEqual([]);
    expect(run(ref, () => false)).toEqual([GUIDE_DEFECT]);
  });

  it("un ADR remplacé exige un LIEN vers un autre ADR", () => {
    const superseded = (extra) =>
      adrPublicationDefects({
        relPath,
        meta: { status: "superseded" },
        body: `${guide} ${extra}`,
        isPublished,
      });
    expect(superseded("Il n'est pas remplacé par un autre ADR.")).toContain(
      "remplacé sans dire par quel ADR",
    );
    expect(superseded("Remplacé par [ADR-0030](0030-autre.md).")).toEqual([]);
  });
});
