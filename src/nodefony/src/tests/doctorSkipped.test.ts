/**
 * `doctor` — ce qu'il n'a PAS pu regarder, et pourquoi il doit le dire.
 *
 * Ce que ces tests protègent est plus important que n'importe quelle règle de
 * diagnostic : **un contrôle sauté ne doit jamais se lire comme un contrôle
 * réussi**. Hors d'une application, `readiness` et `freshness` n'ouvrent rien —
 * et rendaient une liste de manquements vide, que le sommaire affichait en vert
 * (« ✓ Prêt à démarrer — environnement, modules, ports »). Un outil de
 * diagnostic silencieux sur son angle mort est pire qu'un outil absent : il
 * délivre un quitus que personne n'a mérité.
 *
 * Les trois portes (terminal, `--json`, MCP) lisent le MÊME état d'exécution :
 * un rapport humain qui tait ce que le JSON porte apprendrait à ne croire ni
 * l'un ni l'autre.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectCheckReport,
  parseCheckArgv,
  resoudreStrict,
  runCheckCommand,
} from "../kernel/checks/runCheck";
import {
  controlesSautes,
  type CheckFamily,
  type IExecution,
} from "../kernel/checks/report";

/** Un état d'exécution complet, à partir des seules familles qu'on veut poser. */
const execution = (
  sautees: Partial<Record<CheckFamily, string>>,
): Record<CheckFamily, IExecution> => {
  const toutes: CheckFamily[] = [
    "freshness",
    "readiness",
    "envCatalog",
    "deps",
    "wiring",
  ];
  const etat = {} as Record<CheckFamily, IExecution>;
  for (const f of toutes) {
    const raison = sautees[f];
    etat[f] = raison ? { ran: false, reason: raison } : { ran: true };
  }
  return etat;
};

describe("doctor — l'état d'EXÉCUTION d'un contrôle", () => {
  it("🔴 hors d'une application, aucun contrôle d'état ne se déclare passé", async () => {
    // LE cas qui a motivé tout ceci : un dossier vide affichait quatre lignes
    // dont deux VERTES, pour des contrôles qui n'avaient rien ouvert.
    const dir = mkdtempSync(path.join(tmpdir(), "nf-doctor-vide-"));
    try {
      const report = await collectCheckReport(dir);

      assert.isFalse(
        report.execution.readiness.ran,
        "`readiness` ne peut pas se déclarer passé hors d'une application",
      );
      assert.isFalse(report.execution.freshness.ran);
      // Une liste vide, oui — mais accompagnée de l'aveu qu'elle ne prouve rien.
      assert.deepEqual(report.readiness.findings, []);

      const sautes = controlesSautes(report.execution);
      assert.includeMembers(
        sautes.map((s) => s.famille),
        ["readiness", "freshness"],
      );
      for (const saute of sautes) {
        assert.isNotEmpty(saute.reason, `${saute.famille} sans raison`);
        assert.isNotEmpty(
          saute.unlock ?? "",
          `${saute.famille} sans geste de déblocage — le lecteur sait qu'il ` +
            `lui manque quelque chose sans savoir quoi faire`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dans une application NON construite, le catalogue des variables est déclaré non lu", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nf-doctor-app-"));
    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "app-temoin", version: "1.0.0" }),
      );
      writeFileSync(
        path.join(dir, "nodefony.config.ts"),
        `export default defineConfig({ modules: [] });\n`,
      );
      mkdirSync(path.join(dir, "node_modules"), { recursive: true });

      const report = await collectCheckReport(dir);

      // La famille, elle, a bien tourné : c'est SA sous-règle « variable
      // requise » qui n'a rien pu lire, faute de `dist/`.
      assert.isTrue(report.execution.readiness.ran);
      assert.isFalse(
        report.execution.envCatalog.ran,
        "un catalogue illisible ne vaut pas quitus sur les variables requises",
      );
      const sautes = controlesSautes(report.execution);
      const envCatalog = sautes.find((s) => s.famille === "envCatalog");
      assert.isDefined(envCatalog, "`envCatalog` doit être rapporté");
      assert.include(envCatalog?.unlock ?? "", "build");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("une sous-règle n'est pas comptée DEUX fois quand sa famille entière est sautée", () => {
    // `envCatalog` est une règle de `readiness`. Les annoncer tous les deux
    // ferait compter deux angles morts là où il n'y en a qu'un — et le bilan
    // chiffré ne collerait plus aux lignes affichées.
    const sautes = controlesSautes(
      execution({
        readiness: "hors application",
        envCatalog: "hors application",
      }),
    );
    assert.deepEqual(
      sautes.map((s) => s.famille),
      ["readiness"],
    );
  });

  it("la même sous-règle EST rapportée quand sa famille a tourné", () => {
    const sautes = controlesSautes(
      execution({ envCatalog: "catalogue illisible" }),
    );
    assert.deepEqual(
      sautes.map((s) => s.famille),
      ["envCatalog"],
    );
  });

  it("un contrôle sauté sans raison ne rend pas une phrase vide", () => {
    // Le rendu affiche `titre — reason` : une raison absente produirait un
    // tiret suivi de rien, qu'on lit comme un défaut d'affichage plutôt que
    // comme un contrôle manquant.
    const sautes = controlesSautes({
      freshness: { ran: false },
      readiness: { ran: true },
      envCatalog: { ran: true },
      deps: { ran: true },
      wiring: { ran: true },
    });
    assert.lengthOf(sautes, 1);
    assert.isNotEmpty(sautes[0]!.reason);
  });

  it("l'ordre de lecture est celui du rapport, pas celui de l'objet", () => {
    // La fraîcheur d'abord : un build en retard rend faux tout ce qui suit.
    const sautes = controlesSautes(
      execution({ wiring: "a", freshness: "b", deps: "c" }),
    );
    assert.deepEqual(
      sautes.map((s) => s.famille),
      ["freshness", "deps", "wiring"],
    );
  });
});

