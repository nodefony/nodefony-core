/**
 * `doctor --env <e>` — ce qui DISPARAÎT quand on change d'environnement.
 *
 * Le défaut que ces cas ferment est arrivé DEUX fois sur ce dépôt : un module
 * `policy: "dev"` est retiré en production, ce qu'il fournissait part avec lui,
 * et le boot continue. Rien ne l'attrapait avant la production, parce que le
 * gating ne se voit que sur un démarrage de production — c'est-à-dire jamais,
 * sur un poste de développement.
 *
 * Le boot cible est INJECTÉ (`readTarget`) : sans cela ces cas ne pourraient
 * tourner que là où un second démarrage aboutit, donc nulle part en intégration
 * continue.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  preventedChecks,
  type DoctorFamily,
  type IControleSaute,
} from "../kernel/checks/report";
import {
  checkGating,
  lostServices,
  readTargetProvision,
  targetEnvironment,
  type IProvidedService,
  type ITargetProvision,
} from "../kernel/checks/gating";
import {
  gateModuleManifest,
  GATED_BY_POLICY,
  GATED_BY_CONDITION,
  type GateConfig,
} from "../kernel/moduleGating";
import { engineModeOf } from "../runtime/engineEnvironment";

/** Une config vide : aucune `when()` de ces décors ne la lit vraiment. */
const config = {} as GateConfig;

/** Un boot cible qui répond la liste donnée. */
const repond =
  (services: IProvidedService[]) => (): Promise<ITargetProvision> =>
    Promise.resolve({ ok: true, services });

/** Un boot cible qui n'aboutit pas. */
const echoue = (reason: string) => (): Promise<ITargetProvision> =>
  Promise.resolve({ ok: false, reason, short: "boot en échec" });

const service = (name: string, module: string): IProvidedService => ({
  name,
  module,
});

describe("gateModuleManifest — la règle du gating, rejouée à froid", () => {
  it("un module `policy: dev` disparaît d'un runtime de production, avec sa raison", () => {
    const out = gateModuleManifest(
      ["@nodefony/http", { name: "@nodefony/devkit", policy: "dev" }],
      { isProduction: true, forceDevModules: false, config },
    );
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ["@nodefony/http"],
    );
    assert.deepEqual(out.gated, [
      { module: "@nodefony/devkit", reason: GATED_BY_POLICY },
    ]);
  });

  it("le même manifeste en développement ne perd rien", () => {
    const out = gateModuleManifest(
      ["@nodefony/http", { name: "@nodefony/devkit", policy: "dev" }],
      { isProduction: false, forceDevModules: false, config },
    );
    assert.lengthOf(out.entries, 2);
    assert.lengthOf(out.gated, 0);
  });

  it("la dérogation CHARGE le module dev, et le dit — elle ne le tait pas", () => {
    const out = gateModuleManifest([{ name: "banc", policy: "dev" }], {
      isProduction: true,
      forceDevModules: true,
      config,
    });
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ["banc"],
    );
    assert.lengthOf(out.gated, 0);
    // Rendu à part : c'est ce qui permet au Kernel de le CRIER et d'armer
    // l'auto-arrêt. Un module de banc en production est une surface offerte.
    assert.deepEqual(out.derogated, ["banc"]);
  });

  it("une garde `when()` fausse écarte le module, avec sa propre raison", () => {
    const out = gateModuleManifest([{ name: "orm", when: () => false }], {
      isProduction: false,
      forceDevModules: false,
      config,
    });
    assert.deepEqual(out.gated, [
      { module: "orm", reason: GATED_BY_CONDITION },
    ]);
  });

  it("🔴 une garde `when()` qui LÈVE écarte ce module-là, pas le boot entier", () => {
    // Un manifeste s'écrit à la main : une `when()` fautive laissait le Kernel
    // sans le moindre module, au lieu d'un module de moins. La raison est
    // ÉNONCÉE — écarter en silence serait exactement le défaut qu'on combat.
    const out = gateModuleManifest(
      [
        {
          name: "casse",
          when: () => {
            throw new Error("config.orm est undefined");
          },
        },
        "@nodefony/http",
      ],
      { isProduction: false, forceDevModules: false, config },
    );
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ["@nodefony/http"],
    );
    assert.include(out.gated[0]?.reason ?? "", "config.orm est undefined");
  });

  it("l'ordre du manifeste est CONSERVÉ — filtrer n'est pas réordonner", () => {
    const out = gateModuleManifest(["c", "a", "b"], {
      isProduction: true,
      forceDevModules: false,
      config,
    });
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ["c", "a", "b"],
    );
  });

  it("un manifeste absent ne lève pas — un diagnostic ne casse jamais", () => {
    const out = gateModuleManifest(undefined, {
      isProduction: true,
      forceDevModules: false,
      config,
    });
    assert.deepEqual(out.entries, []);
    assert.deepEqual(out.gated, []);
  });
});

