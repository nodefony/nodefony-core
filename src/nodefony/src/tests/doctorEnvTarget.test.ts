/**
 * `doctor --env <e>` — voir depuis son poste ce qui manquera ailleurs.
 *
 * Le défaut réparé : une variable requise en production SEULEMENT est invisible
 * en développement, où son absence est légitime. Pire, les secrets absents sont
 * générés à la volée : rien ne va mal ici, et rien n'ira mal au premier
 * démarrage là-bas non plus — c'est au DEUXIÈME exemplaire que les jetons émis
 * par l'un se font refuser par l'autre, sans un mot dans les journaux.
 *
 * Ces tests portent sur les coutures PURES de la chaîne : la lecture de la
 * ligne de commande, le rapport d'environnement sous un environnement visé, et
 * la règle d'état d'installation. La grammaire elle-même vit dans
 * `envRequiredIn.test.ts`, le boot compris.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { collectCheckReport, parseCheckArgv } from "../kernel/checks/runCheck";
import { buildEnvReport } from "../cli/envReport";
import { checkReadiness } from "../kernel/checks/readiness";
import type { NamedEnvVarMeta } from "../config/defineEnv";

/** Un catalogue minimal : un secret requis en production, rien d'autre. */
const catalogue: readonly NamedEnvVarMeta[] = [
  {
    name: "NF_CSRF_SECRET",
    kind: "string",
    optional: true,
    requiredIn: ["production"],
  },
];

const rapport = (
  processEnv: Record<string, string | undefined>,
  targetEnv: string | null = null,
) =>
  buildEnvReport({
    runtimeEnv: processEnv.NODE_ENV ?? "development",
    processEnv,
    files: [],
    catalog: catalogue,
    targetEnv,
  });

describe("--env : lecture de la ligne de commande", () => {
  it("retient l'environnement visé", () => {
    const parsed = parseCheckArgv(["doctor", "--env", "production"]);
    assert.notProperty(parsed, "error");
    assert.equal((parsed as { targetEnv: string }).targetEnv, "production");
  });

  it("sans drapeau, aucun environnement n'est visé — le rapport parle d'ici", () => {
    const parsed = parseCheckArgv(["doctor"]);
    assert.isNull((parsed as { targetEnv: string | null }).targetEnv);
  });

  // PIÈGE : `--env --json` avalerait l'option suivante et diagnostiquerait un
  // environnement nommé « --json », sans que rien ne le dise.
  it("refuse `--env` sans valeur, et nomme la forme attendue", () => {
    const parsed = parseCheckArgv(["doctor", "--env", "--json"]);
    assert.include((parsed as { error: string }).error, "--env attend");
    assert.include((parsed as { error: string }).error, "production");
  });
});

describe("le rapport d'environnement, sous l'environnement VISÉ", () => {
  it("ici, le secret absent n'est PAS un manquement", () => {
    const v = rapport({ NODE_ENV: "development" }).vars[0];
    assert.isFalse(v.required);
    assert.isFalse(v.missing);
  });

  it("visé production, le MÊME poste le déclare manquant", () => {
    const r = rapport({ NODE_ENV: "development" }, "production");
    assert.equal(r.targetEnv, "production");
    assert.deepEqual([...r.stages], ["production"]);
    assert.isTrue(r.vars[0].required);
    assert.isTrue(r.vars[0].missing);
  });

  it("une valeur présente suffit, où qu'on regarde", () => {
    const r = rapport(
      { NODE_ENV: "development", NF_CSRF_SECRET: "s3cr3t" },
      "production",
    );
    assert.isFalse(r.vars[0].missing);
  });

  // PIÈGE : viser un environnement doit REMPLACER les étiquettes d'ici. Les
  // cumuler ferait exiger, sous `--env production`, ce qui n'est requis qu'en
  // développement — et le rapport accuserait un manquement imaginaire.
  it("viser un environnement remplace celui d'ici, il ne s'y ajoute pas", () => {
    const r = buildEnvReport({
      runtimeEnv: "development",
      processEnv: { NODE_ENV: "development" },
      files: [],
      catalog: [
        {
          name: "NF_DEV_ONLY",
          kind: "string",
          optional: true,
          requiredIn: ["development"],
        },
      ],
      targetEnv: "production",
    });
    assert.isFalse(r.vars[0].missing);
  });

  // La déclaration est RENDUE, même là où elle ne mord pas : c'est ce qui
  // permet de dire « requise en production » plutôt que de le déduire, à tort,
  // du seul fait qu'elle manque ici.
  it("expose la déclaration `requiredIn` à ses lecteurs", () => {
    assert.deepEqual(
      [...(rapport({}).vars[0].requiredIn ?? [])],
      ["production"],
    );
  });

  // Une chaîne vide n'est pas une valeur : `defineEnv` la refuse au boot, et un
  // rapport qui la compterait comme présente annoncerait vert un démarrage qui
  // échouera.
  it("une chaîne VIDE ne satisfait pas l'exigence", () => {
    const r = rapport(
      { NODE_ENV: "development", NF_CSRF_SECRET: "" },
      "production",
    );
    assert.isTrue(r.vars[0].missing);
  });
});

/**
 * Une application MINIMALE — les deux fichiers que `findProjectRoot` exige.
 *
 * ⚠️ Les deux : `nodefony.config.ts` SEUL ne suffit pas, et l'oubli ne se voit
 * pas — le rapport se déclare simplement « hors application », si bien que les
 * contrôles sont sautés et que les tests passent… pour la mauvaise raison.
 */
