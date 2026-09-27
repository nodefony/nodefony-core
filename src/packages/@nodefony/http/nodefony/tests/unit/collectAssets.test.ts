/// <reference types="node" />
import { expect } from "chai";
import { join } from "node:path";
import { planAssetPublish } from "../../src/assets/collectAssets.js";

/**
 * `target` est un chemin de SYSTÈME DE FICHIERS : il n'alimente que `fs.mkdir`/`fs.cp`
 * (`assetsPublishCommand`) et n'entre jamais dans le `manifest.json`. Il porte donc le
 * séparateur natif — `\` sous Windows — et c'est correct. L'attendu se compose ici avec
 * `join()` pour affirmer la RELATION (« segment d'URL → sous-arbre de outDir ») sans rien
 * relâcher : le segment logique reste écrit en dur, seul le séparateur suit la plateforme.
 */
const OUT = "/out";

describe("planAssetPublish", () => {
  it("mappe chaque préfixe sur un sous-arbre miroir de outDir", () => {
    const plan = planAssetPublish(
      [
        { prefix: "/test/", dir: "/abs/test/public" },
        { prefix: "/_assets/studio/", dir: "/abs/studio/public/dist" },
      ],
      OUT,
    );
    expect(plan).to.deep.equal([
      { prefix: "/test/", dir: "/abs/test/public", target: join(OUT, "test") },
      {
        prefix: "/_assets/studio/",
        dir: "/abs/studio/public/dist",
        target: join(OUT, "_assets/studio"),
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
    expect(plan[0]!.target).to.equal(join(OUT, "test"));
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
