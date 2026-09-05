import { describe, it } from "vitest";
import { assert } from "chai";
import {
  buildStartMenu,
  buildInspectMenu,
  filterStartMenu,
  planMenuAction,
  START_MENU_CATALOG,
  MODULE_COMMANDS_GROUP,
  type StartMenuItem,
} from "../cli/startMenu";
import { INSPECT_SUBJECTS } from "../kernel/inspect/adminSubjects";

/** describe() qui connaît tout le catalogue — le cas nominal. */
const describeAll = (name: string) => `résumé de ${name}`;

function choices(items: StartMenuItem[]) {
  return items.filter((i) => i.kind === "choice");
}
function separators(items: StartMenuItem[]) {
  return items.filter((i) => i.kind === "separator");
}

describe("startMenu — composition pure du menu interactif", () => {
  it("projet : les groupes sont titrés, dans l'ordre, et portent les gestes du projet", () => {
    const { message, items } = buildStartMenu({
      inProject: true,
      projectName: "mon-app",
      describe: describeAll,
    });
    assert.include(message, "mon-app");
    const titles = separators(items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.deepEqual(titles, [
      "Serveur",
      "Comprendre",
      "Faire évoluer",
      "Outillage",
    ]);
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    // Les gestes du quotidien — leur ABSENCE était le défaut n°1 de l'audit.
    for (const expected of [
      "development",
      "production",
      "cluster",
      "status",
      "stop",
      "doctor",
      "inspect",
      "env",
      "card",
      "create",
      "build",
      "install",
      "outdated",
      "git:hooks",
      "ai:sync",
      "completion",
    ]) {
      assert.include(values, expected, `« ${expected} » manque au menu projet`);
    }
  });

  it("hors projet : seuls les gestes qui ont un sens partout", () => {
    const { message, items } = buildStartMenu({
      inProject: false,
      describe: describeAll,
    });
    assert.include(message, "Aucun projet");
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.deepEqual(values, ["create", "status", "stop", "completion"]);
    // Aucun geste de projet ne doit fuir hors projet.
    for (const forbidden of ["development", "build", "inspect", "git:hooks"]) {
      assert.notInclude(values, forbidden);
    }
  });

  it("chaque entrée porte une EXPLICATION propre, distincte du résumé", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      moduleCommands: [{ name: "blog:sync", description: "sync du blog" }],
    });
    for (const c of choices(items)) {
      if (c.kind !== "choice") continue;
      assert.isAbove(
        c.description.length,
        30,
        `« ${c.value} » : explication indigente`,
      );
      assert.notInclude(
        c.description,
        "résumé de",
        `« ${c.value} » : l'explication recopie le résumé commander`,
      );
      // Champs BRUTS : le label est le nom nu (le rendu vit dans l'adaptateur),
      // et le résumé commander est porté séparément.
      assert.isFalse(
        /\x1b/.test(c.label),
        `« ${c.value} » : du style a fui dans la composition`,
      );
      assert.isAbove(c.summary.length, 0, `« ${c.value} » : résumé vide`);
    }
  });

  it("une commande retirée du CLI sort du menu toute seule (describe → null)", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: (name) => (name === "cluster" ? null : describeAll(name)),
    });
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.notInclude(values, "cluster");
    assert.include(values, "development");
  });

  it("un groupe entièrement vide n'émet pas son séparateur", () => {
    // Seul « create » répond : les groupes Serveur/Comprendre/Outillage
    // disparaissent AVEC leur titre — un titre sans entrée est un mensonge.
    const { items } = buildStartMenu({
      inProject: true,
      describe: (name) => (name === "create" ? "résumé" : null),
    });
    const titles = separators(items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.deepEqual(titles, ["Faire évoluer"]);
  });

  it("commandes de module : groupe dédié en projet, jamais hors projet", () => {
    const moduleCommands = [
      { name: "security:user:add", description: "crée un utilisateur" },
    ];
    const inProject = buildStartMenu({
      inProject: true,
      describe: describeAll,
      moduleCommands,
    });
    const labels = separators(inProject.items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.include(labels, MODULE_COMMANDS_GROUP);
    const values = choices(inProject.items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.include(values, "security:user:add");

    const outside = buildStartMenu({
      inProject: false,
      describe: describeAll,
      moduleCommands,
    });
    const outsideValues = choices(outside.items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.notInclude(outsideValues, "security:user:add");
  });

  it("🔴 sans manifest, le menu DIT que les commandes de module manquent", () => {
    // Le menu s'ouvre à `onStart` — trop tôt pour que commander connaisse les
    // commandes de MODULE (dispatch différé) — et les lit donc d'un cache. Ce
    // cache n'existe pas tant qu'aucun boot ne l'a écrit : nouveau clone,
    // `npm ci`, `node_modules` nettoyé. Le groupe disparaissait alors ENTIER et
    // EN SILENCE — treize commandes réelles (`http:network`, `frontend:build`,
    // `security:user:add`…) invisibles, sur un menu qui a tout l'air d'être
    // complet. Une dégradation silencieuse est pire que l'absence : elle se
    // fait croire.
    const { message } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      moduleCommands: [],
    });
    assert.match(message, /--help/u, message);
  });

  it("sens négatif : le manifest présent n'affiche AUCUNE note", () => {
    const { message } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      moduleCommands: [{ name: "http:network", description: "Show Network" }],
    });
    assert.notMatch(message, /--help/u, message);
  });

  it("sens négatif : hors projet, aucune note non plus", () => {
    // Hors d'une application, il n'y a PAS de commandes de module à manquer —
    // signaler une absence y serait un faux avertissement, exactement le
    // travers qu'on corrige.
    const { message } = buildStartMenu({
      inProject: false,
      describe: describeAll,
      moduleCommands: [],
    });
    assert.notMatch(message, /--help/u, message);
  });

  it("🔴 une commande de MODULE exige un process neuf, pas le re-parse commander", () => {
    // Vécu : le menu proposait `http:network`, on le choisissait, et le CLI
    // répondait « unknown command 'http:network' » + CRITIC + exit 1. Le menu
    // s'ouvre à `onStart` ; les commandes de module ne sont posées dans
    // commander qu'à `onPreRegister` (dispatch différé). Un menu qui PROPOSE un
    // geste puis le refuse est pire que celui qui ne le proposait pas.
    const builtins = new Set(["development", "inspect", "doctor"]);
    const isBuiltin = (n: string) => builtins.has(n);

    assert.deepEqual(planMenuAction("http:network", isBuiltin), {
      kind: "respawn",
      argv: ["http:network"],
    });
    // Le sens négatif qui compte : une intégrée ne part PAS en process neuf —
    // sinon on paierait un boot complet sur chaque choix du menu.
    assert.deepEqual(planMenuAction("development", isBuiltin), {
      kind: "inline",
      argv: ["development"],
    });
    // Une intégrée à ARGUMENT reste inline : c'est le premier mot qui porte
    // l'identité de la commande.
    assert.deepEqual(planMenuAction("inspect routes", isBuiltin), {
      kind: "inline",
      argv: ["inspect", "routes"],
    });
    // Un script du projet garde son chemin d'origine.
    assert.deepEqual(planMenuAction("npm:verify", isBuiltin), {
      kind: "npm",
      script: "verify",
    });
  });

  it("inspect : le sous-menu vient de la table SOURCE et écarte les sujets à paramètre", () => {
    const { items } = buildInspectMenu(INSPECT_SUBJECTS);
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    for (const [name, subject] of Object.entries(INSPECT_SUBJECTS)) {
      if (subject.param) {
        assert.notInclude(values, name, `« ${name} » exige un paramètre`);
      } else {
        assert.include(values, name);
      }
    }
    assert.include(values, "routes");
  });

  it("scripts npm : proposés SEULEMENT s'ils existent au package.json, groupés, préfixés npm:", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      npmScripts: ["verify", "test", "infra:up", "un-script-inconnu"],
    });
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.include(values, "npm:verify");
    assert.include(values, "npm:test");
    assert.include(values, "npm:infra:up");
    // Hors catalogue → jamais proposé (le menu ne déverse pas 30 scripts).
    assert.notInclude(values, "npm:un-script-inconnu");
    // Déclaré au catalogue mais ABSENT du package.json → pas proposé.
    assert.notInclude(values, "npm:test:e2e");
    const labels = separators(items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.include(labels, "Qualité (npm run)");
    assert.include(labels, "Infra (docker)");
  });

  it("scripts npm : jamais hors projet, et aucun groupe sans script présent", () => {
    const outside = buildStartMenu({
      inProject: false,
      describe: describeAll,
      npmScripts: ["verify"],
    });
    const outsideValues = choices(outside.items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.notInclude(outsideValues, "npm:verify");

    const noInfra = buildStartMenu({
      inProject: true,
      describe: describeAll,
      npmScripts: ["verify"],
    });
    const labels = separators(noInfra.items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.notInclude(labels, "Infra (docker)");
  });

  it("filtre à la frappe : accents ignorés, groupes suivent leurs entrées, terme vide = tout", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      npmScripts: ["verify"],
    });
    assert.strictEqual(filterStartMenu(items, ""), items);
    const dev = filterStartMenu(items, "rechargement");
    const devValues = dev
      .filter((i) => i.kind === "choice")
      .map((i) => (i.kind === "choice" ? i.value : ""));
    assert.include(devValues, "development");
    assert.notInclude(devValues, "production");
    const devTitles = dev
      .filter((i) => i.kind === "separator")
      .map((i) => (i.kind === "separator" ? i.label : ""));
    assert.deepEqual(devTitles, ["Serveur"]);
    const grp = filterStartMenu(items, "serveur");
    const grpValues = grp
      .filter((i) => i.kind === "choice")
      .map((i) => (i.kind === "choice" ? i.value : ""));
    assert.include(grpValues, "development");
    assert.include(grpValues, "stop");
    const q = filterStartMenu(items, "qualite");
    const qValues = q
      .filter((i) => i.kind === "choice")
      .map((i) => (i.kind === "choice" ? i.value : ""));
    assert.include(qValues, "npm:verify");
    assert.deepEqual(filterStartMenu(items, "zzzz-introuvable"), []);
  });

  it("le catalogue ne référence que des groupes déclarés pour chacun de ses contextes", () => {
    for (const entry of START_MENU_CATALOG) {
      for (const context of entry.contexts) {
        assert.isString(
          entry.group[context],
          `« ${entry.value} » : contexte ${context} sans groupe`,
        );
      }
    }
  });
});

