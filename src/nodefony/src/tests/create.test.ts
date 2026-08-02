import { assert } from "chai";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import {
  parseCreateArgv,
  runCreateCommand,
  type ICreateRequest,
} from "../cli/create";
import { getScaffoldSpec } from "../cli/scaffold/spec";
import {
  findPackageRoot,
  resolveLocalWorkspaces,
  resolveAnswers,
  linkLocalDeps,
  runScaffold,
  getScaffoldContext,
  findModuleClassAnchor,
} from "../cli/scaffold/engine";
import { ScaffoldWriter, diffLines } from "../cli/scaffold/writer";
import { askMissing } from "../cli/scaffold/interactive";
import { SysExit } from "../cli/sysexits";

const argv = (...words: string[]): string[] => ["node", "nodefony", ...words];

/** Rend le scaffold app dans un dossier de test avec réponses explicites. */
const scaffold = (
  dir: string,
  answers: Record<string, string | boolean>,
  force = false,
) => runScaffold({ type: "app", answers, dir, force }, version);

const readJson = (p: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, string>>;

/**
 * Le CODE d'un fichier, commentaires ôtés.
 *
 * Ce que la règle « identité par `@CurrentUser()`, pas `RequestContext` brut »
 * veut dire : le code généré ne doit pas ENSEIGNER la mauvaise API. Elle ne dit
 * rien des commentaires — et le template en a un légitime, qui montre
 * `RequestContext.getUser()` dans `initialize()` : ce hook est appelé SANS
 * argument (`controller.initialize()`), un décorateur de paramètre n'y est donc
 * pas injectable. Une assertion posée sur le fichier entier confondait les deux
 * et tombait sur un commentaire juste.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "") // blocs
    .replace(/(^|[^:])\/\/.*$/gmu, "$1"); // lignes (hors `://` d'une URL)
}

/**
 * Empreinte COMPLÈTE d'une arborescence : chemin relatif → contenu.
 *
 * Sert les contrôles « aucun geste partiel » : comparer l'empreinte avant et
 * après un scaffold qui refuse prouve à la fois qu'aucun fichier n'a été
 * ajouté ET qu'aucun n'a été réécrit — ce qu'un `assert.throws` seul ne dit
 * pas (un moteur peut parfaitement écrire cinq fichiers puis lever).
 */
function snapshotTree(dir: string): Map<string, string> {
  const snap = new Map<string, string>();
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    snap.set(path.relative(dir, abs), readFileSync(abs, "utf8"));
  }
  return snap;
}

/** L'arborescence est restée octet pour octet celle de `before`. */
function assertTreeUnchanged(before: Map<string, string>, dir: string): void {
  const after = snapshotTree(dir);
  const added = [...after.keys()].filter((f) => !before.has(f));
  assert.deepEqual(added, [], "fichiers écrits malgré le refus");
  const removed = [...before.keys()].filter((f) => !after.has(f));
  assert.deepEqual(removed, [], "fichiers supprimés malgré le refus");
  for (const [file, content] of before) {
    assert.equal(after.get(file), content, `${file} réécrit malgré le refus`);
  }
}

/** Aucun résidu de template dans le rendu (tag eta oublié = projet corrompu). */
function assertNoEtaResidue(dest: string): void {
  for (const entry of readdirSync(dest, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      const content = readFileSync(
        path.join(entry.parentPath, entry.name),
        "utf8",
      );
      assert.notInclude(content, "<%", `tag eta résiduel dans ${entry.name}`);
      // Eta AVALE le saut de ligne qui suit un tag placé en FIN de ligne : la
      // ligne suivante se recolle à la précédente. Le rendu reste valide (aucun
      // résidu `<%`), mais le fichier part avec un TSDoc recousu ou un type
      // coupé en deux. Le contrôle vivait sur deux scaffolds seulement — et le
      // défaut est réapparu ailleurs le jour où un troisième gabarit a rendu la
      // même forme. Il est donc ici, avec le contrôle frère : un rendu eta se
      // vérifie au même endroit, quel que soit le scaffold.
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        assert.notMatch(
          content,
          /^ \*.*\S \*$/mu,
          `ligne de TSDoc recollée dans ${entry.name} — tag eta en fin de ligne`,
        );
      }
    }
  }
}