function creerApp(prefixe: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefixe));
  writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};\n");
  writeFileSync(path.join(dir, "package.json"), '{"name":"app-de-test"}\n');
  return dir;
}

describe("readiness — un `.env*.local` SUIVI par git", () => {
  let dir: string;
  const app = (): string => {
    dir = creerApp("nf-doctor-env-");
    return dir;
  };
  const nettoie = (): void => rmSync(dir, { recursive: true, force: true });

  it("versionné, c'est un manquement — avec le geste ET la conséquence", async () => {
    const root = app();
    try {
      const r = await checkReadiness({
        projectRoot: root,
        tracked: { supported: true, tracked: [".env.local"] },
      });
      const f = r.findings.find((x) => x.kind === "env-file-tracked");
      assert.isDefined(f, "un secret versionné doit être rapporté");
      assert.include(f?.message ?? "", "git rm --cached .env.local");
      // Retirer le fichier de l'index ne réécrit pas l'historique : taire ce
      // point ferait croire le problème réglé alors que le secret est poussé.
      assert.include(f?.message ?? "", "compromis");
      assert.isNull(r.trackedUnknown, "le contrôle a bien regardé");
    } finally {
      nettoie();
    }
  });

  it("aucun fichier suivi : rien à signaler, et le contrôle a REGARDÉ", async () => {
    const root = app();
    try {
      const r = await checkReadiness({
        projectRoot: root,
        tracked: { supported: true, tracked: [] },
      });
      assert.isEmpty(r.findings.filter((x) => x.kind === "env-file-tracked"));
      assert.isNull(r.trackedUnknown);
    } finally {
      nettoie();
    }
  });

  // 🔴 LE cas qui compte : sans dépôt git, l'absence de trouvaille ne prouve
  // RIEN. Un contrôle de secrets qui se tait sur un dossier non versionné
  // délivre un quitus que personne n'a mérité.
  it("sans dépôt git, le contrôle est SAUTÉ — jamais vert", async () => {
    const root = app();
    try {
      const r = await checkReadiness({
        projectRoot: root,
        tracked: {
          supported: false,
          tracked: [],
          reason: "not a git repository",
        },
      });
      assert.isEmpty(r.findings.filter((x) => x.kind === "env-file-tracked"));
      assert.include(r.trackedUnknown ?? "", "not a git repository");
    } finally {
      nettoie();
    }
  });

  it("aucune sonde fournie : le contrôle le DIT, il ne se croit pas passé", async () => {
    const root = app();
    try {
      const r = await checkReadiness({ projectRoot: root });
      assert.isNotNull(r.trackedUnknown);
    } finally {
      nettoie();
    }
  });
});

/**
 * La CHAÎNE, pas seulement les briques.
 *
 * 🔴 Deux fois de suite, une fonction pure éprouvée et son appelant jamais
 * appelé ont produit une intégration continue rouge. Une sonde correcte que
 * personne ne branche ne garde rien : ces deux cas passent par
 * `collectCheckReport`, c'est-à-dire par le vrai câblage.
 */
describe("collectCheckReport — le contrôle git est réellement BRANCHÉ", () => {
  it("dans un dossier hors dépôt, la sous-règle est annoncée non contrôlée", async () => {
    const dir = creerApp("nf-doctor-nogit-");
    try {
      const report = await collectCheckReport(dir);
      // La cause doit être GIT, pas « hors application » : sans cette
      // vérification, un décor incomplet ferait passer le test pour une raison
      // qui n'a rien à voir avec ce qu'il prétend éprouver.
      assert.isTrue(
        report.execution.readiness.ran,
        "le décor doit être reconnu comme une application",
      );
      assert.isFalse(
        report.execution.envTracked.ran,
        "sans dépôt git, `envTracked` ne peut pas se déclarer passé",
      );
      assert.include(report.execution.envTracked.reason ?? "", "git");
      assert.isDefined(report.execution.envTracked.unlock);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Sans ce cas, une sonde qui échouerait TOUJOURS passerait le test précédent
  // sans qu'on s'en aperçoive : « non contrôlé » serait alors le seul verdict
  // que l'outil sait rendre. On monte donc un vrai dépôt — minuscule — avec un
  // vrai secret versionné, et on demande le rapport par le chemin normal.
  //
  // `git add` suffit : `git ls-files` lit l'INDEX. Pas de commit, donc pas
  // d'identité git à poser sur la machine qui exécute les tests.
  it("un secret versionné remonte jusqu'au rapport", async () => {
    const dir = creerApp("nf-doctor-git-");
    try {
      writeFileSync(path.join(dir, ".env.local"), "NF_CSRF_SECRET=hunter2\n");
      const git = (...args: string[]): void => {
        execFileSync("git", args, { cwd: dir, stdio: "ignore" });
      };
      git("init", "-q");
      git("add", ".env.local");

      const report = await collectCheckReport(dir);
      assert.isTrue(
        report.execution.envTracked.ran,
        "le dossier est versionné : le contrôle devait avoir lieu",
      );
      assert.isNull(report.readiness.trackedUnknown);
      const f = report.readiness.findings.find(
        (x) => x.kind === "env-file-tracked",
      );
      assert.isDefined(f, "le secret versionné devait être rapporté");
      assert.include(f?.message ?? "", ".env.local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
