import { afterAll, afterEach, assert, describe, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEnvCommand, syncEnvExample } from "../cli/env";
import { SysExit } from "../cli/sysexits";

/**
 * #808 — la séquence de la vitrine : une application dont un module LOCAL
 * déclare une variable, clonée sans build. Le schéma du module se lit dans son
 * `dist` ; absent, le contrôle concluait « désynchronisé » et son remède
 * (`env --example`) RETIRAIT la variable du `.env.example`.
 *
 * Ce qui est éprouvé : le module est NOMMÉ avec sa raison, rien n'est jugé ni
 * écrit, et `verify` lance le contrôle APRÈS `build`.
 */
describe("nodefony env --example — module déclaré non construit (#808)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nf-env-unbuilt-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  writeFileSync(
    path.join(root, "nodefony.config.ts"),
    `export default defineConfig({ modules: [{ name: "./modules/demo" }] });\n`,
  );
  writeFileSync(path.join(root, "package.json"), `{ "name": "vitrine" }\n`);
  // Le catalogue de l'app, tel que le build l'expose (symbole partagé).
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(
    path.join(root, "dist", "index.js"),
    `export const env = { [Symbol.for("nodefony.envCatalog")]: [
      { name: "NF_APP_GREETING", kind: "string", optional: true, title: "salut" },
    ] };\n`,
  );
  const demo = path.join(root, "modules", "demo");
  mkdirSync(demo, { recursive: true });
  writeFileSync(
    path.join(demo, "package.json"),
    JSON.stringify({
      name: "@app/demo",
      nodefony: { configSchema: "./dist/configSchema.js" },
    }),
  );
  const example = path.join(root, ".env.example");
  const committed = "# notice commitée, construite avec le module\n";
  writeFileSync(example, committed);

  /** Lance la commande et capture ce qu'elle écrit sur la sortie d'erreur. */
  async function run(...args: string[]): Promise<[number, string]> {
    let err = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runEnvCommand([
      "env",
      "--example",
      ...args,
      "--cwd",
      root,
    ]);
    vi.restoreAllMocks();
    return [code, err];
  }

  it("le constat est « incomplete », le module nommé avec sa raison", async () => {
    const sync = await syncEnvExample(root, true);
    assert.equal(sync.status, "incomplete");
    assert.deepEqual(
      sync.unreadable.map((u) => u.module),
      ["./modules/demo"],
    );
    assert.match(sync.unreadable[0]!.reason, /non construit/u);
  });

  it("--check nomme le module et sa raison, sort en 69 — jamais « désynchronisé »", async () => {
    const [code, err] = await run("--check");
    assert.equal(code, SysExit.UNAVAILABLE);
    assert.include(err, "./modules/demo");
    assert.match(err, /non construit/u);
    assert.notMatch(err, /désynchronisé/u);
    assert.notInclude(err, "npx nodefony env --example\n");
  });

  it("sans --check, REFUSE d'écrire un .env.example amputé", async () => {
    const [code, err] = await run();
    assert.equal(code, SysExit.UNAVAILABLE);
    assert.include(err, "non écrit");
    assert.equal(readFileSync(example, "utf8"), committed);
  });

  it("module construit : la notice s'écrit et porte la variable du module", async () => {
    mkdirSync(path.join(demo, "dist"), { recursive: true });
    writeFileSync(
      path.join(demo, "dist", "configSchema.js"),
      `export function configJsonSchema() {
        return { type: "object", properties: { quota: { type: "integer", env: "NF_DEMO_QUOTA" } } };
      }\n`,
    );
    const [code] = await run();
    assert.equal(code, SysExit.OK);
    const written = readFileSync(example, "utf8");
    assert.include(written, "NF_APP_GREETING");
    assert.include(written, "NF_DEMO_QUOTA");
    assert.deepEqual((await run("--check"))[0], SysExit.OK);
  });
});

describe("gabarit d'application — ordre de verify (#808)", () => {
  const templates = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "templates",
    "app",
  );
  const pkg = readFileSync(
    path.join(templates, "base", "package.json.tpl"),
    "utf8",
  );
  const verify = /"verify": "([^"]+)"/u.exec(pkg)?.[1] ?? "";
  const steps = [...verify.matchAll(/%> ([\w:]+)/gu)].map((m) => m[1]!);

  it("env:check passe APRÈS build — le schéma d'un module local vit dans son dist", () => {
    assert.isAbove(steps.indexOf("build"), -1);
    assert.isAbove(steps.indexOf("env:check"), steps.indexOf("build"));
  });

  // L'ordre est RECOPIÉ en prose (AGENTS.md, CI, menu) : chaque copie suit le script.
  const prose = steps.join(", ");
  for (const rel of [
    ["agent-instructions", "AGENTS.md.tpl"],
    ["base", "gitlab-ci.yml.tpl"],
    ["base", "github", "workflows", "ci.yml.tpl"],
  ]) {
    it(`${rel.join("/")} annonce l'ordre du script`, () => {
      const text = readFileSync(path.join(templates, ...rel), "utf8");
      assert.include(text.replace(/`nodefony doctor`/gu, "doctor"), prose);
    });
  }
  it("le menu interactif annonce l'ordre du script", () => {
    const menu = readFileSync(
      path.join(templates, "..", "..", "src", "cli", "startMenu.ts"),
      "utf8",
    );
    assert.include(menu, prose);
  });
});
