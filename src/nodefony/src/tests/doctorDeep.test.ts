/**
 * Unit — l'étage PROFOND de `doctor` : ce que le projet déclare, exécuté.
 *
 * Tout y est éprouvé SANS lancer une seule commande : l'exécuteur est injecté.
 * Une logique qui appelle `spawnSync` en dur ne s'éprouve que sur la machine
 * qui l'exécute — c'est-à-dire nulle part de reproductible, et surtout jamais
 * sur les deux cas qui comptent ici : le script qui échoue, et celui qui ne
 * rend jamais la main.
 */
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
import path from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseDoctorArgv, progressLine } from "../kernel/checks/runDoctor";
import { createPalette } from "../kernel/checks/report";
import {
  declaredSteps,
  firstUsefulLine,
  readOutdated,
  runVerifySteps,
  verifyChainSteps,
  type IDeepProgress,
} from "../kernel/checks/deep";

// Le jetable du test, le test le supprime : scripts/test/vitest/tmp-guard.ts fait échouer
// la passe sur tout dossier laissé dans le dossier temporaire.
const aSupprimer: string[] = [];
const temporaire = (dossier: string): string => {
  aSupprimer.push(dossier);
  return dossier;
};
afterAll(() => {
  for (const dossier of aSupprimer)
    rmSync(dossier, { recursive: true, force: true });
});

