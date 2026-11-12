// Les pairs des paquets publiés tiennent-ils leur promesse ? Branches pures
// d'abord, puis le constat RÉEL : chaque point d'entrée principal importé dans
// un processus neuf (cf `peers.mjs`).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkRepository,
  divergentPeerRanges,
  loadedOptionalPeers,
  optionalPeerNames,
  probeLoadedPackages,
} from "./peers.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

describe("peers — ce qu'une application paie pour un pair qu'elle n'utilise pas", () => {
  const manifest = {
    name: "@nodefony/http",
    peerDependencies: {
      "@connectrpc/connect": "^2.3.0",
      nodefony: "^10",
    },
    peerDependenciesMeta: {
      "@connectrpc/connect": { optional: true },
      nodefony: { optional: false },
    },
  };

  it("ne retient que les pairs marqués facultatifs", () => {
    expect(optionalPeerNames(manifest)).toEqual(["@connectrpc/connect"]);
    expect(optionalPeerNames({})).toEqual([]);
  });

  it("REFUSE un pair facultatif chargé, ignore les pairs requis et le reste", () => {
    expect(
      loadedOptionalPeers({
        manifest,
        loaded: ["nodefony", "ws", "@connectrpc/connect"],
      }),
    ).toEqual(["@connectrpc/connect"]);
    expect(loadedOptionalPeers({ manifest, loaded: ["nodefony"] })).toEqual([]);
  });

  it("REFUSE un même pair déclaré avec deux plages, accepte des plages égales", () => {
    expect(
      divergentPeerRanges([
        { name: "a", peerDependencies: { x: "^2.3.0", y: "^1" } },
        { name: "b", peerDependencies: { x: "^2.4.0", y: "^1" } },
        { name: "c", peerDependencies: { z: "^3" } },
      ]),
    ).toEqual([{ peer: "x", ranges: { a: "^2.3.0", b: "^2.4.0" } }]);
  });

  it("la sonde VOIT un paquet chargé — sans quoi un vert ne prouverait rien", async () => {
    // Témoin : le cœur charge `zod` à coup sûr. Une sonde aveugle rendrait une
    // liste vide, et tous les contrôles ci-dessous passeraient pour rien.
    const probe = await probeLoadedPackages("nodefony");
    expect("loaded" in probe && probe.loaded).toContain("zod");
  }, 60_000);

  it("aucun point d'entrée principal du dépôt ne charge un pair facultatif, et les plages concordent", async () => {
    // Pas de saut : sans `dist` bâti, la sonde échoue et le dit. La forge
    // bâtit avant `test:release`.
    const problems = await checkRepository(ROOT);
    expect(problems.map((p) => `${p.package} : ${p.problem}`)).toEqual([]);
  }, 120_000);
});
