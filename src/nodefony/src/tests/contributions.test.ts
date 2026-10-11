import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, it } from "vitest";
import { assert } from "chai";
import {
  contributionFingerprint,
  readScaffoldLock,
  renderScaffoldSync,
  runAppContributions,
  runScaffoldSyncCommand,
  SCAFFOLD_LOCK_FILE,
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
        updated: [],
        outdated: [],
        modified: [],
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

/**
 * Un paquet `@nodefony/theme` qui recopie son dossier `assets/` (fichiers
 * SUIVIS) et sème `seed.txt` (fichier de l'application). `deliver` réécrit les
 * assets du paquet : c'est le `npm update`.
 */
const makeThemedApp = (): {
  app: string;
  deliver: (files: Record<string, string>) => void;
  lock: () => Record<string, string>;
  read: (relative: string) => string;
} => {
  const app = makeApp();
  const pkg = addPackage(
    app,
    "theme",
    `import path from "node:path";
     import { fileURLToPath } from "node:url";
     export function contribute(ctx) {
       ctx.write("seed.txt", "semence " + Date.now());
       ctx.copyTree(path.join(path.dirname(fileURLToPath(import.meta.url)), "assets"), "docker/theme");
     }`,
  );
  const deliver = (files: Record<string, string>): void => {
    rmSync(path.join(pkg, "assets"), { recursive: true, force: true });
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(pkg, "assets", ...file.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  };
  return {
    app,
    deliver,
    lock: () => ({ ...readScaffoldLock(app)["@nodefony/theme"]?.files }),
    read: (relative) =>
      readFileSync(path.join(app, ...relative.split("/")), "utf8"),
  };
};

describe("scaffold:sync --update — registre de provenance", () => {
  it("inscrit les copies livrées, jamais une semence", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "a{}", "img/x.txt": "x" });
    await runAppContributions(t.app);
    assert.deepEqual(t.lock(), {
      "docker/theme/img/x.txt": contributionFingerprint("x"),
      "docker/theme/login.css": contributionFingerprint("a{}"),
    });
    assert.isTrue(existsSync(path.join(t.app, SCAFFOLD_LOCK_FILE)));
  });

  it("rafraîchit une copie INTACTE avec --update, la signale sans --update", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "v1" });
    await runAppContributions(t.app);
    t.deliver({ "login.css": "v2" });

    const [plain] = await runAppContributions(t.app);
    assert.deepEqual(plain?.outdated, ["docker/theme/login.css"]);
    assert.strictEqual(t.read("docker/theme/login.css"), "v1");
    assert.strictEqual(
      t.lock()["docker/theme/login.css"],
      contributionFingerprint("v1"),
      "sans --update, l'empreinte reste celle de ce qui est posé",
    );

    const [updated] = await runAppContributions(t.app, false, true);
    assert.deepEqual(updated?.updated, ["docker/theme/login.css"]);
    assert.strictEqual(t.read("docker/theme/login.css"), "v2");
    assert.strictEqual(
      t.lock()["docker/theme/login.css"],
      contributionFingerprint("v2"),
    );
  });

  it("ne remplace JAMAIS une copie retouchée, même avec --update", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "v1" });
    await runAppContributions(t.app);
    writeFileSync(path.join(t.app, "docker", "theme", "login.css"), "à moi");
    t.deliver({ "login.css": "v2" });
    const [report] = await runAppContributions(t.app, false, true);
    assert.deepEqual(report?.modified, ["docker/theme/login.css"]);
    assert.isEmpty(report?.updated ?? []);
    assert.strictEqual(t.read("docker/theme/login.css"), "à moi");
    assert.strictEqual(
      t.lock()["docker/theme/login.css"],
      contributionFingerprint("v1"),
      "l'empreinte livrée reste : revenir sur la retouche rend le fichier rafraîchissable",
    );
  });

  it("une copie posée AVANT le registre : gardée si elle diffère, adoptée si elle est identique", async () => {
    const t = makeThemedApp();
    t.deliver({ "same.css": "pareil", "other.css": "du paquet" });
    mkdirSync(path.join(t.app, "docker", "theme"), { recursive: true });
    writeFileSync(path.join(t.app, "docker", "theme", "same.css"), "pareil");
    writeFileSync(path.join(t.app, "docker", "theme", "other.css"), "ancien");
    const [report] = await runAppContributions(t.app, false, true);
    assert.deepEqual(report?.modified, ["docker/theme/other.css"]);
    assert.strictEqual(t.read("docker/theme/other.css"), "ancien");
    assert.deepEqual(t.lock(), {
      "docker/theme/same.css": contributionFingerprint("pareil"),
    });
  });

  it("une semence n'est jamais remplacée, même avec --update", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "v1" });
    await runAppContributions(t.app);
    const seed = t.read("seed.txt");
    const [report] = await runAppContributions(t.app, false, true);
    assert.strictEqual(t.read("seed.txt"), seed);
    assert.include(report?.kept ?? [], "seed.txt");
    assert.notInclude(report?.modified ?? [], "seed.txt");
  });

  it("en simulation, --update n'écrit ni fichier ni registre", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "v1" });
    await runAppContributions(t.app);
    const before = readFileSync(path.join(t.app, SCAFFOLD_LOCK_FILE), "utf8");
    t.deliver({ "login.css": "v2" });
    const [report] = await runAppContributions(t.app, true, true);
    assert.deepEqual(report?.updated, ["docker/theme/login.css"]);
    assert.strictEqual(t.read("docker/theme/login.css"), "v1");
    assert.strictEqual(
      readFileSync(path.join(t.app, SCAFFOLD_LOCK_FILE), "utf8"),
      before,
    );
  });

  it("une passe sans effet ne réécrit pas le registre ; sans copie suivie, il n'existe pas", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "v1" });
    await runAppContributions(t.app);
    const lockPath = path.join(t.app, SCAFFOLD_LOCK_FILE);
    const content = readFileSync(lockPath, "utf8");
    writeFileSync(lockPath, content);
    const stamp = new Date("2020-01-01T00:00:00Z");
    utimesSync(lockPath, stamp, stamp);
    await runAppContributions(t.app);
    assert.strictEqual(statSync(lockPath).mtimeMs, stamp.getTime());

    const bare = makeApp();
    addPackage(
      bare,
      "deco",
      `export function contribute(ctx) { ctx.write("a.txt", "x"); }`,
    );
    await runAppContributions(bare);
    assert.isFalse(existsSync(path.join(bare, SCAFFOLD_LOCK_FILE)));
  });

  it("une contribution en échec garde son entrée au registre", async () => {
    const t = makeThemedApp();
    t.deliver({ "login.css": "v1" });
    await runAppContributions(t.app);
    const before = t.lock();
    // Un AUTRE module : `import()` garde en cache celui déjà chargé.
    addPackage(
      t.app,
      "theme",
      `export function contribute() { throw new Error("cassée"); }`,
      "./broken.mjs",
    );
    writeFileSync(
      path.join(t.app, "node_modules", "@nodefony", "theme", "broken.mjs"),
      `export function contribute() { throw new Error("cassée"); }`,
    );
    const [report] = await runAppContributions(t.app);
    assert.isNotNull(report?.error);
    assert.deepEqual(t.lock(), before);
  });

  it("l'empreinte d'un texte ignore CRLF, celle d'un binaire non", () => {
    assert.strictEqual(
      contributionFingerprint("a\r\nb\r\n"),
      contributionFingerprint("a\nb\n"),
    );
    assert.notStrictEqual(
      contributionFingerprint(Buffer.from([0, 13, 10])),
      contributionFingerprint(Buffer.from([0, 10])),
    );
  });

  it("le rendu nomme ce qui demande un geste et compte le reste", () => {
    const text = renderScaffoldSync(
      [
        {
          packageName: "@nodefony/theme",
          written: [],
          kept: ["a.css", "b.css", "c.css", "seed.txt"],
          updated: [],
          outdated: ["a.css"],
          modified: ["b.css"],
          error: null,
        },
      ],
      { dryRun: false, update: false },
    );
    assert.include(text, "~ a.css");
    assert.include(text, "! b.css");
    assert.include(text, "= 2 déjà là");
    assert.include(text, "scaffold:sync --update");
  });
});
