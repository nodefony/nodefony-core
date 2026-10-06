import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, it } from "vitest";
import { assert } from "chai";
import {
  runAppContributions,
  runScaffoldSyncCommand,
  summarizeContributions,
} from "../cli/contributions";

/**
 * Les paquets LIVRENT des fichiers à l'application (`nodefony.contribute`) ;
 * le cœur les exécute sans en connaître aucun. Décor : une application avec un
 * `node_modules/@nodefony/<paquet>` fabriqué, dont la contribution est un
 * module ESM écrit à la main.
 */

const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-contrib-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
/** Une application minimale (`package.json` + `nodefony.config.ts`). */
const makeApp = (): string => {
  counter += 1;
  const app = path.join(tmp, `app-${String(counter)}`);
  mkdirSync(app, { recursive: true });
  writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({ name: "demo" }),
  );
  writeFileSync(path.join(app, "nodefony.config.ts"), "export default {};\n");
  return app;
};

/** Pose un paquet `@nodefony/<name>` qui contribue par `source` (module ESM). */
const addPackage = (
  app: string,
  name: string,
  source: string | null,
  declared = "./contribute.mjs",
): string => {
  const dir = path.join(app, "node_modules", "@nodefony", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: `@nodefony/${name}`,
      ...(source === null ? {} : { nodefony: { contribute: declared } }),
    }),
  );
  if (source !== null) writeFileSync(path.join(dir, "contribute.mjs"), source);
  return dir;
};

describe("contributions des paquets à l'application", () => {
  it("exécute la contribution déclarée, avec le nom de l'app, et rapporte ce qu'elle pose", async () => {
    const app = makeApp();
    addPackage(
      app,
      "deco",
      `export function contribute(ctx) {
        ctx.write("docker/deco/" + ctx.appName + ".txt", "bonjour");
      }`,
    );
    addPackage(app, "silent", null);
    const reports = await runAppContributions(app);
    assert.deepEqual(reports, [
      {
        packageName: "@nodefony/deco",
        written: ["docker/deco/demo.txt"],
        kept: [],
        error: null,
      },
    ]);
    assert.strictEqual(
      readFileSync(path.join(app, "docker", "deco", "demo.txt"), "utf8"),
      "bonjour",
    );
  });

  it("ne remplace jamais un fichier présent, et le dit", async () => {
    const app = makeApp();
    addPackage(
      app,
      "deco",
      `export function contribute(ctx) { ctx.write("a.txt", "du paquet"); }`,
    );
    writeFileSync(path.join(app, "a.txt"), "de l'app");
    const [report] = await runAppContributions(app);
    assert.deepEqual(report?.kept, ["a.txt"]);
    assert.isEmpty(report?.written ?? []);
    assert.strictEqual(
      readFileSync(path.join(app, "a.txt"), "utf8"),
      "de l'app",
    );
  });

  it("recopie un dossier du paquet fichier par fichier", async () => {
    const app = makeApp();
    const pkg = addPackage(
      app,
      "theme",
      `import path from "node:path";
       import { fileURLToPath } from "node:url";
       export function contribute(ctx) {
         ctx.copyTree(path.join(path.dirname(fileURLToPath(import.meta.url)), "assets"), "docker/theme");
       }`,
    );
    mkdirSync(path.join(pkg, "assets", "img"), { recursive: true });
    writeFileSync(path.join(pkg, "assets", "theme.properties"), "parent=x\n");
    writeFileSync(
      path.join(pkg, "assets", "img", "logo.png"),
      Buffer.from([0x89, 0x50]),
    );
    const [report] = await runAppContributions(app);
    assert.sameMembers(
      [...(report?.written ?? [])],
      ["docker/theme/theme.properties", "docker/theme/img/logo.png"],
    );
    assert.isTrue(
      readFileSync(path.join(app, "docker", "theme", "img", "logo.png")).equals(
        Buffer.from([0x89, 0x50]),
      ),
    );
  });

  it("en simulation, n'écrit rien", async () => {
    const app = makeApp();
    addPackage(
      app,
      "deco",
      `export function contribute(ctx) { ctx.write("b.txt", "x"); }`,
    );
    const [report] = await runAppContributions(app, true);
    assert.deepEqual(report?.written, ["b.txt"]);
    assert.isFalse(existsSync(path.join(app, "b.txt")));
  });

  it("refuse d'écrire hors de l'application", async () => {
    const app = makeApp();
    addPackage(
      app,
      "evil",
      `export function contribute(ctx) { ctx.write("../dehors.txt", "x"); }`,
    );
    const [report] = await runAppContributions(app);
    assert.match(report?.error ?? "", /hors de la racine/u);
    assert.isFalse(existsSync(path.join(tmp, "dehors.txt")));
  });

  it("refuse une contribution déclarée hors du paquet", async () => {
    const app = makeApp();
    addPackage(app, "evil", "export function contribute() {}", "../../x.mjs");
    const [report] = await runAppContributions(app);
    assert.match(report?.error ?? "", /hors de la racine/u);
  });

  it("une contribution en échec est rapportée, les autres passent", async () => {
    const app = makeApp();
    addPackage(
      app,
      "a-broken",
      `export function contribute() { throw new Error("cassée"); }`,
    );
    addPackage(app, "b-noexport", `export const x = 1;`);
    addPackage(
      app,
      "c-ok",
      `export function contribute(ctx) { ctx.write("ok.txt", "ok"); }`,
    );
    const reports = await runAppContributions(app);
    assert.deepEqual(
      reports.map((r) => [r.packageName, r.error === null]),
      [
        ["@nodefony/a-broken", false],
        ["@nodefony/b-noexport", false],
        ["@nodefony/c-ok", true],
      ],
    );
    assert.match(reports[1]?.error ?? "", /contribute/u);
    assert.include(summarizeContributions(reports), "en échec (cassée)");
  });

  it("`scaffold:sync` sort en 1 si une contribution échoue, en 66 hors projet", async () => {
    const app = makeApp();
    addPackage(
      app,
      "broken",
      `export function contribute() { throw new Error("x"); }`,
    );
    const write = process.stdout.write.bind(process.stdout);
    const ewrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      assert.strictEqual(
        await runScaffoldSyncCommand([
          "node",
          "nodefony",
          "scaffold:sync",
          "--cwd",
          app,
        ]),
        1,
      );
      assert.strictEqual(
        await runScaffoldSyncCommand([
          "node",
          "nodefony",
          "scaffold:sync",
          "--cwd",
          os.tmpdir(),
        ]),
        66,
      );
    } finally {
      process.stdout.write = write;
      process.stderr.write = ewrite;
    }
  });
});
