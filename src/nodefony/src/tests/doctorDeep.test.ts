/**
 * Unit — l'étage PROFOND de `doctor` : ce que le projet déclare, exécuté.
 *
 * Tout y est éprouvé SANS lancer une seule commande : l'exécuteur est injecté.
 * Une logique qui appelle `spawnSync` en dur ne s'éprouve que sur la machine
 * qui l'exécute — c'est-à-dire nulle part de reproductible, et surtout jamais
 * sur les deux cas qui comptent ici : le script qui échoue, et celui qui ne
 * rend jamais la main.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseDoctorArgv } from "../kernel/checks/runDoctor";
import {
  declaredSteps,
  firstUsefulLine,
  readOutdated,
  runVerifySteps,
} from "../kernel/checks/deep";

/** Un projet jetable dont le manifeste déclare les scripts qu'on lui donne. */
function projetAvec(scripts: Record<string, string>): string {
  const racine = mkdtempSync(path.join(tmpdir(), "nf-deep-"));
  mkdirSync(racine, { recursive: true });
  writeFileSync(
    path.join(racine, "package.json"),
    JSON.stringify({ name: "app", scripts }),
    "utf8",
  );
  return racine;
}

describe("doctor --deep — les scripts DÉCLARÉS, et rien d'autre", () => {
  it("ne retient que ce que le manifeste déclare", () => {
    const racine = projetAvec({ typecheck: "tsgo --noEmit", test: "vitest" });
    const { present, missing } = declaredSteps(racine, [
      "typecheck",
      "lint",
      "test",
    ]);
    assert.deepEqual(present, ["typecheck", "test"]);
    assert.deepEqual(missing, ["lint"]);
  });

  it("un manifeste absent ne fait rien lancer, et ne lève pas", () => {
    const vide = mkdtempSync(path.join(tmpdir(), "nf-deep-vide-"));
    assert.deepEqual(declaredSteps(vide, ["test"]), {
      present: [],
      missing: ["test"],
    });
  });

  it("🔴 un script ABSENT n'est pas un échec de cet étage", () => {
    // C'est le contrôle « les gardes du projet sont-elles armées ? » qui répond
    // de l'absence. Le dire ici AUSSI ferait compter un manquement pour deux,
    // et la seconde accusation porterait un geste différent de la première.
    const racine = projetAvec({ test: "vitest" });
    const r = runVerifySteps(racine, ["lint", "test"], () => ({
      status: 0,
      stderr: "",
      stdout: "",
      ms: 5,
    }));
    assert.equal(r.find((x) => x.step === "lint")?.outcome, "absent");
    assert.equal(r.find((x) => x.step === "test")?.outcome, "passed");
  });

  it("un script qui échoue rend sa PREMIÈRE ligne utile, pas l'annonce de npm", () => {
    const racine = projetAvec({ typecheck: "tsgo --noEmit" });
    const r = runVerifySteps(racine, ["typecheck"], () => ({
      status: 1,
      stderr: "",
      stdout:
        "npm notice run app@0.1.0 typecheck\n" +
        "> tsgo --noEmit\n" +
        "src/a.ts(3,5): error TS2345: nope\n",
      ms: 900,
    }));
    assert.equal(r[0]!.outcome, "failed");
    assert.equal(r[0]!.detail, "src/a.ts(3,5): error TS2345: nope");
  });

  it("🔴 un script tué par la borne de temps n'est PAS un succès", () => {
    // Vécu sur ce dépôt : une commande réseau qui pendait cinq minutes par
    // essai et tuait le job de forge. Un `status` nul avec un signal posé se
    // lit « terminé sans erreur » si on ne regarde que le code — le pire des
    // verdicts, puisqu'il est vert.
    const racine = projetAvec({ test: "vitest" });
    const r = runVerifySteps(racine, ["test"], () => ({
      status: null,
      stderr: "",
      stdout: "",
      ms: 120_000,
    }));
    assert.equal(r[0]!.outcome, "timeout");
    assert.match(r[0]!.detail ?? "", /interrompu après 120 s/u);
  });
});