describe("lostServices — le DIFF, et rien d'autre", () => {
  it("un service que l'environnement visé ne fournit plus est CONSTATÉ", () => {
    // 🔴 Constaté, pas accusé, et SANS geste. Qu'un module `policy: "dev"`
    // disparaisse en production est sa raison d'être — le rendre en manquement
    // faisait passer le fonctionnement normal du produit pour un défaut, et le
    // geste qui suivait (« retire `policy: "dev"` ») aurait embarqué
    // l'outillage de développement en production. La distinction qui manque
    // est « ce service est-il REQUIS là-bas ? », et rien ne permet de la
    // déclarer.
    const perdus = lostServices(
      [service("devkit", "devkit"), service("router", "framework")],
      [service("router", "framework")],
      "production",
    );
    assert.lengthOf(perdus, 1);
    assert.equal(perdus[0]?.service, "devkit");
    assert.deepEqual(perdus[0]?.providers, ["devkit"]);
    assert.include(perdus[0]?.message ?? "", "absent en production");
    assert.notProperty(
      perdus[0] ?? {},
      "action",
      "un constat ne porte pas de geste — celui-ci était nuisible",
    );
  });

  it("🔴 le CAS SAIN : le framework reprend la main, donc rien n'est perdu", () => {
    // Un service fourni par un module dev ET par un défaut du framework ne lève
    // rien : c'est toute la raison pour laquelle on CONSTATE au lieu de
    // déduire du manifeste. Un contrôle qui crierait ici apprendrait à être
    // ignoré.
    const perdus = lostServices(
      [service("passwordEncoder", "devkit")],
      [service("passwordEncoder", "security")],
      "production",
    );
    assert.lengthOf(perdus, 0);
  });

  it("deux modules portant le même nom sont nommés ENSEMBLE, une seule fois", () => {
    const perdus = lostServices(
      [service("x", "a"), service("x", "b")],
      [],
      "production",
    );
    assert.lengthOf(perdus, 1);
    assert.deepEqual(perdus[0]?.providers, ["a", "b"]);
    assert.include(perdus[0]?.message ?? "", "« a », « b »");
  });

  it("un service NOUVEAU là-bas n'est pas un manquement — le diff est orienté", () => {
    const perdus = lostServices(
      [],
      [service("clusterBus", "cluster")],
      "production",
    );
    assert.lengthOf(perdus, 0);
  });
});

