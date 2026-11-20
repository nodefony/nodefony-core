/**
 * Éprouve la règle « installation périmée » : le CONTENU du verrou contre ce que
 * npm a posé, jamais leurs dates.
 */
import { describe, expect, it } from "vitest";
import { installDrift } from "./install-drift.mjs";

const lock = {
  packages: {
    "": { name: "nodefony-core" },
    "node_modules/vite": { version: "8.3.8" },
    "node_modules/vite/node_modules/rolldown": { version: "1.2.19" },
    "node_modules/@rollup/rollup-linux-x64-gnu": {
      version: "4.0.0",
      optional: true,
    },
  },
};

describe("installDrift", () => {
  it("installation conforme au verrou : aucun écart, binaire d'une autre plateforme ignoré", () => {
    const installed = {
      packages: {
        "node_modules/vite": { version: "8.3.8" },
        "node_modules/vite/node_modules/rolldown": { version: "1.2.19" },
      },
    };
    expect(installDrift(lock, installed)).toEqual([]);
  });

  it("nomme une version différente, un paquet manquant et un paquet en trop", () => {
    const installed = {
      packages: {
        "node_modules/vite": { version: "8.3.7" },
        "node_modules/rolldown": { version: "1.3.3" },
      },
    };
    expect(installDrift(lock, installed)).toEqual([
      "node_modules/vite 8.3.7 → 8.3.8",
      "node_modules/vite/node_modules/rolldown absent",
      "node_modules/rolldown en trop",
    ]);
  });

  it("un paquet obligatoire absent est un écart, même sans version comparée", () => {
    expect(installDrift(lock, { packages: {} })).toEqual([
      "node_modules/vite absent",
      "node_modules/vite/node_modules/rolldown absent",
    ]);
  });
});
