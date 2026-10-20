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
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach } from "vitest";
import {
  attachWatcherErrorGuard,
  type ISourceWatcher,
  type IWatchHandle,
  type WatchFunction,
  DEV_WATCH_PATHS,
  isIgnoredWatchPath,
  localModuleDirOf,
  planStandaloneRebuild,
  shouldIgnoreWatchEntry,
  watchSources,
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

    it("… même en chemin ABSOLU (un watcher peut fournir l'un ou l'autre)", () => {
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
      // Le DOSSIER lui-même : c'est lui que le watch veut parcourir.
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
     *   le watcher arrivait sur un `EventEmitter` SANS écouteur `error` — Node
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

  describe("la règle ne vaut que DANS le projet (un watcher peut donner de l'absolu)", () => {
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

describe("DevSupervisor — modules LOCAUX d'une application (`modules/<nom>`)", () => {
  // Un module local est un workspace, chargé par son `dist/` et laissé HORS du
  // bundle de l'application : le modifier ne rechargeait rien (dossier non
  // surveillé), et rebâtir l'application seule relançait le serveur sur
  // l'ANCIEN module.
  it("⭐ le dossier des modules locaux fait partie de ce que le superviseur surveille", () => {
    assert.ok(DEV_WATCH_PATHS.includes("modules"), DEV_WATCH_PATHS.join(", "));
  });

  it("ses sources serveur sont surveillées, son frontend et ses tests non", () => {
    assert.strictEqual(
      isIgnoredWatchPath("modules/blog/nodefony/service/BlogService.ts", true),
      false,
    );
    assert.strictEqual(
      isIgnoredWatchPath("modules/blog/index.ts", true),
      false,
    );
    assert.strictEqual(
      isIgnoredWatchPath("modules/blog/frontend/src/main.ts", true),
      true,
    );
    assert.strictEqual(
      isIgnoredWatchPath("modules/blog/tests/blog.test.ts", true),
      true,
    );
  });

  it("un fichier se rattache à SON module, dans les deux grammaires de chemin", () => {
    assert.strictEqual(
      localModuleDirOf("modules/blog/nodefony/service/BlogService.ts"),
      "modules/blog",
    );
    assert.strictEqual(
      localModuleDirOf("modules\\blog\\index.ts"),
      "modules/blog",
    );
    assert.strictEqual(
      localModuleDirOf("nodefony/service/AppService.ts"),
      null,
    );
    assert.strictEqual(localModuleDirOf("index.ts"), null);
    // Le dossier lui-même n'est le fichier de personne.
    assert.strictEqual(localModuleDirOf("modules/blog"), null);
  });

  it("⭐ une modification d'un module rebâtit CE module, pas l'application", () => {
    assert.deepStrictEqual(
      planStandaloneRebuild([
        "modules/blog/nodefony/service/BlogService.ts",
        "modules/blog/index.ts",
      ]),
      { modules: ["modules/blog"], app: false },
    );
  });

  it("modules et application touchés ensemble : les deux, modules triés", () => {
    assert.deepStrictEqual(
      planStandaloneRebuild([
        "modules/zeta/index.ts",
        "index.ts",
        "modules/alpha/index.ts",
      ]),
      { modules: ["modules/alpha", "modules/zeta"], app: true },
    );
  });

  it("rien d'identifiable : on rebâtit l'application (le geste historique)", () => {
    assert.deepStrictEqual(planStandaloneRebuild([]), {
      modules: [],
      app: true,
    });
  });
});

describe("DevSupervisor — watchSources (le watch natif, sur un vrai disque)", () => {
  /*
   *   Le watch tourne sur `fs.watch` de Node, sans dépendance. Ces tests posent
   *   une application jetable dans le dossier temporaire du système — sous macOS
   *   `/var/folders/…`, ce qui éprouve aussi la règle « tmp/var ne valent que
   *   DANS le projet ».
   */
  const roots: string[] = [];
  const watchers: ISourceWatcher[] = [];
  afterEach(() => {
    for (const w of watchers.splice(0)) w.close();
  });
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  const put = (root: string, rel: string, body = "export {};\n") => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  const app = () => {
    const root = mkdtempSync(path.join(tmpdir(), "nf-devwatch-"));
    roots.push(root);
    put(root, "src/service/A.ts");
    put(root, "index.ts");
    return root;
  };
  const start = async (root: string, seen: string[]) => {
    const w = watchSources(root, ["src", "index.ts"], (f) => seen.push(f));
    watchers.push(w);
    attachWatcherErrorGuard(w, () => {});
    // Le watcher natif s'arme de façon asynchrone, et FSEvents (macOS) livre
    // encore les créations faites juste AVANT : on les laisse passer et on oublie.
    await new Promise((r) => setTimeout(r, 300));
    seen.length = 0;
    return w;
  };
  const until = async (ok: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (!ok() && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 25));
    }
    return ok();
  };

  it("un .ts modifié dans un dossier surveillé est signalé, relatif au projet", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    put(root, "src/service/A.ts", "export const a = 1;\n");
    const want = path.join("src", "service", "A.ts");
    assert.ok(await until(() => seen.includes(want)), seen.join(", "));
  });

  it("un .ts créé dans un dossier NEUF est signalé", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    put(root, "src/neuf/B.ts");
    const want = path.join("src", "neuf", "B.ts");
    assert.ok(await until(() => seen.includes(want)), seen.join(", "));
  });

  it("dossiers de travail, artefacts, tests et non-.ts ne sont PAS signalés", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    put(root, "src/tmp/x.ts");
    put(root, "src/dist/y.ts");
    put(root, "src/node_modules/z/index.ts");
    put(root, "src/service/A.test.ts");
    put(root, "src/style.css", "a{}\n");
    // Témoin écrit EN DERNIER : quand il arrive, les autres auraient dû arriver.
    put(root, "src/Witness.ts");
    const witness = path.join("src", "Witness.ts");
    assert.ok(await until(() => seen.includes(witness)), seen.join(", "));
    assert.deepStrictEqual(
      [...new Set(seen)].filter((f) => f !== witness),
      [],
    );
  });

  it("un fichier racine remplacé par RENOMMAGE (écriture atomique) est signalé", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    writeFileSync(path.join(root, "index.ts.tmp"), "export const v = 2;\n");
    renameSync(path.join(root, "index.ts.tmp"), path.join(root, "index.ts"));
    assert.ok(await until(() => seen.includes("index.ts")), seen.join(", "));
    // …et encore à l'enregistrement suivant : le watch n'est pas devenu sourd.
    seen.length = 0;
    writeFileSync(path.join(root, "index.ts.tmp"), "export const v = 3;\n");
    renameSync(path.join(root, "index.ts.tmp"), path.join(root, "index.ts"));
    assert.ok(await until(() => seen.includes("index.ts")), seen.join(", "));
    assert.ok(!seen.includes("index.ts.tmp"), seen.join(", "));
  });

  it("un fichier dont seule la DATE change est signalé (geste du test de bout en bout)", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    const t = new Date(Date.now() + 60_000);
    utimesSync(path.join(root, "src", "service", "A.ts"), t, t);
    const want = path.join("src", "service", "A.ts");
    assert.ok(await until(() => seen.includes(want)), seen.join(", "));
  });

  it("un .ts SUPPRIMÉ est signalé (le serveur doit être rebâti sans lui)", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    rmSync(path.join(root, "src", "service", "A.ts"));
    const want = path.join("src", "service", "A.ts");
    assert.ok(await until(() => seen.includes(want)), seen.join(", "));
  });

  it("des enregistrements en RAFALE sont tous vus, aucun n'est perdu en route", async () => {
    const root = app();
    const seen: string[] = [];
    await start(root, seen);
    const files = ["A1", "A2", "A3", "A4", "A5"].map((n) =>
      path.join("src", "service", `${n}.ts`),
    );
    for (const f of files) put(root, f);
    assert.ok(
      await until(() => files.every((f) => seen.includes(f))),
      seen.join(", "),
    );
  });

  it("un module LOCAL : son serveur est vu, son frontend et ses tests non", async () => {
    const root = app();
    put(root, "modules/blog/index.ts");
    const seen: string[] = [];
    const w = watchSources(root, ["modules"], (f) => seen.push(f));
    watchers.push(w);
    attachWatcherErrorGuard(w, () => {});
    await new Promise((r) => setTimeout(r, 300));
    seen.length = 0;
    put(root, "modules/blog/frontend/src/main.ts");
    put(root, "modules/blog/tests/blog.test.ts");
    put(root, "modules/blog/nodefony/service/Blog.ts");
    const want = path.join("modules", "blog", "nodefony", "service", "Blog.ts");
    assert.ok(await until(() => seen.includes(want)), seen.join(", "));
    assert.deepStrictEqual([...new Set(seen)], [want]);
  });

  it("une racine de projet avec ESPACES et ACCENTS reste surveillée", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "nf devwatch é "));
    roots.push(root);
    put(root, "src/service/A.ts");
    put(root, "index.ts");
    const seen: string[] = [];
    await start(root, seen);
    put(root, "src/service/A.ts", "export const a = 3;\n");
    const want = path.join("src", "service", "A.ts");
    assert.ok(await until(() => seen.includes(want)), seen.join(", "));
  });

  it("le dossier surveillé SUPPRIMÉ entier ne tue pas le superviseur", async () => {
    const root = app();
    const seen: string[] = [];
    const said: string[] = [];
    const w = watchSources(root, ["src", "index.ts"], (f) => seen.push(f));
    watchers.push(w);
    attachWatcherErrorGuard(w, (m) => said.push(m));
    await new Promise((r) => setTimeout(r, 300));
    rmSync(path.join(root, "src"), { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 400));
    // Le reste de la surveillance tient : la racine est toujours vue.
    seen.length = 0;
    put(root, "index.ts", "export const v = 9;\n");
    assert.ok(await until(() => seen.includes("index.ts")), seen.join(", "));
  });

  it("close() coupe la surveillance", async () => {
    const root = app();
    const seen: string[] = [];
    const w = await start(root, seen);
    w.close();
    put(root, "src/service/A.ts", "export const a = 2;\n");
    await new Promise((r) => setTimeout(r, 400));
    assert.deepStrictEqual(seen, []);
  });

  it("une entrée disparue avant l'ouverture est SIGNALÉE, pas fatale", async () => {
    const root = app();
    const said: string[] = [];
    const w = watchSources(root, ["absent", "src"], () => {});
    watchers.push(w);
    attachWatcherErrorGuard(w, (m) => said.push(m));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(said.length, 1, said.join(" | "));
    assert.match(said[0]!, /ENOENT/);
  });
});

