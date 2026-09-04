/**
 * Une variable requise dans UN environnement seulement.
 *
 * Le cas qui fonde cette règle : les secrets absents sont générés à la volée en
 * développement. Déclarer un secret `optional` est donc vrai sur le poste du
 * développeur et faux en production, où un secret éphémère fait refuser par un
 * pod le jeton qu'un autre vient d'émettre — sans le moindre message.
 *
 * La règle vit à UN endroit (`defineEnv`) et trois lecteurs s'en servent : le
 * boot, `nodefony env` et `nodefony doctor --env <e>`. Ces tests éprouvent la
 * brique ; ceux de la chaîne vivent avec leurs commandes.
 */
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defineEnv,
  envString,
  getEnvCatalog,
  isEnvVarRequired,
  isRequiredByStage,
  resolveEnvStages,
} from "../config/defineEnv";

describe("resolveEnvStages — les étiquettes de l'environnement", () => {
  it("rend le mode d'exécution, et `development` par défaut", () => {
    assert.deepStrictEqual(resolveEnvStages({}), ["development"]);
    assert.deepStrictEqual(resolveEnvStages({ NODE_ENV: "production" }), [
      "production",
    ]);
  });

  // PIÈGE : une préproduction tourne en `production`. Élire une seule étiquette
  // rendrait `requiredIn: ["preprod"]` inexprimable — ou pire, ferait exiger en
  // preprod ce qui n'est voulu qu'en production.
  it("rend AUSSI l'environnement de déploiement quand il diffère du mode", () => {
    assert.deepStrictEqual(
      resolveEnvStages({ NODE_ENV: "production", NF_ENV: "preprod" }),
      ["production", "preprod"],
    );
  });

  it("n'énumère pas deux fois la même étiquette", () => {
    assert.deepStrictEqual(
      resolveEnvStages({ NODE_ENV: "production", NF_ENV: "production" }),
      ["production"],
    );
  });

  // La précédence n'est pas rejouée ici : elle est celle du PRODUIT
  // (`Kernel.ts`, `bin/nodefony.ts`, `cli/env.ts`, et `reservedEnv.ts` qui la
  // documente — « `APP_ENV` gagne »). Une sixième écriture de la même règle qui
  // trancherait dans l'autre sens ferait dire à `doctor` un environnement que
  // le boot n'a pas retenu, ce qui est exactement le défaut que ce ticket ferme.
  it("`APP_ENV` prime sur `NF_ENV`, comme partout ailleurs", () => {
    assert.deepStrictEqual(resolveEnvStages({ APP_ENV: "staging" }), [
      "development",
      "staging",
    ]);
    assert.deepStrictEqual(
      resolveEnvStages({ NF_ENV: "prod-eu", APP_ENV: "staging" }),
      ["development", "staging"],
    );
  });
});

describe("isEnvVarRequired — la règle, une seule fois", () => {
  it("une variable sans défaut ni `optional` est requise PARTOUT", () => {
    const meta = { optional: false } as const;
    assert.strictEqual(isEnvVarRequired(meta, ["development"]), true);
    assert.strictEqual(isEnvVarRequired(meta, ["production"]), true);
  });

  it("`requiredIn` n'exige que dans les environnements nommés", () => {
    const meta = { optional: true, requiredIn: ["production"] } as const;
    assert.strictEqual(isEnvVarRequired(meta, ["development"]), false);
    assert.strictEqual(isEnvVarRequired(meta, ["production"]), true);
  });

  it("une seule étiquette qui correspond suffit", () => {
    const meta = { optional: true, requiredIn: ["preprod"] } as const;
    assert.strictEqual(isEnvVarRequired(meta, ["production", "preprod"]), true);
  });

  // PIÈGE : sans cette distinction, une variable requise de toute façon serait
  // annoncée « requise en production », ce qui est faux et envoie chercher une
  // règle d'environnement là où il n'y en a pas.
  it("`isRequiredByStage` ignore l'exigence d'origine", () => {
    assert.strictEqual(isRequiredByStage({}, ["production"]), false);
    assert.strictEqual(
      isRequiredByStage({ requiredIn: ["production"] }, ["production"]),
      true,
    );
  });
});

describe("defineEnv — le BOOT refuse ce qui manquera là où on va", () => {
  const catalog = {
    NF_CSRF_SECRET: envString({
      optional: true,
      requiredIn: ["production"],
      description: "Secret des jetons anti-CSRF.",
    }),
  };

  it("ne lève PAS en développement — le poste démarre sans le secret", () => {
    const env = defineEnv(catalog, { NODE_ENV: "development" });
    assert.strictEqual(env.NF_CSRF_SECRET, undefined);
  });

  it("LÈVE en production, en nommant la variable et l'environnement", () => {
    assert.throws(
      () => defineEnv(catalog, { NODE_ENV: "production" }),
      (e: Error) =>
        e.message.includes("NF_CSRF_SECRET") &&
        e.message.includes("production"),
    );
  });

  it("une chaîne VIDE ne satisfait pas l'exigence", () => {
    assert.throws(() =>
      defineEnv(catalog, { NODE_ENV: "production", NF_CSRF_SECRET: "" }),
    );
  });

  it("la valeur présente lève l'exigence", () => {
    const env = defineEnv(catalog, {
      NODE_ENV: "production",
      NF_CSRF_SECRET: "s3cr3t",
    });
    assert.strictEqual(env.NF_CSRF_SECRET, "s3cr3t");
  });

  // PIÈGE : un secret monté par Docker ou Kubernetes arrive par `<NOM>_FILE`.
  // Contrôler l'exigence sur la source BRUTE le rendrait invisible, et le
  // déploiement le plus soigné serait précisément celui qu'on refuserait.
  it("un secret monté en `<NOM>_FILE` satisfait l'exigence", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nf-env-"));
    const fichier = path.join(dir, "csrf");
    writeFileSync(fichier, "depuis-le-fichier\n");
    const env = defineEnv(catalog, {
      NODE_ENV: "production",
      NF_CSRF_SECRET_FILE: fichier,
    });
    assert.strictEqual(env.NF_CSRF_SECRET, "depuis-le-fichier");
  });

  it("le catalogue expose `requiredIn` à ses lecteurs", () => {
    const env = defineEnv(catalog, { NODE_ENV: "development" });
    assert.deepStrictEqual(getEnvCatalog(env)[0].requiredIn, ["production"]);
  });
});
