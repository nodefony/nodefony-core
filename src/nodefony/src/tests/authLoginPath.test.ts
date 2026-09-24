import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import { AUTH_LOGIN_PATH } from "../runtime/authRoutes";
import { runScaffold } from "../cli/scaffold/engine";

/**
 * Ce que ce contrôle garde : la route de connexion que citent les GABARITS est
 * celle que le cœur nomme — et donc, par le test du module security qui confronte
 * la constante au monteur, celle qui est réellement montée.
 *
 * Les copies d'un gabarit partent chez l'utilisateur ; une divergence ne s'y
 * voit jamais chez nous, toujours chez celui qui génère (vécu : un test engendré
 * qu'il a fallu « adapter à la route réellement installée »).
 */

const TEMPLATES = path.resolve(import.meta.dirname, "../../templates");

/** Toute écriture d'une route qui finit par `/api/auth/login`, quel que soit son préfixe. */
const LOGIN_ROUTE = /\/[\w./-]*\/api\/auth\/login(?![\w/-])/gu;
// Sans `g` pour `toMatch` : un `RegExp` global garde son `lastIndex` d'un appel à l'autre.
const HAS_LOGIN_ROUTE = new RegExp(LOGIN_ROUTE.source, "u");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

describe("la route de connexion des gabarits est AUTH_LOGIN_PATH", () => {
  it("toute écriture littérale de la route dans un gabarit égale la constante", () => {
    const found: { file: string; route: string }[] = [];
    for (const file of walk(TEMPLATES)) {
      for (const m of readFileSync(file, "utf8").matchAll(LOGIN_ROUTE)) {
        found.push({
          file: path.relative(TEMPLATES, file).split(path.sep).join("/"),
          route: m[0],
        });
      }
    }
    // Un contrôle qui ne trouve rien passerait sur n'importe quoi : les
    // vitrines navigateur et le workflow de production citent la route en
    // littéral (ils ne peuvent pas importer le cœur).
    expect(found.length).toBeGreaterThanOrEqual(5);
    const divergent = found.filter((f) => f.route !== AUTH_LOGIN_PATH);
    expect(divergent, `routes divergentes de ${AUTH_LOGIN_PATH}`).toEqual([]);
  });

  describe("les tests GÉNÉRÉS citent la constante, jamais une copie", () => {
    let tmp: string;
    beforeAll(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), "nf-authpath-"));
    });
    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    const read = (dest: string, file: string): string =>
      readFileSync(path.join(dest, "tests", file), "utf8");

    it("application complète : e2e importe AUTH_LOGIN_PATH de nodefony", () => {
      const dest = path.join(tmp, "complete");
      runScaffold(
        {
          type: "app",
          answers: { name: "complete", preset: "complete" },
          dir: dest,
          force: false,
        },
        version,
      );
      const e2e = read(dest, "e2e.test.ts");
      expect(e2e).toMatch(
        /^import \{ AUTH_LOGIN_PATH, readRuntimeState \} from "nodefony";$/mu,
      );
      expect(e2e).toContain("${AUTH_LOGIN_PATH}");
      // Ni le test ni son décor ne gardent de copie de la route.
      expect(e2e).not.toMatch(HAS_LOGIN_ROUTE);
      expect(read(dest, "e2e.setup.ts")).not.toMatch(HAS_LOGIN_ROUTE);
    });

    it("application minimale (sans security) : pas d'import devenu inutilisé", () => {
      const dest = path.join(tmp, "minimal");
      runScaffold(
        {
          type: "app",
          answers: { name: "minimal", preset: "minimal" },
          dir: dest,
          force: false,
        },
        version,
      );
      const e2e = read(dest, "e2e.test.ts");
      expect(e2e).not.toContain("AUTH_LOGIN_PATH");
      expect(e2e).toMatch(/^import \{ readRuntimeState \} from "nodefony";$/mu);
    });
  });
});