describe("DevSupervisor — watchSources (contrat, watcher SIMULÉ)", () => {
  /*
   *   Ce que le disque local ne reproduit pas : un Node antérieur à 24.14 qui
   *   ignore l'option `ignore`, une ouverture qui lève (`EMFILE`, limite
   *   inotify `ENOSPC`), une erreur levée en cours de route (`EPERM` Windows).
   *   Le watcher est injecté : chaque ouverture est enregistrée et pilotable.
   */
  interface IOpened {
    target: string;
    options: { recursive: boolean; ignore?: (filename: string) => boolean };
    fire: (filename: string | null) => void;
    handle: EventEmitter & IWatchHandle;
    closed: number;
  }
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  const layout = () => {
    const root = mkdtempSync(path.join(tmpdir(), "nf-devwatch-sim-"));
    roots.push(root);
    for (const d of ["src", "modules", "nodefony"]) {
      mkdirSync(path.join(root, d));
    }
    for (const f of ["index.ts", "env.ts", "nodefony.config.ts"]) {
      writeFileSync(path.join(root, f), "export {};\n");
    }
    return root;
  };
  /** Fabrique de watchers simulés ; `failOn` fait lever l'ouverture de ce chemin. */
  const simulate = (failOn?: string) => {
    const opened: IOpened[] = [];
    const watchFn: WatchFunction = (target, options, listener) => {
      if (failOn !== undefined && target.endsWith(failOn)) {
        throw Object.assign(new Error("too many open files"), {
          code: "EMFILE",
          path: target,
        });
      }
      const entry: IOpened = {
        target,
        options,
        fire: (filename) => listener("change", filename),
        handle: Object.assign(new EventEmitter(), {
          close: () => {
            entry.closed += 1;
          },
        }),
        closed: 0,
      };
      opened.push(entry);
      return entry.handle;
    };
    return { opened, watchFn };
  };
  const ENTRIES = [
    "src",
    "modules",
    "nodefony",
    "index.ts",
    "env.ts",
    "nodefony.config.ts",
  ];
  const byTarget = (opened: IOpened[], root: string, rel: string) => {
    const hit = opened.find((o) => o.target === path.resolve(root, rel));
    assert.ok(
      hit,
      `aucun watcher sur ${rel} : ${opened.map((o) => o.target).join(", ")}`,
    );
    return hit;
  };

  it("un watcher RÉCURSIF par dossier, UN SEUL non récursif pour les fichiers de la racine", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    watchSources(root, ENTRIES, () => {}, watchFn).close();
    assert.strictEqual(
      opened.length,
      4,
      opened.map((o) => o.target).join(", "),
    );
    for (const d of ["src", "modules", "nodefony"]) {
      const o = byTarget(opened, root, d);
      assert.strictEqual(o.options.recursive, true, d);
      assert.strictEqual(typeof o.options.ignore, "function", d);
    }
    const files = byTarget(opened, root, ".");
    assert.strictEqual(files.options.recursive, false);
    // Un fichier isolé n'a rien à élaguer : pas d'\`ignore\`, qui ne vaut qu'en récursif.
    assert.strictEqual(files.options.ignore, undefined);
  });

  it("l'option ignore ÉLAGUE les dossiers exclus — et seulement eux", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    watchSources(root, ENTRIES, () => {}, watchFn).close();
    const ignore = byTarget(opened, root, "src").options.ignore!;
    for (const d of [
      "node_modules",
      "dist",
      ".git",
      "tests",
      "tmp",
      "var",
      "app/frontend",
    ]) {
      assert.strictEqual(ignore(d), true, d);
    }
    for (const d of [
      "service",
      "packages/@nodefony/frontend",
      "tmpDir.ts",
      "app",
    ]) {
      assert.strictEqual(ignore(d), false, d);
    }
  });

  it("⭐ un Node SANS l'option ignore (avant 24.14) : le filtre de l'événement fait foi", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    const seen: string[] = [];
    const w = watchSources(root, ENTRIES, (f) => seen.push(f), watchFn);
    const src = byTarget(opened, root, "src");
    // Le watcher simulé ne regarde PAS options.ignore : il remonte tout.
    for (const f of [
      "tmp/x.ts",
      "dist/y.ts",
      "node_modules/z/index.ts",
      "service/A.test.ts",
      "tests/helper.ts",
      "app/frontend/main.ts",
      "style.css",
      "service",
    ]) {
      src.fire(f);
    }
    assert.deepStrictEqual(seen, []);
    src.fire(path.join("service", "A.ts"));
    assert.deepStrictEqual(seen, [path.join("src", "service", "A.ts")]);
    w.close();
  });

  it("un événement sans nom de fichier (filename null) est ignoré sans bruit", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    const seen: string[] = [];
    const w = watchSources(root, ENTRIES, (f) => seen.push(f), watchFn);
    for (const o of opened) assert.doesNotThrow(() => o.fire(null));
    assert.deepStrictEqual(seen, []);
    w.close();
  });

  it("le watcher de la racine ne remonte QUE les fichiers demandés", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    const seen: string[] = [];
    const w = watchSources(root, ENTRIES, (f) => seen.push(f), watchFn);
    const files = byTarget(opened, root, ".");
    for (const f of [
      "index.ts.tmp",
      "package.json",
      "other.ts",
      ".index.ts.swp",
      "src",
    ]) {
      files.fire(f);
    }
    assert.deepStrictEqual(seen, []);
    files.fire("index.ts");
    files.fire("env.ts");
    files.fire("nodefony.config.ts");
    assert.deepStrictEqual(seen, ["index.ts", "env.ts", "nodefony.config.ts"]);
    w.close();
  });

  it("un fichier isolé en sous-dossier est surveillé par SON dossier", () => {
    const root = layout();
    mkdirSync(path.join(root, "config"));
    writeFileSync(path.join(root, "config", "app.ts"), "export {};\n");
    const { opened, watchFn } = simulate();
    const seen: string[] = [];
    const w = watchSources(
      root,
      [path.join("config", "app.ts")],
      (f) => seen.push(f),
      watchFn,
    );
    const cfg = byTarget(opened, root, "config");
    assert.strictEqual(cfg.options.recursive, false);
    cfg.fire("app.ts");
    assert.deepStrictEqual(seen, [path.join("config", "app.ts")]);
    w.close();
  });

  it("une ouverture qui LÈVE (EMFILE) est signalée au tick suivant, les autres tiennent", async () => {
    const root = layout();
    const { opened, watchFn } = simulate("modules");
    const said: string[] = [];
    const seen: string[] = [];
    const w = watchSources(root, ENTRIES, (f) => seen.push(f), watchFn);
    attachWatcherErrorGuard(w, (m) => said.push(m));
    assert.strictEqual(
      said.length,
      0,
      "rien ne doit être émis avant le branchement du garde",
    );
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(said.length, 1, said.join(" | "));
    assert.match(said[0]!, /EMFILE/);
    assert.strictEqual(opened.length, 3);
    byTarget(opened, root, "src").fire("A.ts");
    assert.deepStrictEqual(seen, [path.join("src", "A.ts")]);
    w.close();
  });

  it("une erreur levée EN COURS de surveillance est relayée au garde, pas fatale", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    const said: string[] = [];
    const w = watchSources(root, ENTRIES, () => {}, watchFn);
    attachWatcherErrorGuard(w, (m) => said.push(m));
    const err = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
      path: path.join(root, "src"),
    });
    assert.doesNotThrow(() =>
      byTarget(opened, root, "src").handle.emit("error", err),
    );
    assert.strictEqual(said.length, 1);
    assert.match(said[0]!, /EPERM/);
    w.close();
  });

  it("close() ferme CHAQUE watcher, une seule fois, même appelé deux fois", () => {
    const root = layout();
    const { opened, watchFn } = simulate();
    const w = watchSources(root, ENTRIES, () => {}, watchFn);
    w.close();
    w.close();
    assert.deepStrictEqual(
      opened.map((o) => o.closed),
      [1, 1, 1, 1],
    );
  });
});
