/// <reference types="node" />
import { expect } from "chai";
import { planAssetPublish } from "../../src/assets/collectAssets.js";

describe("planAssetPublish", () => {
  it("mappe chaque préfixe sur un sous-arbre miroir de outDir", () => {
    const plan = planAssetPublish(
      [
        { prefix: "/test/", dir: "/abs/test/public" },
        { prefix: "/_assets/studio/", dir: "/abs/studio/public/dist" },
      ],
      "/out",
    );
    expect(plan).to.deep.equal([
      { prefix: "/test/", dir: "/abs/test/public", target: "/out/test" },
      {
        prefix: "/_assets/studio/",
        dir: "/abs/studio/public/dist",
        target: "/out/_assets/studio",
      },
    ]);
  });

  it("déduplique par préfixe (le dernier gagne, comme addMount)", () => {
    const plan = planAssetPublish(
      [
        { prefix: "/test/", dir: "/old" },
        { prefix: "/test/", dir: "/new" },
      ],
      "/out",
    );
    expect(plan).to.have.lengthOf(1);
    expect(plan[0]!.dir).to.equal("/new");
    expect(plan[0]!.target).to.equal("/out/test");
  });

  it("préfixe racine `/` → cible = outDir lui-même", () => {
    const plan = planAssetPublish(
      [{ prefix: "/", dir: "/abs/public" }],
      "/out",
    );
    expect(plan[0]!.target).to.equal("/out");
  });

  it("préserve l'ordre d'insertion", () => {
    const plan = planAssetPublish(
      [
        { prefix: "/a/", dir: "/a" },
        { prefix: "/b/", dir: "/b" },
      ],
      "/out",
    );
    expect(plan.map((p) => p.prefix)).to.deep.equal(["/a/", "/b/"]);
  });
});
