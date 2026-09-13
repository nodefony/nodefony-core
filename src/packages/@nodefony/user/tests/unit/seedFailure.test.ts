import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  describeSeedFailure,
  PasswordPolicy,
  WeakPasswordError,
} from "../../index";

/**
 * Banc du message de semis raté.
 *
 * Les assertions portent sur les TROIS informations que ce message existe pour
 * réunir — le compte, la règle, le geste — et pas sur le fait qu'une phrase a
 * été produite. Un message qui perd l'une des trois laisse l'exploitant devant
 * un constat : c'est le défaut qu'on corrige, pas l'absence de message.
 */
describe("describeSeedFailure — quel compte, quelle règle, quel geste", () => {
  it("nomme le compte, la règle enfreinte et la variable à corriger", () => {
    const message = describeSeedFailure(
      new WeakPasswordError("contient l'identifiant du compte"),
      {
        identifier: "admin",
        envVar: "NF_ADMIN_PASSWORD",
        fromEnv: true,
        admin: true,
      },
    );
    assert.match(message, /"admin"/, "le compte n'est pas nommé");
    assert.match(
      message,
      /contient l'identifiant du compte/,
      "la règle enfreinte n'est pas nommée",
    );
    assert.match(
      message,
      /NF_ADMIN_PASSWORD/,
      "la variable à corriger n'est pas nommée",
    );
    assert.match(
      message,
      /security:user:add admin --admin/,
      "le geste de repli n'est pas donné",
    );
    assert.match(
      message,
      /démarrage continue/,
      "le message ne dit pas que l'application tourne quand même",
    );
  });

  it("n'envoie PAS corriger une variable que personne n'a posée", () => {
    const message = describeSeedFailure(new WeakPasswordError("trop court"), {
      identifier: "admin",
      envVar: "NF_ADMIN_PASSWORD",
      fromEnv: false,
    });
    assert.match(
      message,
      /défaut écrit dans le code/,
      "la provenance de la valeur n'est pas dite",
    );
    assert.doesNotMatch(
      message,
      /Corrige NF_ADMIN_PASSWORD/,
      "envoie corriger une variable absente — on chercherait là où il n'y a rien",
    );
    assert.match(message, /pose NF_ADMIN_PASSWORD/);
  });

  it("omet `--admin` pour un compte ordinaire", () => {
    const message = describeSeedFailure(new WeakPasswordError("trop court"), {
      identifier: "user",
      envVar: "NF_USER_PASSWORD",
      fromEnv: true,
    });
    assert.match(message, /security:user:add user`/);
    assert.doesNotMatch(message, /--admin/);
  });

  it("lit la règle sur la PROPRIÉTÉ, pas par `instanceof`", () => {
    // Deux copies de `@nodefony/user` dans un même arbre (hissage npm, lien
    // local) font échouer tout test de classe. Le message perdrait alors la
    // seule information utile, au pire endroit : celui où l'on explique.
    const jumelle = Object.assign(new Error("Mot de passe refusé : x"), {
      violation: "figure parmi les mots de passe les plus courants",
    });
    assert.match(
      describeSeedFailure(jumelle, {
        identifier: "admin",
        envVar: "NF_ADMIN_PASSWORD",
        fromEnv: true,
      }),
      /figure parmi les mots de passe les plus courants/,
    );
  });

  it("rend le message de toute autre erreur plutôt qu'un texte générique", () => {
    assert.match(
      describeSeedFailure(new Error("SQLITE_READONLY: attempt to write"), {
        identifier: "admin",
        envVar: "NF_ADMIN_PASSWORD",
        fromEnv: true,
      }),
      /SQLITE_READONLY/,
    );
  });
});

/**
 * Les mots de passe de fixture passent la politique — relus DANS leur fichier.
 *
 * Recopier la valeur ici ferait un jumeau non vérifié : le test resterait vert
 * pendant que le semis échoue. C'est arrivé en vrai — le défaut de l'application
 * générée était `admin`, refusé parce qu'il contient l'identifiant du compte, et
 * aucune application neuve ne semait plus son compte.
 */
describe("les mots de passe de fixture passent la politique par défaut", () => {
  const politique = new PasswordPolicy();

  /**
   * Extrait une constante d'un fichier source, en échouant s'il a bougé.
   *
   * @param relatif - chemin du fichier, relatif à ce test.
   * @param nom - nom de la constante.
   * @returns la valeur littérale déclarée.
   */
  const constanteDe = (relatif: string, nom: string): string => {
    const fichier = path.resolve(import.meta.dirname, relatif);
    assert.ok(
      existsSync(fichier),
      `source introuvable : ${fichier} — si le fichier a déménagé, recaler ce ` +
        `test, ne pas le supprimer`,
    );
    const trouve = new RegExp(`${nom} = "([^"]+)"`).exec(
      readFileSync(fichier, "utf8"),
    );
    assert.ok(trouve !== null, `${nom} introuvable dans ${relatif}`);
    return trouve[1] as string;
  };

  it("celui de l'application GÉNÉRÉE (gabarit `create app`)", async () => {
    const motDePasse = constanteDe(
      "../../../../../nodefony/templates/app/complete/nodefony/security/provisionUsers.ts.tpl",
      "DEV_ADMIN_PASSWORD",
    );
    assert.equal(
      await politique.violation(motDePasse, { identifier: "admin" }),
      null,
      `le défaut du gabarit est refusé par la politique — aucune application ` +
        `générée ne sèmerait son compte admin`,
    );
  });

  it("celui du DÉPÔT de développement du framework", async () => {
    const motDePasse = constanteDe(
      "../../../../../../nodefony/security/provisionUsers.ts",
      "DEV_FIXTURE_PASSWORD",
    );
    for (const identifier of ["admin", "user"]) {
      assert.equal(
        await politique.violation(motDePasse, { identifier }),
        null,
        `le défaut du dépôt est refusé pour le compte "${identifier}"`,
      );
    }
  });
});
