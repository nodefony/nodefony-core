/*
 *   Règle de filtrage du WATCH du DevSupervisor (`isIgnoredWatchPath`).
 *
 *   Le superviseur ne surveille que les sources SERVEUR : le client a sa propre
 *   boucle (HMR Vite), `dist` est un artefact, les tests ne sont pas le runtime.
 *
 *   Le cas qui a motivé ces tests : « frontend » est à la fois un RÔLE (le dossier
 *   des sources SPA d'un module) et un NOM DE PAQUET (`@nodefony/frontend`, le
 *   builder Vite — du code SERVEUR). Ignorer tout segment nommé `frontend` rendait
 *   le watch AVEUGLE sur tout ce paquet : on l'éditait, rien ne se passait, jamais
 *   — et le symptôme (« le watch ne réagit pas parfois ») ne pointait vers rien.
 */

import assert from "node:assert";
import { isIgnoredWatchPath } from "../service/dev/DevSupervisor";

describe("DevSupervisor — isIgnoredWatchPath (ce que le watch regarde)", () => {
  describe("le paquet @nodefony/frontend est du code SERVEUR → surveillé", () => {
    it("son service (le builder Vite) n'est PAS ignoré", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "src/packages/@nodefony/frontend/nodefony/service/frontend-service.ts",
          true,
        ),
        false,
      );
    });

    it("son index public n'est PAS ignoré", () => {
      assert.strictEqual(
        isIgnoredWatchPath("src/packages/@nodefony/frontend/index.ts", true),
        false,
      );
    });

    it("… même en chemin ABSOLU (chokidar peut fournir l'un ou l'autre)", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "/Users/x/repo/src/packages/@nodefony/frontend/nodefony/src/vite.ts",
          true,
        ),
        false,
      );
    });
  });

  describe("les sources CLIENT (SPA) gardent leur propre boucle → ignorées", () => {
    it("le dossier frontend/ d'un paquet (Studio)", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "src/packages/@nodefony/studio/frontend/src/App.tsx",
          true,
        ),
        true,
      );
    });

    it("le dossier frontend/ d'un module applicatif", () => {
      assert.strictEqual(
        isIgnoredWatchPath("src/modules/demo/frontend/src/main.tsx", true),
        true,
      );
    });

    it("le dossier frontend/ d'un paquet dont le NOM contient déjà « frontend »", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "src/packages/@nodefony/test-frontend-react/frontend/src/App.tsx",
          true,
        ),
        true,
      );
    });

    it("un composant .svelte d'un module dont le NOM contient « frontend » (cas suspecté à tort de redémarrer le serveur)", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "src/modules/test-frontend-svelte/frontend/src/App.svelte",
          true,
        ),
        true,
      );
    });

    // ⚠️ Cas DISCRIMINANT — le seul de ce bloc que la règle « non-.ts ignoré »
    // ne rattrape pas : un entry point .ts CLIENT n'est exclu QUE par la règle
    // frontend. Les .tsx/.svelte ci-dessus resteraient verts même sans elle.
    it("un entry point .ts CLIENT (frontend/src/main.ts) est exclu par la règle frontend seule", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "src/modules/test-frontend-svelte/frontend/src/main.ts",
          true,
        ),
        true,
      );
    });

    it("… mais le BACK de ce même paquet reste surveillé", () => {
      assert.strictEqual(
        isIgnoredWatchPath(
          "src/packages/@nodefony/test-frontend-react/index.ts",
          true,
        ),
        false,
      );
    });
  });

  describe("artefacts et tests", () => {
    it("dist (produit par le build, jamais édité à la main)", () => {
      assert.strictEqual(
        isIgnoredWatchPath("src/packages/@nodefony/http/dist/index.js", true),
        true,
      );
    });

    it("node_modules et .git", () => {
      assert.strictEqual(
        isIgnoredWatchPath("node_modules/@nodefony/http/index.ts", true),
        true,
      );
      assert.strictEqual(isIgnoredWatchPath(".git/HEAD", true), true);
    });

    it("dossier tests/ et fichiers *.test.ts / *.spec.ts", () => {
      assert.strictEqual(
        isIgnoredWatchPath("src/packages/@nodefony/http/nodefony/tests/x.ts"),
        true,
      );
      assert.strictEqual(
        isIgnoredWatchPath("src/nodefony/src/tests/Kernel.test.ts", true),
        true,
      );
      assert.strictEqual(isIgnoredWatchPath("src/foo.spec.ts", true), true);
    });

    it("un FICHIER non-TS n'intéresse pas le runtime serveur", () => {
      assert.strictEqual(isIgnoredWatchPath("src/app/style.css", true), true);
      // …mais un DOSSIER sans extension doit rester traversable (sinon on
      // n'atteindrait jamais les .ts qu'il contient).
      assert.strictEqual(isIgnoredWatchPath("src/app", false), false);
    });
  });

  describe("les sources serveur ordinaires sont surveillées", () => {
    it("core, http, realtime, module applicatif, config racine", () => {
      for (const p of [
        "src/nodefony/src/Service.ts",
        "src/packages/@nodefony/http/nodefony/service/http-kernel.ts",
        "src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts",
        "src/modules/test/nodefony/controller/RouteController.ts",
        "nodefony.config.ts",
        "env.ts",
      ]) {
        assert.strictEqual(isIgnoredWatchPath(p, true), false, p);
      }
    });
  });
});
