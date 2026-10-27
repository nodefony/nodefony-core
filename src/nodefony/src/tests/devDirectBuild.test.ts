/*
 *   Rebuild DIRECT du superviseur de développement, dans le dépôt du framework.
 *
 *   Pour une sauvegarde, turbo coûtait 3,4 à 3,7 s : son lanceur et le calcul
 *   des empreintes de la clôture `^build`, quand les deux étapes du script —
 *   rolldown (0,3 s) puis tsgo (1,3 s), lancés par leur fichier, sans
 *   `npm exec` — n'en coûtent que 1,6. Un paquet au script `build` EXACTEMENT
 *   standard rejoue donc ce script étape par étape : même sortie, même verdict
 *   (une erreur de types garde l'ancien serveur). Ces tests tiennent les règles
 *   pures qui décident de ce chemin.
 */

import assert from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import {
  DIRECT_BINS,
  directBuildPlan,
  PACKAGE_DECLARATIONS_ARGS,
  PACKAGE_DEV_BUILD_ARGS,
  readWorkspaceInfo,
  resolveLocalBin,
} from "../service/dev/DevSupervisor";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
// Chemin RÉEL : Node résout les liens (macOS : `/var` → `/private/var`).
const scratch = realpathSync(
  mkdtempSync(path.join(tmpdir(), "nf-direct-build-")),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function workspace(rel: string) {
  const dir = path.join(repoRoot, rel);
  const info = readWorkspaceInfo(path.join(dir, "package.json"), dir);
  assert.ok(info, `workspace lisible : ${rel}`);
  return info;
}

describe("directBuildPlan — qui se rebâtit sans turbo", () => {
  it("le gabarit standard avec déclarations : rolldown puis tsgo, sans turbo", () => {
    assert.deepStrictEqual(
      directBuildPlan(
        "rolldown -c rolldown.config.ts && tsgo -p tsconfig.declarations.json",
      ),
      { declarations: true },
    );
  });

  it("le gabarit standard sans déclarations : rolldown seul", () => {
    assert.deepStrictEqual(directBuildPlan("rolldown -c rolldown.config.ts"), {
      declarations: false,
    });
  });

  it("tout autre script garde turbo — on ne devine pas ce qu'un build fait de plus", () => {
    for (const script of [
      undefined,
      "",
      "rolldown -c rolldown.config.ts && tsgo -p tsconfig.declarations.json && npm run build:ui",
      "rolldown -c rolldown.config.ts && npm run build:types",
      "rolldown -c rolldown.config.ts --sourcemap",
      "tsc",
    ]) {
      assert.strictEqual(directBuildPlan(script), null, String(script));
    }
  });

  it("classe les vrais workspaces du dépôt", () => {
    assert.deepStrictEqual(
      directBuildPlan(workspace("src/modules/test").buildScript),
      { declarations: true },
    );
    assert.deepStrictEqual(
      directBuildPlan(workspace("src/packages/@nodefony/http").buildScript),
      { declarations: true },
    );
    // Étape d'interface en plus : turbo.
    assert.strictEqual(
      directBuildPlan(workspace("src/packages/@nodefony/studio").buildScript),
      null,
    );
    // Le cœur produit ses types par un script npm : turbo.
    assert.strictEqual(
      directBuildPlan(workspace("src/nodefony").buildScript),
      null,
    );
  });

  it("les arguments directs sont EXACTEMENT ceux du script (même sortie que turbo)", () => {
    const script = workspace("src/modules/test").buildScript ?? "";
    const [build, declarations] = script.split(" && ");
    assert.strictEqual(
      build,
      ["rolldown", ...PACKAGE_DEV_BUILD_ARGS].join(" "),
    );
    assert.strictEqual(
      declarations,
      ["tsgo", ...PACKAGE_DECLARATIONS_ARGS].join(" "),
    );
  });
});

describe("readWorkspaceInfo — nom et script build d'un workspace", () => {
  it("lit le nom et le script build", () => {
    const dir = path.join(scratch, "ws-ok");
    mkdirSync(dir, { recursive: true });
    const pj = path.join(dir, "package.json");
    writeFileSync(
      pj,
      JSON.stringify({
        name: "@x/ok",
        scripts: { build: "rolldown -c rolldown.config.ts" },
      }),
    );
    assert.deepStrictEqual(readWorkspaceInfo(pj, dir), {
      name: "@x/ok",
      dir,
      buildScript: "rolldown -c rolldown.config.ts",
    });
  });

  it("sans script build : buildScript absent (turbo)", () => {
    const dir = path.join(scratch, "ws-nobuild");
    mkdirSync(dir, { recursive: true });
    const pj = path.join(dir, "package.json");
    writeFileSync(pj, JSON.stringify({ name: "@x/nobuild", scripts: {} }));
    assert.strictEqual(readWorkspaceInfo(pj, dir)?.buildScript, undefined);
  });

  it("sans nom, illisible ou absent : null (traité comme l'application)", () => {
    const dir = path.join(scratch, "ws-bad");
    mkdirSync(dir, { recursive: true });
    const noName = path.join(dir, "package.json");
    writeFileSync(noName, JSON.stringify({ scripts: { build: "x" } }));
    assert.strictEqual(readWorkspaceInfo(noName, dir), null);
    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, "{ pas du json");
    assert.strictEqual(readWorkspaceInfo(broken, dir), null);
    assert.strictEqual(
      readWorkspaceInfo(path.join(dir, "absent.json"), dir),
      null,
    );
  });
});