/**
 * Le CÂBLAGE du menu vers la commande choisie.
 *
 * 🔴 Il a échoué DEUX fois en silence, et un pseudo-terminal ne l'a pas
 * montré : la capacité `quietBoot` d'une commande choisie au menu était
 * ignorée (le CLI ne l'applique qu'à la commande DEMANDÉE sur la ligne — depuis
 * le menu, c'est `menu`), puis, une fois appliquée, le syslog était EMPILÉ au
 * lieu d'être remplacé, si bien que l'ancien filtre écrivait toujours.
 */
describe("menu — la commande CHOISIE reçoit ce qu'elle déclare", () => {
  const fauxCli = (quietBoot: boolean) => {
    const journal: string[] = [];
    const commande = {
      quietBoot,
      forceInteractiveMode: () => journal.push("interactif"),
    };
    const cli = {
      quietBoot: false,
      getCommand: (n: string) => (n === "doctor" ? commande : undefined),
      initSyslog: () => journal.push("syslog"),
    };
    return { cli, journal };
  };

  const menuAvec = async (cli: unknown) => {
    const { default: MenuCommand } =
      await import("../kernel/commands/MenuCommand");
    const cmd = Object.create(MenuCommand.prototype) as {
      cli: unknown;
      appliquerCapacites: (n: string) => void;
    };
    cmd.cli = cli;
    return cmd;
  };

  it("une commande qui déclare quietBoot fait taire le boot — ET rejoue le filtre", async () => {
    const { cli, journal } = fauxCli(true);
    (await menuAvec(cli)).appliquerCapacites("doctor");
    expect(cli.quietBoot).toBe(true);
    // Sans ce second appel, le filtre resterait celui calculé au démarrage du
    // menu, quand personne ne savait encore quelle commande serait choisie.
    expect(journal).toContain("syslog");
    expect(journal).toContain("interactif");
  });

  it("une commande qui ne le déclare pas ne fait taire personne", async () => {
    const { cli, journal } = fauxCli(false);
    (await menuAvec(cli)).appliquerCapacites("doctor");
    expect(cli.quietBoot).toBe(false);
    expect(journal).not.toContain("syslog");
    // Elle reste interactive : c'est un choix, pas une frappe.
    expect(journal).toContain("interactif");
  });

  it("une commande inconnue du CLI ne casse rien", async () => {
    const { cli, journal } = fauxCli(true);
    (await menuAvec(cli)).appliquerCapacites("inexistante");
    expect(cli.quietBoot).toBe(false);
    expect(journal).toEqual([]);
  });
});

