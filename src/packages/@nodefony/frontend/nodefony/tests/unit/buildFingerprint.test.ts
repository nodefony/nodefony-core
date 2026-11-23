/**
 * #872 — un bundle construit sur l'ancien framework ne doit plus être jugé
 * « à jour » après une montée des paquets. Le jugement de fraîcheur porte une
 * empreinte des versions INSTALLÉES (jamais des dates sous `node_modules`).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUILD_FINGERPRINT_FILE,
  collectBuildFingerprint,
  describeFingerprintChange,
  judgeBuildFreshness,
  readBuildFingerprint,
  writeBuildFingerprint,
} from "../../src/buildFingerprint";

let app: string;
let root: string;
let outDir: string;

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function install(name: string, version: string): void {
  writeJson(
    path.join(app, "node_modules", ...name.split("/"), "package.json"),
    {
      name,
      version,
    },
  );
}

/** Une entrée construite il y a une heure, sources plus anciennes encore. */
async function builtEntry(): Promise<void> {
  const hourAgo = new Date(Date.now() - 3_600_000);
  const twoHoursAgo = new Date(Date.now() - 7_200_000);
  const source = path.join(root, "src", "main.ts");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "console.log(1);\n");
  fs.utimesSync(source, twoHoursAgo, twoHoursAgo);
  const manifest = path.join(outDir, ".vite", "manifest.json");
  writeJson(manifest, {});
  fs.utimesSync(manifest, hourAgo, hourAgo);
  await writeBuildFingerprint(outDir, await collectBuildFingerprint(root));
}

beforeEach(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), "nf-fingerprint-"));
  root = path.join(app, "frontend");
  outDir = path.join(app, "public", "dist");
  writeJson(path.join(app, "package.json"), {
    name: "app",
    dependencies: { nodefony: "^10.0.2", "@nodefony/frontend": "^10.0.2" },
    devDependencies: { vite: "^7.0.0", "@vitejs/plugin-react": "^5.0.0" },
  });
  install("nodefony", "10.0.2");
  install("@nodefony/frontend", "10.0.2");
  install("vite", "7.0.0");
  install("@vitejs/plugin-react", "5.0.0");
});

afterEach(() => {
  fs.rmSync(app, { recursive: true, force: true });
});

describe("empreinte des versions d'un build front (#872)", () => {
  it("relève les versions installées de ce que l'application déclare, plus le cœur et vite", async () => {
    expect(await collectBuildFingerprint(root)).toEqual({
      "@nodefony/frontend": "10.0.2",
      "@vitejs/plugin-react": "5.0.0",
      nodefony: "10.0.2",
      vite: "7.0.0",
    });
  });

  it("une entrée construite sur l'état actuel est à jour, et le dit", async () => {
    await builtEntry();
    const verdict = await judgeBuildFreshness(root, outDir);
    expect(verdict.fresh).toBe(true);
    expect(verdict.reason).toBe(
      "sources et versions inchangées (framework 10.0.2)",
    );
  });

  it("monter le framework SANS toucher aux sources rend l'entrée périmée", async () => {
    await builtEntry();
    install("nodefony", "10.0.3");
    install("@nodefony/frontend", "10.0.3");
    const verdict = await judgeBuildFreshness(root, outDir);
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toBe("framework passé de 10.0.2 à 10.0.3");
    expect(verdict.fingerprint["@nodefony/frontend"]).toBe("10.0.3");
  });

  it("monter vite ou un plugin rend aussi l'entrée périmée", async () => {
    await builtEntry();
    install("@vitejs/plugin-react", "5.1.0");
    const verdict = await judgeBuildFreshness(root, outDir);
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toBe("@vitejs/plugin-react passé de 5.0.0 à 5.1.0");
  });

  it("un bundle construit avant l'empreinte est reconstruit une fois", async () => {
    await builtEntry();
    fs.rmSync(path.join(outDir, ".vite", BUILD_FINGERPRINT_FILE));
    const verdict = await judgeBuildFreshness(root, outDir);
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toMatch(/aucune empreinte des versions/);
  });

  it("une source modifiée après le build rend l'entrée périmée", async () => {
    await builtEntry();
    fs.writeFileSync(path.join(root, "src", "main.ts"), "console.log(2);\n");
    const verdict = await judgeBuildFreshness(root, outDir);
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toBe("sources modifiées depuis le dernier build");
  });

  it("une entrée sans manifeste n'a jamais été construite", async () => {
    const verdict = await judgeBuildFreshness(root, outDir);
    expect(verdict).toMatchObject({ fresh: false, reason: "jamais construit" });
  });

  it("une empreinte abîmée vaut une empreinte absente", async () => {
    await builtEntry();
    fs.writeFileSync(path.join(outDir, ".vite", BUILD_FINGERPRINT_FILE), "[]");
    expect(await readBuildFingerprint(outDir)).toBeNull();
  });
});

describe("motif d'un changement d'empreinte", () => {
  const base = {
    nodefony: "10.0.2",
    "@nodefony/frontend": "10.0.2",
    vite: "7.0.0",
  };

  it("rien n'a changé → null", () => {
    expect(describeFingerprintChange(base, { ...base })).toBeNull();
  });

  it("les paquets Nodefony se disent en une phrase, les autres un par un", () => {
    expect(
      describeFingerprintChange(base, {
        nodefony: "10.0.3",
        "@nodefony/frontend": "10.0.3",
        vite: "7.1.0",
        react: "19.2.0",
      }),
    ).toBe(
      "framework passé de 10.0.2 à 10.0.3, react ajouté (19.2.0), vite passé de 7.0.0 à 7.1.0",
    );
  });

  it("au-delà de trois changements, le reste se compte", () => {
    expect(
      describeFingerprintChange(
        { a: "1", b: "1", c: "1", d: "1", e: "1" },
        { a: "2", b: "2", c: "2", d: "2" },
      ),
    ).toBe("a passé de 1 à 2, b passé de 1 à 2, c passé de 1 à 2 et 2 autres");
  });
});
