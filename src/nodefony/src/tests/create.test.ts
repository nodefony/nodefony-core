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
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import {
  argvCablageMcp,
  createExitCode,
  doitDemanderLeType,
  parseCreateArgv,
  planCablageMcp,
  renderDryRun,
  runCreateCommand,
  type ICreateRequest,
} from "../cli/create";
import { AGENT_TARGETS, pointeursInstructions } from "../cli/agentTargets";
import { getScaffoldSpec } from "../cli/scaffold/spec";
import {
  findPackageRoot,
  resolveLocalWorkspaces,
  resolveAnswers,
  linkLocalDeps,
  runScaffold,
  getScaffoldContext,
  findModuleClassAnchor,
  filterProbe,
  malformedProbe,
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

    it("--git-hooks → answers.gitHooks (déclaré dans la spec, sinon le moteur l'IGNORERAIT)", () => {
      const req = parseCreateArgv(
        argv("create", "app", "x", "--git-hooks", "--yes"),
      ) as ICreateRequest;
      assert.isTrue(req.answers.gitHooks as boolean);
      // La spec porte la question — `advanced` : jamais posée en dialogue (le
      // défaut SANS hooks est sûr : le filet complet est la CI), mais présente,
      // sinon `resolveAnswers` jetterait la réponse sans un mot.
      const q = getScaffoldSpec("app")[0]?.questions.find(
        (x) => x.key === "gitHooks",
      );
      assert.isDefined(q);
      assert.isTrue(q?.advanced);
      assert.strictEqual(q?.default, false);
    });

    it("type inconnu / option inconnue → error", () => {
      assert.property(parseCreateArgv(argv("create", "plugin", "x")), "error");
      assert.property(
        parseCreateArgv(argv("create", "app", "ok", "--nope")),
        "error",
      );
    });
  });

  describe("code de sortie — un artefact cassé ne se signale pas en 0", () => {
    it("🔴 build tenté et RATÉ → SOFTWARE, pas OK", () => {
      // Le défaut fermé : la commande écrivait « npm run build a échoué » puis
      // rendait 0. Le message se noie dans la sortie, et aucun automate — chaîne
      // d'intégration, banc, agent qui enchaîne — ne peut distinguer une
      // application prête d'une application à réparer. C'est ce qui a laissé le
      // front d'une application générée ne pas se bâtir sans que rien ne tombe.
      assert.equal(createExitCode(true, false), SysExit.SOFTWARE);
    });

    it("build réussi → OK", () => {
      assert.equal(createExitCode(true, true), SysExit.OK);
    });

    it("installation SAUTÉE → OK : rien n'a été tenté, et c'est dit", () => {
      // `--no-install` saute aussi le build. Rendre un échec ici punirait un
      // geste volontaire, que les prochaines étapes affichent déjà.
      assert.equal(createExitCode(false, false), SysExit.OK);
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
        // `solid` n'est ni un preset @nodefony/frontend ni un scaffold — le
        // contrat refuse ce que le moteur ne rend pas. Vaut pour toute valeur
        // hors de la liste des frontends réellement générables.
        () => resolveAnswers(spec, { name: "x", frontend: "solid" }, caps),
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
      // Les DEUX verbes de diagnostic, jamais l'un sans l'autre : `check` est
      // statique (répond sur une app cassée), `inspect` est runtime (ce qui est
      // VRAIMENT monté). Un agent les apprend ensemble, et n'en exposer qu'un
      // laisse croire que l'autre n'existe pas.
      assert.property(pkg["scripts"], "check");
      assert.property(pkg["scripts"], "inspect");
      // `ai:sync` pose les skills livrés par les paquets. Sans cette ligne, le
      // verbe existe et personne ne l'apprend — le défaut mesuré au banc sur
      // les commandes maison (`nodefony check` employé 5 fois sur 63).
      assert.property(pkg["scripts"], "ai:sync");
      // `clean` ne peut PAS s'appuyer sur `rimraf` : il n'est pas dans les
      // devDependencies du gabarit, et un script qui échoue au premier usage
      // est pire qu'un script absent.
      assert.property(pkg["scripts"], "clean");
      assert.notInclude(pkg["scripts"]["clean"], "rimraf");
      // `verify` : UNE commande qui enchaîne les gates. Mesuré au banc de
      // découvrabilité (tâche 13) — un agent a livré du code qui ne compilait
      // pas sans avoir lancé le typecheck une seule fois, alors que les quatre
      // gates étaient documentés séparément. Quatre commandes à composer, c'est
      // zéro commande lancée ; le gate oublié était toujours `typecheck`, le
      // seul que le build ne fait pas.
      assert.property(pkg["scripts"], "verify");
      for (const gate of [
        "typecheck",
        "lint",
        // `format:check` et non `format` : le second RÉÉCRIT, il ne vérifie rien.
        // Sans lui, un `verify` vert cohabitait avec un dépôt non formaté, et le
        // gate de forme de la CI générée tombait après coup, ailleurs.
        "format:check",
        "test",
        "check",
      ]) {
        assert.include(
          pkg["scripts"]["verify"],
          gate,
          `verify doit enchaîner « ${gate} »`,
        );
        assert.property(
          pkg["scripts"],
          gate,
          `verify appelle « ${gate} », qui doit exister`,
        );
      }
      // Le gate LENT reste dehors : un `verify` qui boote l'app ne serait plus
      // lancé, et on aurait remplacé quatre gates oubliés par un seul.
      assert.notInclude(pkg["scripts"]["verify"], "e2e");
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
      assert.include(live, '@RealtimeChannel("live:events")');
      // Le canal parle sur ÉVÉNEMENT, jamais sur une horloge : un gabarit qui
      // distribuerait un battement enseignerait le polling inversé à chaque
      // application générée.
      assert.notInclude(live, "setInterval");
      assert.include(live, '@RealtimeInbound("live:dire")');
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
      assert.include(e2e, 'live.subscribe("live:events")');
      assert.include(e2e, 'live.emit("live:dire"');
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
        // Le module est au manifeste, et il y est en `policy: "dev"`. On ne
        // fige PAS la forme littérale de son `use(...)` : le devkit y reçoit
        // désormais l'audience de sa porte MCP, et une assertion écrite sur la
        // ponctuation aurait rougi pour un ajout parfaitement voulu — sans rien
        // dire de ce qu'elle protège.
        const compact = config.replace(/\s+/gu, " ");
        const at = compact.indexOf('"@nodefony/devkit"');
        assert.isAbove(at, -1, "le devkit doit figurer au manifeste");
        // La fenêtre qui suit le nom du module porte ses options : c'est là que
        // `policy` se lit, quelle que soit la façon dont le formateur a coupé
        // les lignes.
        // Jusqu'au module SUIVANT — pas une fenêtre de N caractères : la
        // déclaration du devkit porte sa configuration et ses commentaires, et
        // une borne chiffrée se périme au premier mot ajouté.
        const suivant = compact.indexOf("use(", at);
        assert.include(
          compact.slice(at, suivant === -1 ? undefined : suivant),
          '{ policy: "dev" }',
          "le devkit doit rester chargé en DÉVELOPPEMENT seulement",
        );
      });
    }

    it("pose les pointeurs de skills des paquets installés, AVANT le premier commit", async () => {
      const dest = path.join(tmp, "skills-app");
      // Décor : le paquet est DÉJÀ installé — cas réel d'un re-scaffold sur un
      // dossier qui porte ses node_modules. Sans ce raccourci, prouver le
      // câblage exigerait un `npm install` réel (une minute et le réseau) pour
      // une ligne d'orchestration ; la mécanique de découverte, elle, est
      // éprouvée par `aiSync.test.ts`.
      const skill = path.join(
        dest,
        "node_modules",
        "@nodefony",
        "devkit",
        "skills",
        "add-crud",
      );
      mkdirSync(skill, { recursive: true });
      writeFileSync(
        path.join(skill, "SKILL.md"),
        "---\nname: add-crud\ndescription: Crée une ressource REST complète. Détail ignoré.\n---\n\ncorps\n",
      );
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "skills-app",
          "--dir",
          dest,
          "--force",
          "--no-install",
          "--no-git",
        ),
      );
      assert.equal(code, SysExit.OK);
      const pointeur = path.join(
        dest,
        ".agents",
        "skills",
        "add-crud",
        "SKILL.md",
      );
      assert.isTrue(
        existsSync(pointeur),
        "create app n'a posé aucun pointeur — le lot ne sert alors qu'à qui connaît déjà ai:sync",
      );
      const contenu = readFileSync(pointeur, "utf8");
      // Un POINTEUR, pas une copie : il DÉSIGNE la source installée.
      assert.include(
        contenu,
        "node_modules/@nodefony/devkit/skills/add-crud/SKILL.md",
      );
      assert.notInclude(contenu, "corps");
      // Le dossier est fait pour être VERSIONNÉ — un .gitignore qui l'exclurait
      // le ferait disparaître du premier commit sans qu'on le voie.
      const ignore = readFileSync(path.join(dest, ".gitignore"), "utf8");
      assert.notInclude(ignore, ".agents");
    });

    it("l'AGENTS.md DIT que ces skills existent — une capacité absente d'ici n'existe pour personne", () => {
      const dest = path.join(tmp, "dk-agents");
      scaffold(dest, {
        name: "dkagents",
        preset: "complete",
        frontend: "none",
      });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      assert.include(agents, ".agents/skills/");
      assert.include(agents, "ai:sync");
    });

    it("🔴 un geste DESTRUCTEUR n'est jamais enseigné sans son remplaçant", () => {
      // Mesuré au banc de découvrabilité, deux runs sur deux : l'agent tape
      // `npx nodefony orm:reset -c default -y` — la ligne de CE fichier copiée
      // à la lettre, drapeaux compris — puis `rm` la base quatre fois, et la
      // donnée témoin disparaît. Il n'a pas désobéi : ce document est le SEUL
      // qu'il ouvre d'office, le skill qui l'interdit n'est jamais chargé, et
      // ce document PRESCRIVAIT la destruction comme la façon de « repartir
      // d'une base vierge ».
      //
      // La leçon dépasse cette commande : ce qu'un agent lit, il l'exécute. Un
      // interdit rangé ailleurs ne pèse rien face à un exemple écrit ICI —
      // donc le geste dangereux porte sa conséquence, et l'alternative se
      // trouve sur place.
      const dest = path.join(tmp, "agents-destructif");
      scaffold(dest, {
        name: "destructif",
        preset: "complete",
        frontend: "none",
      });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");

      // 1. La commande destructrice existe toujours — la retirer serait pire :
      //    l'agent la trouverait par `--help`, sans le moindre avertissement.
      assert.include(agents, "orm:reset");

      // 2. CHAQUE ligne qui la cite dit ce qu'elle coûte. C'est l'assertion qui
      //    mord : sans elle, la ligne d'origine passait.
      const lignes = agents.split("\n").filter((l) => l.includes("orm:reset"));
      assert.isAtLeast(lignes.length, 1);
      for (const ligne of lignes) {
        assert.match(
          ligne,
          /DÉTRUIT|perd les données|détruit les données/u,
          `une ligne enseigne « orm:reset » sans dire qu'elle détruit : ${ligne}`,
        );
      }

      // 3. Et le remplaçant est là, exécutable : éprouver une migration
      //    AILLEURS. C'est ce qui manquait — un interdit sans son geste de
      //    remplacement ne tient pas.
      assert.include(agents, "NF_MIGRATE_DATABASE_URL");
      assert.include(agents, "nodefony-migrate-schema");
    });

    it("🔴 l'app GÉNÉRÉE dit comment CHERCHER une doc que `rg` n'indexe pas", () => {
      // Le motif est structurel : la documentation des paquets vit sous
      // `node_modules`, que git ignore et que les outils de recherche excluent.
      // Ce fichier pointe huit chemins qui s'OUVRENT très bien mais qu'aucune
      // recherche plein texte ne trouve — un agent en conclut « pas documenté »
      // et réécrit à la main. Les trois issues doivent être écrites ICI, dans
      // le RENDU : ce que le gabarit sait ne sert à personne.
      const dest = path.join(tmp, "agents-recherche");
      scaffold(dest, {
        name: "recherche",
        preset: "complete",
        frontend: "none",
      });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");

      // 1. L'outil qui CHERCHE, quand le serveur répond.
      assert.include(agents, "nodefony_docs");
      // 2. Le repli sans serveur — DÉSIGNER le dossier suffit : l'exclusion ne
      //    vaut que pour le parcours. Mesuré : `rg` à la racine rend 1 fichier,
      //    le même motif sur le dossier désigné en rend 3.
      assert.include(agents, 'rg "terme" node_modules/@nodefony/*/docs/');
      // 3. Le balayage large, quand on ne sait pas où chercher.
      assert.include(agents, "--no-ignore");
      // 4. Et le cas où il n'y a rien à lire : à DIRE, pas à contourner.
      assert.include(agents, "npm install");
    });

    it("🔴 les trois pièges MESURÉS au banc sont écrits dans l'app GÉNÉRÉE", () => {
      // Trois échecs du banc devkit dont la cause était ce fichier — pas
      // l'agent. Chacun se relit ici, dans le rendu, parce qu'un gabarit n'est
      // pas ce qu'il produit.
      const dest = path.join(tmp, "agents-pieges");
      scaffold(dest, { name: "pieges", preset: "complete", frontend: "none" });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");

      // T10 — l'agent s'arrêtait à `npm test` (vitest n'inspecte aucun type) et
      // commitait du code qui ne compile pas. L'en-tête et la conclusion
      // nomment maintenant LA commande unique, comme le corps le faisait déjà.
      assert.include(agents, "npm run verify");
      assert.notInclude(
        agents,
        "`npm test` d'abord, puis `npm run typecheck`",
        "l'en-tête ne doit plus proposer une séquence qu'on peut interrompre",
      );

      // T16 — « Fetch Metadata protège déjà », donc pas de `@CsrfProtect` : un
      // client non-navigateur postait sans jeton et recevait 201.
      assert.include(agents, "PREUVE D'INTENTION");
      assert.include(agents, "x-csrf-token");

      // T26 — le fichier CONSEILLAIT de déplacer la route sous `/api/machine` ;
      // l'agent a obéi, et l'adresse publiée a rendu 404 au partenaire.
      assert.include(agents, "URL DÉJÀ PUBLIÉE");
      assert.include(agents, "^/api/(machine|partenaire)");
    });
  });

  describe(".prettierrc + CI générée (le filet complet vit en forge)", () => {
    it("🔴 l'app naît avec .prettierrc.json et un workflow CI qui joue verify + e2e", () => {
      const dest = path.join(tmp, "ci-sqlite");
      scaffold(dest, { name: "cisqlite" });
      // `format` tournait sur les défauts prettier : un style non écrit.
      assert.include(
        readFileSync(path.join(dest, ".prettierrc.json"), "utf8"),
        '"printWidth"',
      );
      const ci = readFileSync(
        path.join(dest, ".github", "workflows", "ci.yml"),
        "utf8",
      );
      assert.include(ci, "npm run verify");
      assert.include(ci, "npm run test:e2e");
      // Le YAML garde sa STRUCTURE : le piège eta « tag en fin de ligne avale
      // le saut de ligne » recollerait `steps:` au bloc précédent — un yml qui
      // parse encore, et un job qui n'a plus d'étapes.
      assert.match(ci, /\n {4}steps:\n/u);
      // sqlite : aucun service container — l'app démarre sans rien.
      assert.notInclude(ci, "services:");
      // Les DEUX forges sont servies (préférence logiciel libre : GitLab par
      // défaut aussi) — le fichier de l'autre forge est simplement inerte.
      const gitlab = readFileSync(path.join(dest, ".gitlab-ci.yml"), "utf8");
      assert.include(gitlab, "npm run verify");
      assert.include(gitlab, "npm run test:e2e");
      assert.notInclude(gitlab, "services:");
      assertNoEtaResidue(dest);
    });

    it("base SQL retenue : le service container CI porte la MÊME image que le compose", () => {
      const dest = path.join(tmp, "ci-pg");
      scaffold(dest, { name: "cipg", database: "postgres" });
      const ci = readFileSync(
        path.join(dest, ".github", "workflows", "ci.yml"),
        "utf8",
      );
      assert.match(ci, /\n {4}services:\n {6}postgres:\n/u);
      assert.include(ci, "POSTGRES_USER: cipg");
      assert.include(ci, "pg_isready -U cipg");
      // Anti-dérive PROUVÉE sur les rendus, pas sur le catalogue : la même
      // image dans les deux fichiers, extraite de chacun.
      const imageDe = (texte: string, motif: RegExp): string =>
        motif.exec(texte)?.[1] ?? "(absente)";
      const imageCi = imageDe(ci, /image: (\S+)/u);
      const imageCompose = imageDe(
        readFileSync(path.join(dest, "compose.yaml"), "utf8"),
        /postgres:\n {4}image: (\S+)/u,
      );
      assert.equal(imageCi, imageCompose);
      assert.notEqual(imageCi, "(absente)");
      // GitLab : le service se joint par son ALIAS, jamais par 127.0.0.1 (le
      // service tourne dans un autre conteneur) — la variable du job PRIME sur
      // le `.env`, c'est la cascade documentée (le shell gagne toujours).
      const gitlab = readFileSync(path.join(dest, ".gitlab-ci.yml"), "utf8");
      assert.equal(imageDe(gitlab, /name: (\S+)/u), imageCompose);
      assert.include(
        gitlab,
        'NF_DATABASE_URL: "postgres://cipg:cipg-dev@postgres:5432/cipg"',
      );
      assert.notInclude(gitlab, "127.0.0.1");
      assertNoEtaResidue(dest);
    });
  });

  describe("base SQL retenue à la création (compose ↔ .env ↔ README)", () => {
    /**
     * Ce que ces contrôles tiennent : le générateur CONNAÎT le dialecte, donc
     * l'app ne reçoit ni les deux services qu'elle n'utilisera pas, ni une URL à
     * recomposer à la main. Trois fichiers en parlent (`compose.yaml`, `.env`,
     * `README.md`) et ils doivent coïncider EXACTEMENT — c'est le seul défaut
     * qui ne se voit qu'à la connexion refusée, jamais au rendu.
     */
    const composeOf = (dest: string) =>
      readFileSync(path.join(dest, "compose.yaml"), "utf8");
    const envOf = (dest: string) =>
      readFileSync(path.join(dest, ".env"), "utf8");

    it("défaut sqlite : AUCUN service SQL, et l'URL reste commentée", () => {
      const dest = path.join(tmp, "solo");
      scaffold(dest, { name: "solo" });
      const compose = composeOf(dest);
      // Redis et l'observabilité restent — c'est la base SQL qui disparaît.
      assert.include(compose, "\n  redis:\n");
      for (const service of ["postgres", "mariadb", "mysql"]) {
        assert.notInclude(
          compose,
          `\n  ${service}:\n`,
          `service ${service} rendu alors que l'app est en sqlite`,
        );
        assert.notInclude(compose, `  ${service}-data:`);
      }
      // Commentée : une app qui n'a rien demandé démarre sans rien allumer.
      assert.notMatch(envOf(dest), /^NF_DATABASE_URL=/mu);
      assert.include(envOf(dest), "# NF_DATABASE_URL=");
      assertNoEtaResidue(dest);
    });

    for (const [database, service, port, scheme] of [
      ["postgres", "postgres", "5432", "postgres"],
      ["mariadb", "mariadb", "3306", "mysql"],
      // 3306 aussi : le port décalé n'existait que pour faire cohabiter MySQL
      // et MariaDB dans un compose qui portait les deux.
      ["mysql", "mysql", "3306", "mysql"],
    ] as const) {
      it(`--database ${database} : ce service SEUL, sans profil, et l'URL posée dessus`, () => {
        const dest = path.join(tmp, database);
        scaffold(dest, { name: "demo", database });
        const compose = composeOf(dest);
        assert.include(compose, `\n  ${service}:\n`);
        assert.include(compose, `  ${service}-data:`);
        for (const other of ["postgres", "mariadb", "mysql"].filter(
          (s) => s !== service,
        )) {
          assert.notInclude(
            compose,
            `\n  ${other}:\n`,
            `${other} rendu alors que ${database} a été retenu`,
          );
          assert.notInclude(compose, `  ${other}-data:`);
        }
        // Sans profil : la base n'est pas une option, `up -d` doit la monter.
        assert.notInclude(compose, `profiles: ["${service}"]`);
        // Le port PUBLIÉ par le compose et celui de l'URL sont le même — c'est
        // ce couple qui casse en silence si les deux gabarits divergent.
        assert.include(
          compose,
          `127.0.0.1:\${${service.toUpperCase()}_PORT:-${port}}`,
        );
        assert.include(
          envOf(dest),
          `\nNF_DATABASE_URL=${scheme}://demo:demo-dev@127.0.0.1:${port}/demo\n`,
        );
        // Le README parle de LA base retenue, et met l'infra avant le dev.
        const readme = readFileSync(path.join(dest, "README.md"), "utf8");
        assert.include(readme, "npm run infra:up");
        assert.notInclude(readme, "--profile postgres up -d");
        assertNoEtaResidue(dest);
      });
    }

    it("preset minimal : la question ne s'applique pas → la réponse retombe à sqlite", () => {
      const [spec] = getScaffoldSpec("app");
      const answers = resolveAnswers(
        spec,
        { name: "x", preset: "minimal", database: "postgres" },
        { hasCheckout: false },
      );
      // Ni compose.yaml ni ORM en minimal : honorer « postgres » n'aurait aucun
      // fichier où s'écrire, et laisserait croire à un choix appliqué.
      assert.equal(answers.database, "sqlite");
      assert.equal(
        resolveAnswers(spec, { name: "x" }, { hasCheckout: false }).database,
        "sqlite",
      );
    });

    it("--database inconnu → refus AVANT écriture", () => {
      const [spec] = getScaffoldSpec("app");
      assert.throws(
        () =>
          resolveAnswers(
            spec,
            { name: "x", database: "oracle" },
            { hasCheckout: false },
          ),
        /database invalide/u,
      );
      const dest = path.join(tmp, "refus");
      assert.throws(() => scaffold(dest, { name: "x", database: "oracle" }));
      assert.isFalse(existsSync(dest));
    });

    it("flag --database → answers", () => {
      const req = parseCreateArgv(
        argv("create", "app", "x", "--database", "mariadb"),
      );
      assert.equal((req as ICreateRequest).answers.database, "mariadb");
    });
  });

  describe("migrations — la recette de déploiement, et les notes qui doivent dire vrai", () => {
    /**
     * Ce que ces contrôles tiennent : le jour où les migrations existent, une
     * application générée doit POSSÉDER sa recette de déploiement — pas la
     * recopier depuis une page de documentation — et ses notes ne doivent plus
     * affirmer que `orm:migrate` n'existe pas. Ce texte est FIGÉ à la création :
     * une phrase fausse laissée là est livrée dans chaque application, pour
     * toujours.
     *
     * La preuve porte sur les fichiers RENDUS, jamais sur le gabarit : ce n'est
     * pas le même artefact, et c'est le rendu que l'utilisateur reçoit.
     */
    const recipePath = (dest: string) =>
      path.join(dest, "deploy", "migrate-job.yaml");

    for (const [database, scheme, port] of [
      ["postgres", "postgres", "5432"],
      ["mariadb", "mysql", "3306"],
      ["mysql", "mysql", "3306"],
    ] as const) {
      it(`--database ${database} : le travail de migration est rendu au nom de l'app, avec l'image et le secret qui vont avec`, () => {
        const dest = path.join(tmp, `mig-${database}`);
        scaffold(dest, { name: "demo", database });
        const recipe = readFileSync(recipePath(dest), "utf8");
        // Rendu à SON nom — pas un espace réservé qu'il faudrait remplacer.
        assert.include(recipe, "generateName: demo-migrate-");
        assert.include(recipe, "app.kubernetes.io/name: demo");
        assert.include(recipe, "name: demo-db-migrator");
        // La MÊME image que le Dockerfile généré (`docker build -t demo .`) —
        // une migration jouée depuis une autre version applique un schéma que
        // le code déployé ne connaît pas.
        assert.include(recipe, "image: demo:${IMAGE_TAG}");
        // La MÊME forme d'invocation que le `CMD` du Dockerfile : le binaire
        // vit dans les node_modules de l'image, jamais dans le PATH.
        assert.include(
          recipe,
          'command: ["node_modules/.bin/nodefony", "orm:migrate", "--json"]',
        );
        // Le compte qui migre n'est pas celui qui sert.
        assert.include(recipe, "name: NF_MIGRATE_DATABASE_URL");
        assert.include(recipe, "secretKeyRef:");
        // Un Job est IMMUABLE et ne se rejoue pas en aveugle.
        assert.include(recipe, "restartPolicy: Never");
        assert.include(recipe, "backoffLimit: 0");
        // L'exemple de secret parle de LA base retenue, pas d'une autre.
        assert.include(recipe, `${scheme}://migrator:MOT_DE_PASSE@db:${port}/`);
        // Aucun espace réservé de documentation n'a survécu au rendu.
        for (const placeholder of ["myapp", "mon-application", "<TAG>"]) {
          assert.notInclude(recipe, placeholder);
        }
        // Le README envoie vers la recette, et l'AGENTS.md la nomme : une
        // recette que personne ne trouve n'existe pour personne.
        const readme = readFileSync(path.join(dest, "README.md"), "utf8");
        assert.include(readme, "deploy/migrate-job.yaml");
        assert.include(readme, "npx nodefony orm:migrate:status");
        assert.include(
          readFileSync(path.join(dest, "AGENTS.md"), "utf8"),
          "deploy/migrate-job.yaml",
        );
        assertNoEtaResidue(dest);
      });
    }

    it("défaut sqlite : AUCUNE recette — et rien ne promet un fichier qui n'existe pas", () => {
      const dest = path.join(tmp, "mig-sqlite");
      scaffold(dest, { name: "solo" });
      assert.isFalse(existsSync(recipePath(dest)));
      // Le piège : `hasMigrateRecipe` se CONSTATE. Une app sqlite a bien un
      // ORM — donc `hasOrm` est vrai — et une ligne conditionnée à l'ORM
      // enverrait l'agent vers un fichier absent.
      for (const file of ["AGENTS.md", "README.md"]) {
        assert.notInclude(
          readFileSync(path.join(dest, file), "utf8"),
          "deploy/migrate-job.yaml",
          `${file} promet une recette que l'app sqlite n'a pas`,
        );
      }
      // Les commandes, elles, existent bel et bien en sqlite.
      assert.include(
        readFileSync(path.join(dest, "AGENTS.md"), "utf8"),
        "npx nodefony orm:migrate:status",
      );
    });

    /**
     * 🔴 La seule garde qui empêche une note fausse de survivre au chantier.
     *
     * Une chaîne qu'on oublie de changer ne se signale JAMAIS toute seule :
     * elle compile, elle se rend, elle s'affiche — et elle enseigne le
     * contraire de ce que le produit fait désormais. Les deux formulations
     * cherchées ici sont celles que le générateur imprimait quand les
     * migrations n'existaient pas.
     */
    it("🔴 les deux anciennes formulations ont disparu de TOUT ce qui est rendu", () => {
      const perimees = [
        /orm:migrate.{0,3} n'existe pas/u,
        /supprime la base de dev/u,
        /pas d'ALTER en dev/u,
      ];
      // Les deux dimensions qui font varier le texte rendu : la façade (elle
      // décide des layers) et la base (elle décide de la recette). Le produit
      // cartésien n'apprendrait rien de plus — aucune note ne dépend des deux.
      const variantes: { name: string; answers: Record<string, string> }[] = [
        { name: "front-none", answers: { frontend: "none" } },
        { name: "front-react", answers: { frontend: "react" } },
        { name: "front-vue", answers: { frontend: "vue" } },
        { name: "front-angular", answers: { frontend: "angular" } },
        { name: "db-postgres", answers: { database: "postgres" } },
        { name: "db-mariadb", answers: { database: "mariadb" } },
        { name: "db-mysql", answers: { database: "mysql" } },
      ];
      for (const variante of variantes) {
        const dest = path.join(tmp, `perime-${variante.name}`);
        scaffold(dest, { name: "demo", ...variante.answers });
        for (const [rel, contenu] of snapshotTree(dest)) {
          for (const perimee of perimees) {
            assert.notMatch(
              contenu,
              perimee,
              `${variante.name}/${rel} porte encore une formulation d'avant les migrations`,
            );
          }
        }
      }
    });

    it("🔴 la note de `create entity` ne renvoie plus à une commande absente", () => {
      const dest = path.join(tmp, "mig-entity");
      scaffold(dest, { name: "demo", database: "postgres" });
      const r = runScaffold(
        {
          type: "entity",
          answers: { name: "Article", fields: "title:string!" },
          dir: dest,
          force: false,
        },
        version,
      );
      const notes = (r.notes ?? []).join("\n");
      // Ce que la note DOIT dire : la production se migre, et par quoi.
      assert.include(notes, "orm:migrate");
      for (const perimee of [
        /orm:migrate.{0,3} n'existe pas/u,
        /supprime la base de dev/u,
      ]) {
        assert.notMatch(notes, perimee);
      }
    });
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

  describe("Docker — la doctrine cloud-native naît AVEC l'application", () => {
    /**
     * Ces contrôles portent sur des lignes dont l'absence ne produit AUCUNE
     * erreur : l'image se construit, le container démarre, les requêtes
     * passent. Ce qui disparaît est le dialogue avec l'orchestrateur — un
     * déploiement sur deux tue des requêtes en vol, et rien ne le dit.
     */
    for (const preset of ["complete", "minimal"] as const) {
      it(`preset ${preset} : Dockerfile + .dockerignore, doctrine entière`, () => {
        const dest = path.join(tmp, `docker-${preset}`);
        scaffold(dest, { name: `docker-${preset}`, preset });
        const dockerfile = readFileSync(path.join(dest, "Dockerfile"), "utf8");

        // Multi-stage : la chaîne de compilation ne descend pas en production.
        assert.match(dockerfile, /^FROM \S+ AS build$/mu);
        assert.equal(dockerfile.match(/^FROM /gmu)?.length, 2);

        // Forme EXEC obligatoire. En forme shell, /bin/sh devient PID 1 et ne
        // transmet PAS le SIGTERM de `docker stop` : plus jamais de drain,
        // SIGKILL à chaque déploiement — et l'image marche parfaitement.
        assert.match(dockerfile, /^CMD \["/mu);
        assert.notMatch(dockerfile, /^CMD [^[]/mu);

        // Jamais root — les ports Nodefony n'exigent aucun privilège.
        assert.match(dockerfile, /^USER node$/mu);

        // La sonde de l'orchestrateur passe par la route NATIVE du framework.
        assert.match(dockerfile, /^HEALTHCHECK /mu);
        assert.include(dockerfile, "/readyz");

        // Le build de l'image passe par le script de l'app : un jour où
        // `npm run build` changera (front, modules), le Dockerfile suivra
        // sans qu'on y touche.
        assert.include(dockerfile, "npm run build");

        const ignore = readFileSync(path.join(dest, ".dockerignore"), "utf8");
        // Motifs contrôlés en LIGNE ENTIÈRE : `assert.include` se contenterait
        // de `**/*.local` pour prouver `*.local`, et un retrait partiel
        // resterait vert — le mode de défaillance classique d'un gate.
        //
        // `.env.local` porte les clés générées à la création. Entré dans une
        // image, un secret y reste : les couches sont lisibles par qui la
        // télécharge, et une couche suivante ne l'efface pas.
        assert.match(ignore, /^\*\.local$/mu);
        assert.match(ignore, /^\*\*\/\*\.local$/mu);
        assert.match(ignore, /^\*\*\/node_modules$/mu);
        // `dist/` de l'hôte : entré dans le contexte, il masquerait le build
        // du stage et l'image partirait avec le code de la veille.
        assert.match(ignore, /^\*\*\/dist$/mu);

        // Un agent qui ignore que ce fichier existe en écrit un de mémoire —
        // sans multi-stage, en root, en forme shell. La capacité doit donc
        // être nommée là où il lit AVANT d'agir, pas seulement exister.
        const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");
        assert.include(agents, "docker build");
        assert.include(agents, "Dockerfile");
        assertNoEtaResidue(dest);
      });
    }
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
      // Le framework front est une devDependency : rien hors `frontend/` ne
      // l'importe, Vite l'inline dans le bundle, et `npm prune --omit=dev`
      // doit pouvoir le retirer de l'image. En `dependencies` il survivait au
      // prune et embarquait un framework entier que rien ne charge.
      assert.property(pkg["devDependencies"], "react");
      assert.notProperty(pkg["dependencies"], "react");
      assert.notProperty(pkg["dependencies"], "react-dom");
      // `@nodefony/frontend`, LUI, est chargé par le Kernel en production.
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

    // GATE #42 — la doc du client enseigne une adresse que le scaffold MONTE.
    //
    // Elle a enseigné pendant des mois `/nodefony/api/realtime`, qui n'est
    // montée nulle part : un débutant copiait l'exemple et obtenait une socket
    // qui ne se connecte jamais, en silence, puisqu'un WebSocket qui échoue
    // retente. Rien ne pouvait le signaler — les deux textes vivent à des
    // endroits que personne ne relit ensemble. On les relit donc ICI, en
    // confrontant la doc au controller RÉELLEMENT rendu, pas à une constante
    // recopiée dans le test (qui dériverait avec le gabarit, sans un mot).
    it("les adresses temps réel citées par la doc sont celles que le scaffold monte", () => {
      const dest = path.join(tmp, "urlgate");
      scaffold(dest, {
        name: "urlgate",
        preset: "complete",
        frontend: "react",
      });
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "LiveController.ts"),
        "utf8",
      );
      const base = /@controller\("([^"]+)"\)/u.exec(ctrl)?.[1];
      const sous = /path:\s*"([^"]*\/realtime)"/u.exec(ctrl)?.[1];
      assert.isString(base, "la route de base du controller généré");
      assert.isString(sous, "le chemin realtime du controller généré");
      const montee = `${base}${sous}`;

      // Les DEUX seules adresses réelles du dépôt : celle qu'une application
      // générée monte, et celle de la console d'administration — cette dernière
      // LUE dans son controller, jamais recopiée ici. Une constante de test se
      // périme en silence le jour où la route bouge, ce qui est exactement le
      // défaut que ce cas existe pour empêcher.
      const studio = readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "..",
          "packages",
          "@nodefony",
          "studio",
          "nodefony",
          "controller",
          "StudioRealtimeController.ts",
        ),
        "utf8",
      );
      const sBase = /@controller\("([^"]+)"\)/u.exec(studio)?.[1];
      const sSous = /path:\s*"([^"]*\/realtime)"/u.exec(studio)?.[1];
      assert.isString(sBase, "route de base du controller Studio");
      assert.isString(sSous, "chemin realtime du controller Studio");
      const reelles = new Set([montee, `${sBase}${sSous}`]);

      const racineDocs = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "docs",
      );
      for (const page of ["client.md", "react-hooks.md"]) {
        const texte = readFileSync(path.join(racineDocs, page), "utf8");
        // Toute ADRESSE terminée par `/realtime` citée entre guillemets, apostrophes
        // ou accents graves — donc aussi bien un exemple de code qu'une mention en
        // prose. Elle doit commencer par `/` ou par une interpolation d'hôte
        // (`${WS_BASE}/api/live/realtime`) : sans cette exigence, le motif ramassait
        // le NOM DU PAQUET `@nodefony/realtime` et accusait la doc à tort.
        for (const m of texte.matchAll(
          /["'`]((?:\$\{[^}]*\})?\/[^"'`\s]*\/realtime)["'`]/gu,
        )) {
          const citee = m[1]!.replace(/^\$\{[^}]*\}/u, "");
          assert.isTrue(
            reelles.has(citee),
            `${page} enseigne « ${citee} », qu'aucune route ne monte — ` +
              `adresses réelles : ${[...reelles].join(", ")}`,
          );
        }
      }

      // Le message d'erreur du client nomme ces mêmes routes à qui oublie
      // l'adresse. S'il se met à nommer une route morte, il envoie le débutant
      // exactement là où la doc l'envoyait.
      const client = readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "client",
          "realtime",
          "RealtimeClient.ts",
        ),
        "utf8",
      );
      const conseils = codeOnly(client).matchAll(
        /(\/[\w/-]*\/realtime)(?=["'\s),])/gu,
      );
      for (const m of conseils) {
        assert.isTrue(
          reelles.has(m[1]!),
          `RealtimeClient conseille « ${m[1]} », qu'aucune route ne monte`,
        );
      }
    });

    it("vitrines complete : la carte temps réel passe par la FAÇADE, plus aucun ws à la main", () => {
      // React — hooks `nodefony/react` (Provider + état + canal).
      const rdest = path.join(tmp, "rlive");
      scaffold(rdest, { name: "rlive", preset: "complete", frontend: "react" });
      const rapp = readFileSync(
        path.join(rdest, "frontend", "src", "App.tsx"),
        "utf8",
      );
      // React tient en DEUX concepts : le Provider, qui reçoit l'adresse, et un
      // hook par besoin. Fabriquer la socket à la main et l'appeler `connect()`
      // n'apprenaient rien au débutant — le Provider les fait.
      assert.include(rapp, '<NodefonyProvider url="/api/live/realtime">');
      assert.include(rapp, "useNodefony()");
      assert.include(rapp, "useNodefonyState()");
      assert.include(rapp, 'useNodefonyChannelData<Evenement>("live:events")');
      assert.include(rapp, 'live.request("live:ping"');
      assert.notInclude(rapp, "new WebSocket(");
      // Les deux concepts RETIRÉS ne doivent pas revenir par la bande : sans ces
      // deux refus, on retomberait à quatre étapes sans qu'aucun test ne tombe.
      assert.notInclude(rapp, "RealtimeClient.shared(");
      assert.notInclude(rapp, ".connect()");
      // Vue — composables `nodefony/vue`, et la MÊME forme qu'en React : la
      // politique reçoit l'adresse (ici un plugin, le vocabulaire de Vue), un
      // composable par besoin, et RIEN à libérer. Ce qui compte n'est pas que
      // les deux se ressemblent à la ligne près, c'est qu'un débutant y compte
      // le même nombre de concepts.
      const vdest = path.join(tmp, "vlive");
      scaffold(vdest, { name: "vlive", preset: "complete", frontend: "vue" });
      const vapp = readFileSync(
        path.join(vdest, "frontend", "src", "App.vue"),
        "utf8",
      );
      const vmain = readFileSync(
        path.join(vdest, "frontend", "src", "main.ts"),
        "utf8",
      );
      // L'adresse est écrite UNE fois, à l'installation du plugin — pas dans la
      // page, qui n'a aucune raison de la connaître.
      assert.include(vmain, '.use(nodefonyVue, { url: "/api/live/realtime" })');
      assert.include(vapp, "useNodefony()");
      assert.include(vapp, "useNodefonyState()");
      assert.include(vapp, 'useNodefonyChannelData<Evenement>("live:events")');
      assert.include(vapp, 'live.request("live:ping"');
      assert.notInclude(vapp, "new WebSocket(");
      // Les mêmes deux refus qu'en React, pour la même raison : sans eux, on
      // retomberait au câblage manuel sans qu'aucun test ne tombe.
      assert.notInclude(vapp, "RealtimeClient.shared(");
      assert.notInclude(vapp, "connectShared(");
      // Et ce que les composables font DISPARAÎTRE : la liste de libérations,
      // qui est exactement l'endroit où un abonnement fuit sans se voir.
      assert.notInclude(vapp, "offLive");

      // Angular — fonctions d'injection `nodefony/angular`, et la MÊME forme
      // qu'en React et en Vue : la politique reçoit l'adresse (ici un
      // FOURNISSEUR d'injection, le vocabulaire d'Angular), une fonction par
      // besoin, et RIEN à libérer. Le compte de concepts est le même.
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
      const amain = readFileSync(
        path.join(adest, "frontend", "src", "main.ts"),
        "utf8",
      );
      // L'adresse est écrite UNE fois, dans les providers — pas dans le
      // composant, qui n'a aucune raison de la connaître.
      assert.include(amain, 'provideNodefony({ url: "/api/live/realtime" })');
      assert.include(aapp, "injectNodefony()");
      assert.include(aapp, "injectNodefonyState()");
      assert.include(
        aapp,
        'injectNodefonyChannelData<Evenement>("live:events")',
      );
      assert.include(aapp, '#live.request("live:ping"');
      assert.notInclude(aapp, "new WebSocket(");
      // Les mêmes refus qu'en React et en Vue : sans eux, on retomberait au
      // câblage manuel sans qu'aucun test ne tombe.
      assert.notInclude(aapp, "RealtimeClient.shared(");
      assert.notInclude(aapp, "connectShared(");
      // Et ce que la liaison fait DISPARAÎTRE : la liste de libérations, qui
      // est exactement l'endroit où un abonnement fuit sans se voir.
      assert.notInclude(aapp, "offLive");

      // Svelte — liaisons `nodefony/svelte`, et la MÊME forme que les trois
      // autres : la politique reçoit l'adresse (ici une configuration de
      // module, Svelte n'ayant pas de contexte applicatif), une liaison par
      // besoin, et RIEN à libérer.
      const sdest2 = path.join(tmp, "slive2");
      scaffold(sdest2, {
        name: "slive2",
        preset: "complete",
        frontend: "svelte",
      });
      const sapp2 = readFileSync(
        path.join(sdest2, "frontend", "src", "App.svelte"),
        "utf8",
      );
      const smain2 = readFileSync(
        path.join(sdest2, "frontend", "src", "main.ts"),
        "utf8",
      );
      assert.include(
        smain2,
        'configureNodefony({ url: "/api/live/realtime" })',
      );
      assert.include(sapp2, "nodefony()");
      assert.include(sapp2, "nodefonyState()");
      assert.include(sapp2, 'nodefonyChannelData<Evenement>("live:events")');
      assert.include(sapp2, 'live.request("live:ping"');
      assert.notInclude(sapp2, "new WebSocket(");
      assert.notInclude(sapp2, "RealtimeClient.shared(");
      assert.notInclude(sapp2, "connectShared(");
      assert.notInclude(sapp2, "offLive");

      // Ce que les QUATRE doivent tenir en commun, une fois toutes migrées.
      const vitrines: [string, string][] = [
        ["react", path.join(rdest, "frontend", "src", "App.tsx")],
        ["vue", path.join(vdest, "frontend", "src", "App.vue")],
        [
          "angular",
          path.join(adest, "frontend", "src", "app", "app.component.ts"),
        ],
        ["svelte", path.join(sdest2, "frontend", "src", "App.svelte")],
      ];
      for (const [front, fichier] of vitrines) {
        const src = readFileSync(fichier, "utf8");
        // Le canal est le MÊME dans les quatre : c'est ce qui rend les pages
        // comparables. La FORME de l'abonnement, elle, appartient à chaque
        // liaison — l'exiger identique reviendrait à exiger un cinquième
        // dialecte, ce que la grappe #54 a précisément supprimé.
        assert.include(src, '"live:events"', `${front} : le bon canal`);
        // Ce qui ne doit PLUS jamais revenir : la socket fabriquée à la main, le
        // nom d'un événement local recopié, l'appariement subscribe/unsubscribe
        // refait à la main — les trois recopies que #36 a supprimées.
        assert.notInclude(
          src,
          "RealtimeClient.shared(",
          `${front} : la socket ne se fabrique plus à la main`,
        );
        assert.notInclude(
          src,
          "__state__",
          `${front} : un nom d'événement local ne se recopie pas`,
        );
        assert.notInclude(
          src,
          'live.subscribe("live:events")',
          `${front} : l'abonnement est apparié par le socle`,
        );
        assert.notInclude(
          src,
          'live.unsubscribe("live:events")',
          `${front} : le désabonnement est apparié par le socle`,
        );
        assert.notInclude(src, "new WebSocket(", `${front} : plus de ws brut`);
      }
    });

    it("vue : SFC + plugin ; angular : composant + tsconfig.app.json", () => {
      const vdest = path.join(tmp, "vapp");
      scaffold(vdest, { name: "vapp", frontend: "vue" });
      assert.isTrue(existsSync(path.join(vdest, "frontend", "src", "App.vue")));
      const vpkg = readJson(path.join(vdest, "package.json"));
      assert.property(vpkg["devDependencies"], "vue");
      assert.notProperty(vpkg["dependencies"], "vue");
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

    it("svelte : App.svelte (runes) + shim + plugin en devDeps — complete ET minimal", () => {
      // Vitrine complète — mêmes preuves que vue (socle agnostique, pas de
      // WebSocket à la main), en syntaxe runes ($state) + mount() Svelte 5.
      const sdest = path.join(tmp, "slive");
      scaffold(sdest, {
        name: "slive",
        preset: "complete",
        frontend: "svelte",
      });
      const sapp = readFileSync(
        path.join(sdest, "frontend", "src", "App.svelte"),
        "utf8",
      );
      assert.include(sapp, "nodefony()");
      assert.include(sapp, 'nodefonyChannelData<Evenement>("live:events")');
      assert.include(sapp, "$state");
      assert.notInclude(sapp, "new WebSocket(");
      const sentry = readFileSync(
        path.join(sdest, "frontend", "src", "main.ts"),
        "utf8",
      );
      assert.include(sentry, 'import { mount } from "svelte"');
      // Shim TS : sans lui, tsgo ne résout pas l'import ./App.svelte.
      assert.include(
        readFileSync(path.join(sdest, "frontend", "src", "env.d.ts"), "utf8"),
        'declare module "*.svelte"',
      );
      // tsgo checke le TS du front (main.ts + shim) — même règle que vue.
      assert.include(
        readFileSync(path.join(sdest, "tsconfig.json"), "utf8"),
        "frontend/src/**/*.ts",
      );
      const spkg = readJson(path.join(sdest, "package.json"));
      assert.property(spkg["devDependencies"], "svelte");
      assert.property(spkg["devDependencies"], "@sveltejs/vite-plugin-svelte");
      assert.notProperty(spkg["dependencies"] ?? {}, "svelte");
      assert.include(
        readFileSync(
          path.join(sdest, "nodefony", "frontend", "registerSliveEntry.ts"),
          "utf8",
        ),
        'type: "svelte5"',
      );
      assertNoEtaResidue(sdest);

      // Minimal — echo WS brut (pas de realtime), compteur HMR.
      const mdest = path.join(tmp, "sapp");
      scaffold(mdest, { name: "sapp", preset: "minimal", frontend: "svelte" });
      const mapp = readFileSync(
        path.join(mdest, "frontend", "src", "App.svelte"),
        "utf8",
      );
      assert.include(mapp, "new WebSocket(");
      // La façade n'est pas IMPORTÉE en minimal (le commentaire du gabarit la
      // MENTIONNE — c'est voulu : il pointe vers `create controller --kind realtime`).
      assert.notInclude(mapp, "import { RealtimeClient }");
      assertNoEtaResidue(mdest);
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

    it("🔴 une URL servie par le SERVEUR passe par une liaison, dans les QUATRE", () => {
      // Ce que ce contrôle empêche, et qui a coûté une vitrine cassée depuis sa
      // création (`606add6c`) : une URL d'asset écrite EN DUR dans un template.
      // Le compilateur de composants monofichiers de Vue prend `src="/logo.png"`
      // pour un asset du bundle et tente de le RÉSOUDRE — le build de production
      // échoue alors sur un fichier qui n'a jamais eu à exister là, quand Vite en
      // développement sert la même URL sans y toucher. Rien ne le voyait : un
      // build de PROD est le seul juge, et le mode développement passait.
      //
      // Le contrôle porte sur les QUATRE fronts alors que deux seulement sont
      // exposés (Vue et Svelte compilent leur gabarit ; Angular garde le sien
      // dans une chaîne, JSX laisse la chaîne intacte). C'est délibéré : le
      // défaut n'a frappé qu'UN membre d'une famille que l'on croyait
      // identique, précisément parce que les quatre écrivaient la même ligne
      // sans que rien n'exige qu'ils l'écrivent pareil. Une seule écriture
      // possible — la liaison — et la divergence n'a plus où se loger.
      const ATTRIBUT_ASSET = /(?:^|\s)(src|srcset|poster)\s*=\s*"\/(?!\/)/gu;
      let vus = 0;
      for (const fw of ["react", "vue", "angular", "svelte"]) {
        const dest = path.join(tmp, `asset-${fw}`);
        scaffold(dest, {
          name: `asset-${fw}`,
          preset: "complete",
          frontend: fw,
        });
        for (const entry of readdirSync(path.join(dest, "frontend", "src"), {
          recursive: true,
          withFileTypes: true,
        })) {
          if (!entry.isFile()) continue;
          if (!/\.(ts|tsx|vue|svelte|html)$/u.test(entry.name)) continue;
          const file = path.join(entry.parentPath, entry.name);
          const found = [
            ...readFileSync(file, "utf8").matchAll(ATTRIBUT_ASSET),
          ];
          assert.deepEqual(
            found.map((m) => m[0].trim()),
            [],
            `${fw}/${entry.name} : URL d'asset en dur — la porter par une ` +
              `liaison (cf frontend/src/brand.ts), sinon le build de PRODUCTION ` +
              `tente de la résoudre dans le bundle`,
          );
          vus += 1;
        }
      }
      // Un motif qui ne lit aucun fichier reste vert pour toujours.
      assert.isAbove(vus, 3, "aucun fichier de front lu — contrôle inopérant");
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
      // La porte MCP se CONSOMME (4 outils) mais s'ÉTEND aussi : une app publie
      // les siens par `getMcpTools()`. La capacité vivait dans le README du
      // devkit — donc nulle part, pour un agent qui lit ce fichier-ci et rien
      // d'autre. ⚠️ Chercher « MCP » ne prouverait RIEN : le sigle apparaît
      // dans toute la section voisine (ai:mcp, .mcp.json, mcp.tools), et
      // retirer l'extension laisserait ce gate au vert. On ancre donc sur ce
      // qui est PROPRE à la déclaration — le contrat, l'enveloppe de réponse,
      // et l'avertissement qui la borne.
      for (const needle of [
        "getMcpTools()",
        "type IMcpTool",
        "mcpText(",
        // Un outil réservé se DÉCLARE, et l'agent doit savoir que le refus est
        // fermé par défaut — sinon il croit à une panne et contourne.
        'scopes: ["shop:read", "shop:billing"]',
        "inappelable en le nommant",
        "n'authentifie PERSONNE",
      ]) {
        assert.include(agents, needle, `AGENTS.md sans « ${needle} »`);
      }
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
      // CLAUDE.md = un POINTEUR, et presque rien d'autre. Deux contenus
      // propres seulement, chacun payé par une mesure au banc : le renvoi à
      // `create --help` (une liste de générateurs avait déjà dérivé —
      // `create command` y manquait — et l'agent écrivait à la main), et
      // `npm run verify` (trois tâches FAIL sur un code qui ne compilait
      // pas : l'agent lançait `npm test` en boucle sans jamais typechecker,
      // et n'ouvrait pas AGENTS.md — ce pointeur est le SEUL texte qu'un
      // agent headless reçoit d'office).
      //
      // La règle qui vaut la garde de TAILLE ci-dessous : tout ce qu'on
      // recopierait ici existe dans `AGENTS.md` et en divergerait en silence.
      // Ce fichier s'est déjà rempli par ajouts successifs — il annonçait
      // « les trois réflexes » alors qu'il en portait quatre. Le seuil est
      // donc serré exprès : il fait échouer le prochain ajout, pas le dixième.
      const claude = readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
      assert.include(claude, "AGENTS.md");
      assert.include(claude, "nodefony create --help");
      // Le réflexe gate : un `npm test` vert ne typecheck rien (le runner
      // efface les types) — c'est la panne commune des trois FAIL mesurés.
      assert.include(claude, "npm run verify");
      assert.isBelow(
        claude.split("\n").length,
        15,
        "CLAUDE.md se remplit : ce qui doit être lu vit dans AGENTS.md",
      );
      // Ces sujets sont traités par AGENTS.md — les redire ici crée deux
      // versions dont une seule sera corrigée.
      for (const recopie of [
        "nodefony env",
        "nodefony stop",
        "RealtimeClient",
      ]) {
        assert.notInclude(claude, recopie);
        assert.include(agents, recopie);
      }
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
      // La suite de migration de l'application : elle prouve chez l'UTILISATEUR
      // ce que le dépôt du framework ne prouve que chez lui. Un préréglage avec
      // ORM doit la porter — sans elle, une chaîne de migration cassée à
      // l'installation ne se voit qu'en production.
      assert.isTrue(
        existsSync(path.join(dest, "tests", "migrations.e2e.test.ts")),
        "la suite de migration de l'application doit être générée",
      );
      const e2eMigrations = readFileSync(
        path.join(dest, "tests", "migrations.e2e.test.ts"),
        "utf8",
      );
      // Une application générée n'a PAS `globals` : ses tests importent leurs
      // primitives. Un fichier écrit avec la convention du dépôt du framework
      // échoue ici sur `beforeAll is not defined` — mesuré sur une application
      // réelle, pas déduit.
      assert.include(e2eMigrations, 'from "vitest"');
      // Le port se LIT, il ne se devine pas : un repli `?? 5151` fait
      // interroger le premier serveur venu sur la machine, et le verdict porte
      // alors sur LUI. Constaté : un serveur de dev laissé ouvert rendait 404 à
      // toute la suite, qui accusait les routes de l'application.
      assert.include(e2eMigrations, "runningAppPort()");
      assert.notInclude(e2eMigrations, "?? 5151");
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

    // Mesuré au banc de découvrabilité (tâche 23, 3 runs) : pour faire aboutir
    // les envois d'un partenaire, DEUX agents sur trois DÉMONTENT la défense
    // CSRF — une origine inconnue obtient alors 201. Aucun ne déclare l'origine,
    // aucun n'ouvre la doc du module. La cause n'est pas le jugement de l'agent
    // mais le placement du savoir : `@CsrfExempt` porte un nom qui se devine,
    // `trustedOrigins` n'était écrit nulle part où l'agent lit d'office.
    it("csrf : l'AGENTS.md donne le geste (trustedOrigins) et son bloc reste recopiable", () => {
      const dest = path.join(tmp, "csrf-agents");
      scaffold(dest, {
        name: "csrf-agents",
        preset: "complete",
        frontend: "none",
      });
      const agents = readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      assert.include(
        agents,
        "trustedOrigins",
        "AGENTS.md doit nommer la clé qui DÉCLARE une origine partenaire",
      );
      // Nommer la bonne réponse ne suffit pas : la porte de sortie se devine
      // sans documentation, il faut donc la citer POUR la désigner comme fausse.
      assert.include(
        agents,
        "@CsrfExempt",
        "AGENTS.md doit nommer le réflexe (@CsrfExempt) pour le récuser",
      );
      // Le bloc montré est fait pour être recopié dans `nodefony.config.ts`. S'il
      // perdait la clé `secret` que la config y pose, le recopier couperait le
      // token synchronizer — en silence, tests verts.
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      const bloc = (texte: string) =>
        /csrf:\s*\{[^}]*?secret:\s*([^,\n}]+)/u.exec(texte)?.[1].trim() ?? null;
      const secretConfig = bloc(config);
      const secretAgents = bloc(agents);
      assert.isNotNull(
        secretConfig,
        "bloc csrf introuvable dans la config générée",
      );
      assert.isNotNull(secretAgents, "bloc csrf introuvable dans l'AGENTS.md");
      assert.equal(
        secretAgents,
        secretConfig,
        "le bloc csrf de l'AGENTS.md doit reprendre le secret de la config — sinon le recopier le supprime",
      );
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
      assert.include(src, '@RealtimeChannel("pulse:events")');
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

    it("--module accepte le nom COURT du module, pas seulement son nom npm", () => {
      // Un module a deux identités : `@app/blog` (manifeste) et `blog` (dossier,
      // celui qu'on a tapé pour le créer). N'accepter que la première faisait
      // échouer `--module blog` juste après `create module blog` — trois
      // tentatives perdues par un agent tiers sur cette seule asymétrie.
      const dest = path.join(tmp, "shortapp");
      scaffold(dest, { name: "shortapp", preset: "minimal" });
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      controller(dest, { name: "post", module: "blog" });
      assert.isTrue(
        existsSync(
          path.join(
            dest,
            "modules",
            "blog",
            "nodefony",
            "controllers",
            "PostController.ts",
          ),
        ),
      );
      // Le nom npm exact reste évidemment accepté.
      controller(dest, { name: "tag", module: "@shortapp/blog" });
    });

    it("nom court AMBIGU : refus qui nomme les candidats, jamais un choix arbitraire", () => {
      // Deux dossiers de workspaces peuvent porter le même nom court — c'est le
      // cas d'un monorepo (`packages/@x/auth` ET `modules/auth`). On ne devine
      // pas : on rend les deux noms complets.
      const dest = path.join(tmp, "ambigu");
      scaffold(dest, { name: "ambigu", preset: "minimal" });
      const pkgPath = path.join(dest, "package.json");
      const pkg = readJson(pkgPath) as unknown as Record<string, unknown>;
      pkg["workspaces"] = ["modules/*", "packages/@x/*"];
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      for (const [rel, name] of [
        [path.join("modules", "auth"), "@ambigu/auth"],
        [path.join("packages", "@x", "auth"), "@x/auth"],
      ] as const) {
        const dir = path.join(dest, rel);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "package.json"),
          `${JSON.stringify({ name, version: "0.1.0" }, null, 2)}\n`,
        );
        writeFileSync(path.join(dir, "index.ts"), "export default {};\n");
      }
      assert.throws(
        () => controller(dest, { name: "x", module: "auth" }),
        /désigne 2 modules[\s\S]*@ambigu\/auth[\s\S]*@x\/auth/u,
      );
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

    it("génère AUSSI son test unitaire — sinon l'agent écrit un e2e", () => {
      // 🔴 Mesuré au banc de découvrabilité (tâche 13) : sommé de rendre chaque
      // responsabilité « testable séparément », l'agent écrit des tests de bout
      // en bout. Il n'a rien d'autre à copier — `create service` était le SEUL
      // générateur sans test, quand `entity` en produit deux et `module` un.
      const dest = path.join(tmp, "svctest");
      scaffold(dest, { name: "svctest", preset: "minimal" });
      const r = service(dest, { name: "tax", description: "Calcul de la TVA" });
      const file = path.join(dest, "tests", "TaxService.test.ts");
      assert.isTrue(existsSync(file), "aucun test généré pour le service");
      assert.include(r.files, path.join("tests", "TaxService.test.ts"));
      const src = readFileSync(file, "utf8");
      // Il passe par la porte PUBLIÉE, pas par un kernel bricolé.
      assert.include(src, 'from "nodefony/testing"');
      assert.include(src, "createTestModule()");
      // 🔴 Et il n'assied AUCUNE assertion sur la méthode d'exemple, que le
      // gabarit dit de remplacer : un test écrit sur `greet()` serait rouge à
      // la première modification de l'utilisateur. C'est le piège déjà payé par
      // `create command --service`, qui EXIGEAIT cette même méthode.
      assert.notInclude(src, "greet");
      // Zéro balise eta résiduelle.
      assertNoEtaResidue(dest);
    });

    it("le test généré COMPILE aussi quand le service a une dépendance", () => {
      // 🔴 Le banc de vérité a attrapé ce qu'aucune assertion de chaîne ne
      // voyait : avec `--inject`, le constructeur prend DEUX arguments, et le
      // test généré n'en passait qu'un — `TS2554: Expected 2 arguments, but
      // got 1`, trois fois. D'où le constructeur local `build()`, seul endroit
      // du fichier qui connaît la forme du constructeur.
      const dest = path.join(tmp, "svctestdep");
      scaffold(dest, { name: "svctestdep", preset: "minimal" });
      service(dest, { name: "tax", description: "Calcul de la TVA" });
      service(dest, {
        name: "invoice",
        description: "Facturation",
        inject: "TaxService",
      });
      const src = readFileSync(
        path.join(dest, "tests", "InvoiceService.test.ts"),
        "utf8",
      );
      // La dépendance est CONSTRUITE et passée — sinon le fichier ne compile pas.
      assert.include(src, "new TaxService(module)");
      assert.include(src, "new InvoiceService(module, new TaxService(module))");
      // Et le service SANS dépendance n'en invente pas une.
      const seul = readFileSync(
        path.join(dest, "tests", "TaxService.test.ts"),
        "utf8",
      );
      assert.include(seul, "new TaxService(module)");
      assert.notInclude(seul, "new TaxService(module, ");
    });

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

    it("un TSDoc qui CITE @services([…]) n'est pas réécrit à la place du décorateur", () => {
      // Vécu sur un run du banc : `String.replace` sans `g` réécrit la PREMIÈRE
      // occurrence, et le gabarit d'application CITE `@services([…])` dans le
      // TSDoc au-dessus de la classe pour expliquer à quoi sert la liste. La
      // prose se retrouvait donc réécrite — « `@services([…, TaxService])` est
      // ce qui fait EXISTER un service » — et s'allongeait à chaque service
      // créé, pendant que le vrai décorateur était bien étendu. Rien ne cassait :
      // un commentaire ne compile pas.
      const dest = path.join(tmp, "svctsdoc");
      scaffold(dest, { name: "svctsdoc", preset: "minimal" });
      const indexPath = path.join(dest, "index.ts");
      const prose = " * ⚠️ `@services([…])` fait EXISTER un service.";
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace(
          /^(class App extends Module\b)/mu,
          `/**\n${prose}\n */\n$1`,
        ),
      );
      service(dest, { name: "tax", description: "TVA" });
      const after = readFileSync(indexPath, "utf8");
      assert.include(after, prose, "le TSDoc a été réécrit à la place du code");
      assert.match(after, /^@services\(\[TaxService\]\)$/mu);
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

    it("controller ET frontend cohabitent — la page ne réclame pas le nom du module", () => {
      // Régression mesurée sur un agent tiers : les deux scaffolds délégués
      // rendaient `<Pascal>Controller`. Avec le même nom, la commande échouait
      // sur ce qu'elle venait ELLE-MÊME d'écrire (« déjà référencé — choisis un
      // autre nom »), pour TOUT nom — donc `create module --frontend <fw>`
      // était inutilisable telle que l'`AGENTS.md` généré l'annonce.
      const dest = app("cohab");
      mod(dest, { name: "shop", controller: "hello", frontend: "vue" });
      const controllers = path.join(
        dest,
        "modules",
        "shop",
        "nodefony",
        "controllers",
      );
      assert.isTrue(existsSync(path.join(controllers, "ShopController.ts")));
      assert.isTrue(
        existsSync(path.join(controllers, "ShopPageController.ts")),
      );
      // La CLASSE diffère, l'URL reste courte : c'est le nom qui gênait, pas
      // la route (le controller du module vit sous /api/…).
      const page = readFileSync(
        path.join(controllers, "ShopPageController.ts"),
        "utf8",
      );
      assert.include(page, 'path: "/shop"');
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
      // Deps du framework ajoutées au package.json (catalogue unique) — le
      // framework front en dev, pour que `npm prune --omit=dev` le retire.
      const pkg = readJson(path.join(dest, "package.json"));
      assert.property(pkg["devDependencies"], "react");
      assert.notProperty(pkg["dependencies"], "react");
      assert.property(pkg["devDependencies"], "@vitejs/plugin-react");
      assert.include((r.notes ?? []).join("\n"), "npm install");
      // Le controller de page rend l'entry du BON nom.
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "DashboardController.ts"),
        "utf8",
      );
      assert.include(ctrl, '"dashboard"');
      assert.include(ctrl, "renderDocument(");
      // Les DEUX données de la requête sont propagées au rendu : le nonce CSP
      // (sans lui, `script-src 'nonce-…'` bloque les balises émises) ET l'hôte
      // (sans lui, l'application générée annonce ses assets sur l'hôte du
      // démarrage — un poste et un conteneur ne peuvent plus être servis
      // ensemble, panne vécue sur Studio). Un gabarit est du code DISTRIBUÉ :
      // ce qu'il n'écrit pas, aucune application ne l'aura.
      assert.include(ctrl, "this.context?.cspNonce");
      assert.include(ctrl, "this.context?.domain");
      assert.include(ctrl, 'path: "/dashboard"');
      assertNoEtaResidue(dest);
    });

    it("module local : la brique de l'app est POSÉE en peer, pas réclamée à la main", () => {
      // Régression mesurée sur un agent tiers : la garde refusait dès que
      // `@nodefony/frontend` manquait à la CIBLE. Un module local est un
      // workspace — rien ne s'y installe pour son compte propre — et l'agent a
      // dû éditer le package.json à la main, ce qu'un générateur existe pour
      // éviter. Le registrar rendu importe le type `FrontendService` : la
      // dépendance est réelle (typecheck), d'où la peer, comme `@nodefony/http`.
      const dest = path.join(tmp, "fmod");
      scaffold(dest, { name: "fmod", preset: "complete", frontend: "none" });
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      const r = front(dest, {
        name: "page",
        frontend: "vue",
        module: "@fmod/blog",
      });
      const pkg = readJson(path.join(dest, "modules", "blog", "package.json"));
      assert.property(pkg["peerDependencies"], "@nodefony/frontend");
      assert.include((r.notes ?? []).join("\n"), "@nodefony/frontend");
    });

    it("app SANS la brique : la garde mord toujours (rien à poser depuis rien)", () => {
      const dest = path.join(tmp, "fmini");
      scaffold(dest, { name: "fmini", preset: "minimal", frontend: "none" });
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.throws(
        () =>
          front(dest, { name: "page", frontend: "vue", module: "@fmini/blog" }),
        /@nodefony\/frontend manque/u,
      );
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
      assert.include(
        (r.notes ?? []).join("\n"),
        "table posts sur le connecteur « default » (sqlite)",
      );
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
      // Allowlist de tri : un `?order=` libre laisserait le client nommer une
      // colonne inconnue, et l'ORM lèverait — un 500 offert à qui tape au hasard.
      assert.match(src, /const SORTABLE = \[[^\]]*"title"/u);
      // 🔴 LE contrat de page du framework, pas un parseur maison. Un gabarit
      // est DISTRIBUÉ : le dialecte qu'il porte devient celui de toutes les
      // applications générées. Il a déjà porté le sien (`?sort=-champ`, JSON:API)
      // pendant que le framework parlait `?order=champ:SENS` — deux dialectes,
      // dont un seul documenté, et rien pour le signaler.
      assert.include(
        src,
        'import { parsePageQuery, parseFilters } from "nodefony"',
      );
      assert.include(src, "sortable: SORTABLE");
      assert.notInclude(
        src,
        "function parseSort",
        "le controller généré ne réécrit PAS un lecteur de tri",
      );
      assert.notInclude(
        src,
        '@Query("sort")',
        "le dialecte JSON:API `?sort=-champ` a été remplacé par `?order=champ:SENS`",
      );
    });

    it("le vocabulaire de FILTRE est déclaré, et il traverse jusqu'au store", () => {
      const dest = app("eapp4bis");
      entity(dest, { name: "Author", fields: "email:string!" });
      entity(dest, {
        name: "Post",
        fields:
          "title:string published:bool status:enum(draft,live) author:ref:Author",
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      // Les trois natures où l'ÉGALITÉ veut dire quelque chose — et elles seules.
      assert.include(src, 'published: "boolean"');
      assert.include(src, 'status: ["draft", "live"]');
      assert.include(src, 'author: "string"');
      // Une chaîne libre n'est PAS un filtre : l'égalité stricte sur un titre
      // n'est jamais ce qu'on cherche, `?q=` répond à ça.
      assert.notInclude(src, 'title: "string"');
      assert.include(src, "as const satisfies IFilterSpec");
      // Déclaré ⇒ honoré : le filtre devient un critère de store, il n'est pas
      // appliqué après découpage (ce qui rendrait des pages incomplètes).
      assert.include(src, "parseFilters(query, FILTERS)");
      assert.include(src, "criteria: filters");
    });

    it("sans champ filtrable, la spec reste VIDE — et refuse quand même l'inconnu", () => {
      const dest = app("eapp4ter");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      // Le refus du paramètre inventé ne dépend d'aucun filtre déclaré : c'est
      // lui qui empêche `?titre=x` de rendre la collection entière sous un 200.
      assert.match(
        src,
        /const FILTERS = \{\s*\} as const satisfies IFilterSpec/u,
      );
      assert.include(src, "parseFilters(query, FILTERS)");
    });

    it("une relation inconnue dans ?include= est refusée, pas ignorée", () => {
      const dest = app("eapp4quater");
      entity(dest, { name: "Author", fields: "email:string!" });
      entity(dest, { name: "Post", fields: "title:string author:ref:Author" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      // Le `.filter(INCLUDABLE.has)` d'origine rendait la fiche SANS la relation
      // demandée, sous un 200 : le client lit « relation vide », pas « nom faux ».
      assert.notInclude(src, "filter((name) => INCLUDABLE.has(name))");
      assert.include(src, "Relation « ${name} » inconnue");
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

    describe("sondes des tests générés (tri et filtre ÉPROUVABLES)", () => {
      // Ces deux sondes décident si un test e2e est ÉMIS. Se tromper ne casse
      // pas la génération : elle émet un test qui échoue sur du code correct
      // (le cas vécu), ou n'en émet aucun là où il en fallait un. Ni le
      // typecheck ni les assertions de chaînes ne le voient.
      const champ = (o: object) => ({ nullable: false, ...o }) as never;

      it("un booléen offre son contraire — de quoi prouver que le filtre FILTRE", () => {
        const probe = filterProbe([champ({ name: "publie", type: "bool" })]);
        assert.deepStrictEqual(probe, {
          name: "publie",
          match: "true",
          matchJson: "true",
          other: "false",
          otherJson: "false",
        });
      });

      it("une énumération à DEUX valeurs les offre ; à UNE seule, elle ne prouve rien", () => {
        const deux = filterProbe([
          champ({
            name: "statut",
            type: "enum",
            values: ["draft", "published"],
          }),
        ]);
        assert.strictEqual(deux?.name, "statut");
        assert.strictEqual(deux?.match, "draft");
        assert.strictEqual(deux?.otherJson, '"published"');
        // Une seule valeur : aucune ligne témoin n'est fabricable, donc
        // « toutes les lignes portent la valeur demandée » serait vrai même
        // avec le filtre débranché.
        assert.isNull(
          filterProbe([
            champ({ name: "statut", type: "enum", values: ["draft"] }),
          ]),
        );
      });

      it("une clé étrangère seule ne se prête PAS au test — poser une 2ᵉ valeur sortirait du sujet", () => {
        assert.isNull(
          filterProbe([
            champ({ name: "titre", type: "string" }),
            champ({ name: "auteur", type: "ref", target: "Author" }),
          ]),
        );
      });

      it("un filtre `string` ne peut REFUSER aucune valeur — aucun test de rejet n'est émis", () => {
        // Le défaut vécu : le test visait le premier filtre déclaré quel qu'il
        // soit et exigeait un 400. Sur une entité dont le seul filtre est une
        // clé étrangère à identifiant textuel, il réclamait le refus d'une
        // valeur parfaitement valide — et mettait en défaut le générateur.
        assert.isNull(malformedProbe([{ name: "auteur", def: '"string"' }]));
      });

      it("booléen, entier et énumération savent refuser — chacun sa valeur fautive", () => {
        assert.deepStrictEqual(
          malformedProbe([{ name: "actif", def: '"boolean"' }]),
          {
            name: "actif",
            value: "oui",
          },
        );
        assert.deepStrictEqual(
          malformedProbe([{ name: "auteur", def: '"int"' }]),
          {
            name: "auteur",
            value: "abc",
          },
        );
        // Le premier filtre RÉFUTABLE est retenu, pas le premier déclaré.
        assert.deepStrictEqual(
          malformedProbe([
            { name: "auteur", def: '"string"' },
            { name: "statut", def: '["draft", "published"]' },
          ]),
          { name: "statut", value: "valeur-hors-domaine" },
        );
      });
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

    it("🔴 la commande GÉNÉRÉE naît avec les quatre leçons payées sur le cœur", () => {
      // Un gabarit est du code DISTRIBUÉ : ce qu'il n'enseigne pas, chaque
      // développeur le réapprendra par le même bug. Ces trois-là ont été payées
      // le même jour sur les commandes du framework.
      const dest = appWithModule("cmdlecons");
      const r = command(dest, { name: "publish", module: "@cmdlecons/blog" });
      const src = readFileSync(
        path.join(r.dest, "nodefony", "command", "PublishCommand.ts"),
        "utf8",
      );

      // 1. Le journal de boot n'est pas la sortie : sans ceci, la commande rend
      //    trente lignes de `MODULE ADD` avant sa réponse.
      assert.include(src, "quietBoot: true");

      // 2. La SORTIE va sur stdout, jamais dans le journal — sinon le filtre
      //    ci-dessus (ou `--json`) efface la réponse elle-même.
      //    ⚠️ On regarde le CODE, pas les commentaires : le gabarit CITE
      //    `this.log(message, "INFO")` pour dire de ne pas l'écrire, et une
      //    sonde naïve accuse alors la phrase qui met en garde.
      const codeSeul = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      assert.notMatch(
        codeSeul,
        /this\.log\(message/u,
        "la sortie passe par le journal : un filtre la fera disparaître",
      );
      assert.include(src, "process.stdout.write(`${message}");

      // 3. Un argument indispensable se DEMANDE : déclaré `<requis>`, commander
      //    refuse la commande avant qu'elle existe — y compris choisie au menu.
      assert.include(src, "askArgument");

      // 4. ENCHAÎNER une autre commande : trois choses ne suivent pas d'un
      //    process à l'autre, et elles ont été écrites deux fois à la main
      //    avant que le gabarit ne les enseigne.
      //    ⚠️ On vérifie le BLOC D'EXEMPLE, pas la prose qui l'explique : une
      //    première version cherchait `stdio: "inherit"` n'importe où, et le
      //    texte pédagogique la satisfaisait à lui seul — le test restait vert
      //    en ayant perdu l'exemple, c'est-à-dire la seule chose qui AGIT.
      const exemple = src.slice(src.indexOf("spawnSync(process.execPath"));
      assert.isNotEmpty(exemple, "le gabarit n'enseigne plus l'enchaînement");
      for (const clef of [
        'stdio: "inherit"',
        "NODE_ENV",
        "cwd: this.kernel?.path",
      ]) {
        assert.include(
          exemple.slice(0, 400),
          clef,
          `${clef} absent de l'exemple d'enchaînement`,
        );
      }
      assert.notMatch(
        src,
        /addArgument\("<[a-z]/u,
        "un argument déclaré obligatoire fait refuser la commande au menu",
      );
    });

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

    it("le plan NOMME sa cible et rend ce que l'exécution dirait", () => {
      // 🔴 Mesuré au banc de découvrabilité : à qui l'on demande d'établir un
      // plan, l'agent colle la sortie du `--dry-run` — et cette sortie ne
      // portait qu'un inventaire de fichiers. Ni le connecteur visé, ni le
      // dialecte, ni les routes : les notes, qui les disent, n'étaient rendues
      // qu'en exécution RÉELLE. Une simulation qui tait ce que la commande dit
      // n'est pas une simulation.
      const dest = path.join(tmp, "simentity");
      scaffold(dest, {
        name: "simentity",
        preset: "complete",
        frontend: "none",
      });
      const before = snapshotTree(dest);
      const r = runScaffold(
        {
          type: "entity",
          answers: { name: "Invoice", fields: "number:string! amount:int" },
          dir: dest,
          force: false,
        },
        version,
        { dryRun: true },
      );
      assertTreeUnchanged(before, dest);
      const notes = (r.notes ?? []).join("\n");
      // Le CONNECTEUR est nommé — sur une app multi-connecteurs, le seul
      // dialecte ne dit pas OÙ la table atterrit.
      assert.include(notes, "default");
      assert.match(notes, /sqlite|postgres|mysql/u);
      // Et le rendu du plan les porte : c'est lui que l'agent recopie.
      const rendu = renderDryRun(r.changes ?? [], r.notes);
      assert.include(rendu, "default");
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

  describe("dépendances des GABARITS (anti-dépendance fantôme)", () => {
    it("aucun gabarit n'importe un paquet qu'aucun manifeste généré ne déclare", async () => {
      const { FRONTEND_PARAMS } = await import("../cli/scaffold/engine");
      const templates = path.join(findPackageRoot(), "templates");

      // Ce qu'un projet généré DÉCLARE, tous gabarits et toutes saveurs
      // confondus : les deux manifestes (app + module) lus en TEXTE — ils
      // portent des tags eta, donc `JSON.parse` échouerait — plus les
      // frameworks front, qui sont ajoutés par le moteur et non par le
      // manifeste. L'union est volontairement LARGE : ce contrôle ne juge pas
      // qu'une saveur déclare la bonne dépendance (c'est le travail de
      // `nodefony check` sur l'app rendue), il attrape le paquet que
      // PERSONNE ne déclare nulle part.
      const declared = new Set<string>();
      for (const rel of [
        path.join("app", "base", "package.json.tpl"),
        path.join("module", "base", "package.json.tpl"),
      ]) {
        const text = readFileSync(path.join(templates, rel), "utf8");
        for (const m of text.matchAll(
          /"((?:@[a-z0-9-]+\/)?[a-z0-9.-]+)"\s*:/gu,
        )) {
          declared.add(m[1]);
        }
      }
      for (const front of Object.values(FRONTEND_PARAMS)) {
        for (const name of Object.keys({ ...front.deps, ...front.devDeps })) {
          declared.add(name);
        }
      }

      // Ancré en début de ligne, comme la règle `undeclared-import` de
      // `nodefony check` : un gabarit MONTRE des imports dans son TSDoc (le
      // snippet client de `create controller --kind realtime`), et réclamer une
      // dépendance pour du texte d'exemple serait un faux positif.
      const IMPORTS =
        /^\s*(?:import|export)[^;]*?from\s+"([^".][^"]*)"|^\s*import\s+"([^".][^"]*)"/gmu;
      const phantoms: string[] = [];
      for (const entry of readdirSync(templates, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !/\.(ts|tsx|vue)\.tpl$/u.test(entry.name)) {
          continue;
        }
        const abs = path.join(entry.parentPath, entry.name);
        const source = readFileSync(abs, "utf8");
        for (const m of source.matchAll(IMPORTS)) {
          const spec = m[1] ?? m[2];
          if (spec.startsWith("node:")) {
            continue;
          }
          // `@scope/nom/sous-chemin` → `@scope/nom` ; `nom/sous` → `nom`.
          const parts = spec.split("/");
          const pkg = spec.startsWith("@")
            ? parts.slice(0, 2).join("/")
            : parts[0];
          if (!declared.has(pkg)) {
            phantoms.push(`${path.relative(templates, abs)} → ${spec}`);
          }
        }
      }

      // Vécu : le test rendu par `create controller --kind realtime` importait
      // `reflect-metadata`, qu'aucune application ne déclare — le polyfill est
      // chargé par `@nodefony/realtime` lui-même. Le typecheck de l'app générée
      // partait rouge chez qui n'a pas le hissage npm pour le sauver (`--link`,
      // pnpm). Un gabarit distribue son dialecte ET ses dépendances : une dette
      // écrite ici se paie chez tous ceux qui génèrent.
      assert.deepEqual(
        phantoms,
        [],
        `gabarit(s) important un paquet non déclaré :\n${phantoms.join("\n")}`,
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
      // · agents → ENTRÉE (aucun : rien n'est jamais coché par défaut)
      feedAnswers(input, output, ["demo", "2", "2", "o", ""]);
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
        agents: [],
      });
    });

    it("ne redemande pas ce que les flags ont déjà dit ; saute link sans checkout", async () => {
      const [spec] = getScaffoldSpec("app");
      const input = new PassThrough();
      const output = new PassThrough();
      // frontend, puis agents : deux entrées vides = les deux défauts (none,
      // aucun). Au RYTHME des invites — readline ne met pas en file ce qui
      // arrive entre deux `question()`.
      feedAnswers(input, output, ["", ""]);
      const answers = await askMissing(
        spec,
        { name: "demo", preset: "minimal" },
        { hasCheckout: false },
        input,
        output,
      );
      assert.equal(answers.frontend, "none");
      assert.deepEqual(answers.agents, []); // ENTRÉE = aucun agent, rien d'écrit
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

  // E2E binaire réel (gate NF_RUN_CLI_BOOT — exige un `npm run build` PRÉALABLE :
  // un spawn valide le DIST, pas le source).
  const describeBoot = process.env["NF_RUN_CLI_BOOT"]
    ? describe
    : describe.skip;
  describeBoot("e2e bin/nodefony create (dist)", () => {
    // ⏱️ Ce test SPAWNE un process : le défaut de 5 s de vitest est un budget
    // d'assertion, pas de démarrage. Sous `test:all` (workspaces en parallèle) il
    // est dépassé sans qu'aucun défaut n'existe — vert en isolation, rouge en
    // suite. Le délai n'est pas une mesure ici : rien ne s'évalue en temps.
    it("spawn → exit 0 + arbre généré", { timeout: 120_000 }, () => {
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

// Le geste `--git-hooks` de `create app` EST `installGitHooks` — même
// implémentation que la commande `nodefony git:hooks`, jamais recopiée. Ce
// bloc prouve le CÂBLAGE : l'option traverse le parse, le moteur, et les
// hooks entrent dans le COMMIT INITIAL (posés entre `git init` et le commit).
describe("create app --git-hooks", { timeout: 60_000 }, () => {
  let dest = "";
  const envAvant: Record<string, string | undefined> = {};

  beforeEach(() => {
    dest = mkdtempSync(path.join(os.tmpdir(), "nf-create-hooks-"));
    // L'identité git est posée par l'ENV (héritée par les spawn de create) :
    // sans elle, le commit initial échoue sur une machine/CI sans .gitconfig
    // et le test conclurait FAUX sur l'appartenance au commit.
    for (const [k, v] of Object.entries({
      GIT_AUTHOR_NAME: "banc",
      GIT_AUTHOR_EMAIL: "banc@local",
      GIT_COMMITTER_NAME: "banc",
      GIT_COMMITTER_EMAIL: "banc@local",
    })) {
      envAvant[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterEach(() => {
    rmSync(dest, { recursive: true, force: true });
    for (const [k, v] of Object.entries(envAvant)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("🔴 pose .githooks + core.hooksPath, et les hooks sont DANS le commit initial", async () => {
    const code = await runCreateCommand(
      argv(
        "create",
        "app",
        "hooks-app",
        "--dir",
        dest,
        "--force",
        "--preset",
        "minimal",
        "--no-install",
        "--git-hooks",
        "--yes",
      ),
    );
    assert.equal(code, SysExit.OK);
    const hook = path.join(dest, ".githooks", "pre-commit");
    assert.isTrue(existsSync(hook), "pre-commit absent — le flag n'a pas agi");
    assert.include(readFileSync(hook, "utf8"), "nodefony git:hooks");
    const cfg = spawnSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: dest,
      encoding: "utf8",
    });
    assert.equal(cfg.stdout.trim(), ".githooks");
    // Dans le COMMIT INITIAL — pas seulement sur le disque : posés après le
    // commit, ils ne suivraient ni l'équipe ni la CI.
    const fichiers = spawnSync(
      "git",
      ["log", "--name-only", "--format=", "-1"],
      { cwd: dest, encoding: "utf8" },
    ).stdout;
    assert.include(fichiers, ".githooks/pre-commit");
    assert.include(fichiers, ".githooks/pre-push");
  });

  it("sans le flag : AUCUN hook, aucune config — le défaut est la CI", async () => {
    const code = await runCreateCommand(
      argv(
        "create",
        "app",
        "sans-hooks",
        "--dir",
        dest,
        "--force",
        "--preset",
        "minimal",
        "--no-install",
        "--yes",
      ),
    );
    assert.equal(code, SysExit.OK);
    assert.isFalse(existsSync(path.join(dest, ".githooks")));
    const cfg = spawnSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: dest,
      encoding: "utf8",
    });
    assert.notEqual(cfg.status, 0);
  });
});

describe("create app — l'AGENT se choisit, la porte MCP vient avec (lot 2)", () => {
  const parCli = AGENT_TARGETS.filter((c) => c.declaration === "cli");
  const parFichier = AGENT_TARGETS.filter(
    (c) => c.declaration === "fichier-projet",
  );

  it("aucun agent coché → RIEN n'est écrit (pas même le .mcp.json)", () => {
    assert.isNull(argvCablageMcp([], AGENT_TARGETS, "/tmp/app"));
  });

  it("un agent à CLI coché → ai:mcp le nomme, dans l'app NEUVE, en mode authentifié", () => {
    assert.isAtLeast(parCli.length, 1, "fixture : au moins un agent à CLI");
    const cle = parCli[0]!.cle;
    assert.deepEqual(argvCablageMcp([cle], AGENT_TARGETS, "/tmp/app"), [
      "ai:mcp",
      "--cwd",
      "/tmp/app",
      "--auth",
      "--agent",
      cle,
    ]);
  });

  it("seulement un agent servi par le FICHIER → `none` : le .mcp.json est écrit, aucune CLI lancée", () => {
    assert.isAtLeast(
      parFichier.length,
      1,
      "fixture : au moins un agent servi par fichier",
    );
    const argv = argvCablageMcp(
      [parFichier[0]!.cle],
      AGENT_TARGETS,
      "/tmp/app",
    );
    assert.isNotNull(argv);
    assert.deepEqual(argv?.slice(-2), ["--agent", "none"]);
  });

  it("le choix « standard » (norme AGENTS.md + MCP) écrit le fichier et ne lance AUCUNE CLI", () => {
    // Il ne correspond à aucun outil de la table : c'est le cas de l'agent
    // conforme qu'on ne pilote pas. `--agent none` dit « aucune CLI », pas
    // « rien faire » — le `.mcp.json` est écrit, et c'est lui que l'agent lit.
    const argv = argvCablageMcp(["standard"], AGENT_TARGETS, "/tmp/app");
    assert.isNotNull(argv);
    assert.deepEqual(argv?.slice(-2), ["--agent", "none"]);
    assert.include(argv ?? [], "--auth");
  });

  it("un agent NON coché ne part jamais dans l'appel", () => {
    if (parCli.length < 2) return;
    const argv = argvCablageMcp([parCli[0]!.cle], AGENT_TARGETS, "/tmp/app");
    assert.notInclude(argv?.join(" ") ?? "", parCli[1]!.cle);
  });

  it("des agents choisis + app installée ET construite → on câble", () => {
    assert.deepEqual(
      planCablageMcp({ choisis: 1, installed: true, built: true }),
      { propose: true },
    );
  });

  it("aucun agent choisi → rien n'est écrit, ici comme hors terminal", () => {
    const plan = planCablageMcp({ choisis: 0, installed: true, built: true });
    assert.isFalse(plan.propose);
    assert.include(
      plan.propose === false ? plan.motif : "",
      "aucun agent",
      "le motif doit NOMMER la raison — un refus muet se lit comme une panne",
    );
  });

  it("ne propose pas sur une app non installée : l'émission du jeton démarre le kernel", () => {
    for (const etat of [
      { installed: false, built: false },
      { installed: true, built: false },
    ]) {
      const plan = planCablageMcp({ choisis: 1, ...etat });
      assert.isFalse(
        plan.propose,
        `attendu refusé pour ${JSON.stringify(etat)}`,
      );
      assert.include(plan.propose === false ? plan.motif : "", "kernel");
    }
  });
});

describe("pointeurs d'instructions — aucun agent ne travaille aveugle", () => {
  it("un pointeur par agent qui ne lit PAS AGENTS.md, aucun pour ceux qui le lisent", () => {
    const attendus = new Set(
      AGENT_TARGETS.filter((c) => !c.instructions.natif).map(
        (c) => c.instructions.fichier,
      ),
    );
    const rendus = new Set(pointeursInstructions().map((p) => p.fichier));
    assert.deepEqual([...rendus].sort(), [...attendus].sort());
    for (const cible of AGENT_TARGETS.filter((c) => c.instructions.natif)) {
      assert.notInclude(
        [...rendus],
        cible.instructions.fichier,
        `${cible.nom} lit AGENTS.md : rien à poser`,
      );
    }
  });

  it("chaque agent est NOMMÉ dans son pointeur — deux agents d'un même fichier y figurent tous les deux", () => {
    for (const { fichier, agents } of pointeursInstructions()) {
      assert.isNotEmpty(agents, `${fichier} : pointeur sans agent nommé`);
      const attendus = AGENT_TARGETS.filter(
        (c) => !c.instructions.natif && c.instructions.fichier === fichier,
      ).map((c) => c.nom);
      assert.deepEqual([...agents].sort(), attendus.sort());
    }
  });

  it("chaque fait s'ancre dans le SOURCE de l'agent — jamais dans sa doc seule", () => {
    for (const cible of AGENT_TARGETS) {
      assert.isNotEmpty(
        cible.instructions.preuve,
        `${cible.nom} : le fichier d'instructions est affirmé sans preuve`,
      );
    }
  });
});

describe("create app --agents — la troisième voie de la même question", () => {
  const lu = (argv: string[]): unknown => {
    const p = parseCreateArgv(["node", "nodefony", "create", "app", ...argv]);
    return "error" in p ? p.error : p.answers.agents;
  };

  it("une liste séparée par des virgules devient un TABLEAU de valeurs entières", () => {
    assert.deepEqual(lu(["--agents", "claude,gemini"]), ["claude", "gemini"]);
  });

  it("`none` dit l'absence EXPLICITE — distincte de l'option omise", () => {
    assert.deepEqual(lu(["--agents", "none"]), []);
    assert.isUndefined(lu([]), "omise, la question garde le défaut de la spec");
  });

  it("un script obtient donc le câblage sans terminal", () => {
    // C'est tout l'intérêt : ce qui autorise est le choix EXPLICITE, pas la
    // présence d'un humain — sinon Studio et les forges restent muets.
    assert.deepEqual(lu(["--agents", "standard"]), ["standard"]);
  });
});

describe("spec ⇄ flags — une question qu'aucun flag ne sert est INATTEIGNABLE", () => {
  /** `gitHooks` → `--git-hooks` : la convention du CLI, appliquée une fois. */
  const enKebab = (cle: string): string =>
    `--${cle.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`;

  it("chaque question de chaque type est atteignable par un flag", () => {
    // 🔴 Le gate qui manquait. L'en-tête de la spec promet « ajouter un choix =
    // ajouter UNE entrée » — la voie interactive et Studio la tiennent (ils
    // lisent la spec), la voie FLAGS non : son analyse est écrite à la main.
    // Une question ajoutée sans son flag est donc servie à l'humain et refusée
    // au script, sans que rien ne le signale. Vécu sur `agents`.
    // `name` est POSITIONNEL (`create app mon-app`) : c'est la seule exemption,
    // et elle se justifie — un nom n'est pas une option, c'est le sujet de la
    // commande. Toute autre absence est un oubli.
    const positionnelles = new Set(["name"]);
    const manquants: string[] = [];
    for (const spec of getScaffoldSpec()) {
      for (const q of spec.questions) {
        if (positionnelles.has(q.key)) continue;
        const flag = q.flag ?? enKebab(q.key);
        const parsed = parseCreateArgv([
          "node",
          "nodefony",
          "create",
          spec.type,
          "x",
          flag,
          q.type === "boolean" ? "" : "valeur",
        ]);
        if ("error" in parsed && parsed.error.includes("option inconnue")) {
          manquants.push(`${spec.type}.${q.key} (${flag})`);
        }
      }
    }
    assert.deepEqual(
      manquants,
      [],
      "questions sans flag — un script ne peut pas y répondre",
    );
  });
});

describe("create sans type — le menu propose, la commande doit DEMANDER", () => {
  const RIEN = "type requis : app | module (reçu : rien)";
  const FAUTE = "type requis : app | module (reçu : ap)";

  it("aucun type + terminal → on demande, au lieu de rendre l'usage", () => {
    assert.isTrue(doitDemanderLeType(RIEN, { isTTY: true, yes: false }));
  });

  it("hors terminal → l'usage, car personne ne peut répondre", () => {
    assert.isFalse(doitDemanderLeType(RIEN, { isTTY: false, yes: false }));
  });

  it("--yes dit « ne me demande rien » — il est respecté", () => {
    assert.isFalse(doitDemanderLeType(RIEN, { isTTY: true, yes: true }));
  });

  it("un type FAUTIF se corrige, il ne se remplace pas par une question", () => {
    assert.isFalse(doitDemanderLeType(FAUTE, { isTTY: true, yes: false }));
  });
});