/**
 * 🔴 Le menu ne tient plus de LISTE BLANCHE.
 *
 * Il ne proposait que les commandes inscrites à la main dans son catalogue :
 * une commande neuve n'y entrait jamais, et rien ne le signalait — le menu
 * avait toujours l'air complet. Le catalogue ne décide plus de ce qui EXISTE,
 * seulement de l'ordre de lecture et du conseil d'usage.
 */
describe("buildStartMenu — ce qui existe est proposé, sans l'y inscrire", () => {
  const base = {
    inProject: true,
    describe: (n: string) => (n === "inconnue" ? null : `résumé de ${n}`),
  };

  it("⭐ une commande intégrée HORS catalogue apparaît sous son intention", () => {
    const { items } = buildStartMenu({
      ...base,
      builtinCommands: [
        {
          name: "commande-neuve",
          description: "ce qu'elle fait",
          group: "COMPRENDRE",
          requiredArgs: 0,
        },
      ],
    });
    const at = items.findIndex(
      (i) => i.kind === "choice" && i.value === "commande-neuve",
    );
    assert.isAtLeast(at, 0, "la commande doit être proposée");
    const separateurs = items
      .slice(0, at)
      .filter((i) => i.kind === "separator");
    assert.equal(
      separateurs.at(-1)?.label,
      "Comprendre",
      "…sous le groupe que son intention désigne",
    );
  });

  it("🔴 une commande qui EXIGE un argument n'est pas proposée", () => {
    // Le menu la lancerait sans argument : l'utilisateur recevrait une erreur
    // d'usage là où il attendait un geste.
    const { items } = buildStartMenu({
      ...base,
      builtinCommands: [
        {
          name: "exige-un-sujet",
          description: "…",
          group: "COMPRENDRE",
          requiredArgs: 1,
        },
      ],
    });
    assert.isFalse(
      items.some((i) => i.kind === "choice" && i.value === "exige-un-sujet"),
    );
  });

  it("une commande déjà au catalogue n'est pas proposée DEUX fois", () => {
    const { items } = buildStartMenu({
      ...base,
      builtinCommands: [
        {
          name: "development",
          description: "…",
          group: "LANCER",
          requiredArgs: 0,
        },
      ],
    });
    const combien = items.filter(
      (i) => i.kind === "choice" && i.value === "development",
    ).length;
    assert.equal(combien, 1);
  });

  it("les commandes de MODULE se rangent aussi par intention", () => {
    const { items } = buildStartMenu({
      ...base,
      moduleCommands: [
        {
          name: "orm:migrate",
          description: "applique les migrations",
          group: "BASE DE DONNÉES",
        },
        { name: "truc:machin", description: "d'un module tiers" },
      ],
    });
    const titres = items
      .filter((i) => i.kind === "separator")
      .map((i) => i.label);
    assert.include(
      titres,
      "Base de données",
      "l'intention déclarée est suivie",
    );
    assert.include(
      titres,
      "Commandes du projet",
      "…et celle qui n'en déclare aucune garde le groupe générique",
    );
  });
});
