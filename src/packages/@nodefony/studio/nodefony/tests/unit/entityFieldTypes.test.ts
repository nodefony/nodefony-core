/**
 * Unit — le panneau « Types de champ » de l'écran « Créer » : ce qu'il déduit.
 *
 * Le moteur affiché suit le connecteur CHOISI (un projet peut en porter deux), et
 * la liste des entités qu'une relation peut viser suit la règle du générateur :
 * un module ne vise une entité de l'application que sur MongoDB — le SQL refuse ce
 * lien. Afficher l'inverse ferait proposer un geste que le générateur refuse.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import {
  engineFor,
  referenceableEntities,
  type IScaffoldProjectContext,
  type IScaffoldTarget,
} from "../../../frontend/src/routes/create/createModel";

const context = (
  connectors: IScaffoldProjectContext["connectors"],
): IScaffoldProjectContext => ({
  connectors,
  columnTypes: [],
  entities: { "@demo/app": ["User", "Post"], "@demo/blog": ["Note"] },
});
const targets: IScaffoldTarget[] = [
  { kind: "app", name: "@demo/app", dir: "/a" },
  { kind: "module", name: "@demo/blog", dir: "/a/modules/blog" },
];

describe("Créer — panneau des types : moteur et relations", () => {
  it("le moteur est celui du connecteur CHOISI, sinon du premier", () => {
    const ctx = context([
      { name: "default", dialect: "sqlite" },
      { name: "nodefony", dialect: "mongodb" },
    ]);
    expect(engineFor(ctx, "nodefony")).to.equal("mongodb");
    expect(engineFor(ctx, "default")).to.equal("sqlite");
    expect(engineFor(ctx, "inconnu")).to.equal("sqlite");
    expect(engineFor(context([]), "default")).to.equal(null);
    expect(engineFor(null, "default")).to.equal(null);
  });

  it("depuis l'application : ses propres entités", () => {
    expect(
      referenceableEntities(context([]), targets, "", "sqlite"),
    ).to.deep.equal(["Post", "User"]);
  });

  it("depuis un module en SQL : SEULEMENT celles du module (le lien vers l'app est refusé)", () => {
    expect(
      referenceableEntities(context([]), targets, "@demo/blog", "postgres"),
    ).to.deep.equal(["Note"]);
  });

  it("depuis un module sur MongoDB : celles du module ET de l'application", () => {
    expect(
      referenceableEntities(context([]), targets, "@demo/blog", "mongodb"),
    ).to.deep.equal(["Note", "Post", "User"]);
  });
});
