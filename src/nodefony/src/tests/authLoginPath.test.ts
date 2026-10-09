import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import {
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  OAUTH2_PROVIDERS_PATH,
  WEBAUTHN_LOGIN_OPTIONS_PATH,
  WEBAUTHN_LOGIN_VERIFY_PATH,
} from "../runtime/authRoutes";
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

/**
 * Toute écriture d'une route de session ou de passkey du framework. Le
 * fournisseur OAuth (`…/oauth2/<nom>/callback`) n'y entre pas : son chemin
 * porte un nom choisi par l'application, il n'a pas de constante à égaler.
 */
const AUTH_ROUTE =
  /\/nodefony\/security\/api\/(?:auth|webauthn)(?:\/[\w-]+)*|\/nodefony\/security\/api\/oauth2\/providers/gu;

/** Les seules écritures permises : celles que le cœur nomme. */
const KNOWN_ROUTES = new Set<string>([
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  WEBAUTHN_LOGIN_OPTIONS_PATH,
  WEBAUTHN_LOGIN_VERIFY_PATH,
  OAUTH2_PROVIDERS_PATH,
]);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

/** Écritures de `pattern` dans les gabarits, avec le fichier qui les porte. */
const scan = (pattern: RegExp): { file: string; route: string }[] =>
  walk(TEMPLATES).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(pattern)].map((m) => ({
      file: path.relative(TEMPLATES, file).split(path.sep).join("/"),
      route: m[0],
    })),
  );

describe("les routes de connexion des gabarits sont celles que le cœur nomme", () => {
  it("toute écriture littérale de la route de connexion égale AUTH_LOGIN_PATH", () => {
    const found = scan(LOGIN_ROUTE);
    // Un contrôle qui ne trouve rien passerait sur n'importe quoi : le workflow
    // de production et `AGENTS.md` citent la route en littéral (ils ne peuvent
    // pas importer le cœur).
    expect(found.length).toBeGreaterThanOrEqual(4);
    const divergent = found.filter((f) => f.route !== AUTH_LOGIN_PATH);
    expect(divergent, `routes divergentes de ${AUTH_LOGIN_PATH}`).toEqual([]);
  });

  it("toute route de session ou de passkey écrite dans un gabarit est une constante du cœur", () => {
    const found = scan(AUTH_ROUTE);
    // Même garde : `AGENTS.md` cite la connexion, l'identité et la déconnexion.
    expect(found.length).toBeGreaterThanOrEqual(6);
    const unknown = found.filter((f) => !KNOWN_ROUTES.has(f.route));
    expect(unknown, "routes de connexion inconnues du cœur").toEqual([]);
  });

  it("les pages générées n'appellent plus les routes de session à la main", () => {
    // Le déroulé partagé (`NodefonyLogin`, via `nodefony/{react,vue,svelte,angular}`)
    // porte les appels : une copie dans une page ne gérerait ni le second
    // facteur, ni le blocage, ni les fournisseurs.
    const pages = walk(path.join(TEMPLATES, "app", "frontend")).filter((f) =>
      readFileSync(f, "utf8").includes('fetch("/nodefony/security'),
    );
    expect(pages).toEqual([]);
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