describe("resolveLocalBin — le fichier qu'exécute un binaire du projet", () => {
  it("résout rolldown depuis un workspace du dépôt, vers un fichier qui existe", () => {
    const cli = resolveLocalBin(
      path.join(repoRoot, "src/modules/test"),
      "rolldown",
    );
    assert.ok(cli, "rolldown résolu");
    assert.strictEqual(path.basename(cli), "cli.mjs");
    assert.ok(cli.includes(path.join("node_modules", "rolldown")), cli);
  });

  it("chaque binaire lancé en direct se résout dans le dépôt (sinon : lanceur)", () => {
    const from = path.join(repoRoot, "src/modules/test");
    for (const [bin, pkg] of Object.entries(DIRECT_BINS)) {
      const cli = resolveLocalBin(from, pkg, bin);
      assert.ok(cli, `${bin} (${pkg}) résolu`);
    }
  });

  it("lit un champ bin en chaîne et en table", () => {
    const root = path.join(scratch, "bins");
    const asString = path.join(root, "node_modules", "outil-chaine");
    const asTable = path.join(root, "node_modules", "outil-table");
    mkdirSync(path.join(asString, "bin"), { recursive: true });
    mkdirSync(path.join(asTable, "bin"), { recursive: true });
    writeFileSync(
      path.join(asString, "package.json"),
      JSON.stringify({ name: "outil-chaine", bin: "./bin/run.mjs" }),
    );
    writeFileSync(path.join(asString, "bin", "run.mjs"), "");
    writeFileSync(
      path.join(asTable, "package.json"),
      JSON.stringify({
        name: "outil-table",
        bin: { autre: "./x.mjs", "outil-table": "./bin/cli.mjs" },
      }),
    );
    writeFileSync(path.join(asTable, "bin", "cli.mjs"), "");
    assert.strictEqual(
      resolveLocalBin(root, "outil-chaine"),
      path.join(asString, "bin", "run.mjs"),
    );
    assert.strictEqual(
      resolveLocalBin(root, "outil-table"),
      path.join(asTable, "bin", "cli.mjs"),
    );
  });

  it("introuvable → null : le superviseur repasse par le lanceur du gestionnaire", () => {
    const root = path.join(scratch, "vide");
    mkdirSync(root, { recursive: true });
    assert.strictEqual(
      resolveLocalBin(root, "paquet-qui-nexiste-pas-nf"),
      null,
    );
    // Binaire déclaré mais fichier absent.
    const pkg = path.join(scratch, "fantome", "node_modules", "fantome");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "fantome", bin: "./bin/absent.mjs" }),
    );
    assert.strictEqual(
      resolveLocalBin(path.join(scratch, "fantome"), "fantome"),
      null,
    );
  });
});