describe("nodefony create — scaffold 3 fronts (spec + moteur + CLI)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "nf-create-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("parseCreateArgv (adaptateur argv)", () => {
    it("parse type/name + défauts (answers partielles vides)", () => {
      const req = parseCreateArgv(argv("create", "app", "mon-app"));
      assert.deepEqual(req, {
        type: "app",
        answers: { name: "mon-app" },
        dir: undefined,
        force: false,
        yes: false,
        install: true,
        git: true,
        dryRun: false,
        describeJson: false,
        answersJson: undefined,
      });
    });

    it("flags → answers : --preset --frontend --link/--no-link --yes --dir", () => {
      const req = parseCreateArgv(
        argv(
          "create",
          "app",
          "x",
          "--preset",
          "minimal",
          "--frontend",
          "react",
          "--no-link",
          "--yes",
          "--dir",
          "a/b",
          "--force",
          "--no-install",
          "--no-git",
        ),
      );
      assert.deepEqual(req, {
        type: "app",
        answers: {
          name: "x",
          preset: "minimal",
          frontend: "react",
          link: false,
        },
        dir: "a/b",
        force: true,
        yes: true,
        install: false,
        git: false,
        dryRun: false,
        describeJson: false,
        answersJson: undefined,
      });
    });

    it("--dry-run / -n : simulation demandée", () => {
      const long = parseCreateArgv(argv("create", "app", "x", "--dry-run"));
      const short = parseCreateArgv(argv("create", "app", "x", "-n"));
      assert.isTrue((long as ICreateRequest).dryRun);
      assert.isTrue((short as ICreateRequest).dryRun);
    });

    it("type inconnu / option inconnue → error", () => {
      assert.property(parseCreateArgv(argv("create", "plugin", "x")), "error");
      assert.property(
        parseCreateArgv(argv("create", "app", "ok", "--nope")),
        "error",
      );
    });
  });

  describe("spec déclarative (contrat des 3 fronts)", () => {
    it("JSON-able : survit à un round-trip JSON sans perte", () => {
      const spec = getScaffoldSpec();
      const round = JSON.parse(JSON.stringify(spec)) as typeof spec;
      assert.deepEqual(round, spec);
      assert.equal(spec[0].type, "app");
      assert.isAtLeast(spec[0].questions.length, 4);
    });

    it("resolveAnswers : défauts, pattern, choix, askIf", () => {
      const [spec] = getScaffoldSpec("app");
      const caps = { hasCheckout: false };
      const ok = resolveAnswers(spec, { name: "mon-app" }, caps);
      assert.equal(ok.preset, "complete");
      assert.equal(ok.frontend, "none");
      assert.equal(ok.link, false); // askIf hasCheckout=false → forcé false
      assert.throws(
        () => resolveAnswers(spec, { name: "Bad_Name" }, caps),
        /kebab-case/,
      );
      assert.throws(
        () => resolveAnswers(spec, { name: "x", preset: "big" }, caps),
        /preset invalide/,
      );
      assert.throws(
        () => resolveAnswers(spec, { name: "x", frontend: "svelte" }, caps),
        /frontend invalide/,
      );
    });
  });

  describe("moteur — preset complete", () => {
    it("vitrine complète : infra docker + toutes les briques, zéro résidu", () => {
      const dest = path.join(tmp, "full");
      const r = scaffold(dest, { name: "full" });
      for (const f of [
        "package.json",
        "tsconfig.json",
        "rolldown.config.ts",
        "env.ts",
        "nodefony.config.ts",
        "index.ts",
        ".gitignore",
        "README.md",
        "compose.yaml",
        ".oxlintrc.json",
        "vitest.config.ts",
        path.join("nodefony", "controllers", "HelloController.ts"),
        path.join("tests", "config.test.ts"),
        path.join("tests", "e2e.test.ts"),
        path.join(
          "docker",
          "grafana",
          "provisioning",
          "datasources",
          "loki.yaml",
        ),
        ".env",
        ".env.local",
        path.join("nodefony", "security", "provisionUsers.ts"),
      ]) {
        assert.isTrue(existsSync(path.join(dest, f)), `manque ${f}`);
      }
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], `^${version}`);
      assert.property(pkg["dependencies"], "@nodefony/drizzle");
      // Le hachage de mot de passe est un chemin PAR DÉFAUT (argon2id, RFC
      // 9106) et le provisionnement seede un compte au boot. `@nodefony/user`
      // déclare le binding en peer OPTIONNELLE — pour la bibliothèque, pas pour
      // l'application. Sans cette dépendance, une app générée démarre en
      // développement et meurt en production sur `Cannot find package
      // '@node-rs/argon2'` : trouvé par un agent tiers, jamais par nos tests,
      // parce qu'aucun d'eux ne démarrait l'app en production.
      assert.property(pkg["dependencies"], "@node-rs/argon2");
      assert.property(pkg["scripts"], "infra:up");
      // Sans front, le build reste back seul (pas de frontend:build fantôme).
      assert.notInclude(pkg["scripts"]["build"], "frontend:build");
      assertNoEtaResidue(dest);
      assert.isEmpty(r.linked);
    });

    it("temps réel de l'app : LiveController délégué au gabarit realtime, câblé, prouvé par l'e2e", () => {
      const dest = path.join(tmp, "livefull");
      scaffold(dest, { name: "livefull" });
      const live = readFileSync(
        path.join(dest, "nodefony", "controllers", "LiveController.ts"),
        "utf8",
      );
      // Le MÊME gabarit que `create controller --kind realtime` (délégation,
      // zéro copie propre à l'app — corriger le gabarit corrige les deux).
      assert.include(live, "extends RealtimeController");
      assert.include(live, '@RealtimeChannel("live:ticker")');
      // Policy INLINE visible : l'ouverture d'une action est un choix ÉCRIT,
      // la protection par rôle est démontrée à côté.
      assert.include(
        live,
        '@RealtimeAction("live:ping", { authenticated: false })',
      );
      assert.include(
        live,
        '@RealtimeAction("live:snapshot", { roles: ["ROLE_ADMIN"] })',
      );
      // Les décorateurs annoncent déjà canaux et actions au welcome : un
      // override les ferait apparaître en DOUBLE (doublon vécu).
      assert.notInclude(live, "realtimeChannels()");
      assert.notInclude(live, "realtimeActions()");
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, "LiveController");
      // La sonde FONCTIONNELLE vit dans l'e2e généré : la MÊME façade que les
      // vitrines navigateur, côté Node (`nodefony/client`).
      const e2e = readFileSync(path.join(dest, "tests", "e2e.test.ts"), "utf8");
      assert.include(e2e, 'from "nodefony/client"');
      assert.include(e2e, 'live.request("live:ping"');
      assert.include(e2e, 'live.subscribe("live:ticker")');
    });

    it("secrets PAR-PROJET : .env.local porte 3 clés uniques, .gitignore les exclut", () => {
      const dest = path.join(tmp, "sec");
      scaffold(dest, { name: "sec" });
      const local = readFileSync(path.join(dest, ".env.local"), "utf8");
      const keys = ["NF_TOTP_KEY", "NF_WEBHOOK_KEY", "NF_CSRF_SECRET"];
      const values: string[] = [];
      for (const k of keys) {
        const m = local.match(new RegExp(`^${k}=(.+)$`, "m"));
        assert.isNotNull(m, `clé ${k} absente de .env.local`);
        // 32 octets base64 = 44 caractères — le format AES-256-GCM attendu.
        assert.lengthOf((m as RegExpMatchArray)[1], 44);
        values.push((m as RegExpMatchArray)[1]);
      }
      assert.lengthOf(new Set(values), 3, "les 3 clés doivent être distinctes");
      // Deux apps générées ne partagent JAMAIS une clé (aléatoire par projet).
      const dest2 = path.join(tmp, "sec2");
      scaffold(dest2, { name: "sec2" });
      const local2 = readFileSync(path.join(dest2, ".env.local"), "utf8");
      assert.notInclude(local2, values[0]);
      // Le .env COMMITÉ ne porte AUCUNE valeur de secret ; le .gitignore exclut *.local.
      const dotenv = readFileSync(path.join(dest, ".env"), "utf8");
      for (const v of values) assert.notInclude(dotenv, v);
      assert.include(
        readFileSync(path.join(dest, ".gitignore"), "utf8"),
        "*.local",
      );
    });

    it("provisionUsers câblé : hook onKernelReady + seed admin + rôles Studio", () => {
      const dest = path.join(tmp, "prov");
      scaffold(dest, { name: "prov" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, "provisionUsers(this)");
      assert.include(index, "onKernelReady");
      const prov = readFileSync(
        path.join(dest, "nodefony", "security", "provisionUsers.ts"),
        "utf8",
      );
      assert.include(prov, "NF_ADMIN_PASSWORD");
      assert.include(prov, "ROLE_NODEFONY_ADMIN");
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(config, "roleHierarchy");
      assert.include(config, "NF_CSRF_SECRET");
    });
  });

  /**
   * L'outillage de développement arrive AVEC l'application, dans les deux
   * presets — mais jamais en production.
   *
   * Les deux moitiés comptent, et séparément : en `devDependencies` pour qu'un
   * `npm ci --omit=dev` ne l'installe pas, et `policy: "dev"` pour qu'un
   * déploiement qui installerait tout ne le charge pas quand même. Personne
   * n'apprend un verbe absent : s'il fallait l'ajouter à la main, il n'existerait
   * pour personne.
   */
  describe("devkit — l'outillage de dev naît avec l'app, et pas en prod", () => {
    for (const preset of ["complete", "minimal"]) {
      it(`preset ${preset} : devDependency + policy dev au manifeste`, () => {
        const dest = path.join(tmp, `dk-${preset}`);
        scaffold(dest, { name: `dk${preset}`, preset, frontend: "none" });
        const pkg = readJson(path.join(dest, "package.json"));
        assert.property(
          pkg["devDependencies"] as unknown as Record<string, string>,
          "@nodefony/devkit",
        );
        // …et SURTOUT pas en dependencies : ce serait installé en production.
        assert.notProperty(
          pkg["dependencies"] as unknown as Record<string, string>,
          "@nodefony/devkit",
        );
        const config = readFileSync(
          path.join(dest, "nodefony.config.ts"),
          "utf8",
        );
        assert.include(
          config.replace(/\s+/gu, " "),
          'use("@nodefony/devkit", {}, { policy: "dev" })',
        );
      });
    }
  });

  describe("moteur — preset minimal", () => {
    it("base saine : http+framework seuls, PAS d'infra docker", () => {
      const dest = path.join(tmp, "mini");
      scaffold(dest, { name: "mini", preset: "minimal" });
      assert.isFalse(existsSync(path.join(dest, "compose.yaml")));
      assert.isFalse(existsSync(path.join(dest, "docker")));
      // Pas de security en minimal → ni secrets ni provisioning utilisateurs.
      assert.isFalse(existsSync(path.join(dest, ".env.local")));
      assert.isFalse(existsSync(path.join(dest, "nodefony", "security")));
      const pkg = readJson(path.join(dest, "package.json"));
      assert.notProperty(pkg["dependencies"], "@nodefony/drizzle");
      assert.notProperty(pkg["dependencies"], "@nodefony/studio");
      assert.notProperty(pkg["scripts"], "infra:up");
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.notInclude(config, "@nodefony/security");
      assert.include(config, "@nodefony/http");
      // Sans @nodefony/realtime, pas de controller realtime de vitrine.
      assert.isFalse(
        existsSync(
          path.join(dest, "nodefony", "controllers", "LiveController.ts"),
        ),
      );
      assertNoEtaResidue(dest);
    });
  });

  describe("controller d'accueil — un seul gabarit pour l'app et la commande", () => {
    /** Le HelloController rendu par `create app`, tel quel. */
    const helloOf = (dest: string) =>
      readFileSync(
        path.join(dest, "nodefony", "controllers", "HelloController.ts"),
        "utf8",
      );

    it("l'app garde /api/hello et son payload (README, e2e et vitrines en dépendent)", () => {
      const dest = path.join(tmp, "happ");
      scaffold(dest, { name: "happ", preset: "complete", frontend: "none" });
      const src = helloOf(dest);
      assert.include(src, '@controller("/api")');
      assert.include(src, 'path: "/hello"');
      assert.include(src, 'hello: "happ"');
      // Route protégée : seulement quand une zone `secure` existe (preset complete).
      assert.include(src, 'path: "/secure/hello"');
      // Le test e2e généré interroge cette route et compare ce payload : les
      // deux templates doivent rester d'accord.
      const e2e = readFileSync(path.join(dest, "tests", "e2e.test.ts"), "utf8");
      assert.include(e2e, "/api/hello");
      assert.include(e2e, 'expect(body.hello).toBe("happ")');
      assertNoEtaResidue(dest);
    });

    it("sans security, aucune route protégée n'est promise", () => {
      const dest = path.join(tmp, "hmini");
      scaffold(dest, { name: "hmini", preset: "minimal", frontend: "none" });
      const src = helloOf(dest);
      assert.include(src, 'path: "/hello"');
      assert.notInclude(src, "/secure/hello");
      assert.notInclude(src, 'zone: "secure"');
    });

    it("create controller --kind hello : index à la racine de SON préfixe, pas de route protégée", () => {
      const dest = path.join(tmp, "hctrl");
      scaffold(dest, { name: "hctrl", preset: "complete", frontend: "none" });
      runScaffold(
        {
          type: "controller",
          answers: { name: "blog", kind: "hello" },
          dir: dest,
          force: false,
        },
        version,
      );
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "BlogController.ts"),
        "utf8",
      );
      assert.include(src, '@controller("/api/blog")');
      assert.include(src, 'path: ""');
      // La zone `secure` du manifeste ne couvre PAS /api/blog/secure/… :
      // générer la route ici enseignerait une protection qui n'existe pas.
      assert.notInclude(src, "/secure/hello");
      assert.include(src, 'hello: "blog"');
      // L'echo brut porte sa REDIRECTION : démo du pipeline, pas un modèle —
      // le WS métier a sa couche (`--kind realtime`).
      assert.include(src, "--kind realtime");
    });
  });

  describe("moteur — choix frontend", () => {
    it("react : entry tsx + AppController + registerEntry + deps + jsx", () => {
      const dest = path.join(tmp, "rapp");
      scaffold(dest, { name: "rapp", preset: "minimal", frontend: "react" });
      assert.isTrue(existsSync(path.join(dest, "frontend", "src", "main.tsx")));
      assert.isTrue(existsSync(path.join(dest, "frontend", "src", "App.tsx")));
      // Coquille HTML de l'app (renderDocument y injecte les tags au marqueur).
      const shell = readFileSync(
        path.join(dest, "frontend", "index.html"),
        "utf8",
      );
      assert.include(shell, "<!--nodefony:frontend-->");
      assert.include(shell, '<div id="root"></div>');
      assert.isTrue(
        existsSync(
          path.join(dest, "nodefony", "controllers", "AppController.ts"),
        ),
      );
      const pkg = readJson(path.join(dest, "package.json"));
      assert.property(pkg["dependencies"], "react");
      assert.property(pkg["dependencies"], "@nodefony/frontend");
      assert.property(pkg["devDependencies"], "@vitejs/plugin-react");
      // `npm run build` produit l'app ENTIÈRE : back (rolldown) + front (vite
      // → public/dist). Sans ce chaînage, `npm start` servait une page blanche
      // (vécu) — l'utilisateur n'a qu'UN geste de build à connaître.
      assert.include(pkg["scripts"]["build"], "nodefony frontend:build");
      // L'entry se déclare dans le fichier PARTAGÉ avec `create front` — pas
      // inlinée dans l'index : l'app et un module écrivent le même geste.
      const registrar = readFileSync(
        path.join(dest, "nodefony", "frontend", "registerRappEntry.ts"),
        "utf8",
      );
      assert.include(registrar, 'type: "react19"');
      assert.include(registrar, "apiProxyPaths");
      assert.include(registrar, 'name: "rapp"');
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, "registerRappEntry(this);");
      assert.notInclude(index, "registerEntry(this, {");
      const tsconfig = readFileSync(path.join(dest, "tsconfig.json"), "utf8");
      assert.include(tsconfig, "react-jsx");
      // Minimal (pas de realtime) : l'echo BRUT reste — mais il porte sa
      // redirection vers la bonne couche, et n'importe pas la façade.
      const app = readFileSync(
        path.join(dest, "frontend", "src", "App.tsx"),
        "utf8",
      );
      assert.include(app, "new WebSocket(");
      assert.include(app, "--kind realtime");
      // Le NOM de la façade reste cité par la redirection (commentaire) — on
      // vérifie l'absence d'USAGE, pas du mot (même règle que la vitrine
      // example dégradée).
      assert.notInclude(app, "import { RealtimeClient }");
      assert.notInclude(app, "NodefonyProvider");
      assertNoEtaResidue(dest);
    });

    it("vitrines complete : la carte temps réel passe par la FAÇADE, plus aucun ws à la main", () => {
      // React — hooks `nodefony/react` (Provider + état + canal).
      const rdest = path.join(tmp, "rlive");
      scaffold(rdest, { name: "rlive", preset: "complete", frontend: "react" });
      const rapp = readFileSync(
        path.join(rdest, "frontend", "src", "App.tsx"),
        "utf8",
      );
      assert.include(
        rapp,
        'RealtimeClient.shared({ url: "/api/live/realtime" })',
      );
      assert.include(rapp, "NodefonyProvider");
      assert.include(rapp, "useNodefonyState()");
      assert.include(rapp, 'useNodefonyChannelData<Tick>("live:ticker")');
      assert.include(rapp, 'live.request("live:ping"');
      assert.notInclude(rapp, "new WebSocket(");
      // Vue et Angular — pas de bindings dédiés : la façade RealtimeClient.
      const vdest = path.join(tmp, "vlive");
      scaffold(vdest, { name: "vlive", preset: "complete", frontend: "vue" });
      const vapp = readFileSync(
        path.join(vdest, "frontend", "src", "App.vue"),
        "utf8",
      );
      assert.include(
        vapp,
        'RealtimeClient.shared({ url: "/api/live/realtime" })',
      );
      assert.include(vapp, 'live.on("live:ticker"');
      assert.include(vapp, 'live.subscribe("live:ticker")');
      assert.notInclude(vapp, "new WebSocket(");
      const adest = path.join(tmp, "alive");
      scaffold(adest, {
        name: "alive",
        preset: "complete",
        frontend: "angular",
      });
      const aapp = readFileSync(
        path.join(adest, "frontend", "src", "app", "app.component.ts"),
        "utf8",
      );
      assert.include(
        aapp,
        'RealtimeClient.shared({ url: "/api/live/realtime" })',
      );
      assert.include(aapp, 'live.on("live:ticker"');
      assert.notInclude(aapp, "new WebSocket(");
    });

    it("vue : SFC + plugin ; angular : composant + tsconfig.app.json", () => {
      const vdest = path.join(tmp, "vapp");
      scaffold(vdest, { name: "vapp", frontend: "vue" });
      assert.isTrue(existsSync(path.join(vdest, "frontend", "src", "App.vue")));
      const vpkg = readJson(path.join(vdest, "package.json"));
      assert.property(vpkg["dependencies"], "vue");
      assert.include(
        readFileSync(
          path.join(vdest, "nodefony", "frontend", "registerVappEntry.ts"),
          "utf8",
        ),
        'type: "vue3"',
      );

      const adest = path.join(tmp, "aapp");
      scaffold(adest, { name: "aapp", frontend: "angular" });
      assert.isTrue(
        existsSync(
          path.join(adest, "frontend", "src", "app", "app.component.ts"),
        ),
      );
      assert.isTrue(
        existsSync(path.join(adest, "frontend", "tsconfig.app.json")),
      );
      const apkg = readJson(path.join(adest, "package.json"));
      assert.property(apkg["devDependencies"], "@analogjs/vite-plugin-angular");
      assertNoEtaResidue(adest);
    });

    it("la feuille de style de la vitrine est PARTAGÉE, l'accent seul est local", () => {
      // Le CSS de démonstration existait en trois copies (mise en page, palette,
      // composants), dont seule la couleur du framework différait. La feuille
      // est désormais unique ; ce test vérifie les deux moitiés du contrat :
      // (a) la feuille est bien la même partout, (b) chaque accent définit
      // TOUTES les variables qu'elle consomme — sinon la page part sans son
      // logo animé et sans badge, silencieusement.
      const rendered = new Map<string, { showcase: string; accent: string }>();
      for (const fw of ["react", "vue", "angular"]) {
        const dest = path.join(tmp, `css-${fw}`);
        scaffold(dest, { name: `css-${fw}`, preset: "minimal", frontend: fw });
        const src = path.join(dest, "frontend", "src");
        rendered.set(fw, {
          showcase: readFileSync(path.join(src, "showcase.css"), "utf8"),
          accent: readFileSync(path.join(src, "accent.css"), "utf8"),
        });
      }
      const [first, ...others] = [...rendered.values()];
      for (const other of others) {
        assert.equal(other.showcase, first.showcase, "la feuille a divergé");
      }
      const used = new Set(
        [...first.showcase.matchAll(/var\((--nf-[\w-]+)\)/gu)].map((m) => m[1]),
      );
      // Les variables de palette sont définies par la feuille elle-même ; ne
      // restent à la charge de l'accent que celles qui portent la couleur.
      const fromAccent = [...used].filter(
        (v) => !first.showcase.includes(`${v}:`),
      );
      assert.isNotEmpty(
        fromAccent,
        "aucune variable d'accent — test inopérant",
      );
      for (const [fw, { accent }] of rendered) {
        for (const variable of fromAccent) {
          assert.include(
            accent,
            `${variable}:`,
            `${fw} ne définit pas ${variable}`,
          );
        }
        // L'animation nommée par la variable doit exister LÀ où elle est posée
        // (un `@keyframes` déclaré dans les styles d'un composant Angular est
        // renommé par l'encapsulation — l'animation serait introuvable).
        const anim = /--nf-logo-anim:\s*([\w-]+)/u.exec(accent)?.[1];
        assert.isString(anim, `${fw} : animation du logo non nommée`);
        assert.include(
          accent,
          `@keyframes ${anim}`,
          `${fw} : ${anim} non déclarée`,
        );
      }
    });

    it("ce que le front importe et que TypeScript ignore est DÉCLARÉ", () => {
      // Un `import "./showcase.css"` se construit et s'affiche parfaitement,
      // mais fait échouer le `npm run typecheck` de l'app générée (TS2882) tant
      // que `vite/client` n'est pas dans `types` — une app livrée avec un gate
      // rouge d'emblée. Le contrôle est posé sur la RÈGLE, pas sur le CSS :
      // ajouter demain un import d'image le fera tomber aussi.
      for (const fw of ["react", "vue", "angular"]) {
        const dest = path.join(tmp, `decl-${fw}`);
        scaffold(dest, { name: `decl-${fw}`, preset: "minimal", frontend: fw });
        const imports: string[] = [];
        for (const entry of readdirSync(path.join(dest, "frontend", "src"), {
          recursive: true,
          withFileTypes: true,
        })) {
          if (!entry.isFile() || !/\.(ts|tsx|vue)$/u.test(entry.name)) continue;
          const src = readFileSync(
            path.join(entry.parentPath, entry.name),
            "utf8",
          );
          for (const m of src.matchAll(
            /from\s+"([^"]+)"|import\s+"([^"]+)"/gu,
          )) {
            const spec = m[1] ?? m[2];
            // Un specifier relatif portant une extension que tsc ne compile pas.
            if (
              /^\.{1,2}\//u.test(spec) &&
              /\.\w+$/u.test(spec) &&
              !/\.(ts|tsx)$/u.test(spec)
            ) {
              imports.push(spec);
            }
          }
        }
        if (imports.length === 0) continue;
        const tsconfig = readFileSync(path.join(dest, "tsconfig.json"), "utf8");
        assert.include(
          tsconfig,
          "vite/client",
          `${fw} importe ${imports.join(", ")} sans déclaration de type`,
        );
      }
    });

    it("none : aucun fichier frontend, pas d'AppController", () => {
      const dest = path.join(tmp, "napp");
      scaffold(dest, { name: "napp" });
      assert.isFalse(existsSync(path.join(dest, "frontend")));
      assert.isFalse(
        existsSync(
          path.join(dest, "nodefony", "controllers", "AppController.ts"),
        ),
      );
    });
  });

  describe("AGENTS.md — l'app naît parlante pour un agent", () => {
    it("app : AGENTS.md (devise + générateurs + gates + zone notes) + CLAUDE.md pointeur", () => {
      const dest = path.join(tmp, "agents");
      scaffold(dest, { name: "agents", preset: "complete", frontend: "none" });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      // La devise ouvre le fichier — LA règle que l'agent doit retenir.
      assert.include(
        agents.split("\n").slice(0, 4).join("\n"),
        "N'invente jamais du code Nodefony",
      );
      // Inventaire des générateurs + front machine : l'agent APPELLE le
      // scaffold comme un outil au lieu d'imiter des fichiers de mémoire.
      for (const needle of [
        "nodefony create module",
        "nodefony create entity",
        "--describe-json",
        "--answers-json",
        "--dry-run",
        "npm run typecheck",
        "<!-- app-notes:start -->",
        "<!-- app-notes:end -->",
        // Les verbes qui répondent SANS boot : ce sont les seuls utilisables au
        // moment où l'agent arrive (rien n'est construit) ou quand plus rien ne
        // démarre. Une capacité absente d'ici est une capacité ABSENTE : le banc
        // a mesuré que ce fichier est le canal qui déplace un agent, là où le
        // TSDoc et la doc ne le déplacent pas.
        "nodefony card",
        "nodefony symbols",
      ]) {
        assert.include(agents, needle, `AGENTS.md sans « ${needle} »`);
      }
      // Preset complete → les docs des briques embarquées sont pointées.
      assert.include(agents, "@nodefony/security/docs");
      assert.include(agents, "@nodefony/realtime/docs");
      // ── Les renvois de doc EXISTENT-ILS ? ────────────────────────────────
      // Toute la découvrabilité tient à cette table : l'agent ne CHERCHE pas la
      // doc, il lit les chemins qu'on lui donne. Une page renommée, et
      // l'AGENTS.md pointe dans le vide — sans un mot, puisqu'aucun lien
      // markdown ne se casse ici (ce sont des chemins en code inline).
      // On confronte donc chaque renvoi au monorepo, d'où provient ce que npm
      // publiera (`docs` est dans les `files` des 13 paquets — le catalogue en
      // porte le gate).
      const repoRoot = path.resolve(findPackageRoot(), "..", "..");
      const resolveRenvoi = (cited: string): string => {
        const rest = cited.replace(/^node_modules\//u, "");
        return rest.startsWith("@nodefony/")
          ? path.join(repoRoot, "src", "packages", rest)
          : path.join(repoRoot, "src", rest);
      };
      const renvois = [
        ...new Set(
          [...agents.matchAll(/node_modules\/[@\w./-]+/gu)].map((m) =>
            m[0].replace(/[.,)]+$/u, ""),
          ),
        ),
      ];
      assert.isAtLeast(renvois.length, 5, "table tâche→doc vide ou non captée");
      const morts = renvois.filter((r) => !existsSync(resolveRenvoi(r)));
      assert.deepEqual(
        morts,
        [],
        `renvois de doc morts dans l'AGENTS.md généré (l'agent y sera envoyé pour rien) :\n${morts.join("\n")}`,
      );
      // Cycle de vie du serveur : démarrer ne suffit pas, il faut ARRÊTER. Un
      // serveur laissé derrière garde les ports, et le run suivant échoue sur
      // une erreur qui ne parle jamais de lui.
      for (const needle of [
        "npm run dev",
        "nodefony status",
        "nodefony stop",
        "--detach --wait",
      ]) {
        assert.include(agents, needle, `AGENTS.md sans « ${needle} »`);
      }
      // Interroger l'app plutôt que déduire de ses sources : une route dépend de
      // décorateurs, d'un manifeste et d'un ordre de chargement.
      assert.include(agents, "nodefony inspect routes --json");
      assert.include(agents, "nodefony inspect config --json");
      // POINTER `inspect` ne suffit pas — mesuré au banc : la tâche l'a lancé
      // CINQ fois et a quand même rendu le compte de ses propres sources (13
      // routes au lieu des 124 montées). Deux repères manquaient, donc deux
      // gates : l'écart d'un ordre de grandeur est NORMAL (les modules
      // installés montent l'essentiel), et un outil qui résiste se RÉPARE — le
      // repli sur les fichiers rend une réponse d'allure normale à une autre
      // question que celle posée.
      assert.include(agents, "ENGLOBE tes sources");
      assert.include(agents, "écart d'un ordre de grandeur");
      assert.include(agents, "ne te rabats pas sur les sources");
      // Où sont les CLÉS de config d'un module — le pointage qui manquait.
      assert.include(agents, "dist/nodefony/config/config.js");
      // Les 3 savoirs fondamentaux que tout agent doit avoir AVANT d'écrire :
      // le cœur est ISOMORPHE (jamais un client WS/type dupliqué à la main),
      // le container DI est PROTOTYPAL (scopes par héritage, zéro copie),
      // et un SERVICE n'est pas une classe utilitaire — mesuré au banc : sans
      // ce repère, l'agent écrit une classe à méthodes `static`, qui compile,
      // qui marche, et qui reste invisible au conteneur.
      // ⚠️ Ancrer sur la PHRASE et sur le couple `@injectable`/`extends
      // Service`, jamais sur le mot « service » seul : il apparaît dans dix
      // phrases voisines, donc un gate posé dessus resterait vert une fois la
      // règle retirée (le piège déjà rencontré plus bas avec `@IsGranted`).
      assert.include(agents, "ISOMORPHE");
      assert.include(agents, "PROTOTYPAL");
      assert.include(agents, "Un service n'est pas une classe utilitaire");
      assert.include(agents, "`@injectable()` qui `extends Service`");
      assert.include(agents, "nodefony create service");
      assert.include(agents, "nodefony/docs/client.md");
      assert.include(agents, "nodefony/docs/service.md");
      // Grammaire des champs : le défaut et l'énumération manquaient à l'appel.
      // Mesuré au banc avec un agent TIERS (`vibe`) : faute de les voir, il a
      // INVENTÉ un flag `--default "price:0"` (refusé, exit 64) et écrit
      // `status:enum:draft,published` — deux tours perdus pour une grammaire
      // que le générateur sait lire depuis S4. Ancrer sur l'EXEMPLE, pas sur le
      // mot « enum » : il apparaît dans la phrase d'explication juste après.
      assert.include(agents, "views:int=0");
      assert.include(agents, "status:enum(draft,published)");
      // Le 409 : la capacité existe (le rendu d'erreur mappe les codes pilote),
      // mais RIEN ne le disait — même banc, même agent : il a réécrit un
      // `throw new HttpError(…, 409)` dans le service généré, avec son TSDoc.
      // Une capacité que l'app n'ANNONCE pas est une capacité absente.
      assert.include(agents, "sont DÉJÀ traduites en HTTP");
      assert.include(agents, "SQLITE_CONSTRAINT_UNIQUE");
      // Toute commande MONTRÉE se préfixe `npx` : le binaire n'est pas dans le
      // PATH d'une app, et un agent tape ce qu'on lui montre. Mesuré au banc :
      // le gabarit portait 39 formes nues contre 2 préfixées ; l'agent a suivi
      // la majorité, s'est pris un 127 et a brûlé deux tours à chercher où
      // vivait le binaire. Ce n'était pas son réflexe — c'était notre exemple.
      const nues = [...agents.matchAll(/`nodefony [a-z]/gu)];
      assert.equal(
        nues.length,
        0,
        `commandes montrées sans « npx » (${nues.length}) — l'agent les copiera telles quelles`,
      );
      // Utilisateurs et droits : sans ces repères, un agent réinvente un lecteur
      // de session, teste l'appartenance à un rôle à la main, ou insère un
      // utilisateur en base sans passer par l'encodeur de mot de passe. Les
      // quatre gestes sont NOMMÉS, et leur doc installée est pointée.
      // ⚠️ Chercher `@IsGranted` ne prouverait RIEN : le nom apparaît dans
      // plusieurs phrases voisines, donc retirer le geste laisserait le gate au
      // vert (vécu en écrivant ce test). On ancre sur des marqueurs PROPRES à
      // chaque geste — un par ligne de la section.
      for (const needle of [
        "Utilisateurs et droits : tout existe",
        '`@IsGranted("ROLE_ADMIN")` sur la',
        "lire l'utilisateur courant** : le paramètre décoré `@CurrentUser()`",
        "la clé `roleHierarchy`",
        "`npx nodefony security:user:add <identifiant>`",
        "s'enregistre par\n    `registerVoterFactory`",
        "@nodefony/security/docs/authorization.md",
        "@nodefony/user/docs/index.md",
      ]) {
        assert.include(agents, needle, `AGENTS.md sans « ${needle} »`);
      }
      // Aucun module encore : l'état vide DIT quoi faire.
      assert.include(agents, "Aucun — `npx nodefony create module");
      // CLAUDE.md = pointeur + les QUATRE réflexes (auto-chargé à chaque tour
      // par l'outil agent, contrairement à AGENTS.md — mesuré au banc : la
      // règle doit vivre dans le contexte au moment d'ÉCRIRE). Reste court.
      //
      // Il n'ÉNUMÈRE PLUS les générateurs : la liste avait dérivé (`create
      // command` manquait), et l'agent qui ne l'y trouvait pas écrivait à la
      // main. On vérifie donc ce qui ne peut pas se périmer — le renvoi à
      // `create --help` et les CHEMINS interdits d'écriture manuelle.
      const claude = readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
      assert.include(claude, "AGENTS.md");
      assert.include(claude, "nodefony create --help");
      assert.include(claude, "nodefony/command/");
      assert.include(claude, "nodefony env");
      assert.include(claude, "nodefony stop");
      assert.include(claude, "isomorphe");
      assert.include(claude, "RealtimeClient");
      assert.isBelow(claude.split("\n").length, 40);
    });

    it("minimal : la table des docs dit la vérité des briques réellement installées", () => {
      const dest = path.join(tmp, "amin");
      scaffold(dest, { name: "amin", preset: "minimal", frontend: "none" });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      // Pointer une doc non installée serait un mensonge — le trou n°1 du kit.
      assert.notInclude(agents, "@nodefony/security/docs");
      assert.notInclude(agents, "@nodefony/orm-core/docs");
      // …et les gestes d'autorisation non plus : une app sans module de sécurité
      // n'a ni `@IsGranted` ni `security:user:add`. Promettre un décorateur qui
      // n'existe pas ici enverrait l'agent droit dans une erreur d'import.
      assert.notInclude(agents, "Utilisateurs et droits");
      assert.notInclude(agents, "security:user:add");
      assert.include(agents, "@nodefony/framework/docs");
    });

    it("régénération BORNÉE : create module réécrit l'inventaire, préserve notes et CLAUDE.md", () => {
      const dest = path.join(tmp, "regen");
      scaffold(dest, { name: "regen", preset: "complete", frontend: "none" });
      // L'humain/agent accumule ses leçons dans la zone préservée…
      const agentsPath = path.join(dest, "AGENTS.md");
      writeFileSync(
        agentsPath,
        readFileSync(agentsPath, "utf8").replace(
          /_\(vide[^\n]*\n/u,
          "- leçon locale : toujours frapper /api/hello après un boot\n",
        ),
      );
      // …et remplace le pointeur CLAUDE.md par le sien : il lui appartient.
      const claudePath = path.join(dest, "CLAUDE.md");
      writeFileSync(claudePath, "# mon CLAUDE.md à moi\n");
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      const agents = readFileSync(agentsPath, "utf8");
      // Réécrit depuis l'état réel : le module créé est inventorié…
      assert.include(agents, "modules/blog");
      // …la zone app-notes a survécu à la réécriture complète…
      assert.include(agents, "toujours frapper /api/hello");
      // …et le CLAUDE.md de l'utilisateur n'a pas été touché.
      assert.equal(readFileSync(claudePath, "utf8"), "# mon CLAUDE.md à moi\n");
    });

    it("accueil : sans frontend, GET / répond (HomeController) ; avec, AppController tient /", () => {
      const none = path.join(tmp, "hnone");
      scaffold(none, { name: "hnone", preset: "complete", frontend: "none" });
      const home = readFileSync(
        path.join(none, "nodefony", "controllers", "HomeController.ts"),
        "utf8",
      );
      assert.include(home, 'path: "/"');
      // La racine dit QUI répond, et rien de plus : cette réponse part en
      // production, vers n'importe qui. Énumérer les routes internes, la console
      // d'administration ou les chemins de documentation décrirait
      // l'architecture à qui la demande. Ces informations vivent dans
      // `@nodefony/devkit` (policy dev), pas dans la racine de l'app.
      for (const fuite of [
        "/api/hello",
        "/nodefony",
        "node_modules",
        "AGENTS",
      ]) {
        assert.notInclude(
          home,
          fuite,
          `la racine générée divulgue « ${fuite} » — en production, c'est offert à tout le monde`,
        );
      }
      const index = readFileSync(path.join(none, "index.ts"), "utf8");
      assert.include(index, "HomeController");

      const front = path.join(tmp, "hfront");
      scaffold(front, { name: "hfront", preset: "minimal", frontend: "react" });
      assert.isFalse(
        existsSync(
          path.join(front, "nodefony", "controllers", "HomeController.ts"),
        ),
      );
      assert.notInclude(
        readFileSync(path.join(front, "index.ts"), "utf8"),
        "HomeController",
      );
    });

    it("suites franches : e2e HORS du glob par défaut, ciblés par leur propre config", () => {
      const dest = path.join(tmp, "suites");
      scaffold(dest, { name: "suites", preset: "complete", frontend: "none" });
      // `npm test` ne montre que ce qu'il exécute — plus de skipped-vert.
      const unit = readFileSync(path.join(dest, "vitest.config.ts"), "utf8");
      assert.include(unit, '"tests/e2e.test.ts"');
      // …et il DIT ce qu'il n'a pas exercé : un vert muet a déjà fait conclure
      // « les tests passent » sur une route qui rendait 500 et ne répondait
      // jamais, les tests justes vivant dans le fichier que ce glob exclut.
      // La parenthèse d'appel, pas le nom nu : le gabarit NOMME `onTestRunEnd`
      // dans un commentaire (pour dire que `onFinished` subsiste dans les types
      // de vitest 4 sans plus être appelé), et une sonde sur le nom seul passait
      // donc grâce au commentaire, hook amputé compris.
      assert.match(
        unit,
        /onTestRunEnd\s*\(/,
        "le rappel doit être branché sur onTestRunEnd — onFinished ne serait jamais appelé",
      );
      assert.include(unit, "npm run test:e2e");
      // `create entity` ajoute un `*.e2e.test.ts` par ressource : eux aussi
      // doivent rester hors du glob par défaut, sinon `npm test` les lance sans
      // serveur et échoue pour une raison sans rapport avec le code testé.
      assert.include(unit, '"tests/**/*.e2e.test.ts"');
      const e2eConfig = readFileSync(
        path.join(dest, "vitest.e2e.config.ts"),
        "utf8",
      );
      assert.include(e2eConfig, '"tests/e2e.test.ts"');
      assert.include(e2eConfig, '"tests/**/*.e2e.test.ts"');
      // L'app est démarrée UNE fois pour toute la suite : un démarrage par
      // fichier rendrait la suite inutilisable dès la deuxième entité.
      assert.include(e2eConfig, 'globalSetup: ["tests/e2e.setup.ts"]');
      assert.isTrue(
        existsSync(path.join(dest, "tests", "e2e.setup.ts")),
        "le setup global e2e doit être généré",
      );
      // La suite tourne sur une base À ELLE. Partagée avec le développement,
      // elle y sème un compte `admin` au mot de passe publié dans ce fichier ;
      // le seed étant idempotent, `admin` / `admin` cesse ensuite de marcher
      // pour toujours — et l'inverse (un admin de dev déjà là) fait échouer
      // `connexionAdmin()`. Mesuré sur une application réelle, pas déduit.
      const e2eSetup = readFileSync(
        path.join(dest, "tests", "e2e.setup.ts"),
        "utf8",
      );
      assert.match(
        e2eSetup,
        /NF_DATABASE_URL:\s*URL_BASE_E2E/,
        "le serveur de test doit recevoir une base dédiée, jamais celle du développement",
      );
      assert.include(e2eSetup, "NF_E2E_DATABASE_URL");
      // Le mot `stateless` n'existait NULLE PART dans une application générée.
      // Un agent à qui on demande une API pour un programme n'avait donc aucun
      // chemin vers la troisième nature de zone : il posait une zone à session,
      // et un client machine devait gérer des cookies. Le vocabulaire vit aux
      // deux endroits où on le cherche — la config qu'on édite, et le fichier
      // que l'agent lit par défaut.
      const configGeneree = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(
        configGeneree,
        "stateless",
        "la config générée doit nommer la zone stateless (appelants non-navigateur)",
      );
      // Le mot seul ne suffit pas, et cette assertion l'a prouvé en passant au
      // vert pendant que le trou restait ouvert : `stateless` vivait dans un
      // COMMENTAIRE, avec son exemple complet — et sur trois agents mesurés,
      // deux ont écrit `stateless: false` en ayant ce texte sous les yeux, dont
      // un en reprenant le nom et le pattern de l'exemple. On recopie le code
      // ACTIF, pas celui qu'on lit à côté : c'est donc lui qu'on vérifie.
      const codeActif = configGeneree
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/u.test(l))
        .join("\n");
      assert.match(
        codeActif,
        /stateless:\s*true/u,
        "la config générée doit porter une zone stateless ACTIVE, pas un exemple commenté",
      );
      assert.match(
        codeActif,
        /authenticators:\s*\[\s*"apikey"\s*\]/u,
        "cette zone doit montrer l'authentificateur de porteur SEUL — ajouter " +
          '"session" à côté rouvre exactement le défaut qu\'elle illustre',
      );
      const agentsMd = readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      assert.include(
        agentsMd,
        "stateless",
        "AGENTS.md doit donner le geste M2M — c'est le fichier lu par défaut",
      );
      // La zone est écrite DEUX fois — dans la config qu'on édite, et dans le
      // fichier que l'agent lit par défaut. La frontière est réelle (l'un est
      // du code, l'autre de la doc), donc la duplication reste ; ce qui ne
      // reste pas, c'est la possibilité qu'elles divergent en silence. Une
      // consigne qui dirait `stateless: false` pendant que la config dit
      // `true` fabriquerait exactement le défaut qu'elles décrivent.
      const zone = (texte: string) => {
        const m =
          /machine:\s*\{[^}]*?pattern:\s*"([^"]+)"[^}]*?authenticators:\s*\[([^\]]*)\][^}]*?stateless:\s*(true|false)/u.exec(
            texte,
          );
        return m
          ? { pattern: m[1], auth: m[2].replace(/\s/gu, ""), stateless: m[3] }
          : null;
      };
      const zoneConfig = zone(configGeneree);
      const zoneAgents = zone(agentsMd);
      assert.isNotNull(
        zoneConfig,
        "zone machine introuvable dans la config générée",
      );
      assert.isNotNull(zoneAgents, "zone machine introuvable dans AGENTS.md");
      assert.deepEqual(
        zoneAgents,
        zoneConfig,
        "AGENTS.md et nodefony.config.ts doivent montrer la MÊME zone machine",
      );
      const pkg = readJson(path.join(dest, "package.json"));
      assert.include(pkg["scripts"]["test:e2e"], "-c vitest.e2e.config.ts");
      // Le test e2e n'a plus AUCUNE gate d'environnement : invoqué = exécuté.
      const e2e = readFileSync(path.join(dest, "tests", "e2e.test.ts"), "utf8");
      assert.notInclude(e2e, "RUN_E2E");
      assert.notInclude(e2e, "describe.skip");
    });
  });

  describe("moteur — create controller (in-project)", () => {
    /** Scaffold controller depuis `from` (détection racine = comme le CLI). */
    const controller = (
      from: string,
      answers: Record<string, string | boolean>,
    ) =>
      runScaffold(
        { type: "controller", answers, dir: from, force: false },
        version,
      );

    it("hello (défaut) : fichier + wiring index.ts + notes GET/WS", () => {
      const dest = path.join(tmp, "capp");
      scaffold(dest, { name: "capp", preset: "minimal" });
      const r = controller(dest, { name: "blog" });
      const file = path.join(
        dest,
        "nodefony",
        "controllers",
        "BlogController.ts",
      );
      assert.isTrue(existsSync(file));
      const src = readFileSync(file, "utf8");
      assert.include(src, '@controller("/api/blog")');
      assert.include(src, 'methods: ["WEBSOCKET"]');
      // Identité par décorateur @CurrentUser (idiomatique), pas RequestContext brut.
      assert.include(src, "@CurrentUser()");
      assert.notInclude(codeOnly(src), "RequestContext");
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(
        index,
        'import BlogController from "./nodefony/controllers/BlogController";',
      );
      assert.match(index, /@controllers\(\[[^\]]*BlogController\]\)/u);
      assert.include((r.notes ?? []).join("\n"), "GET  /api/blog");
      assertNoEtaResidue(dest);
    });

    it("normalisation : blog-postController → BlogPostController, route kebab", () => {
      const dest = path.join(tmp, "norm");
      scaffold(dest, { name: "norm", preset: "minimal" });
      controller(dest, { name: "blog-postController" });
      const file = path.join(
        dest,
        "nodefony",
        "controllers",
        "BlogPostController.ts",
      );
      assert.isTrue(existsSync(file));
      assert.include(
        readFileSync(file, "utf8"),
        '@controller("/api/blog-post")',
      );
    });

    it("realtime : RealtimeController + canal ticker ; minimal sans la dep → garde", () => {
      const full = path.join(tmp, "rt");
      scaffold(full, { name: "rt", preset: "complete" });
      controller(full, { name: "pulse", kind: "realtime" });
      const src = readFileSync(
        path.join(full, "nodefony", "controllers", "PulseController.ts"),
        "utf8",
      );
      assert.include(src, "extends RealtimeController");
      assert.include(src, '@RealtimeChannel("pulse:ticker")');
      // Actions par DÉCORATEUR, policy inline visible — plus d'override.
      assert.include(
        src,
        '@RealtimeAction("pulse:ping", { authenticated: false })',
      );
      assert.include(src, '@RealtimeAction("pulse:snapshot"');
      assert.notInclude(src, "realtimeActions()");
      // Le décorateur annonce le canal au welcome : l'override le doublerait.
      assert.notInclude(src, "realtimeChannels()");
      // La TSDoc client cite les VRAIS symboles de la façade (une API inventée
      // dans un exemple coûte plus cher qu'aucun exemple).
      assert.include(src, "RealtimeClient.shared");
      assert.include(src, "useNodefonyChannelData");

      // Le controller naît avec SON test, nommé d'après la route qu'il éprouve.
      // Le nom est vérifié parce qu'un token non substitué produit un fichier
      // `__KEBAB__-realtime.test.ts` qui PASSE : le contenu est correct, le nom
      // seul est faux — aucune assertion de contenu ne l'aurait vu.
      const rtTest = readFileSync(
        path.join(full, "tests", "pulse-realtime.test.ts"),
        "utf8",
      );
      assert.include(rtTest, '"@nodefony/realtime/testing"');
      assert.include(rtTest, "createRealtimeHarness");
      assert.include(rtTest, '"pulse:ping"');
      assert.notInclude(rtTest, "__KEBAB__");

      const mini = path.join(tmp, "rtmini");
      scaffold(mini, { name: "rtmini", preset: "minimal" });
      assert.throws(
        () => controller(mini, { name: "pulse", kind: "realtime" }),
        /@nodefony\/realtime/u,
      );
    });

    it("example complete : vitrine décorateurs (sécu + idempotence + session)", () => {
      const dest = path.join(tmp, "exfull");
      scaffold(dest, { name: "exfull", preset: "complete" });
      controller(dest, { name: "item", kind: "example", route: "/api/items" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      for (const marker of [
        '@controller("/api/items")',
        '@Get("/{id}")',
        '@Post("")',
        "@Idempotent()",
        "@HttpCode(201)",
        '@IsGranted("ROLE_ADMIN")',
        '@RequireScope("item:export")',
        "@CsrfProtect()",
        "@UseSession()",
        "@CurrentUser()",
        '@Headers("user-agent")',
        "@UploadedFile()",
        "@Redirect(",
        '@Patch("/{id}")',
        "@Body({ stream: true })",
        'import type { IUser } from "@nodefony/user";',
        "WEBSOCKET",
      ]) {
        assert.include(src, marker, `manque ${marker}`);
      }
      // Bug vécu : une action @Idempotent doit RETOURNER le payload brut —
      // renderJson (structure circulaire) casserait la mémorisation du rejeu.
      assert.include(src, "return item;");
      // Identité par décorateur, jamais RequestContext brut dans la vitrine.
      assert.notInclude(codeOnly(src), "RequestContext");
      // La route paramétrique reste déclarée APRÈS les GET statiques (ordre de match).
      assert.isBelow(
        src.indexOf('@Get("/latest")'),
        src.indexOf('@Get("/{id}")'),
      );
      // L'echo WS de fin de vitrine porte sa redirection vers la bonne couche.
      assert.include(src, "--kind realtime");
    });

    it("example minimal : vitrine DÉGRADÉE sans security (aucun import mort)", () => {
      const dest = path.join(tmp, "exmin");
      scaffold(dest, { name: "exmin", preset: "minimal" });
      controller(dest, { name: "item", kind: "example" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      // Les NOMS restent cités dans le commentaire pédagogique (« ajoute
      // @nodefony/security pour débloquer… ») — on vérifie l'absence d'USAGE.
      assert.notInclude(src, '@IsGranted("');
      assert.notInclude(src, "@nodefony/user");
      assert.notInclude(src, "@CsrfProtect()");
      assert.notInclude(src, "  IsGranted,");
      assert.include(src, "@Idempotent()");
      assert.include(src, "@UseSession()");
      assert.include(src, "ajoute `@nodefony/security`");
      // @CurrentUser vient du framework (lit l'ALS) → présent MÊME sans security.
      assert.include(src, "@CurrentUser()");
    });

    it("rest : CRUD de production HTTP pur (pas de zoo, pas de WS)", () => {
      const dest = path.join(tmp, "restpur");
      scaffold(dest, { name: "restpur", preset: "complete" });
      controller(dest, { name: "item", kind: "rest", route: "/api/items" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      for (const marker of [
        '@controller("/api/items")',
        '@Get("")',
        '@Get("/{id}")',
        '@Post("")',
        '@Put("/{id}")',
        '@Patch("/{id}")',
        '@Delete("/{id}")',
        "@HttpCode(201)",
        "@Idempotent()",
        "@CurrentUser()",
        // complete → security : delete protégée par rôle.
        '@IsGranted("ROLE_ADMIN")',
        "HttpError",
      ]) {
        assert.include(src, marker, `manque ${marker}`);
      }
      // REST pur : aucun transport WS, aucun décorateur de la vitrine.
      assert.notInclude(src, "WEBSOCKET");
      assert.notInclude(src, "@UseSession");
      assert.notInclude(src, "@UploadedFile");
      assert.notInclude(codeOnly(src), "RequestContext");
      // minimal (sans security) : delete dégradée SANS @IsGranted, zéro import mort.
      const mini = path.join(tmp, "restpurmin");
      scaffold(mini, { name: "restpurmin", preset: "minimal" });
      controller(mini, { name: "item", kind: "rest" });
      const srcMin = readFileSync(
        path.join(mini, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      assert.notInclude(srcMin, "@IsGranted");
      assert.notInclude(srcMin, "@nodefony/user");
      assert.include(srcMin, '@Delete("/{id}")');
    });

    it("duplex : mêmes actions REST + socket (pont api.request) ; garde dep realtime", () => {
      const dest = path.join(tmp, "duplex");
      scaffold(dest, { name: "duplex", preset: "complete" });
      controller(dest, { name: "item", kind: "duplex", route: "/api/items" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      for (const marker of [
        "extends RealtimeController",
        // Le PONT opt-in : sans cet override, api.request n'existe pas.
        "realtimeApiRequest(): boolean",
        // Transports déclarés route par route (zéro bypass).
        'methods: ["GET", "WEBSOCKET"]',
        'methods: ["POST", "WEBSOCKET"]',
        'methods: ["DELETE", "WEBSOCKET"]',
        "@Idempotent()",
        "@CurrentUser()",
        // Le TSDoc client montre les DEUX portes.
        "socket.request(",
        "socket.mutate(",
        "idempotencyKey",
        // Variante sécurisée (complete) : la MÊME garde par rôle pour les
        // DEUX portes — HTTP direct et pont api.request (ALS au handshake).
        '@IsGranted("ROLE_ADMIN")',
        'import type { IUser } from "@nodefony/user";',
      ]) {
        assert.include(src, marker, `manque ${marker}`);
      }
      // minimal sans @nodefony/realtime → garde actionnable (comme realtime).
      const mini = path.join(tmp, "duplexmin");
      scaffold(mini, { name: "duplexmin", preset: "minimal" });
      assert.throws(
        () => controller(mini, { name: "item", kind: "duplex" }),
        /@nodefony\/realtime/u,
      );
    });

    it("cible --module : écrit dans modules/<x> + wiring de SON index.ts", () => {
      const dest = path.join(tmp, "mapp");
      scaffold(dest, { name: "mapp", preset: "minimal" });
      const mod = path.join(dest, "modules", "shop");
      mkdirSync(path.join(mod, "nodefony"), { recursive: true });
      writeFileSync(
        path.join(mod, "package.json"),
        JSON.stringify({ name: "@mapp/shop" }),
      );
      writeFileSync(
        path.join(mod, "index.ts"),
        'import { Module } from "nodefony";\n' +
          'import { controllers } from "@nodefony/framework";\n\n' +
          "@controllers([])\nclass Shop extends Module {}\nexport default Shop;\n",
      );
      controller(dest, { name: "cart", module: "@mapp/shop" });
      assert.isTrue(
        existsSync(
          path.join(mod, "nodefony", "controllers", "CartController.ts"),
        ),
      );
      const index = readFileSync(path.join(mod, "index.ts"), "utf8");
      assert.include(index, "@controllers([CartController])");
      // l'index de l'APP n'est pas touché
      assert.notInclude(
        readFileSync(path.join(dest, "index.ts"), "utf8"),
        "CartController",
      );
    });

    it("garde-fous : hors projet / module inconnu / nom en double", () => {
      assert.throws(
        () => controller(os.tmpdir(), { name: "x" }),
        /aucun projet Nodefony/u,
      );
      const dest = path.join(tmp, "gapp");
      scaffold(dest, { name: "gapp", preset: "minimal" });
      assert.throws(
        () => controller(dest, { name: "x", module: "ghost" }),
        /introuvable — cibles du projet/u,
      );
      controller(dest, { name: "dup" });
      assert.throws(() => controller(dest, { name: "dup" }), /déjà référencé/u);
    });

    it("nom en double : refus SANS toucher au projet", () => {
      const dest = path.join(tmp, "cintact");
      scaffold(dest, { name: "cintact", preset: "minimal" });
      controller(dest, { name: "blog", kind: "rest" });
      const before = snapshotTree(dest);
      assert.throws(
        () => controller(dest, { name: "blog", kind: "hello" }),
        /déjà référencé/u,
      );
      assertTreeUnchanged(before, dest);
    });

    it("wiring impossible : refus SANS laisser un controller orphelin", () => {
      // Un `index.ts` sans `@controllers([...])` : le moteur ne SAIT pas câbler.
      // Il doit le dire avant d'écrire — un fichier posé mais jamais chargé est
      // pire qu'un refus, l'utilisateur croit avoir un controller qui répond.
      const dest = path.join(tmp, "noanchor");
      scaffold(dest, { name: "noanchor", preset: "minimal" });
      const indexPath = path.join(dest, "index.ts");
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace(
          /@controllers\(\[[^\]]*\]\)/u,
          "",
        ),
      );
      const before = snapshotTree(dest);
      assert.throws(
        () => controller(dest, { name: "orphan" }),
        /@controllers/u,
      );
      assertTreeUnchanged(before, dest);
    });

    it("parseCreateArgv : --kind --route --module", () => {
      const p = parseCreateArgv(
        argv(
          "create",
          "controller",
          "blog",
          "--kind",
          "realtime",
          "--route",
          "/api/live",
          "--module",
          "@x/shop",
        ),
      );
      assert.notProperty(p, "error");
      const req = p as Exclude<typeof p, { error: string }>;
      assert.equal(req.type, "controller");
      assert.deepInclude(req.answers, {
        name: "blog",
        kind: "realtime",
        route: "/api/live",
        module: "@x/shop",
      });
    });
  });

  describe("moteur — create service (in-project)", () => {
    /** Scaffold service depuis `from` (détection racine = comme le CLI). */
    const service = (from: string, answers: Record<string, string | boolean>) =>
      runScaffold(
        { type: "service", answers, dir: from, force: false },
        version,
      );

    it("app racine SANS @services([...]) : le décorateur est CRÉÉ, pas refusé", () => {
      // Le gabarit `app/base` ne rend JAMAIS @services([...]) — c'est le cas
      // nominal du bug rapporté (un agent ne trouve @injectable nulle part).
      const dest = path.join(tmp, "svcapp");
      scaffold(dest, { name: "svcapp", preset: "minimal" });
      const indexBefore = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.notInclude(indexBefore, "@services");
      const r = service(dest, {
        name: "billing",
        description: "Facturation de démonstration",
      });
      const file = path.join(dest, "nodefony", "service", "BillingService.ts");
      const itf = path.join(
        dest,
        "nodefony",
        "interfaces",
        "IBillingService.ts",
      );
      assert.isTrue(existsSync(file));
      assert.isTrue(existsSync(itf));
      const src = readFileSync(file, "utf8");
      assert.include(src, "@injectable()");
      assert.include(
        src,
        "class BillingService extends Service implements IBillingService",
      );
      assert.include(src, 'super(\n      "billing",');
      assert.include(src, "Facturation de démonstration.");
      // Le hook de démarrage d'un SERVICE s'appelle `init` — le kernel ne
      // cherche que celui-là (`guardServiceInitialize` : `if (!serviceInit.init)
      // return`). Une méthode `initialize` sur un service n'est JAMAIS appelée,
      // et RIEN ne le signale : un abonnement kernel écrit dedans dort en
      // silence. Prouvé à l'exécution (marqueurs dans les deux méthodes : seul
      // `init` sort). `initialize` appartient au CONTROLLER, où il tourne à
      // chaque requête — deux cycles de vie, deux noms.
      assert.include(src, "async init(): Promise<this>");
      assert.notMatch(
        src,
        /\basync initialize\s*\(/u,
        "le gabarit de service rend une méthode `initialize` — elle ne sera jamais appelée",
      );
      // Aucune dépendance à un config.ts — le point dur du kit : une cible
      // in-project n'en a pas forcément un.
      assert.notInclude(src, "config/config");
      assert.notMatch(
        src,
        /^ \*.*\S \*$/mu,
        "ligne de TSDoc recollée — tag eta en fin de ligne",
      );
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(
        index,
        'import BillingService from "./nodefony/service/BillingService";',
      );
      assert.include(index, 'import { services } from "nodefony";');
      assert.match(index, /@services\(\[BillingService\]\)\nclass App\b/u);
      assert.include((r.notes ?? []).join("\n"), 'container.get("billing")');
      assertNoEtaResidue(dest);
    });

    it("--inject : la dépendance est DÉCLARÉE au constructeur, et APPELÉE", () => {
      // Le geste mesuré ROUGE au banc de découvrabilité : `@inject` n'existait
      // en code ACTIF dans AUCUN gabarit (uniquement des commentaires), et
      // l'agent passait exclusivement par `container.get`. On ne prend que la
      // voie qu'on a VUE.
      const dest = path.join(tmp, "svcinject");
      scaffold(dest, { name: "svcinject", preset: "minimal" });
      service(dest, { name: "billing" });
      const r = service(dest, { name: "invoice", inject: "BillingService" });
      const src = readFileSync(
        path.join(dest, "nodefony", "service", "InvoiceService.ts"),
        "utf8",
      );
      // L'import est une VALEUR : `@inject` nomme la classe, et le paramètre
      // décoré porte son type — un `import type` effacerait la métadonnée.
      assert.include(src, 'import BillingService from "./BillingService";');
      assert.include(
        src,
        '@inject("BillingService") private readonly billing: BillingService,',
      );
      // Une dépendance déclarée et jamais lue ne compile pas (`noUnusedLocals`)
      // — et ne montrerait rien. L'appel porte sur une méthode CHERCHÉE dans le
      // service visé, jamais sur un nom supposé.
      assert.include(src, "return this.billing.greet();");
      assert.notMatch(
        src,
        /^ \*.*\S \*$/mu,
        "ligne de TSDoc recollée — tag eta en fin de ligne",
      );
      const itf = readFileSync(
        path.join(dest, "nodefony", "interfaces", "IInvoiceService.ts"),
        "utf8",
      );
      assert.include(itf, "depuisBillingService(): Promise<unknown>;");
      assert.include(
        (r.notes ?? []).join("\n"),
        "BillingService est injecté par le CONSTRUCTEUR",
      );
      assertNoEtaResidue(dest);
    });

    it("--inject : la note APPREND le geste quand la cible a déjà un service", () => {
      // La note est le canal : elle est lue au moment exact où le geste
      // s'applique. Sans elle, `--inject` n'existe que dans une aide que
      // personne n'ouvre.
      const dest = path.join(tmp, "svcnote");
      scaffold(dest, { name: "svcnote", preset: "minimal" });
      const first = service(dest, { name: "billing" });
      assert.notInclude((first.notes ?? []).join("\n"), "--inject");
      const second = service(dest, { name: "invoice" });
      assert.include(
        (second.notes ?? []).join("\n"),
        "create service invoice --inject BillingService",
      );
    });

    it("--inject : un service absent est REFUSÉ avant écriture", () => {
      const dest = path.join(tmp, "svcinjectko");
      scaffold(dest, { name: "svcinjectko", preset: "minimal" });
      assert.throws(
        () => service(dest, { name: "invoice", inject: "GhostService" }),
        /--inject.*Ghost.*introuvable/u,
      );
      // Rien n'a été écrit : un import vers une classe absente casserait la
      // compilation de toute l'app, sur une erreur qui ne parle pas du scaffold.
      assert.isFalse(
        existsSync(path.join(dest, "nodefony", "service", "InvoiceService.ts")),
      );
    });

    it("index.ts écrit à la MAIN en `export class` : le décorateur est posé quand même", () => {
      // Nos gabarits exportent en bas de fichier, donc la classe s'y déclare
      // nue (`class App extends Module`). Mais `export class X extends Module`
      // est la forme que montre la doc du kernel — c'est donc celle qu'une app
      // reprise à la main portera, et une ancre en `^class` la manquait : le
      // scaffold refusait un projet parfaitement valide.
      const dest = path.join(tmp, "svcexport");
      scaffold(dest, { name: "svcexport", preset: "minimal" });
      const indexPath = path.join(dest, "index.ts");
      const before = readFileSync(indexPath, "utf8").replace(
        /^class App extends Module\b/mu,
        "export class App extends Module",
      );
      assert.include(before, "export class App extends Module");
      writeFileSync(indexPath, before);
      service(dest, { name: "billing", description: "Facturation" });
      const index = readFileSync(indexPath, "utf8");
      // Décorateur AVANT `export` — la forme valide en TypeScript.
      assert.match(
        index,
        /@services\(\[BillingService\]\)\nexport class App\b/u,
        "décorateur non posé sur une classe exportée en tête",
      );
      assertNoEtaResidue(dest);
    });

    it("@services([...]) déjà présent (module --service) : la liste s'ÉTEND", () => {
      const dest = path.join(tmp, "svcmod");
      scaffold(dest, { name: "svcmod", preset: "minimal" });
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none", service: true },
          dir: dest,
          force: false,
        },
        version,
      );
      const modIndex = path.join(dest, "modules", "blog", "index.ts");
      assert.match(
        readFileSync(modIndex, "utf8"),
        /@services\(\[BlogService\]\)/u,
      );
      service(dest, { name: "tax", module: "@svcmod/blog" });
      const after = readFileSync(modIndex, "utf8");
      assert.match(after, /@services\(\[BlogService, TaxService\]\)/u);
      // `services` était déjà importé (module `--service` : `import { Kernel,
      // Module, services } from "nodefony";`) — pas de DEUXIÈME import ajouté.
      assert.equal(
        (after.match(/\bservices\b[^\n]*from "nodefony"/gu) ?? []).length,
        1,
      );
    });

    it("module créé avec --no-service : le décorateur est CRÉÉ là aussi", () => {
      const dest = path.join(tmp, "svcnosvc");
      scaffold(dest, { name: "svcnosvc", preset: "minimal" });
      runScaffold(
        {
          type: "module",
          answers: { name: "shop", controller: "none", service: false },
          dir: dest,
          force: false,
        },
        version,
      );
      const modIndex = path.join(dest, "modules", "shop", "index.ts");
      assert.notInclude(readFileSync(modIndex, "utf8"), "@services");
      service(dest, { name: "invoice", module: "@svcnosvc/shop" });
      const after = readFileSync(modIndex, "utf8");
      assert.match(
        after,
        /@services\(\[InvoiceService\]\)\nclass ShopModule\b/u,
      );
      assert.isTrue(
        existsSync(
          path.join(
            dest,
            "modules",
            "shop",
            "nodefony",
            "service",
            "InvoiceService.ts",
          ),
        ),
      );
    });

    it("normalisation : billing-planService → BillingPlanService, clé camelCase", () => {
      const dest = path.join(tmp, "svcnorm");
      scaffold(dest, { name: "svcnorm", preset: "minimal" });
      service(dest, { name: "billing-planService" });
      const file = path.join(
        dest,
        "nodefony",
        "service",
        "BillingPlanService.ts",
      );
      assert.isTrue(existsSync(file));
      assert.include(
        readFileSync(file, "utf8"),
        'super(\n      "billingPlan",',
      );
    });

    it("garde-fous : hors projet / module inconnu / nom en double", () => {
      assert.throws(
        () => service(os.tmpdir(), { name: "x" }),
        /aucun projet Nodefony/u,
      );
      const dest = path.join(tmp, "svcguard");
      scaffold(dest, { name: "svcguard", preset: "minimal" });
      assert.throws(
        () => service(dest, { name: "x", module: "ghost" }),
        /introuvable — cibles du projet/u,
      );
      service(dest, { name: "dup" });
      assert.throws(() => service(dest, { name: "dup" }), /déjà référencé/u);
    });

    it("nom en double : refus SANS toucher au projet", () => {
      const dest = path.join(tmp, "svcintact");
      scaffold(dest, { name: "svcintact", preset: "minimal" });
      service(dest, { name: "billing" });
      const before = snapshotTree(dest);
      assert.throws(
        () => service(dest, { name: "billing" }),
        /déjà référencé/u,
      );
      assertTreeUnchanged(before, dest);
    });

    it("parseCreateArgv : --module --description", () => {
      const p = parseCreateArgv(
        argv(
          "create",
          "service",
          "billing",
          "--module",
          "@x/shop",
          "--description",
          "Facturation",
        ),
      );
      assert.notProperty(p, "error");
      const req = p as Exclude<typeof p, { error: string }>;
      assert.equal(req.type, "service");
      assert.deepInclude(req.answers, {
        name: "billing",
        module: "@x/shop",
        description: "Facturation",
      });
    });
  });

  describe("moteur — create module (in-project, workspace npm)", () => {
    /** Rend un module dans une app déjà scaffoldée. */
    const mod = (
      from: string,
      answers: Record<string, string | boolean>,
      force = false,
    ) => runScaffold({ type: "module", answers, dir: from, force }, version);

    /** App de fixture — le module se pose DEDANS (comme en usage réel). */
    const app = (name: string, preset = "complete"): string => {
      const dest = path.join(tmp, name);
      scaffold(dest, { name, preset, frontend: "none" });
      return dest;
    };

    it("pose la coquille : package npm, build, config Zod, docs, tests", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "none" });
      for (const f of [
        "package.json",
        "tsconfig.json",
        "rolldown.config.ts",
        "vitest.config.ts",
        "index.ts",
        "README.md",
        path.join("docs", "index.md"),
        path.join("nodefony", "config", "config.ts"),
        path.join("nodefony", "config", "defineModuleConfig.ts"),
        path.join("nodefony", "src", "errors", "BlogError.ts"),
        path.join("tests", "blog.test.ts"),
      ]) {
        assert.isTrue(existsSync(path.join(r.dest, f)), `manque ${f}`);
      }
      assert.equal(r.dest, path.join(dest, "modules", "blog"));
      assertNoEtaResidue(r.dest);
    });

    it("nomme le paquet d'après l'app (@<app>/<module>) et le rend chargeable", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "none" });
      const pkg = readJson(path.join(r.dest, "package.json"));
      assert.equal(pkg["name"] as unknown as string, "@mapp/blog");
      assert.equal(pkg["main"] as unknown as string, "dist/index.js");
      // Le Kernel importe le module PAR SON NOM → le nom du paquet et l'entrée
      // du manifeste doivent être le MÊME identifiant.
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(config, 'use("@mapp/blog", {})');
    });

    it("déclare le workspace npm et chaîne les scripts de l'app", () => {
      const dest = app("mapp");
      mod(dest, { name: "blog", controller: "none" });
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { workspaces: string[]; scripts: Record<string, string> };
      assert.include(pkg.workspaces, "modules/*");
      // Sans ce chaînage, le module ne serait ni construit, ni typé, ni testé.
      assert.include(pkg.scripts["build"], "--workspaces");
      assert.include(pkg.scripts["typecheck"], "--workspaces");
      assert.include(pkg.scripts["test"], "--workspaces");
      // Le build des modules passe AVANT celui de l'app.
      assert.isTrue(
        pkg.scripts["build"].indexOf("--workspaces") <
          pkg.scripts["build"].indexOf("rolldown"),
      );
    });

    it("est idempotent : un 2ᵉ module ne duplique ni workspace ni chaînage", () => {
      const dest = app("mapp");
      mod(dest, { name: "blog", controller: "none" });
      const first = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> };
      mod(dest, { name: "shop", controller: "none" });
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { workspaces: string[]; scripts: Record<string, string> };
      assert.deepEqual(pkg.workspaces, ["modules/*"]);
      for (const script of ["build", "typecheck", "test"]) {
        assert.equal(
          (pkg.scripts[script].match(/--workspaces/gu) ?? []).length,
          1,
          `script ${script} chaîné deux fois`,
        );
        // Le 2ᵉ passage n'a PAS touché aux scripts déjà chaînés.
        assert.equal(pkg.scripts[script], first.scripts[script]);
      }
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(config, 'use("@mapp/blog", {})');
      assert.include(config, 'use("@mapp/shop", {})');
    });

    /**
     * Le layout des modules se CONSTATE dans les workspaces du dépôt.
     *
     * Motif : le dépôt du framework range ses paquets dans
     * `src/packages/@nodefony/*` — la commande y visait quand même `modules/`,
     * si bien que l'auteur écrivait à la main le squelette que sa propre
     * commande produit. Un générateur qui ne sert pas le dépôt qui le publie
     * dérive sans que personne le voie.
     */
    describe("monorepo de paquets scopés (le dépôt hérite de son générateur)", () => {
      /** App de fixture RE-DÉCLARÉE en monorepo de paquets, avec témoins. */
      const mono = (name: string): string => {
        const dest = app(name);
        const manifestPath = path.join(dest, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          workspaces?: string[];
          scripts?: Record<string, string>;
          version?: string;
        };
        manifest.workspaces = ["src/packages/@acme/*", "src/modules/*"];
        manifest.version = "7.3.1";
        manifest.scripts = { ...manifest.scripts, build: "turbo run build" };
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        // AGENTS.md ÉCRIT À LA MAIN — celui d'un dépôt, pas d'une app générée.
        writeFileSync(path.join(dest, "AGENTS.md"), "# le mien\n");
        return dest;
      };

      it("pose le module dans le dossier DÉCLARÉ, sous le scope déclaré", () => {
        const dest = mono("mono");
        const r = mod(dest, { name: "blog", controller: "none" });
        assert.equal(
          r.dest,
          path.join(dest, "src", "packages", "@acme", "blog"),
        );
        const pkg = readJson(path.join(r.dest, "package.json"));
        assert.equal(pkg["name"] as unknown as string, "@acme/blog");
        assertNoEtaResidue(r.dest);
      });

      it("le module naît PUBLIABLE : exports, types générés, files, déclarations", () => {
        const dest = mono("mono");
        const r = mod(dest, { name: "blog", controller: "none" });
        const pkg = readJson(path.join(r.dest, "package.json"));
        // Les types pointent du GÉNÉRÉ — jamais un .d.ts écrit à la main.
        assert.equal(
          pkg["types"] as unknown as string,
          "./dist/types/index.d.ts",
        );
        assert.deepEqual(pkg["files"] as unknown as string[], ["dist", "docs"]);
        assert.isUndefined(
          pkg["private"],
          "un paquet publiable n'est pas privé",
        );
        // La version suit celle de la RACINE : les paquets d'un dépôt avancent
        // ensemble, ils ne démarrent pas chacun à 0.1.0.
        assert.equal(pkg["version"] as unknown as string, "7.3.1");
        assert.include(
          (pkg["scripts"] as unknown as Record<string, string>)["build"],
          "tsconfig.declarations.json",
        );
        for (const f of [
          "tsconfig.declarations.json",
          "tsconfig.tests.json",
          "CLAUDE.md",
          "MEMORY.md",
        ]) {
          assert.isTrue(existsSync(path.join(r.dest, f)), `manque ${f}`);
        }
      });

      /**
       * Motif payé en CI : `@nodefony/devkit`, né de cette commande, ne
       * déclarait ses frères qu'en `peerDependencies`. Or un orchestrateur de
       * monorepo (turbo, nx) construit son graphe sur `dependencies` +
       * `devDependencies` : sans arête, le module se construisait AVANT
       * `nodefony`, et son `rolldown.config.ts` importait un
       * `nodefony/bundler` qui n'existait pas encore. Quatre workflows rouges,
       * le même `Cannot find module … dist/node/bundler/index.js`.
       *
       * Ne vaut QUE pour un paquet du dépôt : dans une application, `nodefony`
       * vient de npm déjà construit — il n'y a rien à ordonner.
       */
      it("déclare ses frères LOCAUX en devDependencies (l'ordre de build en dépend)", () => {
        const dest = mono("mono");
        const r = mod(dest, { name: "blog", controller: "none" });
        const pkg = readJson(path.join(r.dest, "package.json"));
        const peer = (pkg["peerDependencies"] ?? {}) as unknown as Record<
          string,
          string
        >;
        const dev = (pkg["devDependencies"] ?? {}) as unknown as Record<
          string,
          string
        >;
        const locaux = Object.keys(peer).filter(
          (n) => n === "nodefony" || n.startsWith("@nodefony/"),
        );
        assert.isNotEmpty(
          locaux,
          "un module Nodefony dépend au minimum de `nodefony`",
        );
        for (const nom of locaux) {
          assert.property(
            dev,
            nom,
            `« ${nom} » est un workspace du dépôt cité en peerDependencies mais absent des devDependencies : turbo ne verra aucune arête et pourra construire ce module AVANT lui`,
          );
        }
      });

      it("ne touche NI aux workspaces NI aux scripts d'un dépôt qui les déclare", () => {
        const dest = mono("mono");
        mod(dest, { name: "blog", controller: "none" });
        const pkg = JSON.parse(
          readFileSync(path.join(dest, "package.json"), "utf8"),
        ) as { workspaces: string[]; scripts: Record<string, string> };
        assert.deepEqual(pkg.workspaces, [
          "src/packages/@acme/*",
          "src/modules/*",
        ]);
        // Un dépôt établi a sa propre chaîne (turbo, nx…) : la doubler la casse.
        assert.equal(pkg.scripts["build"], "turbo run build");
        assert.notInclude(pkg.scripts["build"], "--workspaces");
      });

      it("n'écrase JAMAIS l'AGENTS.md de la racine (il est écrit à la main)", () => {
        const dest = mono("mono");
        mod(dest, { name: "blog", controller: "none" });
        assert.equal(
          readFileSync(path.join(dest, "AGENTS.md"), "utf8"),
          "# le mien\n",
        );
      });

      it("le manifeste reçoit le module, et le commentaire nomme le BON dossier", () => {
        const dest = mono("mono");
        mod(dest, { name: "blog", controller: "none" });
        const config = readFileSync(
          path.join(dest, "nodefony.config.ts"),
          "utf8",
        );
        assert.include(config, 'use("@acme/blog", {})');
        assert.include(config, "src/packages/@acme/");
        assert.notInclude(config, "(modules/) — créé par");
      });
    });

    it("délègue le controller au scaffold controller (0 template dupliqué)", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "hello" });
      const ctrl = path.join(
        r.dest,
        "nodefony",
        "controllers",
        "BlogController.ts",
      );
      assert.isTrue(existsSync(ctrl), "controller non rendu dans le module");
      // Câblé dans l'index DU MODULE (pas dans celui de l'app).
      const index = readFileSync(path.join(r.dest, "index.ts"), "utf8");
      assert.include(index, "@controllers([BlogController])");
      assert.notInclude(
        readFileSync(path.join(dest, "index.ts"), "utf8"),
        "BlogController",
      );
      assert.deepInclude(r.notes ?? [], "GET  /api/blog");
    });

    it("service et commande CLI : posés à la demande, jamais imposés", () => {
      const dest = app("mapp");
      const withAll = mod(dest, {
        name: "blog",
        controller: "none",
        service: true,
        command: true,
      });
      assert.isTrue(
        existsSync(
          path.join(withAll.dest, "nodefony", "service", "BlogService.ts"),
        ),
      );
      assert.isTrue(
        existsSync(
          path.join(withAll.dest, "nodefony", "command", "HelloCommand.ts"),
        ),
      );
      const index = readFileSync(path.join(withAll.dest, "index.ts"), "utf8");
      assert.include(index, "@services([BlogService])");
      assert.include(index, "this.addCommand(HelloCommand)");

      // Le service et la commande générés doivent porter les DEUX noms cohérents :
      // `@injectable()` nomme la CLASSE, `super("blog", …)` la clé du conteneur —
      // et la commande doit demander le service par cette CLÉ, pas par la classe.
      const svc = readFileSync(
        path.join(withAll.dest, "nodefony", "service", "BlogService.ts"),
        "utf8",
      );
      assert.include(svc, "@injectable()");
      // Même règle que pour `create service` : le hook de démarrage d'un service
      // s'appelle `init`. Le kernel ne cherche que celui-là — une `initialize`
      // rendue ici serait du code mort silencieux dans CHAQUE module généré.
      assert.include(svc, "async init(): Promise<this>");
      assert.notMatch(
        svc,
        /\basync initialize\s*\(/u,
        "le service du module rend une méthode `initialize` — jamais appelée",
      );
      // Vise le CODE, pas la prose. Le fichier généré DOCUMENTE les deux noms en
      // commentaire (« super("blog", …) ») : un `include('"blog"')` — et même un
      // `/super\(\s*"blog",/` — reste donc vert avec un `super()` cassé, en
      // matchant le commentaire. Constaté en tentant de mettre ce test en rouge.
      // On ancre sur ce que la prose ne contient pas : l'argument suivant.
      assert.match(
        svc,
        /super\(\s*"blog",\s*module\.container/,
        "le service doit s'enregistrer sous sa clé conteneur",
      );
      const cmd = readFileSync(
        path.join(withAll.dest, "nodefony", "command", "HelloCommand.ts"),
        "utf8",
      );
      assert.include(
        cmd,
        'get("blog")',
        "la commande doit résoudre le service par sa CLÉ conteneur",
      );

      // Aucune balise de template ne doit fuiter dans le code livré — cas réel :
      // un fichier ajouté au scaffold mais jamais passé au moteur (copié tel
      // quel) partirait chez l'utilisateur avec ses `<% %>` en clair.
      //
      // ⚠️ Portée exacte, vérifiée : ce contrôle N'ATTRAPE PAS une variable mal
      // nommée — Eta rend `<%= it.typo %>` en chaîne VIDE, sans lever. Une faute
      // de nom produit donc un trou silencieux dans le fichier généré, que rien
      // ici ne voit. (Le vrai filet contre ça = les assertions de contenu
      // ci-dessus, qui exigent les chaînes attendues.)
      for (const [file, src] of [
        ["index.ts", index],
        ["BlogService.ts", svc],
        ["HelloCommand.ts", cmd],
      ] as const) {
        assert.notMatch(
          src,
          /<%|%>/,
          `${file} contient une balise de template non rendue`,
        );
      }

      const bare = mod(dest, {
        name: "shop",
        controller: "none",
        service: false,
        command: false,
      });
      assert.isFalse(existsSync(path.join(bare.dest, "nodefony", "service")));
      assert.isFalse(existsSync(path.join(bare.dest, "nodefony", "command")));
      const bareIndex = readFileSync(path.join(bare.dest, "index.ts"), "utf8");
      assert.notInclude(bareIndex, "@services");
      assert.notInclude(bareIndex, "addCommand");
    });

    it("AGENTS.md du module : TOUJOURS rendu — « le plus proche gagne »", () => {
      const plain = app("plain");
      // Même un projet SANS aucun fichier IA à la racine y a droit : la
      // condition historique (CLAUDE.md racine, que create app ne créait
      // jamais) rendait ces templates morts.
      rmSync(path.join(plain, "CLAUDE.md"), { force: true });
      rmSync(path.join(plain, "AGENTS.md"), { force: true });
      const r = mod(plain, { name: "blog", controller: "none" });
      const agents = readFileSync(path.join(r.dest, "AGENTS.md"), "utf8");
      assert.include(agents, "@plain/blog");
      assert.include(agents, "proche gagne");
      assert.include(agents, "source unique des défauts");
      // Les savoirs fondamentaux, portés AUSSI au niveau module (le fichier
      // le plus proche est celui que l'agent lit) : DI prototypal, isomorphisme,
      // et l'ajout d'un service — la liste des ajouts d'un module couvrait
      // controller/front/command, jamais le service, alors qu'il s'y ajoute
      // exactement pareil (et se câble dans le `@services([…])`).
      assert.include(agents, "PROTOTYPAL");
      assert.include(agents, "nodefony/docs/service.md");
      assert.include(agents, "nodefony/docs/client.md");
      assert.include(agents, "nodefony create service");
      assert.include(agents, "extends Service");
      assert.include(agents, "--kind realtime --module blog");
      // Sans controller demandé, l'inventaire n'en promet aucun.
      assert.notInclude(agents, "BlogController");
      // L'ancien couple est fusionné dedans — plus jamais généré.
      assert.isFalse(existsSync(path.join(r.dest, "CLAUDE.md")));
      assert.isFalse(existsSync(path.join(r.dest, "MEMORY.md")));
    });

    it("config du module : le schéma Zod porte les défauts, le registre le type", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "none" });
      const config = readFileSync(
        path.join(r.dest, "nodefony", "config", "config.ts"),
        "utf8",
      );
      assert.include(config, "export const blogConfigSchema");
      assert.include(config, "blogConfigSchema.parse({})");
      const builder = readFileSync(
        path.join(r.dest, "nodefony", "config", "defineModuleConfig.ts"),
        "utf8",
      );
      // Le builder VALIDE, il ne porte aucune valeur (règle d'or ADR-0006).
      assert.include(builder, "export function defineBlogConfig");
      assert.notInclude(builder, ".default(");
      const index = readFileSync(path.join(r.dest, "index.ts"), "utf8");
      assert.include(index, 'declare module "nodefony"');
      assert.include(index, '"@mapp/blog": BlogConfigInput;');
    });

    it("refuse un module qui existe déjà (sauf --force)", () => {
      const dest = app("mapp");
      mod(dest, { name: "blog", controller: "none" });
      assert.throws(
        () => mod(dest, { name: "blog", controller: "none" }),
        /existe déjà/u,
      );
    });

    it("refuse hors projet — avec le geste à faire", () => {
      assert.throws(
        () => mod(tmp, { name: "blog", controller: "none" }),
        /aucun projet Nodefony/u,
      );
    });

    it("refuse une brique absente de l'app plutôt que de générer du code mort", () => {
      // Preset minimal = ni realtime ni frontend dans l'app : un module ne peut
      // pas « ajouter » un paquet qui n'est pas installé.
      const dest = app("mini", "minimal");
      assert.throws(
        () => mod(dest, { name: "blog", controller: "realtime" }),
        /@nodefony\/realtime/u,
      );
      assert.throws(
        () => mod(dest, { name: "blog", frontend: "react" }),
        /@nodefony\/frontend/u,
      );
      // Rien n'a été écrit : la garde tombe AVANT le premier fichier.
      assert.isFalse(existsSync(path.join(dest, "modules", "blog")));
    });

    it("spec module : questions JSON-able, défauts sûrs (contrat des 3 fronts)", () => {
      const [spec] = getScaffoldSpec("module");
      assert.equal(spec.type, "module");
      const keys = spec.questions.map((q) => q.key);
      assert.deepEqual(keys, [
        "name",
        "description",
        "controller",
        "service",
        "command",
        "frontend",
      ]);
      const answers = resolveAnswers(
        spec,
        { name: "blog" },
        {
          hasCheckout: false,
        },
      );
      assert.deepEqual(answers, {
        name: "blog",
        description: "",
        controller: "hello",
        service: true,
        command: false,
        frontend: "none",
      });
      assert.throws(
        () =>
          resolveAnswers(spec, { name: "Blog Post" }, { hasCheckout: false }),
        /kebab-case/u,
      );
    });
  });

  describe("moteur — create front (in-project)", () => {
    const front = (from: string, answers: Record<string, string | boolean>) =>
      runScaffold({ type: "front", answers, dir: from, force: false }, version);

    it("app complete SANS front : coquille + entry + controller + double wiring", () => {
      const dest = path.join(tmp, "fapp");
      scaffold(dest, { name: "fapp", preset: "complete", frontend: "none" });
      const r = front(dest, { name: "dashboard", frontend: "react" });
      for (const f of [
        path.join("frontend", "index.html"),
        path.join("frontend", "src", "main.tsx"),
        path.join("frontend", "src", "App.tsx"),
        path.join("nodefony", "controllers", "DashboardController.ts"),
        path.join("nodefony", "frontend", "registerDashboardEntry.ts"),
      ]) {
        assert.isTrue(existsSync(path.join(dest, f)), `manque ${f}`);
      }
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, "DashboardController");
      assert.match(index, /@controllers\(\[[^\]]*DashboardController\]\)/u);
      assert.include(index, "registerDashboardEntry(this);");
      assert.include(index, "override async onKernelBoot()");
      // Deps du framework ajoutées au package.json (catalogue unique).
      const pkg = readJson(path.join(dest, "package.json"));
      assert.property(pkg["dependencies"], "react");
      assert.property(pkg["devDependencies"], "@vitejs/plugin-react");
      assert.include((r.notes ?? []).join("\n"), "npm install");
      // Le controller de page rend l'entry du BON nom.
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "DashboardController.ts"),
        "utf8",
      );
      assert.include(ctrl, 'renderDocument("dashboard"');
      assert.include(ctrl, 'path: "/dashboard"');
      assertNoEtaResidue(dest);
    });

    it("app-avec-front et front-ajouté partagent la MÊME source", () => {
      // Le gate de la mutualisation : `create app --frontend react` et
      // `create front --frontend react` rendaient chacun leur copie de l'entry
      // et de la déclaration. Comparer les deux sorties octet pour octet est la
      // seule façon de s'assurer que personne ne re-duplique le template — une
      // divergence future casse ce test, pas un rendu de page dans six mois.
      const withFront = path.join(tmp, "twin-a");
      scaffold(withFront, {
        name: "twin",
        preset: "minimal",
        frontend: "react",
      });
      // `complete` : c'est ce preset qui embarque @nodefony/frontend sans front
      // choisi — le décor minimal pour qu'un front puisse être AJOUTÉ ensuite.
      const added = path.join(tmp, "twin-b");
      scaffold(added, { name: "twin-b", preset: "complete", frontend: "none" });
      front(added, { name: "twin", frontend: "react" });

      const read = (root: string, ...rel: string[]) =>
        readFileSync(path.join(root, ...rel), "utf8");
      // Le point de montage ne porte aucune variable : strictement identique.
      assert.equal(
        read(added, "frontend", "src", "main.tsx"),
        read(withFront, "frontend", "src", "main.tsx"),
      );
      // La déclaration d'entry ne diffère que par le nom de l'entry Vite —
      // ici le même (« twin ») de part et d'autre, donc égalité stricte aussi.
      assert.equal(
        read(added, "nodefony", "frontend", "registerTwinEntry.ts"),
        read(withFront, "nodefony", "frontend", "registerTwinEntry.ts"),
      );
    });

    it("cible avec un front DÉJÀ posé → throw actionnable", () => {
      const dest = path.join(tmp, "fdup");
      scaffold(dest, { name: "fdup", preset: "complete", frontend: "react" });
      assert.throws(
        () => front(dest, { name: "extra", frontend: "react" }),
        /porte déjà un front/u,
      );
    });

    it("cible sans @nodefony/frontend (minimal none) → throw actionnable", () => {
      const dest = path.join(tmp, "fmin");
      scaffold(dest, { name: "fmin", preset: "minimal" });
      assert.throws(
        () => front(dest, { name: "page", frontend: "vue" }),
        /@nodefony\/frontend manque/u,
      );
    });

    it("vue : shim env.d.ts partagé ; angular : tsconfig.app.json partagé", () => {
      const v = path.join(tmp, "fvue");
      scaffold(v, { name: "fvue", preset: "complete", frontend: "none" });
      front(v, { name: "board", frontend: "vue" });
      assert.isTrue(existsSync(path.join(v, "frontend", "src", "env.d.ts")));
      const a = path.join(tmp, "fng");
      scaffold(a, { name: "fng", preset: "complete", frontend: "none" });
      front(a, { name: "board", frontend: "angular" });
      assert.isTrue(existsSync(path.join(a, "frontend", "tsconfig.app.json")));
    });

    it("les apps AVEC front gardent la coquille et les briques partagées", () => {
      // Non-régression du déplacement des layers (front-shell/vue-shim/ng-tsconfig).
      const rv = path.join(tmp, "regvue");
      scaffold(rv, { name: "regvue", preset: "minimal", frontend: "vue" });
      assert.isTrue(existsSync(path.join(rv, "frontend", "index.html")));
      assert.isTrue(existsSync(path.join(rv, "frontend", "src", "env.d.ts")));
      const rn = path.join(tmp, "regng");
      scaffold(rn, { name: "regng", preset: "minimal", frontend: "angular" });
      assert.isTrue(existsSync(path.join(rn, "frontend", "index.html")));
      assert.isTrue(existsSync(path.join(rn, "frontend", "tsconfig.app.json")));
      const pkg = readJson(path.join(rn, "package.json"));
      assert.property(pkg["devDependencies"], "@analogjs/vite-plugin-angular");
    });
  });

  describe("moteur — create entity (in-project)", () => {
    // Le dialecte suit l'INFRA DÉCLARÉE : sans ce décor explicite, les cas
    // ci-dessous héritaient du terminal, et un développeur qui garde
    // `NF_DATABASE_URL` dans son shell (docker local — le cas courant) voyait
    // quatre tests virer au rouge sans rapport avec son travail. Un test qui
    // hérite de l'environnement n'éprouve pas ce qu'il croit.
    let savedDbUrl: string | undefined;
    beforeEach(() => {
      savedDbUrl = process.env.NF_DATABASE_URL;
      delete process.env.NF_DATABASE_URL;
    });
    afterEach(() => {
      if (savedDbUrl === undefined) delete process.env.NF_DATABASE_URL;
      else process.env.NF_DATABASE_URL = savedDbUrl;
    });

    /** Scaffold entité depuis `from` (détection racine = comme le CLI). */
    const entity = (from: string, answers: Record<string, string | boolean>) =>
      runScaffold(
        { type: "entity", answers, dir: from, force: false },
        version,
      );

    /** App de fixture — preset `complete` : c'est lui qui embarque @nodefony/drizzle. */
    const app = (name: string, preset = "complete"): string => {
      const dest = path.join(tmp, name);
      scaffold(dest, { name, preset, frontend: "none" });
      return dest;
    };

    it("pose la chaîne complète : entité, schémas, service, controller, tests", () => {
      const dest = app("eapp");
      const r = entity(dest, {
        name: "Post",
        fields: "title:string content:text",
      });

      for (const f of [
        "nodefony/entity/Post.ts",
        "nodefony/entity/Post.schema.ts",
        "nodefony/service/PostService.ts",
        "nodefony/controllers/PostController.ts",
        "tests/post.test.ts",
      ]) {
        assert.isTrue(existsSync(path.join(dest, f)), `${f} manquant`);
      }
      assert.include((r.notes ?? []).join("\n"), "table posts (sqlite)");
      assertNoEtaResidue(dest);
    });

    it("le dialecte suit l'INFRA DÉCLARÉE, pas seulement le fichier de config", () => {
      // Une application déclare sa base par URL (conteneur, CI, production) et
      // `nodefony.config.ts` ne porte alors aucun dialecte. Le scaffold lisait
      // le seul fichier, retombait sur sqlite, et générait du Drizzle SQLite
      // pour une application tournant sur PostgreSQL — chaînes bornées rendues
      // en `text`, identifiants `uuid` rendus en `text`. Ce dernier point est
      // structurel : PostgreSQL refuse `text = uuid`, donc toute jointure
      // écrite ensuite échoue. Mesuré sur un schéma réel : 18 identifiants
      // dégradés et 32 longueurs perdues sur 83 colonnes, sans un mot.
      const dest = app("pgapp");
      process.env.NF_DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
      const r = entity(dest, {
        name: "Ticket",
        fields: "code:string(2)! ref:uuid!",
      });
      assert.include((r.notes ?? []).join("\n"), "(postgres)");
      const src = readFileSync(
        path.join(dest, "nodefony/entity/Ticket.ts"),
        "utf8",
      );
      assert.include(src, "drizzle-orm/pg-core");
      // Les deux traductions que le mauvais dialecte faisait disparaître.
      assert.include(src, 'varchar("code", { length: 2 })');
      assert.include(src, 'uuid("ref")');
    });

    /*
     *   Une table qui EXISTE impose ses noms.
     *
     *   Le générateur pluralisait sans échappatoire : sur les six tables d'un
     *   schéma réel, six portaient le mauvais nom, et il ne restait qu'à éditer.
     *   Les trois réglages ci-dessous ne changent que du SQL — le code
     *   TypeScript généré autour (service, controller, tests) continue de nommer
     *   `id` et `siteId`, sinon un réglage de nommage deviendrait une refonte.
     */
    it("--table impose le nom SQL, et la route reste celle de la ressource", () => {
      const dest = app("tblapp");
      const r = entity(dest, {
        name: "Website",
        fields: "name:string domain:string!",
        table: "website",
      });
      const src = readFileSync(
        path.join(dest, "nodefony/entity/Website.ts"),
        "utf8",
      );
      assert.include(src, 'sqliteTable("website"');
      assert.notInclude(src, '"websites"');
      assert.include((r.notes ?? []).join("\n"), "table website");
      // La route REST est une URL publique : elle suit la ressource, pas la table.
      const ctrl = readFileSync(
        path.join(dest, "nodefony/controllers/WebsiteController.ts"),
        "utf8",
      );
      assert.include(ctrl, "/api/websites");
    });

    it("--column-case snake et --id-name traversent le moteur jusqu'au fichier", () => {
      const dest = app("snakeapp");
      entity(dest, {
        name: "Website",
        fields: "siteName:string createdBy:uuid:index",
        table: "website",
        columnCase: "snake",
        idName: "website_id",
      });
      const src = readFileSync(
        path.join(dest, "nodefony/entity/Website.ts"),
        "utf8",
      );
      assert.include(src, 'text("website_id")');
      assert.include(src, 'siteName: text("site_name")');
      assert.include(src, 'createdBy: text("created_by")');
      assert.include(src, 'index("website_created_by_idx")');
      // L'invariant : le reste de la chaîne ne connaît que les propriétés.
      const service = readFileSync(
        path.join(dest, "nodefony/service/WebsiteService.ts"),
        "utf8",
      );
      assert.notInclude(service, "website_id");
    });

    it("un nom SQL invalide est refusé AVANT d'écrire quoi que ce soit", () => {
      const dest = app("badsql");
      // `table` et `idName` sont des chaînes libres : c'est le moteur qui les
      // juge. `columnCase` est un choix DÉCLARÉ dans la spec, donc rejeté plus
      // tôt, par le contrat commun aux trois fronts — le moteur n'a plus qu'à
      // s'en tenir à sa ceinture.
      for (const [answers, needle] of [
        [{ table: "Web Site" }, "--table"],
        [{ idName: "Website-Id" }, "--id-name"],
        [{ columnCase: "kebab" }, "columnCase"],
      ] as const) {
        assert.throws(
          () =>
            entity(dest, {
              name: "Website",
              fields: "name:string",
              ...answers,
            }),
          new RegExp(needle),
        );
      }
      assert.isFalse(
        existsSync(path.join(dest, "nodefony", "entity", "Website.ts")),
        "un refus ne doit laisser aucun fichier derrière lui",
      );
    });

    it("un dialecte ÉCRIT dans la config l'emporte sur l'environnement", () => {
      // L'inverse doit rester vrai : déclarer `dialect` est une intention
      // explicite, et une variable d'environnement ne la contredit pas. Sans
      // cette borne, poser une URL rendrait indéréglable un projet qui a
      // sciemment choisi son moteur.
      const dest = app("mixapp");
      const cfg = path.join(dest, "nodefony.config.ts");
      const before = readFileSync(cfg, "utf8");
      assert.isTrue(
        before.includes('"@nodefony/drizzle"'),
        "fixture inattendue : le preset complete ne déclare pas drizzle",
      );
      // Le gabarit déclare le module sans configurer de connecteur (l'infra
      // vient de l'URL) : on en pose un qui CHOISIT son dialecte.
      writeFileSync(
        cfg,
        before.replace(
          '"@nodefony/drizzle",',
          'use("@nodefony/drizzle", { connectors: { default: { dialect: "sqlite" } } }),',
        ),
      );
      process.env.NF_DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db";
      const r = entity(dest, { name: "Fixed", fields: "code:string!" });
      assert.include((r.notes ?? []).join("\n"), "(sqlite)");
    });

    it("drizzle-orm est déclaré par l'app (import direct de l'entité générée)", () => {
      // L'entité produite importe `drizzle-orm/<dialecte>-core` : c'est une dep DE
      // L'APP. Sans elle, la résolution ne tient que par le hissage npm des
      // transitives — absent quand les paquets nodefony sont liés en `file:`
      // (`--link`) : le typecheck échoue alors sur un import introuvable, loin de
      // la cause. Le gabarit `complete` la déclare…
      const dest = app("eapp-ormdep");
      const pkg = readJson(path.join(dest, "package.json"));
      assert.property(pkg["dependencies"], "drizzle-orm");

      // …et une app générée AVANT ce gabarit se rattrape au scaffold d'entité.
      const legacy = app("eapp-ormdep-legacy");
      const legacyPath = path.join(legacy, "package.json");
      const legacyPkg = readJson(legacyPath) as Record<
        string,
        Record<string, string>
      >;
      delete legacyPkg["dependencies"]["drizzle-orm"];
      writeFileSync(legacyPath, `${JSON.stringify(legacyPkg, null, 2)}\n`);

      const r = entity(legacy, { name: "Post", fields: "title:string" });
      assert.property(readJson(legacyPath)["dependencies"], "drizzle-orm");
      assert.include(
        (r.notes ?? []).join("\n"),
        "drizzle-orm",
        "l'ajout d'une dépendance doit être ANNONCÉ (npm install requis)",
      );
    });

    it("nom RÉSERVÉ par un module du framework → refus AVANT écriture", () => {
      // Vécu : `create entity User` écrit tout, puis l'application ne démarre plus
      // — l'entité `User` du module `user` est dépossédée et l'erreur parle d'une
      // colonne inconnue, jamais du doublon. La casse ne sauve pas : `access_token`
      // et `AccessToken` désignent la même table.
      const dest = app("eapp-reserved");
      for (const name of ["User", "user", "AccessToken", "session"]) {
        assert.throws(
          () => entity(dest, { name, fields: "title:string" }),
          /appartient au module/u,
          `${name} doit être refusé`,
        );
      }
      // Refus AVANT écriture : rien ne traîne dans l'app.
      assert.isFalse(
        existsSync(path.join(dest, "nodefony", "entity", "User.ts")),
      );
      // Contre-épreuve : un nom voisin mais libre passe (la garde ne sur-bloque pas).
      const ok = entity(dest, { name: "UserProfile", fields: "bio:text" });
      assert.isTrue(
        existsSync(path.join(dest, "nodefony", "entity", "UserProfile.ts")),
        `UserProfile doit passer — notes: ${(ok.notes ?? []).join(" ")}`,
      );
    });

    it("l'entité est du Drizzle natif, avec la clé uuid7 générée côté JS", () => {
      const dest = app("eapp2");
      entity(dest, { name: "Post", fields: "title:string! views:int" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.include(src, 'from "drizzle-orm/sqlite-core"');
      assert.include(src, 'export const postTable = sqliteTable("posts"');
      assert.include(src, "Nodefony.generateSortableId()");
      assert.match(src, /title: text\("title"\)\.notNull\(\)\.unique\(\)/u);
      // Le descripteur ne fige PAS le connecteur (donnée de config, résolue au boot).
      assert.include(src, "export const PostEntity = defineEntity({");
      assert.notMatch(src, /connector:\s*["']/u);
    });

    it("le contrat d'entrée dérive la mise à jour, et exclut id/horodatages", () => {
      const dest = app("eapp3");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.schema.ts"),
        "utf8",
      );
      assert.include(src, "export const createPostSchema = z.object({");
      assert.include(src, "createPostSchema.partial()");
      assert.notInclude(src, "id:");
      assert.notInclude(src, "createdAt");
    });

    it("le controller sert REST ET la socket, avec les bons statuts", () => {
      const dest = app("eapp4");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      assert.include(src, '@controller("/api/posts")');
      assert.include(src, 'methods: ["GET", "WEBSOCKET"]'); // le différenciateur
      assert.include(src, "@HttpCode(201)");
      // Le décorateur RÉEL, pas la phrase de la TSDoc qui le mentionne : la
      // forme souple (`required: false`) est ce qui distingue « rejeu toléré »
      // de « clé obligatoire », et c'est elle qu'on veut voir générée.
      assert.include(src, "@Idempotent({ required: false })");
      assert.include(src, '"Location"');
      assert.include(src, "@HttpCode(204)");
      assert.include(src, "404");
    });

    // Une liste qui ne dit pas s'il en reste n'est pas paginée : le client ne
    // peut pas distinguer « c'est tout » de « demande la suite ».
    it("la liste rend une PAGE, pas un tableau nu — et son ordre est déterministe", () => {
      const dest = app("eapp4b");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      assert.include(src, "listPageResource(");
      assert.notInclude(src, "listResource(");
      // Tri par défaut : sans lui, deux pages consécutives peuvent montrer la
      // même ligne ou en sauter une, sans que rien ne le signale.
      assert.include(src, '[["createdAt", "DESC"], ["id", "DESC"]]');
      // Allowlist de tri : un `?sort=` libre laisserait le client nommer une
      // colonne inconnue, et l'ORM lèverait — un 500 offert à qui tape au hasard.
      assert.match(src, /const SORTABLE = new Set<string>\(\[[^\]]*"title"/u);
      assert.include(src, "SORTABLE.has(field)");
    });

    it("sans horodatage, l'ordre par défaut retombe sur l'id (jamais rien)", () => {
      const dest = app("eapp4c");
      entity(dest, {
        name: "Post",
        fields: "title:string",
        timestamps: false,
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      assert.include(src, '[["id", "DESC"]]');
      assert.notInclude(src, "createdAt");
    });

    // PUT et PATCH ne doivent PAS faire la même chose : sinon le PUT ment sur
    // son contrat (RFC 9110 §9.3.4) et l'exemple enseigne le mensonge.
    it("PUT remplace (corps complet) et PATCH retouche — la différence est réelle", () => {
      const dest = app("eapp4d");
      entity(dest, { name: "Post", fields: "title:string" });
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      const service = readFileSync(
        path.join(dest, "nodefony", "service", "PostService.ts"),
        "utf8",
      );
      assert.include(ctrl, '@Patch("/{id}")');
      assert.include(ctrl, '@Put("/{id}")');
      // Le PUT passe par le service (schéma de CRÉATION = corps complet exigé),
      // le PATCH par le helper générique (schéma partiel).
      assert.include(ctrl, "getPostService().replace(id, payload)");
      assert.include(ctrl, "this.updateResource({ id }, payload)");
      assert.include(service, "async replace(");
      assert.include(service, "createPostSchema.parse(");
    });

    // Une relation déclarée en `ref:` doit devenir une relation RÉELLE : le
    // graphe Studio et l'eager-load la consomment. Une colonne + un commentaire
    // ne sont pas une relation.
    it("`ref:` renseigne defineEntity({ relations }) et ouvre ?include=", () => {
      const dest = app("eapp4e");
      entity(dest, { name: "Author", fields: "email:string!" });
      entity(dest, { name: "Post", fields: "title:string author:ref:Author" });
      const ent = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      assert.include(ent, "relations: [");
      assert.include(ent, 'type: "many-to-one"');
      assert.include(ent, 'target: "Author"');
      assert.include(ent, 'field: "author"');
      // `foreignKey` EXPLICITE : l'adapter déduirait `userId` (d'après la cible)
      // alors que la colonne porte le nom du champ. Une relation dérivée
      // pointerait une colonne qui n'existe pas.
      assert.include(ent, 'foreignKey: "author"');
      // Côté porte : allowlist d'include, jamais un include libre.
      assert.include(ctrl, 'const INCLUDABLE = new Set<string>(["author"])');
      assert.include(ctrl, "INCLUDABLE.has(name)");
    });

    // Une entité sans champ produit un CRUD qui « marche » et ne transporte rien.
    // Ce qu'un front (Studio, terminal, agent) doit pouvoir demander AU PROJET
    // plutôt que le deviner : ses connecteurs, ses entités, la traduction réelle
    // des types dans son moteur.
    it("le contexte du projet décrit ce que le projet offre RÉELLEMENT", () => {
      const dest = app("eapp4m");
      entity(dest, { name: "Author", fields: "email:string!" });
      const context = getScaffoldContext(dest);
      assert.isNotNull(context);
      const ctx = context as NonNullable<typeof context>;

      // Les connecteurs viennent de la configuration, pas d'une liste figée.
      assert.isAtLeast(ctx.connectors.length, 1);
      assert.deepEqual(
        ctx.connectors.map((c) => c.name),
        ["default"],
      );
      assert.equal(ctx.connectors[0].dialect, "sqlite");

      // Les entités existantes : c'est ce que `ref:` peut viser.
      const appTarget = ctx.targets.find((t) => t.kind === "app");
      assert.isDefined(appTarget);
      assert.include(ctx.entities[appTarget!.name], "Author");
      // Le schéma Zod n'est pas une entité — il ne doit pas polluer les choix.
      assert.notInclude(ctx.entities[appTarget!.name], "Author.schema");

      // La traduction par moteur est MONTRÉE : c'est elle qui guide le choix.
      const json = ctx.columnTypes.find((t) => t.type === "json");
      assert.isDefined(json);
      assert.include(json!.byDialect.postgres, "jsonb");
      assert.include(json!.byDialect.sqlite, 'mode: "json"');
    });

    it("hors projet, le contexte est nul plutôt qu'inventé", () => {
      assert.isNull(getScaffoldContext(os.tmpdir()));
    });

    // Chercher le premier `dialect:` du fichier faisait générer TOUTES les
    // entités dans le moteur du premier connecteur, sans un mot — une entité
    // « analytics » naissait en SQLite alors que sa base est PostgreSQL.
    it("plusieurs connecteurs : chacun garde SON moteur", () => {
      const dest = app("eapp4n");
      const configPath = path.join(dest, "nodefony.config.ts");
      const config = readFileSync(configPath, "utf8").replace(
        '"@nodefony/drizzle",',
        `use("@nodefony/drizzle", {
      connectors: {
        default: { dialect: "sqlite" },
        analytics: { dialect: "postgres" },
      },
    }),`,
      );
      writeFileSync(configPath, config);

      const ctx = getScaffoldContext(dest);
      assert.deepEqual(ctx?.connectors, [
        { name: "default", dialect: "sqlite" },
        { name: "analytics", dialect: "postgres" },
      ]);

      // Et le scaffold suit : l'entité posée sur `analytics` naît en PostgreSQL.
      entity(dest, {
        name: "Visit",
        fields: "path:string meta:json",
        connector: "analytics",
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Visit.ts"),
        "utf8",
      );
      assert.include(src, "pgTable");
      assert.include(src, 'jsonb("meta")');
      assert.include(src, 'connector: "analytics"');
    });

    it("refuse une entité sans champ, et n'écrit rien", () => {
      const dest = app("eapp4g");
      const before = snapshotTree(dest);
      assert.throws(
        () => entity(dest, { name: "Post", fields: "" }),
        /aucun champ/u,
      );
      assertTreeUnchanged(before, dest);
    });

    it("enum et défaut traversent jusqu'au fichier généré", () => {
      const dest = app("eapp4h");
      entity(dest, {
        name: "Post",
        fields:
          "status:enum(draft,published)=draft views:int=0 title:string:index",
      });
      const ent = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      const schema = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.schema.ts"),
        "utf8",
      );
      // La colonne porte l'énumération au typage…
      assert.include(ent, 'enum: ["draft", "published"] as const');
      // …et le défaut est posé côté JS (le DDL dev n'émet pas les DEFAULT SQL).
      assert.include(ent, '$defaultFn(() => "draft")');
      assert.include(ent, "$defaultFn(() => 0)");
      // …tandis que Zod le fait respecter à l'entrée, sur tous les transports.
      assert.include(schema, 'z.enum(["draft", "published"])');
      // `:index` produit un index RÉEL, préfixé par la table (unicité globale).
      assert.include(ent, 'index("posts_title_idx").on(t.title)');
      assert.match(ent, /import \{[^}]*\bindex\b[^}]*\} from "drizzle-orm/u);
    });

    // Le test data ne prouve pas que la ressource est SERVIE : routage,
    // décorateurs, statuts et sérialisation ne sont traversés qu'en HTTP réel.
    it("génère un test HTTP de bout en bout, hors du glob par défaut", () => {
      const dest = app("eapp4i");
      entity(dest, { name: "Post", fields: "title:string!" });
      const e2e = readFileSync(
        path.join(dest, "tests", "post.e2e.test.ts"),
        "utf8",
      );
      assert.include(e2e, "expect(created.status).toBe(201)");
      assert.include(e2e, '"location"');
      assert.include(e2e, "toBe(422)");
      assert.include(e2e, "expect(page.hasNext).toBe(true)");
      assert.include(e2e, "expect(removed.status).toBe(204)");
      assert.include(e2e, 'method: "PATCH"');
      // Champ unique déclaré → le doublon DOIT être éprouvé.
      assert.include(e2e, "expect(duplicate.status).toBe(409)");
    });

    // Sans cette garde, l'app se génère mais ne démarre plus : l'ORM résout les
    // relations au connect et lève sur une cible inconnue — un message qui parle
    // de registre d'entités, jamais du champ fautif.
    it("refuse une relation vers une entité qui n'existe pas, et n'écrit rien", () => {
      const dest = app("eapp4k");
      const before = snapshotTree(dest);
      assert.throws(
        () => entity(dest, { name: "Post", fields: "author:ref:Ghost" }),
        /Ghost/u,
      );
      assertTreeUnchanged(before, dest);
    });

    it("le test data généré enregistre les entités cibles des relations", () => {
      const dest = app("eapp4l");
      entity(dest, { name: "Author", fields: "email:string!" });
      entity(dest, { name: "Post", fields: "title:string author:ref:Author" });
      const src = readFileSync(
        path.join(dest, "tests", "post.test.ts"),
        "utf8",
      );
      assert.include(
        src,
        'import { AuthorEntity } from "../nodefony/entity/Author"',
      );
      assert.include(
        src,
        "entityRegistry.register({ ...AuthorEntity, connector: ORM })",
      );
      assert.include(src, 'entityRegistry.unregister("Author", ORM)');
    });

    it("sans champ unique, le cas 409 n'est PAS généré (il ne pourrait pas passer)", () => {
      const dest = app("eapp4j");
      entity(dest, { name: "Post", fields: "title:string" });
      const e2e = readFileSync(
        path.join(dest, "tests", "post.e2e.test.ts"),
        "utf8",
      );
      assert.notInclude(e2e, "409");
    });

    it("sans relation, aucune mécanique d'include n'est générée", () => {
      const dest = app("eapp4f");
      entity(dest, { name: "Post", fields: "title:string" });
      const ent = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      assert.notInclude(ent, "relations:");
      assert.notInclude(ctrl, "INCLUDABLE");
      assert.notInclude(ctrl, "parseInclude");
    });

    it("le service porte la validation — donc tous les transports en profitent", () => {
      const dest = app("eapp5");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "service", "PostService.ts"),
        "utf8",
      );
      assert.include(src, "extends AbstractCrudService<PostRow>");
      assert.include(src, "beforeCreate");
      assert.include(src, "createPostSchema.parse(data)");
      // Repository résolu au PREMIER USAGE : l'ORM ne se connecte qu'à onBoot.
      assert.include(src, "export function getPostService()");
    });

    it("câble l'index : @entities créé de toutes pièces + @controllers complété", () => {
      const dest = app("eapp6");
      entity(dest, { name: "Post", fields: "title:string" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");

      // Import NOMMÉ : un descripteur d'entité est une const exportée, pas un default
      // (contrairement à un controller). Un `import X from …` ne compilerait pas.
      assert.include(
        index,
        'import { PostEntity } from "./nodefony/entity/Post";',
      );
      assert.include(index, 'import { entities } from "@nodefony/orm-core";');
      assert.match(index, /@entities\(\[PostEntity\]\)/u);
      assert.match(index, /@controllers\(\[[^\]]*PostController\]\)/u);
    });

    it("deuxième entité : le décorateur EXISTANT est complété, pas dupliqué", () => {
      const dest = app("eapp7");
      entity(dest, { name: "Post", fields: "title:string" });
      entity(dest, { name: "Comment", fields: "body:text" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");

      assert.match(index, /@entities\(\[PostEntity, CommentEntity\]\)/u);
      assert.strictEqual(index.match(/@entities\(/gu)?.length, 1);
      // L'import du décorateur ne doit pas être ajouté deux fois.
      assert.strictEqual(
        index.match(/import \{ entities \} from "@nodefony\/orm-core";/gu)
          ?.length,
        1,
      );
      // ⚠️ RÉGRESSION : la 2ᵉ entité passait par le wiring des CONTROLLERS, qui écrit
      // un import PAR DÉFAUT → `MISSING_EXPORT "default"` au build (vécu). Un
      // descripteur d'entité est une const NOMMÉE — les DEUX imports doivent l'être.
      assert.include(
        index,
        'import { CommentEntity } from "./nodefony/entity/Comment";',
      );
      assert.notMatch(index, /import \w+Entity from /u);
    });

    it("trois entités : chaque import reste nommé, la liste s'allonge", () => {
      const dest = app("eapp7b");
      entity(dest, { name: "Post", fields: "title:string" });
      entity(dest, { name: "Comment", fields: "body:text" });
      entity(dest, { name: "Tag", fields: "label:string" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");

      assert.match(
        index,
        /@entities\(\[PostEntity, CommentEntity, TagEntity\]\)/u,
      );
      assert.notMatch(index, /import \w+Entity from /u);
    });

    it("--dialect postgres : pgTable et jsonb", () => {
      const dest = app("eapp8");
      entity(dest, {
        name: "Post",
        fields: "meta:json",
        dialect: "postgres",
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.include(src, 'from "drizzle-orm/pg-core"');
      assert.include(src, "pgTable");
      assert.include(src, 'jsonb("meta")');
    });

    it("--no-controller : ni controller ni wiring de controller", () => {
      const dest = app("eapp9");
      entity(dest, { name: "Post", fields: "title:string", controller: false });
      assert.isFalse(
        existsSync(
          path.join(dest, "nodefony", "controllers", "PostController.ts"),
        ),
      );
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.match(index, /@entities\(\[PostEntity\]\)/u);
      assert.notInclude(index, "PostController");
    });

    describe("ancre de la classe Module (findModuleClassAnchor)", () => {
      it("remonte les décorateurs de classe, parenthèses imbriquées comprises", () => {
        const source =
          `import { Module } from "nodefony";\n\n` +
          `@services([A])\n` +
          `@entities([defineEntity(x)])\n` +
          `class App extends Module {}\n`;
        const at = findModuleClassAnchor(source);
        assert.isNumber(at);
        // L'insertion se fait AU-DESSUS des décorateurs, pas entre eux et la classe.
        assert.strictEqual(
          source.slice(at as number),
          "@services([A])\n@entities([defineEntity(x)])\nclass App extends Module {}\n",
        );
      });

      it("sans décorateur : l'ancre est la classe elle-même", () => {
        const source = `import { Module } from "nodefony";\n\nclass App extends Module {}\n`;
        assert.strictEqual(
          source.slice(findModuleClassAnchor(source) as number),
          "class App extends Module {}\n",
        );
      });

      it("aucune classe Module → undefined (l'appelant rend son geste manuel)", () => {
        assert.isUndefined(findModuleClassAnchor(`export const x = 1;\n`));
      });

      // 🔴 GARDE ANTI-ReDoS. L'ancienne regex `(?:@[\w.]+\([\s\S]*?\)\s*)*class …`
      // était EXPONENTIELLE au backtracking, et son pire cas était précisément le
      // cas d'échec de l'appelant (aucune classe à trouver) : mesuré 636 ms à 26
      // décorateurs, ×3,5 par paire — ~40 s à 34, des heures à 60. La commande
      // figeait au lieu de dire « ajoute à la main ». Ce test échoue par TIMEOUT
      // si le balayage redevient une regex ambiguë.
      it("60 décorateurs sans classe : rend la main immédiatement", () => {
        const evil = "@a()".repeat(60) + "class X extends Modul";
        const started = process.hrtime.bigint();
        assert.isUndefined(findModuleClassAnchor(evil));
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        assert.isBelow(
          ms,
          50,
          `${ms.toFixed(1)} ms — backtracking exponentiel`,
        );
      });
    });

    it("nom normalisé : PostEntity → Post (le suffixe n'est jamais redoublé)", () => {
      const dest = app("eapp10");
      entity(dest, { name: "PostEntity", fields: "title:string" });
      assert.isTrue(
        existsSync(path.join(dest, "nodefony", "entity", "Post.ts")),
      );
    });

    it("--connector : l'ENTITÉ porte le connecteur, pas seulement le service", () => {
      // ⚠️ RÉGRESSION (vécue en important un schéma tiers sur une base dédiée) : seul
      // le service lisait `--connector`. Le descripteur, lui, restait sur `default` →
      // les tables étaient créées dans la base de l'APP pendant que le service les
      // cherchait dans l'autre. Les deux moitiés de la chaîne parlaient de deux bases.
      const dest = app("eapp13");
      entity(dest, {
        name: "Post",
        fields: "title:string",
        connector: "wordpress",
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.match(src, /connector: "wordpress"/u);
      const service = readFileSync(
        path.join(dest, "nodefony", "service", "PostService.ts"),
        "utf8",
      );
      assert.include(service, 'ormRegistry.get("wordpress")');
    });

    it("connecteur par défaut : l'entité ne fige RIEN (donnée de config)", () => {
      const dest = app("eapp14");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.notMatch(src, /connector:\s*["']/u);
    });

    it("une RELATION en DERNIER champ : la table se ferme proprement", () => {
      // ⚠️ RÉGRESSION (vécue en appliquant un vrai schéma) : eta supprime le saut de
      // ligne qui suit une interpolation, donc `});` remontait sur la dernière ligne
      // rendue. Tant qu'elle finissait par une virgule, `…,});` restait VALIDE —
      // invisible. Mais le commentaire de fin de ligne d'un champ `ref` avalait la
      // fermeture : `…, // → User.id …});` ne compile pas.
      const dest = app("eapp12");
      // La cible d'une relation doit exister : l'ORM la résout au connect et lève
      // sinon (l'app ne démarrerait pas). Le scaffold refuse donc en amont.
      entity(dest, { name: "Author", fields: "email:string!" });
      // `timestamps: false` : SANS ça, createdAt/updatedAt suivent la relation et le
      // commentaire n'est plus en dernière position — le bug ne se reproduit pas.
      entity(dest, {
        name: "Comment",
        fields: "body:text author:ref:Author",
        timestamps: false,
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Comment.ts"),
        "utf8",
      );
      // Le commentaire de la relation est bien SUIVI d'un saut de ligne avant la
      // fermeture de l'objet de colonnes — laquelle porte maintenant le 3ᵉ
      // argument (l'index automatique de la colonne de jointure).
      assert.match(src, /\/\/ → Author\.id[^\n]*\n\}/u);
      assert.notMatch(src, /\}\);.*\/\//u);
      // L'index EST là, et il porte bien sur la colonne de relation.
      assert.match(src, /index\("comments_author_idx"\)\.on\(t\.author\)/u);
      assert.include(src, "import { index, sqliteTable");
      // Idem pour l'interface de ligne et le schéma Zod (mêmes interpolations).
      assert.match(src, /author: string;\n\}/u);
    });

    it("table au pluriel, y compris irrégulier (Story → stories)", () => {
      const dest = app("eapp11");
      entity(dest, { name: "Story", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Story.ts"),
        "utf8",
      );
      assert.include(src, 'sqliteTable("stories"');
    });

    describe("gardes — aucun fichier écrit si elles tombent", () => {
      it("app SANS ORM : refus actionnable plutôt que du code mort", () => {
        const dest = app("bare", "minimal"); // minimal = pas de drizzle
        assert.throws(
          () => entity(dest, { name: "Post", fields: "title:string" }),
          /@nodefony\/drizzle absent/u,
        );
        assert.isFalse(existsSync(path.join(dest, "nodefony", "entity")));
      });

      it("hors projet : refus", () => {
        assert.throws(
          () => entity(tmp, { name: "Post", fields: "title:string" }),
          /aucun projet Nodefony/u,
        );
      });

      it("entité déjà déclarée : refus SANS toucher au projet", () => {
        const dest = app("dup");
        entity(dest, { name: "Post", fields: "title:string" });
        // L'empreinte est prise APRÈS le premier scaffold : c'est le travail de
        // l'utilisateur que le second appel ne doit pas effleurer.
        const before = snapshotTree(dest);
        assert.throws(
          () => entity(dest, { name: "Post", fields: "other:string" }),
          /déjà référencé/u,
        );
        assertTreeUnchanged(before, dest);
      });

      it("champ mal formé : refus avec le mot « invalide » (→ EX_USAGE)", () => {
        const dest = app("badfield");
        assert.throws(
          () => entity(dest, { name: "Post", fields: "title:wat" }),
          /invalide/u,
        );
      });

      it("module cible inconnu : refus, cibles listées", () => {
        const dest = app("nomod");
        assert.throws(
          () =>
            entity(dest, {
              name: "Post",
              fields: "title:string",
              module: "@x/absent",
            }),
          /introuvable/u,
        );
      });
    });
  });

  describe("moteur — create command (in-project)", () => {
    /** App de fixture, avec un module `blog` qui porte un service. */
    const appWithModule = (name: string): string => {
      const dest = path.join(tmp, name);
      scaffold(dest, { name, preset: "minimal", frontend: "none" });
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none", service: true },
          dir: dest,
          force: false,
        },
        version,
      );
      return dest;
    };

    const command = (
      from: string,
      answers: Record<string, string | boolean>,
      force = false,
    ) => runScaffold({ type: "command", answers, dir: from, force }, version);

    it("dérive `<module>:<action>` du Module cible, pas du nom npm", () => {
      const dest = appWithModule("cmdapp");
      const r = command(dest, { name: "publish", module: "@cmdapp/blog" });
      const file = path.join(
        r.dest,
        "nodefony",
        "command",
        "PublishCommand.ts",
      );
      assert.isTrue(existsSync(file), "commande non rendue dans le module");
      const src = readFileSync(file, "utf8");
      // Le nom npm est `@cmdapp/blog` ; le nom Nodefony est `blog` — c'est le
      // second qui préfixe la commande, parce que c'est lui qui existe au runtime.
      assert.include(src, 'super("blog:publish"');
      assert.include(src, 'kernelEvent: "onReady"');
      assert.notMatch(src, /<%|%>/u, "balise de template non rendue");
      assert.deepInclude(
        r.notes ?? [],
        "CLI  nodefony blog:publish [who] [-j]  (phase onReady)",
      );
    });

    it("câble `this.addCommand(...)` après le super(…) du constructeur", () => {
      const dest = appWithModule("cmdwire");
      const r = command(dest, { name: "publish", module: "@cmdwire/blog" });
      const index = readFileSync(path.join(r.dest, "index.ts"), "utf8");
      assert.include(
        index,
        'import PublishCommand from "./nodefony/command/PublishCommand";',
      );
      // L'ORDRE compte : un addCommand AVANT le super() lèverait au runtime
      // (« must call super before accessing this »). On l'ancre, au lieu de se
      // contenter de la présence des deux lignes.
      assert.match(
        index,
        /super\([^()]*\);\n\s*this\.addCommand\(PublishCommand\);/u,
        "addCommand doit suivre immédiatement le super(…)",
      );
    });

    it("app racine : cible par défaut, préfixe `app`", () => {
      const dest = appWithModule("cmdroot");
      const r = command(dest, { name: "seed" });
      assert.equal(r.dest, dest);
      const src = readFileSync(
        path.join(dest, "nodefony", "command", "SeedCommand.ts"),
        "utf8",
      );
      assert.include(src, 'super("app:seed"');
      // Câblé dans l'index de l'APP, pas dans celui du module.
      assert.include(
        readFileSync(path.join(dest, "index.ts"), "utf8"),
        "this.addCommand(SeedCommand)",
      );
      assert.notInclude(
        readFileSync(path.join(dest, "modules", "blog", "index.ts"), "utf8"),
        "SeedCommand",
      );
    });

    it("tolère le préfixe déjà écrit, et garde les sous-actions", () => {
      const dest = appWithModule("cmdpfx");
      // Réflexe naturel de qui a lu `nodefony blog:publish` dans l'aide.
      const a = command(dest, { name: "blog:publish", module: "@cmdpfx/blog" });
      assert.include(
        readFileSync(
          path.join(a.dest, "nodefony", "command", "PublishCommand.ts"),
          "utf8",
        ),
        'super("blog:publish"',
      );
      // Sous-action (convention `security:user:add`) : le `:` interne survit,
      // et la classe s'en déduit sans lui.
      const b = command(dest, { name: "user:add", module: "@cmdpfx/blog" });
      assert.include(
        readFileSync(
          path.join(b.dest, "nodefony", "command", "UserAddCommand.ts"),
          "utf8",
        ),
        'super("blog:user:add"',
      );
    });

    it("plusieurs commandes cohabitent dans la même cible", () => {
      const dest = appWithModule("cmdmulti");
      command(dest, { name: "publish", module: "@cmdmulti/blog" });
      const r = command(dest, { name: "archive", module: "@cmdmulti/blog" });
      const index = readFileSync(path.join(r.dest, "index.ts"), "utf8");
      assert.include(index, "this.addCommand(PublishCommand);");
      assert.include(index, "this.addCommand(ArchiveCommand);");
    });

    it("--phase choisit le point d'arrêt du boot ; une phase inconnue est refusée", () => {
      const dest = appWithModule("cmdphase");
      const r = command(dest, {
        name: "serve",
        phase: "onPostReady",
        module: "@cmdphase/blog",
      });
      assert.include(
        readFileSync(
          path.join(r.dest, "nodefony", "command", "ServeCommand.ts"),
          "utf8",
        ),
        'kernelEvent: "onPostReady"',
      );
      assert.throws(
        () =>
          command(dest, {
            name: "boom",
            phase: "onWhenever",
            module: "@cmdphase/blog",
          }),
        // Refusée par la spec elle-même (question de type `choice`) : le moteur
        // n'a pas à revalider ce que `resolveAnswers` garantit déjà.
        /phase invalide « onWhenever »/u,
      );
    });

    it("--service : appelle le service par sa CLÉ, et refuse s'il n'y en a pas", () => {
      const dest = appWithModule("cmdsvc");
      const r = command(dest, {
        name: "greet",
        service: true,
        module: "@cmdsvc/blog",
      });
      const src = readFileSync(
        path.join(r.dest, "nodefony", "command", "GreetCommand.ts"),
        "utf8",
      );
      assert.include(src, 'get("blog")');
      // La méthode est CHERCHÉE dans le service, pas supposée par son nom.
      assert.include(src, "await svc.greet()");
      // Eta AVALE le saut de ligne qui suit un tag placé en fin de ligne : la
      // ligne suivante se recolle à la précédente, et le fichier part avec un
      // TSDoc recousu ou un type coupé en deux. Vu sur pièce en écrivant ce
      // template (« — Publie les brouillons *\n * Convention ») — d'où un
      // contrôle de FORME, que les assertions de contenu ne voient pas.
      assert.notMatch(
        src,
        /^ \*.*\S \*$/mu,
        "ligne de TSDoc recollée — tag eta en fin de ligne",
      );
      assert.match(src, /as BlogService \| undefined;/u);
      // L'app racine n'a pas de service : produire l'appel ne compilerait pas —
      // on refuse AVANT d'écrire plutôt que de livrer du code cassé.
      assert.throws(
        () => command(dest, { name: "greet", service: true }),
        /aucun service appelable/u,
      );
    });

    /**
     * Le gabarit de service dit « Exemple de méthode métier — à remplacer par la
     * vôtre ». La garde de `--service`, elle, exigeait cette méthode par son NOM
     * (`greet`) : suivre le conseil du gabarit cassait l'option, sur un message
     * qui réclamait une méthode d'exemple. Trouvé en dogfoodant sur un vrai
     * module. Un générateur ne peut pas exiger que son propre exemple soit resté
     * intact — c'est même l'inverse de ce qu'on lui demande.
     */
    it("--service : marche encore quand la méthode d'exemple a été REMPLACÉE", () => {
      const dest = appWithModule("cmdrenamed");
      const svcPath = path.join(
        dest,
        "modules",
        "blog",
        "nodefony",
        "service",
        "BlogService.ts",
      );
      const rewritten = readFileSync(svcPath, "utf8").replace(
        /greet\(who = "monde"\): string \{/u,
        "publier(): string {",
      );
      assert.notInclude(rewritten, "greet(", "réécriture du service ratée");
      writeFileSync(svcPath, rewritten);

      const r = command(dest, {
        name: "publish",
        service: true,
        module: "@cmdrenamed/blog",
      });
      const src = readFileSync(
        path.join(r.dest, "nodefony", "command", "PublishCommand.ts"),
        "utf8",
      );
      assert.include(src, "await svc.publier()");
    });

    it("--service : refuse une méthode qui exige un argument (l'appel ne compilerait pas)", () => {
      const dest = appWithModule("cmdargs");
      const svcPath = path.join(
        dest,
        "modules",
        "blog",
        "nodefony",
        "service",
        "BlogService.ts",
      );
      const rewritten = readFileSync(svcPath, "utf8")
        .replace(/greet\(who = "monde"\): string \{/u, "publier(id: string) {")
        .replace(
          /status\(\): \{ ready: boolean \} \{/u,
          "etat(flag: boolean) {",
        );
      writeFileSync(svcPath, rewritten);
      assert.throws(
        () =>
          command(dest, {
            name: "publish",
            service: true,
            module: "@cmdargs/blog",
          }),
        /aucun service appelable/u,
      );
    });

    it("refuse un nom déjà pris, une cible inconnue, une action vide", () => {
      const dest = appWithModule("cmdguard");
      command(dest, { name: "publish", module: "@cmdguard/blog" });
      assert.throws(
        () => command(dest, { name: "publish", module: "@cmdguard/blog" }),
        /déjà référencé/u,
      );
      assert.throws(
        () => command(dest, { name: "publish", module: "@cmdguard/absent" }),
        /introuvable/u,
      );
      assert.throws(
        () => command(dest, { name: "blog", module: "@cmdguard/blog" }),
        /action requise/u,
      );
    });

    it("hors projet : refus propre", () => {
      assert.throws(
        () => command(tmp, { name: "publish" }),
        /aucun projet Nodefony ici/u,
      );
    });
  });

  describe("mode machine (--describe-json / --answers-json)", () => {
    /** Capture stdout d'un appel de commande (le mode machine ÉCRIT du JSON). */
    const capture = async (...words: string[]): Promise<[number, string]> => {
      const chunks: string[] = [];
      const stdout = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        chunks.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        const code = await runCreateCommand(argv("create", ...words));
        return [code, chunks.join("")];
      } finally {
        process.stdout.write = stdout;
      }
    };

    it("--describe-json sans type : catalogue complet, JSON valide", async () => {
      const [code, out] = await capture("--describe-json");
      assert.equal(code, SysExit.OK);
      const doc = JSON.parse(out) as {
        types: { type: string; questions: { key: string }[] }[];
        caps: { hasCheckout: boolean };
        usage: Record<string, string>;
      };
      assert.sameMembers(
        doc.types.map((t) => t.type),
        [
          "app",
          "module",
          "controller",
          "service",
          "front",
          "entity",
          "command",
        ],
      );
      // Ce que l'agent doit pouvoir apprendre sans lire une ligne de source.
      const entity = doc.types.find((t) => t.type === "entity");
      assert.includeMembers(
        (entity?.questions ?? []).map((q) => q.key),
        ["name", "fields", "id"],
      );
      assert.isBoolean(doc.caps.hasCheckout);
      assert.property(doc.usage, "answers");
    });

    it("--describe-json <type> : ce type seul", async () => {
      const [, out] = await capture("controller", "--describe-json");
      const doc = JSON.parse(out) as { types: { type: string }[] };
      assert.deepEqual(
        doc.types.map((t) => t.type),
        ["controller"],
      );
    });

    it("--answers-json : réponses lues, les flags l'emportent", async () => {
      const dest = path.join(tmp, "mj");
      const file = path.join(tmp, "answers.json");
      writeFileSync(
        file,
        JSON.stringify({ name: "mj", preset: "complete", frontend: "none" }),
      );
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "--dir",
          dest,
          "--answers-json",
          file,
          // Le flag contredit le fichier : c'est le geste le plus explicite de
          // l'appel, il doit gagner.
          "--preset",
          "minimal",
          "--no-install",
          "--no-git",
        ),
      );
      assert.equal(code, SysExit.OK);
      assert.isTrue(existsSync(path.join(dest, "package.json")));
      assert.isFalse(
        existsSync(path.join(dest, "compose.yaml")),
        "preset complete appliqué malgré --preset minimal",
      );
    });

    it("une clé hors spec est REFUSÉE, pas avalée", async () => {
      const file = path.join(tmp, "typo.json");
      // `prest` au lieu de `preset` : `resolveAnswers` l'ignorerait et
      // générerait la vitrine complète sans un mot — indétectable pour un
      // appelant automatique.
      writeFileSync(file, JSON.stringify({ name: "typo", prest: "minimal" }));
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "--dir",
          path.join(tmp, "typo"),
          "--answers-json",
          file,
        ),
      );
      assert.equal(code, SysExit.USAGE);
      assert.isFalse(existsSync(path.join(tmp, "typo")));
    });

    it("JSON invalide ou valeur non scalaire : refus en EX_USAGE", async () => {
      const bad = path.join(tmp, "bad.json");
      writeFileSync(bad, "{ pas du json");
      assert.equal(
        await runCreateCommand(
          argv(
            "create",
            "app",
            "--dir",
            path.join(tmp, "b1"),
            "--answers-json",
            bad,
          ),
        ),
        SysExit.USAGE,
      );
      const nested = path.join(tmp, "nested.json");
      writeFileSync(nested, JSON.stringify({ name: { deep: true } }));
      assert.equal(
        await runCreateCommand(
          argv(
            "create",
            "app",
            "--dir",
            path.join(tmp, "b2"),
            "--answers-json",
            nested,
          ),
        ),
        SysExit.USAGE,
      );
    });

    it("--answers-json sans valeur : usage, pas un crash", () => {
      const p = parseCreateArgv(argv("create", "app", "x", "--answers-json"));
      assert.property(p, "error");
    });
  });

  describe("dry-run (simulation — même exécution, sans le disque)", () => {
    it("une app simulée n'existe pas, mais son plan est complet", () => {
      const dest = path.join(tmp, "sim");
      const r = runScaffold(
        {
          type: "app",
          answers: { name: "sim", preset: "minimal", frontend: "none" },
          dir: dest,
          force: false,
        },
        version,
        { dryRun: true },
      );
      assert.isFalse(existsSync(dest), "le dry-run a écrit sur le disque");
      const changes = r.changes ?? [];
      assert.isNotEmpty(changes);
      // Le plan porte le MÊME inventaire que le résultat annoncé.
      assert.sameMembers(
        changes.map((c) => path.relative(dest, c.path)),
        r.files,
      );
      assert.isTrue(changes.every((c) => c.kind === "create"));
      // Le contenu est celui qui SERAIT écrit : il est rendu, pas promis.
      const index = changes.find((c) => c.path.endsWith("index.ts"));
      assert.include(index?.content ?? "", "@controllers([");
    });

    it("sur un projet existant, distingue création et réécriture + diff", () => {
      const dest = path.join(tmp, "simc");
      scaffold(dest, { name: "simc", preset: "minimal" });
      const before = snapshotTree(dest);
      const r = runScaffold(
        {
          type: "controller",
          answers: { name: "blog" },
          dir: dest,
          force: false,
        },
        version,
        { dryRun: true },
      );
      assertTreeUnchanged(before, dest);
      const changes = r.changes ?? [];
      const rewritten = changes.filter((c) => c.kind === "overwrite");
      // `index.ts` existe : le câblage le RÉÉCRIT — c'est le seul cas où la
      // simulation a une valeur, et le plan doit le dire.
      assert.deepEqual(
        rewritten.map((c) => path.relative(dest, c.path)),
        ["index.ts"],
      );
      const [wire] = rewritten;
      assert.include(wire.previous ?? "", "@controllers([");
      const added = diffLines(wire.previous ?? "", wire.content)
        .filter((l) => l.kind === "add")
        .map((l) => l.text);
      assert.isTrue(
        added.some((l) => l.includes("BlogController")),
        "le diff ne montre pas l'insertion du controller",
      );
    });

    it("un refus reste un refus en simulation", () => {
      const dest = path.join(tmp, "simref");
      scaffold(dest, { name: "simref", preset: "minimal" });
      runScaffold(
        {
          type: "controller",
          answers: { name: "dup" },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.throws(
        () =>
          runScaffold(
            {
              type: "controller",
              answers: { name: "dup" },
              dir: dest,
              force: false,
            },
            version,
            { dryRun: true },
          ),
        /déjà référencé/u,
      );
    });

    it("diffLines : conserve l'ordre et n'invente aucune ligne", () => {
      const diff = diffLines("a\nb\nc", "a\nx\nb\nc");
      assert.deepEqual(
        diff.map((l) => `${l.kind[0]}${l.text}`),
        ["ka", "ax", "kb", "kc"],
      );
      assert.deepEqual(diffLines("a", "a"), [{ kind: "keep", text: "a" }]);
    });
  });

  describe("catalogue de versions (anti-dérive templates ↔ monorepo)", () => {
    it("chaque version du catalogue reste alignée (même MAJEURE) sur le repo", async () => {
      const { SCAFFOLD_VERSIONS } = await import("../cli/scaffold/versions");
      const repoRoot = path.resolve(findPackageRoot(), "..", "..");
      // Sources de vérité : là où le monorepo utilise RÉELLEMENT ces paquets.
      const sources = [
        "package.json",
        path.join("src", "nodefony", "package.json"),
        path.join("src", "packages", "@nodefony", "studio", "package.json"),
        path.join("src", "packages", "@nodefony", "frontend", "package.json"),
        // Le code généré importe `drizzle-orm` en direct → l'app le déclare, et
        // sa version doit suivre celle sur laquelle l'adapter est éprouvé.
        path.join("src", "packages", "@nodefony", "drizzle", "package.json"),
      ];
      const repo: Record<string, string> = {};
      for (const rel of sources) {
        const p = path.join(repoRoot, rel);
        if (!existsSync(p)) continue;
        const pkg = readJson(p);
        Object.assign(
          repo,
          pkg["devDependencies"] ?? {},
          pkg["dependencies"] ?? {},
        );
      }
      const clean = (v: string) => v.replace(/^[~^>=\s]*/u, "");
      const major = (v: string) => Number.parseInt(clean(v), 10);
      // En 0.x, c'est la MINEURE qui porte les ruptures (semver §4) : comparer la
      // seule majeure y revient à ne rien comparer — `drizzle-orm` 0.45 vs 0.99
      // passerait, alors que le repository dépend de comportements fins du
      // builder (cf `limit(-1)` ignoré silencieusement en 0.45).
      const track = (v: string) => {
        const [ma, mi] = clean(v).split(".");
        return ma === "0" ? `0.${mi}` : ma;
      };
      const drifts: string[] = [];
      for (const [name, range] of Object.entries(SCAFFOLD_VERSIONS)) {
        const used = repo[name];
        if (!used || used.startsWith("file:")) continue; // pas comparable
        if (major(range) !== major(used) || track(range) !== track(used)) {
          drifts.push(`${name}: scaffold ${range} vs repo ${used}`);
        }
      }
      assert.deepEqual(
        drifts,
        [],
        `catalogue scaffold (versions.ts) en dérive de MAJEURE vs le repo :\n${drifts.join("\n")}`,
      );
    });
  });

  describe("moteur — garde-fous", () => {
    it("dossier non vide sans force → throw ; avec force → OK", () => {
      const dest = path.join(tmp, "occupied");
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, "x.txt"), "occupé");
      assert.throws(() => scaffold(dest, { name: "occupied" }), /pas vide/);
      scaffold(dest, { name: "occupied" }, true);
      assert.isTrue(existsSync(path.join(dest, "package.json")));
    });
  });

  describe("link (deps file: vers le checkout local)", () => {
    it("resolveLocalWorkspaces : checkout → map, hors checkout → null", () => {
      const workspaces = resolveLocalWorkspaces(findPackageRoot());
      assert.isNotNull(workspaces);
      assert.equal(workspaces!["nodefony"], findPackageRoot());
      assert.isTrue(existsSync(workspaces!["@nodefony/http"]));
      assert.isNull(resolveLocalWorkspaces(tmp));
    });

    it("linkLocalDeps : réécrit le scope nodefony, laisse le public", () => {
      const dest = path.join(tmp, "linked");
      mkdirSync(dest, { recursive: true });
      writeFileSync(
        path.join(dest, "package.json"),
        JSON.stringify({
          dependencies: { nodefony: "^10.0.0", zod: "^4.4.3" },
          devDependencies: { "@nodefony/http": "^10.0.0", rolldown: "^1.1.5" },
        }),
      );
      const writer = new ScaffoldWriter();
      const linked = linkLocalDeps(
        dest,
        {
          nodefony: "/repo/src/nodefony",
          "@nodefony/http": "/repo/src/packages/@nodefony/http",
        },
        writer,
      );
      writer.commit();
      assert.deepEqual(linked, ["@nodefony/http", "nodefony"]);
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], "file:/repo/src/nodefony");
      assert.equal(pkg["dependencies"]["zod"], "^4.4.3");
    });

    it("runScaffold link:true : app câblée sur le checkout", () => {
      const dest = path.join(tmp, "linked-app");
      const r = scaffold(dest, { name: "linked-app", link: true });
      assert.isNotEmpty(r.linked);
      const pkg = readJson(path.join(dest, "package.json"));
      assert.match(pkg["dependencies"]["nodefony"], /^file:.*src\/nodefony$/);
      assert.equal(pkg["dependencies"]["zod"], "^4.4.3");
    });
  });

  describe("front interactif (readline sur streams factices)", () => {
    /**
     * Répond AU RYTHME des prompts : readline ne met pas en file les lignes
     * arrivées entre deux `question()` — on pousse la réponse suivante quand
     * l'output affiche une invite (comme un humain).
     */
    const feedAnswers = (
      input: PassThrough,
      output: PassThrough,
      replies: string[],
    ): void => {
      const queue = [...replies];
      output.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (/[:\]] $/u.test(text) && queue.length > 0) {
          input.write(`${queue.shift()}\n`);
        }
      });
    };

    it("pose les questions manquantes, choix numérotés, défauts sur entrée vide", async () => {
      const [spec] = getScaffoldSpec("app");
      const input = new PassThrough();
      const output = new PassThrough();
      // name → "demo" · preset → 2 (minimal) · frontend → 2 (react) · link → o
      feedAnswers(input, output, ["demo", "2", "2", "o"]);
      const answers = await askMissing(
        spec,
        {},
        { hasCheckout: true },
        input,
        output,
      );
      assert.deepEqual(answers, {
        name: "demo",
        preset: "minimal",
        frontend: "react",
        link: true,
      });
    });

    it("ne redemande pas ce que les flags ont déjà dit ; saute link sans checkout", async () => {
      const [spec] = getScaffoldSpec("app");
      const input = new PassThrough();
      const output = new PassThrough();
      output.resume();
      input.write("\n"); // seul frontend est demandé → entrée vide = défaut none
      const answers = await askMissing(
        spec,
        { name: "demo", preset: "minimal" },
        { hasCheckout: false },
        input,
        output,
      );
      assert.equal(answers.frontend, "none");
      assert.isUndefined(answers.link); // askIf non satisfait → jamais posée
    });
  });

  describe("runCreateCommand (non-TTY : défauts stables pour CI/scripts)", () => {
    it("génère la vitrine complète par défaut, exit OK", async () => {
      const dest = path.join(tmp, "demo-app");
      // --no-install/--no-git : le banc valide la GÉNÉRATION, pas npm ni git.
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "demo-app",
          "--dir",
          dest,
          "--no-install",
          "--no-git",
        ),
      );
      assert.equal(code, SysExit.OK);
      assert.isTrue(existsSync(path.join(dest, "compose.yaml")));
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], `^${version}`); // pas de link implicite
    });

    it("--dry-run : plan affiché, disque intact, ni install ni git", async () => {
      // Contrôle du CHEMIN COMPLET (argv → moteur → rendu) : le moteur sait
      // déjà simuler, ce qui reste à prouver c'est que la commande NE PASSE PAS
      // aux étapes post-génération — installer et commiter des fichiers qui
      // n'existent pas est le seul vrai danger de ce mode.
      const dest = path.join(tmp, "sim-app");
      const written: string[] = [];
      const stdout = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        written.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      let code: number;
      try {
        code = await runCreateCommand(
          argv("create", "app", "sim-app", "--dir", dest, "--dry-run"),
        );
      } finally {
        process.stdout.write = stdout;
      }
      const out = written.join("");
      assert.equal(code, SysExit.OK);
      assert.isFalse(existsSync(dest), "--dry-run a écrit sur le disque");
      assert.include(out, "RIEN n'a été écrit");
      assert.include(out, "package.json");
      // `--dry-run` sans `--no-install`/`--no-git` : ces étapes doivent être
      // sautées d'elles-mêmes, pas par un flag que l'utilisateur penserait à poser.
      assert.notInclude(out, "npm install");
      assert.notInclude(out, "🌱 git");
    });

    it("--preset/--frontend passent au moteur ; valeur invalide → EX_USAGE", async () => {
      const dest = path.join(tmp, "mini-app");
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "mini-app",
          "--dir",
          dest,
          "--preset",
          "minimal",
          "--no-install",
          "--no-git",
        ),
      );
      assert.equal(code, SysExit.OK);
      assert.isFalse(existsSync(path.join(dest, "compose.yaml")));
      assert.equal(
        await runCreateCommand(
          argv(
            "create",
            "app",
            "x",
            "--dir",
            path.join(tmp, "x"),
            "--preset",
            "big",
          ),
        ),
        SysExit.USAGE,
      );
    });

    it("usage invalide / nom manquant hors TTY / dossier occupé", async () => {
      assert.equal(await runCreateCommand(argv("create")), SysExit.USAGE);
      assert.equal(
        await runCreateCommand(argv("create", "app", "Bad_Name")),
        SysExit.USAGE,
      );
      assert.equal(
        await runCreateCommand(argv("create", "app")),
        SysExit.USAGE,
      );
      const dest = path.join(tmp, "busy");
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, "x.txt"), "occupé");
      assert.equal(
        await runCreateCommand(argv("create", "app", "busy", "--dir", dest)),
        SysExit.CANTCREAT,
      );
    });
  });

  // E2E binaire réel (gate RUN_CLI_BOOT — exige un `npm run build` PRÉALABLE :
  // un spawn valide le DIST, pas le source).
  const describeBoot = process.env["RUN_CLI_BOOT"] ? describe : describe.skip;
  describeBoot("e2e bin/nodefony create (dist)", () => {
    it("spawn → exit 0 + arbre généré", () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bin = path.resolve(here, "../../bin/nodefony");
      const dest = path.join(tmp, "e2e-app");
      execFileSync(
        "node",
        [
          bin,
          "create",
          "app",
          "e2e-app",
          "--dir",
          dest,
          "--no-install",
          "--no-git",
        ],
        { stdio: "pipe" },
      );
      assert.isTrue(existsSync(path.join(dest, "nodefony.config.ts")));
    });
  });
});
