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
import { EventEmitter } from "node:events";
import {
  attachWatcherErrorGuard,
  isIgnoredWatchPath,
  shouldIgnoreWatchEntry,
} from "../service/dev/DevSupervisor";

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

    // Vécu (CI Windows) : `src/nodefony/tmp/copied` est créé puis SUPPRIMÉ par la
    // suite de tests pendant qu'un serveur détaché tourne. Le scan du watcher
    // tombait alors sur un dossier en train de disparaître → `EBUSY` sous Windows,
    // et le superviseur mourait. Un dossier de TRAVAIL n'est pas une source.
    it("les dossiers de TRAVAIL (tmp/, var/) ne sont pas des sources", () => {
      assert.strictEqual(
        isIgnoredWatchPath("src/nodefony/tmp/copied/dummy.ts", true),
        true,
      );
      // Le DOSSIER lui-même : c'est lui que chokidar veut scanner.
      assert.strictEqual(isIgnoredWatchPath("src/nodefony/tmp", false), true);
      assert.strictEqual(isIgnoredWatchPath("var/sessions", false), true);
      // …en grammaire Windows aussi (axiome : normaliser AVANT de filtrer).
      assert.strictEqual(
        isIgnoredWatchPath("src\\nodefony\\tmp\\copied\\dummy.ts", true),
        true,
      );
    });

    it("… mais un nom qui CONTIENT tmp/var reste surveillé", () => {
      assert.strictEqual(
        isIgnoredWatchPath("src/nodefony/src/service/tmpDir.ts", true),
        false,
      );
      assert.strictEqual(
        isIgnoredWatchPath("src/packages/@nodefony/vars/index.ts", true),
        false,
      );
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
  describe("une erreur d'OBSERVATION ne tue pas le superviseur", () => {
    /*
     *   Vécu (CI Windows, `Filet CLI`) : un `EBUSY` remonté par le scan de
     *   chokidar arrivait sur un `EventEmitter` SANS écouteur `error` — Node
     *   transforme alors l'événement en exception non rattrapée, et le
     *   superviseur (donc tout le serveur de développement) meurt.
     *
     *   Le watch est un capteur : ce qu'il n'arrive pas à lire se SIGNALE, il ne
     *   se paie pas d'un arrêt.
     */
    it("un « error » émis par le watcher est absorbé et JOURNALISÉ", () => {
      const watcher = new EventEmitter();
      const said: string[] = [];
      attachWatcherErrorGuard(watcher, (m) => said.push(m));

      const boom = Object.assign(new Error("scandir"), {
        code: "EBUSY",
        path: "src/nodefony/tmp/copied",
      });
      assert.doesNotThrow(() => watcher.emit("error", boom));

      assert.strictEqual(said.length, 1);
      assert.match(said[0]!, /EBUSY/);
      assert.match(said[0]!, /tmp[/\\]copied/);
    });

    // Contrôle NÉGATIF : sans le garde, le même émetteur JETTE. C'est la preuve
    // que le test précédent mesure bien quelque chose.
    it("sans le garde, le même émetteur jette (le garde mord)", () => {
      const nu = new EventEmitter();
      assert.throws(() => nu.emit("error", new Error("scandir")));
    });
  });

  describe("la règle ne vaut que DANS le projet (chokidar donne de l'absolu)", () => {
    /*
     *   `tmp` et `var` sont des dossiers de travail DU PROJET — ailleurs, ce sont
     *   des noms ordinaires. Sur macOS `TMPDIR` vaut `/var/folders/…`, et nos
     *   propres bancs de scaffold créent l'application là. Filtrer sur le chemin
     *   ABSOLU y rejetterait CHAQUE entrée : watch aveugle, sans un mot.
     */
    const app = "/var/folders/8y/q7n8/T/nf-create-app-Xy42";

    it("une app posée sous /var/folders reste surveillée", () => {
      assert.strictEqual(
        shouldIgnoreWatchEntry(app, `${app}/src/nodefony/service/Db.ts`, true),
        false,
      );
      assert.strictEqual(
        shouldIgnoreWatchEntry(app, `${app}/nodefony.config.ts`, true),
        false,
      );
    });

    it("… et son PROPRE dossier de travail y reste ignoré", () => {
      assert.strictEqual(
        shouldIgnoreWatchEntry(app, `${app}/tmp/build`, false),
        true,
      );
      assert.strictEqual(
        shouldIgnoreWatchEntry(app, `${app}/var/sessions`, false),
        true,
      );
    });

    it("les autres règles valent toujours en absolu", () => {
      assert.strictEqual(
        shouldIgnoreWatchEntry(app, `${app}/src/x/dist/index.js`, true),
        true,
      );
      assert.strictEqual(
        shouldIgnoreWatchEntry(app, `${app}/src/mod/frontend/main.ts`, true),
        true,
      );
    });
  });
});