describe("checkGating — le contrôle complet", () => {
  it("sans environnement visé, le contrôle est SAUTÉ et le dit", async () => {
    const r = await checkGating({
      targetEnv: null,
      manifest: [],
      config,
      here: [],
      readTarget: repond([]),
    });
    assert.isFalse(r.execution.ran);
    assert.include(r.execution.reason ?? "", "aucun environnement visé");
    assert.include(r.execution.unlock ?? "", "--env production");
  });

  it("🔴 le manquement est rendu, et les modules écartés restent une INFO", async () => {
    const r = await checkGating({
      targetEnv: "production",
      manifest: [{ name: "devkit", policy: "dev" }, "framework"],
      config,
      here: [service("devkit", "devkit"), service("router", "framework")],
      readTarget: repond([service("router", "framework")]),
    });
    assert.isTrue(r.execution.ran);
    assert.lengthOf(r.findings, 1);
    assert.equal(r.findings[0]?.service, "devkit");
    // Écarter un module `policy: dev` en production est le comportement
    // NORMAL : il est rapporté, jamais compté comme manquement.
    assert.deepEqual(
      r.gated.map((g) => g.module),
      ["devkit"],
    );
  });

  it("des modules partent sans rien emporter : aucun manquement", async () => {
    const r = await checkGating({
      targetEnv: "production",
      manifest: [{ name: "devkit", policy: "dev" }],
      config,
      here: [service("passwordEncoder", "devkit")],
      readTarget: repond([service("passwordEncoder", "security")]),
    });
    assert.isTrue(r.execution.ran);
    assert.lengthOf(r.findings, 0);
    assert.lengthOf(r.gated, 1);
  });

  it("🔴 un boot cible en échec SAUTE le contrôle — il ne conclut pas « rien à signaler »", async () => {
    const r = await checkGating({
      targetEnv: "production",
      manifest: [{ name: "devkit", policy: "dev" }],
      config,
      here: [service("devkit", "devkit")],
      readTarget: echoue("l'application ne démarre pas en production"),
    });
    assert.isFalse(r.execution.ran);
    assert.lengthOf(r.findings, 0);
    // La moitié qui se lit SANS boot survit à l'échec de l'autre : c'est celle
    // qui répond le plus souvent.
    assert.lengthOf(r.gated, 1);
  });

  it("viser un environnement de DÉVELOPPEMENT n'écarte aucun module dev", async () => {
    const r = await checkGating({
      targetEnv: "development",
      manifest: [{ name: "devkit", policy: "dev" }],
      config,
      here: [service("devkit", "devkit")],
      readTarget: repond([service("devkit", "devkit")]),
    });
    assert.lengthOf(r.gated, 0);
    assert.lengthOf(r.findings, 0);
  });

  it("`staging` tourne comme la production — le collapse est rejoué à l'identique", async () => {
    const r = await checkGating({
      targetEnv: "staging",
      manifest: [{ name: "devkit", policy: "dev" }],
      config,
      here: [],
      readTarget: repond([]),
    });
    assert.deepEqual(
      r.gated.map((g) => g.module),
      ["devkit"],
    );
  });
});

describe("readTargetProvision — le boot cible, dans un processus À PART", () => {
  it("un binaire introuvable devient une raison lisible, jamais une exception", async () => {
    const lire = readTargetProvision({
      execPath: process.execPath,
      binPath: "/chemin/qui/nexiste/pas.js",
      cwd: process.cwd(),
      env: {},
      timeoutMs: 20_000,
    });
    const out = await lire("production");
    assert.isFalse(out.ok);
    if (out.ok) return;
    assert.include(out.reason, "production");
    assert.equal(out.short, "boot en échec");
  });

  it("🔴 les DEUX étiquettes sont posées, et elles ÉCRASENT celles d'ici", () => {
    // Le décor pose l'inverse de la cible : hériter sans écraser ferait
    // comparer la production à elle-même et conclure « rien ne disparaît ».
    const env = targetEnvironment(
      { NODE_ENV: "development", NF_ENV: "development", PATH: "/usr/bin" },
      "production",
    );
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.NF_ENV, "production");
    // Le reste de l'environnement PASSE : sans `PATH` ni `HOME`, le boot cible
    // ne trouverait ni son interpréteur ni ses fichiers de configuration.
    assert.equal(env.PATH, "/usr/bin");
  });

  it("les deux étiquettes valent la MÊME chose — sinon les exigences divergent", () => {
    // `resolveEnvStages` rend une étiquette unique quand mode et déploiement
    // concordent, et DEUX sinon. Poser `NODE_ENV=production, NF_ENV=preprod`
    // ferait exiger les variables de production EN PLUS de celles de preprod,
    // là où `doctor --env preprod` n'exige que celles de preprod.
    const env = targetEnvironment({}, "preprod");
    // Comparer les deux entre elles ne prouve RIEN : deux `undefined` se
    // valent, et le test passait avec une implémentation qui ne posait rien.
    assert.equal(env.NODE_ENV, "preprod");
    assert.equal(env.NF_ENV, "preprod");
  });
});

/**
 * 🔴 Le collapse dev/prod : UNE règle, deux lecteurs.
 *
 * Le Kernel décide de ce qu'il FAIT au démarrage ; `doctor --env` prédit ce
 * qu'un déploiement PRODUIRA. Les deux l'écrivaient séparément. Deux copies
 * d'une même décision divergent en silence — et ici la divergence ferait
 * annoncer un déploiement que l'application ne produit pas.
 */
