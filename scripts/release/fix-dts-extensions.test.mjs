// Réécriture des specifiers relatifs des `.d.ts` publiés : un import que node16
// ne résout pas, et TOUT consommateur perd les types de l'entrée qui le porte.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixDtsExtensions } from "./fix-dts-extensions.mjs";

describe("fixDtsExtensions", () => {
  let dir = "";
  const read = (...p) => fs.readFileSync(path.join(dir, ...p), "utf8");

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-fix-dts-"));
    const write = (rel, text) => {
      const file = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    write("client/index.d.ts", "export type RoutesMap = {};\n");
    write("client/angular/index.d.ts", "export type Local = {};\n");
    write("client/angular/socket.d.ts", "export type S = {};\n");
    // Ce que tsgo émet quand un type déroulé vient du barrel parent.
    write(
      "client/angular/token.d.ts",
      [
        'export declare const A: import("..").RoutesMap;',
        'import type { Local } from ".";',
        'export type { S } from "./socket";',
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("réécrit un import de DOSSIER nu (« .. », « . ») vers son index.js", () => {
    const { unresolved } = fixDtsExtensions(dir);
    const text = read("client", "angular", "token.d.ts");
    expect(unresolved).toEqual([]);
    expect(text).toContain('import("../index.js").RoutesMap');
    expect(text).toContain('from "./index.js"');
    expect(text).toContain('from "./socket.js"');
    expect(text).not.toMatch(/["']\.\.?["']/u);
  });
});
