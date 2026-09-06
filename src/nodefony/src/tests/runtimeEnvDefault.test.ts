/*
 *   Le mode MOTEUR quand rien ne le dit — la décision, et ce dont elle DÉPEND.
 *
 *   Décision : le défaut est `development`. Elle ne repose pas sur un goût mais
 *   sur une hypothèse VÉRIFIABLE — « aucun serveur ne démarre sans que son mode
 *   soit posé ». Les trois lanceurs le posent eux-mêmes, l'image générée pose
 *   `ENV NODE_ENV=production`, et Node.js le recommande explicitement
 *   (« Always run your Node.js with NODE_ENV=production set »). Le défaut ne
 *   gouverne donc QUE les commandes utilitaires, tapées sur un poste de
 *   développement.
 *
 *   🔴 C'est cette HYPOTHÈSE que le dernier bloc grave. Le jour où quelqu'un
 *   ajoute un lanceur qui ne déclare pas son mode, le défaut `development`
 *   devient dangereux — et rien d'autre ne le dirait.
 *
 *   ⚠️ Ce fichier ne teste pas le collapse `staging → production` (règle
 *   DISTINCTE : tout ce qui n'est pas « dev » tourne comme la production),
 *   couvert par `Kernel.test.ts`. Les confondre ferait passer l'une pour
 *   l'autre le jour où l'une des deux change.
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import CliKernel from "../kernel/CliKernel";
import Kernel from "../kernel/Kernel";
import {
  DEFAULT_ENGINE_ENVIRONMENT,
  defaultEngineEnvironment,
  detectEnvironmentFromArgv,
} from "../runtime/engineEnvironment";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

describe("detectEnvironmentFromArgv — seule la COMMANDE exprime une intention", () => {
  it("reconnaît les lanceurs et leurs alias", () => {
    assert.equal(detectEnvironmentFromArgv(["production"]), "production");
    assert.equal(detectEnvironmentFromArgv(["start"]), "production");
    assert.equal(
      detectEnvironmentFromArgv(["cluster", "-w", "4"]),
      "production",
    );
    assert.equal(detectEnvironmentFromArgv(["development"]), "development");
  });

  it("une commande utilitaire n'exprime rien", () => {
    assert.strictEqual(detectEnvironmentFromArgv(["doctor"]), undefined);
    assert.strictEqual(detectEnvironmentFromArgv([]), undefined);
  });

  // 🔴 LE cas qui a motivé l'extraction : la VALEUR d'une option n'est pas une
  // intention. Avant cette règle, `doctor --env production` faisait basculer le
  // processus entier en production — il chargeait `.env.production` et les
  // modules de production pour répondre à une question sur le POSTE, et le
  // catalogue de l'application retombait en silence sur un build périmé.
  it("la valeur d'une option ne décide PAS du mode", () => {
    assert.strictEqual(
      detectEnvironmentFromArgv(["doctor", "--env", "production"]),
      undefined,
    );
    assert.strictEqual(
      detectEnvironmentFromArgv(["env", "--env", "prod"]),
      undefined,
    );
  });

  // Corollaire : ce qui suit une option ne compte plus, même un mot de lanceur.
  // Personne n'écrit `nodefony --json production`, et le prendre pour une
  // intention rouvrirait exactement le trou qu'on vient de fermer.
  it("tout ce qui suit la première option est ignoré", () => {
    assert.strictEqual(
      detectEnvironmentFromArgv(["--json", "production"]),
      undefined,
    );
  });
});

/**
 * Joue un corps avec `NODE_ENV` retiré, puis le restaure.
 *
 * Vitest pose `NODE_ENV=test` : sans ce retrait, la variable primerait et le
 * test mesurerait la précédence au lieu du DÉFAUT — un vert qui ne prouverait
 * rien de ce qui est écrit ici.
 */