describe("engineModeOf — la règle du collapse, en un seul endroit", () => {
  it("seuls `dev` et `development` sont du développement", () => {
    assert.equal(engineModeOf("dev"), "development");
    assert.equal(engineModeOf("development"), "development");
  });

  it("tout le reste tourne comme la production — un déploiement est un déploiement", () => {
    for (const label of [
      "production",
      "prod",
      "staging",
      "preprod",
      "canary",
      "prod-eu",
      "test",
      "",
      undefined,
    ]) {
      assert.equal(engineModeOf(label), "production", `« ${label} »`);
    }
  });
});

describe("mode strict — un contrôle SANS MATIÈRE n'est pas un contrôle bloqué", () => {
  /**
   * 🔴 La règle qui manquait, et qui condamnait toute application NEUVE.
   *
   * `CI` arme `--strict` d'office, et le mode strict fait échouer sur tout
   * contrôle non exécuté. Or vingt-deux des vingt-trois états « non exécuté »
   * du produit tombaient du côté « empêché », dont « aucune entité Drizzle »,
   * « aucun ORM chargé », « aucun module de sécurité chargé ». Une application
   * fraîchement générée n'a par construction ni entité ni base : elle échouait
   * donc dans toute forge, avec un rapport qui écrivait « Rien à signaler
   * parmi les 6 contrôles effectués ».
   *
   * Le critère : le contrôle a-t-il REGARDÉ et trouvé qu'il n'y avait rien
   * (sans objet), ou n'a-t-il pas pu regarder (empêché) ?
   */
  const saute = (
    famille: DoctorFamily,
    extra: Partial<IControleSaute> = {},
  ): IControleSaute => ({
    famille,
    titre: famille,
    reason: "peu importe",
    ...extra,
  });

  it("« sans objet » ne pèse pas sur le code de sortie", () => {
    assert.lengthOf(
      preventedChecks([saute("dialect", { notApplicable: true })]),
      0,
    );
  });

  it("« non demandé » non plus — l'étage 2 exige un démarrage", () => {
    assert.lengthOf(
      preventedChecks([saute("migrations", { onDemand: true })]),
      0,
    );
  });

  it("🔴 mais un contrôle EMPÊCHÉ pèse toujours — sinon plus rien ne garde", () => {
    // Le risque de la correction : tout laisser passer. Un manifeste illisible
    // reste un manquement de couverture, et doit condamner en mode strict.
    assert.lengthOf(preventedChecks([saute("guards")]), 1);
  });

  it("les états SANS MATIÈRE du produit sont marqués, pas seulement typés", () => {
    // Le champ pourrait exister sans que personne ne le pose : c'est ainsi
    // qu'une correction se perd. On confronte donc au SOURCE — les états qui
    // disent « il n'y a rien » doivent porter la marque.
    const attendus: ReadonlyArray<readonly [string, string]> = [
      ["../kernel/checks/runDoctor.ts", "aucune entité"],
      ["../kernel/checks/runDoctor.ts", "aucune source"],
      ["../kernel/checks/runDoctor.ts", "aucune classe"],
      ["../kernel/checks/live.ts", "aucun ORM"],
      ["../kernel/checks/live.ts", "sans migrations"],
      ["../kernel/checks/live.ts", "sans firewall"],
      ["../kernel/checks/gating.ts", "aucune cible"],
    ];
    const manquants: string[] = [];
    for (const [fichier, court] of attendus) {
      const texte = readFileSync(
        path.resolve(import.meta.dirname, fichier),
        "utf8",
      );
      const at = texte.indexOf(`short: "${court}"`);
      if (at === -1) {
        manquants.push(`${court} (état introuvable — a-t-il été renommé ?)`);
        continue;
      }
      // La marque suit immédiatement le libellé court.
      if (!texte.slice(at, at + 160).includes("notApplicable: true")) {
        manquants.push(`${court} (compté comme EMPÊCHÉ)`);
      }
    }
    assert.deepEqual(
      manquants,
      [],
      `états sans matière non marqués : ${manquants.join(" · ")}`,
    );
  });
});