describe("doctor — sévérité d'un contrôle sauté", () => {
  it("devant un humain, un contrôle sauté n'est PAS un manquement", () => {
    // Faire échouer par défaut ferait de `doctor` un outil qu'on apprend à
    // ignorer : hors application, aucun contrôle d'état ne peut tourner.
    assert.isFalse(resoudreStrict(undefined, {}));
  });

  it("dans une chaîne automatisée, personne ne lit la section — donc ça échoue", () => {
    assert.isTrue(resoudreStrict(undefined, { CI: "1" }));
  });

  it("🔴 le drapeau explicite gagne DANS LES DEUX SENS", () => {
    // `--no-strict` existe pour qu'une absence VOULUE puisse s'énoncer, plutôt
    // que de se contourner en désarmant la commande entière.
    assert.isTrue(resoudreStrict(true, {}));
    assert.isFalse(resoudreStrict(false, { CI: "1" }));
  });

  it("`--strict` et `--no-strict` sont acceptés par la ligne de commande", () => {
    const strict = parseCheckArgv(["doctor", "--strict"]);
    assert.isTrue("strict" in strict && strict.strict);
    const lache = parseCheckArgv(["doctor", "--no-strict"]);
    assert.isTrue("strict" in lache && !lache.strict);
    // Une option inconnue reste un refus : un drapeau mal tapé lançait
    // autrefois un run complet en silence.
    assert.property(parseCheckArgv(["doctor", "--stritc"]), "error");
  });
});

/**
 * 🔴 La doctrine ci-dessus était prouvée sur la BRIQUE (`resoudreStrict`), et
 * sur elle seule. La CHAÎNE — `runCheckCommand` lit l'environnement, arme le
 * régime, rend un code — n'était éprouvée nulle part.
 *
 * Ce trou a coûté une intégration continue rouge sur trois plateformes : deux
 * tests écrits AVANT cette doctrine appelaient la commande sans énoncer leur
 * régime, héritaient du `CI` de la forge, et recevaient 1 là où ils attendaient
 * 0. Verte en local (pas de `CI`), rouge partout ailleurs.
 */
describe("doctor — la doctrine du régime strict, de bout en bout", () => {
  let dir = "";
  let cwd = "";
  let ciAvant: string | undefined;

  beforeEach(() => {
    // Un dossier NU : aucun `nodefony.config.ts` en remontant, donc les cinq
    // familles sont sautées pour une seule cause. C'est le décor où le régime
    // décide seul du code de sortie.
    dir = mkdtempSync(path.join(tmpdir(), "nf-strict-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"nu"}');
    cwd = process.cwd();
    ciAvant = process.env.CI;
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    if (ciAvant === undefined) delete process.env.CI;
    else process.env.CI = ciAvant;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Exécute la commande sans déverser son rapport dans la sortie des tests. */
  const codeDe = async (argv: string[]): Promise<number> => {
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      return await runCheckCommand(argv);
    } finally {
      process.stdout.write = write;
    }
  };

  it("devant un humain, des contrôles sautés laissent le code à 0", async () => {
    delete process.env.CI;
    assert.equal(await codeDe([]), 0);
  });

  it("🔴 sous `CI`, les MÊMES contrôles sautés font échouer la commande", async () => {
    process.env.CI = "1";
    assert.equal(await codeDe([]), 1);
  });

  it("`--no-strict` rend le code à 0 même sous `CI` — l'absence VOULUE s'énonce", async () => {
    process.env.CI = "1";
    assert.equal(await codeDe(["--no-strict"]), 0);
  });

  it("`--strict` fait échouer même sans `CI`", async () => {
    delete process.env.CI;
    assert.equal(await codeDe(["--strict"]), 1);
  });
});

describe("doctor — le rapport JSON porte TOUT ce qui pèse sur le verdict", () => {
  it("🔴 `freshness` est dans le rapport, pas seulement dans le compte", async () => {
    // Vécu : `--json` rendait 1 sans porter la moindre trace de ce qui l'avait
    // causé — la famille était comptée dans le verdict et absente du flux.
    const dir = mkdtempSync(path.join(tmpdir(), "nf-doctor-json-"));
    try {
      const report = await collectCheckReport(dir);
      assert.property(report, "freshness");
      assert.property(report, "execution");
      for (const famille of [
        "freshness",
        "readiness",
        "envCatalog",
        "deps",
        "wiring",
      ] as CheckFamily[]) {
        assert.property(
          report.execution,
          famille,
          `l'état de \`${famille}\` doit voyager avec le rapport`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