function sansNodeEnv<T>(corps: () => T): T {
  const avant = process.env["NODE_ENV"];
  delete process.env["NODE_ENV"];
  try {
    return corps();
  } finally {
    if (avant === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = avant;
  }
}

function avecNodeEnv<T>(valeur: string, corps: () => T): T {
  const avant = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = valeur;
  try {
    return corps();
  } finally {
    if (avant === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = avant;
  }
}

describe("mode moteur — le défaut quand rien ne le dit", () => {
  it("vaut `development`, jamais `production`", () => {
    assert.strictEqual(DEFAULT_ENGINE_ENVIRONMENT, "development");
    sansNodeEnv(() => {
      const k = new Kernel(undefined as never, null as never);
      assert.strictEqual(k.resolveRuntimeEnv(), "development");
    });
  });

  it("`NODE_ENV` prime sur le défaut", () => {
    avecNodeEnv("production", () => {
      const k = new Kernel(undefined as never, null as never);
      assert.strictEqual(k.resolveRuntimeEnv(), "production");
    });
  });

  it("l'intention de la commande prime sur le défaut", () => {
    sansNodeEnv(() => {
      const k = new Kernel(undefined as never, null as never);
      assert.strictEqual(k.resolveRuntimeEnv("production"), "production");
    });
  });

  it("un CliKernel construit sans mode part en `development`", () => {
    sansNodeEnv(() => {
      assert.strictEqual(new CliKernel().environment, "development");
    });
  });
});

describe("mode moteur — POSER la variable est un acte de déploiement", () => {
  // 🔴 LE TROU QUE LA SUITE A ATTRAPÉ. Une première version faisait retomber sur
  // `development` dès que `NODE_ENV` ne désignait aucun mode moteur — donc pour
  // `staging`, `canary`, `prod-eu`. Un déploiement de pré-production aurait
  // chargé les modules `policy:"dev"` (console d'administration, outillage) et
  // détaillé ses traces. Ces valeurs ne sont PAS une absence : elles NOMMENT un
  // déploiement, et un déploiement tourne comme la production.
  for (const nomme of ["staging", "canary", "prod-eu", "test", "preprod"]) {
    it(`NODE_ENV="${nomme}" nomme un déploiement → production`, () => {
      assert.strictEqual(defaultEngineEnvironment(nomme), "production");
      avecNodeEnv(nomme, () => {
        assert.strictEqual(new CliKernel().environment, "production");
      });
    });
  }

  it("une chaîne VIDE compte comme posée (choix conservateur)", () => {
    // On ne distingue pas « vidée par erreur » de « vidée exprès ». Se tromper
    // vers la production ne coûte qu'une commande utilitaire ; l'inverse expose
    // une console d'administration.
    assert.strictEqual(defaultEngineEnvironment(""), "production");
  });

  it("seule l'ABSENCE TOTALE désigne un poste de développement", () => {
    assert.strictEqual(defaultEngineEnvironment(undefined), "development");
  });

  it("aucun défaut ne s'interpose AVANT cette distinction", () => {
    // Le second piège, plus discret : un défaut posé dans les options par
    // défaut du Cli court-circuitait la cascade et rendait `development` pour
    // `staging`. La règle ne vaut que si rien ne la précède.
    const src = lire("Cli.ts");
    const bloc = src.slice(src.indexOf("const defaultOptions"));
    const zone = bloc.slice(0, bloc.indexOf("};"));
    assert.ok(
      !/^\s*environment\s*:/mu.test(zone),
      "defaultOptions ne doit porter AUCUN `environment` : il s'interposerait " +
        "avant la distinction absent / posé-mais-non-moteur",
    );
  });
});

describe("mode moteur — UNE règle, UNE implémentation", () => {
  // Cette règle vivait à SEPT endroits, et elle avait déjà divergé : le kernel
  // se déclarait en production pendant que la cascade `.env` ne chargeait ni
  // `.env.production` ni `.env.development`. Un défaut recopié ne se voit pas —
  // il se compte.
  for (const fichier of ["kernel/Kernel.ts", "Cli.ts"]) {
    it(`${fichier} ne contient aucun défaut d'environnement EN DUR`, () => {
      const src = lire(fichier);
      const fautifs: string[] = [];
      for (const ligne of src.split("\n")) {
        // Un DÉFAUT s'écrit `|| "production"` ou `?? "production"`. Un `case`,
        // une comparaison ou une AFFECTATION délibérée n'en sont pas — les
        // compter rendrait ce contrôle ingérable, donc ignoré.
        if (/(?:\|\||\?\?)\s*["'](?:production|development)["']/u.test(ligne)) {
          fautifs.push(ligne.trim());
        }
      }
      assert.deepStrictEqual(
        fautifs,
        [],
        `défaut(s) en dur — doivent pointer DEFAULT_ENGINE_ENVIRONMENT :\n${fautifs.join("\n")}`,
      );
    });
  }

  it("le contexte de CONFIG reçoit le même mode que le moteur", () => {
    // Le piège exact que la source unique ferme : `buildConfigContext` fabrique
    // le `ctx` de `defineConfig((ctx) => …)`. S'il désignait un autre mode que
    // le kernel, l'application serait CONFIGURÉE pour un environnement et
    // EXÉCUTÉE dans un autre, sans qu'aucune erreur ne le dise.
    const src = lire("kernel/Kernel.ts");
    const bloc = src.slice(src.indexOf("private buildConfigContext"));
    assert.ok(
      /DEFAULT_ENGINE_ENVIRONMENT/u.test(bloc.slice(0, 900)),
      "buildConfigContext doit retomber sur DEFAULT_ENGINE_ENVIRONMENT",
    );
  });
});

describe("mode moteur — l'hypothèse dont dépend le défaut", () => {
  // 🔴 SI CE BLOC TOMBE, LE DÉFAUT `development` N'EST PLUS SÛR.
  // Il ne mesure pas du code : il vérifie que la raison d'être de la décision
  // tient toujours. Un lanceur qui ne poserait pas son mode ferait démarrer un
  // serveur de production en développement.
  const LANCEURS = [
    { fichier: "kernel/commands/ProdCommand.ts", mode: "production" },
    { fichier: "kernel/commands/DevCommand.ts", mode: "development" },
    { fichier: "kernel/commands/ClusterCommand.ts", mode: "production" },
  ];

  for (const { fichier, mode } of LANCEURS) {
    it(`${path.basename(fichier)} pose explicitement « ${mode} »`, () => {
      const src = lire(fichier);
      assert.ok(
        new RegExp(`environment\\s*=\\s*["']${mode}["']`, "u").test(src),
        `${fichier} doit poser son mode lui-même — sans quoi le défaut le gouverne`,
      );
    });
  }

  it("tout ALIAS d'un lanceur est détecté par le lanceur binaire", () => {
    // Le trou vécu : `ProdCommand.alias("start")` existait, `start` n'était PAS
    // dans la détection argv. `nodefony start` ne devait son mode qu'au défaut
    // de classe — il tombait du bon côté par ACCIDENT, accident qui disparaît
    // le jour où ce défaut change. Un alias qui lance un serveur DOIT être ici.
    // La détection a QUITTÉ le binaire pour `runtime/engineEnvironment.ts` :
    // un binaire s'exécute à l'import, donc sa règle ne pouvait pas s'éprouver
    // autrement qu'en lisant son texte. Elle s'appelle désormais.
    const bin = lire("runtime/engineEnvironment.ts");
    const detection = bin.slice(
      bin.indexOf("function detectEnvironmentFromArgv"),
    );
    const zone = detection.slice(0, detection.indexOf("return undefined"));

    // 🔴 Les COMPARAISONS, pas le texte de la zone. Première version de ce test :
    // elle cherchait le mot « start » n'importe où — donc le trouvait dans le
    // COMMENTAIRE qui explique pourquoi il doit y être. Débranché (l'alias retiré
    // du `if`), il restait VERT. Un test qui lit les commentaires ne teste rien.
    const compares = new Set(
      [...zone.matchAll(/a\s*===\s*["']([\w:-]+)["']/gu)].map((m) => m[1]),
    );

    for (const { fichier } of LANCEURS) {
      const src = lire(fichier);
      for (const [, alias] of src.matchAll(
        /this\.alias\(["']([\w:-]+)["']\)/gu,
      )) {
        assert.ok(
          compares.has(alias as string),
          `l'alias « ${alias} » de ${path.basename(fichier)} lance un serveur ` +
            `mais n'est comparé nulle part dans detectEnvironmentFromArgv ` +
            `(comparés : ${[...compares].join(", ")})`,
        );
      }
    }
  });
});
