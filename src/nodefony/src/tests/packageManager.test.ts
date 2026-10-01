import { assert } from "vitest";
import path from "node:path";
import {
  LOCKFILES,
  packageManagerFromUserAgent,
  resolvePackageManager,
} from "../cli/packageManager";

// Chaînes RÉELLES relevées dans un script lancé par chaque gestionnaire
// (npm 12.1.0, pnpm 12.6.0, yarn 1.22.22, bun 1.4.2).
const AGENTS = {
  npm: "npm/12.1.0 node/v26.10.0 darwin x64 workspaces/false",
  pnpm: "pnpm/12.6.0 npm/? node/? darwin x64",
  yarn: "yarn/1.22.22 npm/? node/v26.10.0 darwin x64",
  bun: "bun/1.4.2 npm/? node/v26.10.0 darwin x64",
} as const;

/** Un disque qui ne porte que les fichiers donnés, sous `/app`. */
const disk =
  (...files: string[]) =>
  (file: string): boolean =>
    files.some((f) => path.join("/app", f) === file);

describe("resolvePackageManager — une seule décision, quatre sources", () => {
  describe("packageManagerFromUserAgent", () => {
    for (const [name, agent] of Object.entries(AGENTS)) {
      it(`${name} se lit en tête de « ${agent} »`, () => {
        assert.equal(packageManagerFromUserAgent(agent), name);
      });
    }

    it("absent, vide ou inconnu → null (jamais une supposition)", () => {
      assert.isNull(packageManagerFromUserAgent(undefined));
      assert.isNull(packageManagerFromUserAgent(""));
      assert.isNull(packageManagerFromUserAgent("deno/2.0.0 npm/?"));
    });
  });

  it("la configuration gagne sur tout le reste", () => {
    assert.deepEqual(
      resolvePackageManager({
        configured: "yarn",
        dir: "/app",
        userAgent: AGENTS.pnpm,
        exists: disk("package-lock.json"),
      }),
      { name: "yarn", source: "config" },
    );
  });

  for (const [file, name] of LOCKFILES) {
    it(`sans configuration, le verrou ${file} désigne ${name}`, () => {
      assert.deepEqual(
        resolvePackageManager({
          dir: "/app",
          userAgent: AGENTS.npm,
          exists: disk(file),
        }),
        { name, source: "lockfile", lockfile: file },
      );
    });
  }

  it("le verrou gagne sur l'agent : `npm run` dans un projet pnpm reste pnpm", () => {
    assert.equal(
      resolvePackageManager({
        dir: "/app",
        userAgent: AGENTS.npm,
        exists: disk("pnpm-lock.yaml"),
      }).name,
      "pnpm",
    );
  });

  it("deux verrous → choix STABLE, le premier de LOCKFILES", () => {
    assert.equal(
      resolvePackageManager({
        dir: "/app",
        userAgent: undefined,
        exists: disk("package-lock.json", "pnpm-lock.yaml"),
      }).name,
      "pnpm",
    );
  });

  it("hors projet (create app), l'agent décide : `pnpm create nodefony` → pnpm", () => {
    assert.deepEqual(resolvePackageManager({ userAgent: AGENTS.pnpm }), {
      name: "pnpm",
      source: "user-agent",
    });
  });

  it("aucune source → npm, et la source le DIT", () => {
    assert.deepEqual(
      resolvePackageManager({
        dir: "/app",
        userAgent: undefined,
        exists: disk(),
      }),
      { name: "npm", source: "default" },
    );
  });
});
