import { afterAll, assert, describe, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScaffoldWriter } from "../cli/scaffold/writer";
import { listTargets } from "../cli/scaffold/engine";

/**
 * L'ordre des entrées d'un dossier ne dépend NI du système NI de la transaction.
 *
 * Vécu : une application `--demo` (module `demo` sur le disque) à qui l'on
 * ajoute `create module blog`. Pendant la transaction, la liste valait « disque
 * puis écritures en attente » — `demo`, `blog` — et le bloc d'`AGENTS.md` fut
 * écrit dans cet ordre ; relu ensuite sur le disque, `blog`, `demo`. `nodefony
 * doctor` déclarait alors périmé l'`AGENTS.md` d'une application neuve. Et
 * l'ordre de `readdir` n'est pas garanti alphabétique sous linux.
 */
describe("ScaffoldWriter.listDir — ordre déterministe", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nf-listdir-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("une entrée en attente se range à sa place, pas à la fin", () => {
    const modules = path.join(root, "modules");
    mkdirSync(path.join(modules, "demo"), { recursive: true });
    writeFileSync(path.join(modules, "demo", "index.ts"), "");
    const writer = new ScaffoldWriter();
    writer.write(path.join(modules, "blog", "index.ts"), "");
    assert.deepEqual(
      writer.listDir(modules).map((e) => e.name),
      ["blog", "demo"],
    );
  });

  it("listTargets rend les modules dans le même ordre, transaction ou disque", () => {
    const app = path.join(root, "app");
    mkdirSync(path.join(app, "modules", "demo"), { recursive: true });
    writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({ name: "app", workspaces: ["modules/*"] }),
    );
    writeFileSync(path.join(app, "modules", "demo", "index.ts"), "");
    const writer = new ScaffoldWriter();
    writer.write(path.join(app, "modules", "blog", "index.ts"), "");
    const during = listTargets(app, writer).map((t) => path.basename(t.dir));
    writer.commit();
    const after = listTargets(app).map((t) => path.basename(t.dir));
    assert.deepEqual(during, after);
    assert.deepEqual(after.slice(1), ["blog", "demo"]);
  });
});