/** Un projet jetable dont le manifeste déclare les scripts qu'on lui donne. */
function projetAvec(scripts: Record<string, string>): string {
  const racine = temporaire(mkdtempSync(path.join(tmpdir(), "nf-deep-")));
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
    const vide = temporaire(mkdtempSync(path.join(tmpdir(), "nf-deep-vide-")));
    assert.deepEqual(declaredSteps(vide, ["test"]), {
      present: [],
      missing: ["test"],
    });
  });

  it("🔴 un script ABSENT n'est pas un échec de cet étage", async () => {
    // C'est le contrôle « les gardes du projet sont-elles armées ? » qui répond
    // de l'absence. Le dire ici AUSSI ferait compter un manquement pour deux,
    // et la seconde accusation porterait un geste différent de la première.
    const racine = projetAvec({ test: "vitest" });
    const r = await runVerifySteps(racine, ["lint", "test"], () => ({
      status: 0,
      stderr: "",
      stdout: "",
      ms: 5,
    }));
    assert.equal(r.find((x) => x.step === "lint")?.outcome, "absent");
    assert.equal(r.find((x) => x.step === "test")?.outcome, "passed");
  });

  it("un script qui échoue rend sa PREMIÈRE ligne utile, pas l'annonce de npm", async () => {
    const racine = projetAvec({ typecheck: "tsgo --noEmit" });
    const r = await runVerifySteps(racine, ["typecheck"], () => ({
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

  it("🔴 un script tué par la borne de temps n'est PAS un succès", async () => {
    // Vécu sur ce dépôt : une commande réseau qui pendait cinq minutes par
    // essai et tuait le job de forge. Un `status` nul avec un signal posé se
    // lit « terminé sans erreur » si on ne regarde que le code — le pire des
    // verdicts, puisqu'il est vert.
    const racine = projetAvec({ test: "vitest" });
    const r = await runVerifySteps(racine, ["test"], () => ({
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
  it("un registre muet n'accuse RIEN — ce n'est pas un défaut de l'application", async () => {
    const { summary, reason } = await readOutdated("/peu-importe", () => ({
      stdout: "",
      failed: true,
    }));
    assert.equal(summary, null);
    assert.match(reason, /registre npm n'a pas répondu/u);
  });

  it("un projet qui n'est pas géré par npm : rien n'est lancé, et c'est DIT", async () => {
    // Le document de `npm outdated` lu sur l'arbre de pnpm inventerait des
    // retards et des absences. Aucun exécuteur injecté : c'est le vrai.
    const racine = projetAvec({});
    try {
      writeFileSync(path.join(racine, "pnpm-lock.yaml"), "", "utf8");
      const { summary, reason } = await readOutdated(racine);
      assert.equal(summary, null);
      assert.match(reason, /ne lit que npm, et ce projet est géré par pnpm/u);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it("une sortie VIDE veut dire « rien en retard », pas « rien lu »", async () => {
    // `npm outdated` n'écrit rien quand tout est à jour. Confondre ce silence
    // avec une panne ferait annoncer un angle mort sur l'application la plus
    // saine qui soit.
    const { summary, reason } = await readOutdated("/peu-importe", () => ({
      stdout: "",
      failed: false,
    }));
    assert.notEqual(summary, null);
    assert.equal(reason, "");
    assert.equal(summary?.packages.length, 0);
  });

  it("une réponse illisible se DIT, elle ne se devine pas", async () => {
    const { summary, reason } = await readOutdated("/peu-importe", () => ({
      stdout: "{ pas du json",
      failed: false,
    }));
    assert.equal(summary, null);
    assert.match(reason, /pas lisible/u);
  });

  it("agrège par la MÊME fonction que `nodefony outdated`", async () => {
    const { summary } = await readOutdated("/peu-importe", () => ({
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

/**
 * Ce que `--deep` lance vient de la chaîne `verify` du PROJET.
 *
 * Le défaut que ces cas ferment : la liste était écrite dans le framework
 * (`typecheck`, `lint`, `test`), la chaîne du gabarit en enchaîne six — si bien
 * que `--deep` annonçait lancer « les gardes du projet » et sautait
 * `format:check`, c'est-à-dire précisément celle qui échouait. Un vert rendu sur
 * un projet dont `verify` sort en 1 n'est pas un angle mort déclaré : c'est un
 * faux vert.
 */
describe("verifyChainSteps — les gardes que le projet DÉCLARE", () => {
  it("lit la chaîne entière, dans l'ordre, `npm test` compris", () => {
    const racine = projetAvec({
      verify:
        "npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run doctor",
    });
    assert.deepEqual(verifyChainSteps(racine), {
      steps: ["typecheck", "lint", "format:check", "test", "build"],
      unhandled: [],
    });
  });

  it("lit aussi la chaîne d'un projet pnpm ou bun — `bun test` n'est PAS le script", () => {
    // Le gabarit écrit `verify` avec le gestionnaire du projet.
    assert.deepEqual(
      verifyChainSteps(
        projetAvec({
          verify: "bun run typecheck && bun run test && pnpm run lint",
        }),
      ),
      { steps: ["typecheck", "test", "lint"], unhandled: [] },
    );
    // `bun test` lance le testeur de bun, pas le script `test` : le lancer en
    // `bun run test` jugerait une autre commande que celle écrite.
    assert.deepEqual(verifyChainSteps(projetAvec({ verify: "bun test" })), {
      steps: [],
      unhandled: ["bun test"],
    });
  });

  it("écarte `doctor`, y compris appelé par le CHEMIN de son binaire", () => {
    // C'est la forme de ce dépôt. La ranger dans les non-lançables la ferait
    // compter comme un angle mort alors qu'elle est en train de s'exécuter.
    const racine = projetAvec({
      verify:
        "npm run typecheck && npm test && node src/nodefony/bin/nodefony doctor",
    });
    assert.deepEqual(verifyChainSteps(racine), {
      steps: ["typecheck", "test"],
      unhandled: [],
    });
  });

  it("NOMME ce qu'il ne sait pas lancer, au lieu de le taire", () => {
    // Un morceau écrit en dur ne se borne pas et son verdict ne se lit pas.
    // Le taire rendrait « au vert » plus large que ce qui a été contrôlé.
    const racine = projetAvec({
      verify: "npm run lint && node scripts/maison.js --strict",
    });
    assert.deepEqual(verifyChainSteps(racine), {
      steps: ["lint"],
      unhandled: ["node scripts/maison.js --strict"],
    });
  });

  it("sans chaîne `verify`, ne rend RIEN — l'appelant se replie", () => {
    assert.deepEqual(verifyChainSteps(projetAvec({ test: "vitest" })), {
      steps: [],
      unhandled: [],
    });
  });

  it("un manifeste absent ou illisible ne lève pas", () => {
    const vide = temporaire(mkdtempSync(path.join(tmpdir(), "nf-chain-vide-")));
    assert.deepEqual(verifyChainSteps(vide), { steps: [], unhandled: [] });
    writeFileSync(path.join(vide, "package.json"), "{ pas du json", "utf8");
    assert.deepEqual(verifyChainSteps(vide), { steps: [], unhandled: [] });
  });

  it("ne répète pas un script que la chaîne nomme deux fois", () => {
    const racine = projetAvec({ verify: "npm run lint && npm run lint" });
    assert.deepEqual(verifyChainSteps(racine).steps, ["lint"]);
  });

  it("accepte pnpm et yarn — la chaîne n'est pas toujours écrite pour npm", () => {
    const racine = projetAvec({
      verify: "pnpm run typecheck && yarn test",
    });
    assert.deepEqual(verifyChainSteps(racine).steps, ["typecheck", "test"]);
  });
});

// #294 — `--deep` LANÇAIT déjà les gardes par le gestionnaire du projet, mais
// les ANNONÇAIT en npm : « ✗ npm run format:check » dans un projet pnpm, et le
// conseil « relance-le seul » donnait une commande que le projet ne tape pas.
describe("doctor --deep — la commande affichée parle le gestionnaire du projet", () => {
  for (const [lock, pm] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ] as const) {
    it(`${pm} : annonces, verdicts et ligne de progression`, async () => {
      const racine = projetAvec({ lint: "oxlint", test: "vitest" });
      writeFileSync(path.join(racine, lock), "", "utf8");
      const events: IDeepProgress[] = [];
      const r = await runVerifySteps(
        racine,
        ["lint", "test", "typecheck"],
        (step) => ({
          status: step === "lint" ? 1 : 0,
          stderr: "x",
          stdout: "",
          ms: 1,
        }),
        (e) => events.push(e),
      );
      for (const step of ["lint", "test", "typecheck"]) {
        assert.equal(
          r.find((x) => x.step === step)?.command,
          `${pm} run ${step}`,
        );
      }
      assert.ok(events.length > 0);
      for (const e of events) assert.equal(e.command, `${pm} run ${e.step}`);
      const done = events.find((e) => e.step === "lint" && e.phase === "done");
      assert.ok(done);
      assert.match(
        progressLine(done, createPalette(false)) ?? "",
        new RegExp(`${pm} run lint`, "u"),
      );
      rmSync(racine, { recursive: true, force: true });
    });
  }
});