describe("doctor --deep — la première ligne utile", () => {
  it("saute le bruit de npm sur les DEUX flux avant de se rabattre", () => {
    // L'angle mort classique : un `stderr` qui ne porte QUE l'annonce de npm
    // masquait le `stdout` où l'outil nomme la cause.
    assert.equal(
      firstUsefulLine(
        "npm notice run app@0.1.0 lint\n",
        "src/b.ts:1:1: warning no-unused-vars\n",
      ),
      "src/b.ts:1:1: warning no-unused-vars",
    );
  });

  it("rend le bruit quand il n'y a QUE lui — un gate muet et un gate illisible diffèrent", () => {
    assert.equal(
      firstUsefulLine("", "npm notice run app@0.1.0 lint\n"),
      "npm notice run app@0.1.0 lint",
    );
  });

  it("borne une ligne démesurée", () => {
    const long = firstUsefulLine("", `${"x".repeat(500)}\n`);
    assert.ok(long.length <= 160);
    assert.ok(long.endsWith("…"));
  });
});

describe("doctor --deep — les paquets en retard", () => {
  it("un registre muet n'accuse RIEN — ce n'est pas un défaut de l'application", () => {
    const { summary, reason } = readOutdated("/peu-importe", () => ({
      stdout: "",
      failed: true,
    }));
    assert.equal(summary, null);
    assert.match(reason, /registre npm n'a pas répondu/u);
  });

  it("une sortie VIDE veut dire « rien en retard », pas « rien lu »", () => {
    // `npm outdated` n'écrit rien quand tout est à jour. Confondre ce silence
    // avec une panne ferait annoncer un angle mort sur l'application la plus
    // saine qui soit.
    const { summary, reason } = readOutdated("/peu-importe", () => ({
      stdout: "",
      failed: false,
    }));
    assert.notEqual(summary, null);
    assert.equal(reason, "");
    assert.equal(summary?.packages.length, 0);
  });

  it("une réponse illisible se DIT, elle ne se devine pas", () => {
    const { summary, reason } = readOutdated("/peu-importe", () => ({
      stdout: "{ pas du json",
      failed: false,
    }));
    assert.equal(summary, null);
    assert.match(reason, /pas lisible/u);
  });

  it("agrège par la MÊME fonction que `nodefony outdated`", () => {
    const { summary } = readOutdated("/peu-importe", () => ({
      stdout: JSON.stringify({
        "@nodefony/http": {
          current: "9.0.0",
          wanted: "9.0.0",
          latest: "10.0.0",
          dependent: "app",
          location: "node_modules/@nodefony/http",
        },
      }),
      failed: false,
    }));
    assert.equal(summary?.packages.length, 1);
    assert.equal(summary?.packages[0]?.name, "@nodefony/http");
    // La sévérité vient de `classifySeverity`, pas d'une règle réécrite ici.
    assert.equal(summary?.packages[0]?.severity, "major");
  });
});

describe("doctor --deep — ce qu'il IMPLIQUE", () => {
  const lire = (argv: string[]): { live: boolean; deep: boolean } => {
    const p = parseDoctorArgv(argv);
    assert.ok(!("error" in p), `argv refusé : ${argv.join(" ")}`);
    return { live: p.live, deep: p.deep };
  };

  it("`--deep` allume l'étage 2 tout seul — un seul drapeau pour « dis-moi tout »", () => {
    assert.deepEqual(lire(["doctor", "--deep"]), { live: true, deep: true });
  });

  it("`--live` seul n'allume PAS l'étage 3 : il ne lance aucune commande", () => {
    // L'implication ne vaut que dans un sens. `--live` demande à l'application ;
    // il n'a jamais promis de lancer la suite de tests du projet.
    assert.deepEqual(lire(["doctor", "--live"]), { live: true, deep: false });
  });

  it("🔴 `--no-live` gagne contre l'implication, DANS LES DEUX ORDRES", () => {
    // Le piège d'un booléen simple : `--no-live --deep` rallumerait `live`,
    // parce que l'implication s'appliquerait après le refus. C'est le REFUS
    // qu'il faut mémoriser, pas l'état — et l'ordre des drapeaux sur une ligne
    // de commande n'est pas quelque chose qu'on peut demander à l'utilisateur.
    assert.deepEqual(lire(["doctor", "--deep", "--no-live"]), {
      live: false,
      deep: true,
    });
    assert.deepEqual(lire(["doctor", "--no-live", "--deep"]), {
      live: false,
      deep: true,
    });
  });

  it("sans rien, aucun des deux étages coûteux ne s'allume", () => {
    assert.deepEqual(lire(["doctor"]), { live: false, deep: false });
  });
});
