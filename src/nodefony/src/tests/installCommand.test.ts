/**
 * `createAppCommand` / `npmChannelOf` / `NODE_ENGINE_RANGE` : ce qu'une page
 * affiche pour installer Nodefony (#784). La commande nomme son canal tant que
 * le framework est en préversion — sans lui, `latest` sert l'ancien Nodefony 7.
 */
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import {
  createAppCommand,
  describeNodeRange,
  NODE_ENGINE_LABEL,
  NODE_ENGINE_RANGE,
  npmChannelOf,
  packageSpec,
} from "../cli/installCommand";
import * as barrel from "../index";

describe("npmChannelOf", () => {
  it("rend l'identifiant de la préversion, `latest` pour une stable", () => {
    expect(npmChannelOf("10.0.0-beta.8")).toBe("beta");
    expect(npmChannelOf("10.0.0-alpha.12")).toBe("alpha");
    expect(npmChannelOf("10.0.0-rc")).toBe("rc");
    expect(npmChannelOf("10.0.0-beta.8+sha.1")).toBe("beta");
    expect(npmChannelOf("10.0.0")).toBe("latest");
  });

  it("rend null pour une version invalide", () => {
    expect(npmChannelOf("10.0")).toBeNull();
    expect(npmChannelOf("v10.0.0")).toBeNull();
  });
});

describe("createAppCommand", () => {
  it("🔴 nomme le canal d'une préversion — la forme nue installerait la 7", () => {
    expect(createAppCommand("mon-app", "10.0.0-beta.8")).toBe(
      "npm create nodefony@beta mon-app",
    );
    expect(createAppCommand("", "10.0.0-rc.1")).toBe("npm create nodefony@rc");
  });

  it("écrit une stable sans canal : `latest` est alors sa ligne", () => {
    expect(createAppCommand("mon-app", "10.0.0")).toBe(
      "npm create nodefony mon-app",
    );
  });

  it("prend par défaut la version du paquet qui tourne", () => {
    expect(createAppCommand("x")).toBe(createAppCommand("x", pkg.version));
  });
});

describe("NODE_ENGINE_RANGE", () => {
  it("est la plage d'`engines` du manifeste, jamais une recopie", () => {
    expect(NODE_ENGINE_RANGE).toBe(pkg.engines.node);
  });
});

describe("describeNodeRange / NODE_ENGINE_LABEL", () => {
  it("rend chaque plancher en clair, joints par « ou »", () => {
    expect(describeNodeRange("^24.16.0 || >=26.0.0")).toBe("24.16+ ou 26+");
    expect(describeNodeRange(">=22.0.0")).toBe("22+");
    expect(describeNodeRange("^24.16.3")).toBe("24.16.3+");
  });

  it("rend telle quelle une forme qu'elle ne reconnaît pas — exacte plutôt que fausse", () => {
    expect(describeNodeRange(">=24 <27")).toBe(">=24 <27");
    expect(describeNodeRange("^24.16.0 || 26.x")).toBe("^24.16.0 || 26.x");
  });

  it("le libellé publié est celui de la plage d'`engines`", () => {
    expect(NODE_ENGINE_LABEL).toBe(describeNodeRange(pkg.engines.node));
  });
});

describe("index public", () => {
  it("expose la règle entière — le cadre (écran de connexion) les importe de `nodefony`", () => {
    expect(barrel.createAppCommand).toBe(createAppCommand);
    expect(barrel.npmChannelOf).toBe(npmChannelOf);
    expect(barrel.NODE_ENGINE_RANGE).toBe(NODE_ENGINE_RANGE);
    expect(barrel.NODE_ENGINE_LABEL).toBe(NODE_ENGINE_LABEL);
    expect(barrel.describeNodeRange).toBe(describeNodeRange);
  });
});

describe("packageSpec", () => {
  it("nomme le canal d'une préversion, pour tout paquet du framework", () => {
    expect(packageSpec("@nodefony/http", "10.1.0-beta.2")).toBe(
      "@nodefony/http@beta",
    );
    expect(packageSpec("nodefony", "10.0.0-rc.1")).toBe("nodefony@rc");
  });

  it("écrit une stable sans canal — `latest` EST sa ligne", () => {
    expect(packageSpec("@nodefony/http", "10.0.0")).toBe("@nodefony/http");
  });

  it("est la règle de createAppCommand — une seule implémentation", () => {
    for (const v of ["10.0.0", "10.0.0-beta.9", "10.2.0-alpha.1"])
      expect(createAppCommand("x", v)).toBe(
        `npm create ${packageSpec("nodefony", v)} x`,
      );
  });
});
