import assert from "node:assert/strict";
import { resolveColorEnabled } from "nodefony";
import { styleFor } from "../../nodefony/src/migrator/explain";

/**
 * **Qui décide de la couleur d'une sortie de commande.**
 *
 * La question n'est pas « est-ce un terminal ? » — c'est la réponse la plus
 * courante et elle est incomplète. Deux conventions publiques la précèdent, et
 * les manquer ne lève jamais d'erreur :
 *
 * - **`NO_COLOR`** (no-color.org) : posée une fois, elle vaut pour toutes les
 *   commandes d'une machine. L'ignorer rend une sortie illisible sur un
 *   terminal à palette inhabituelle, et le framework passe pour cassé.
 * - **`FORCE_COLOR`** : sans elle, aucune sortie colorée n'est CAPTURABLE — ni
 *   dans un fichier, ni dans une passe d'intégration continue qui sait rendre
 *   les couleurs, ni dans un rapport de validation. On ne peut alors pas
 *   relire ce que l'exploitant voit vraiment ; c'est ce qui a fait découvrir
 *   l'écart.
 *
 * La règle vit au CŒUR et sert déjà les journaux. Ce banc verrouille que les
 * commandes de migration l'appellent au lieu d'en écrire une seconde : deux
 * implémentations divergeraient, et le journal obéirait à `NO_COLOR` quand la
 * commande, elle, continuerait de colorer.
 */
describe("@nodefony/drizzle — la couleur des commandes de migration", () => {
  const AVANT = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
  };

  /** Repose l'environnement — ces variables sont GLOBALES au processus. */
  afterEach(() => {
    for (const [k, v] of Object.entries(AVANT)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  /** Pose l'environnement du cas, en repartant d'une ardoise nette. */
  const env = (valeurs: Record<string, string | undefined>): void => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    for (const [k, v] of Object.entries(valeurs)) {
      if (v !== undefined) process.env[k] = v;
    }
  };

  describe("la règle du cœur, telle que la commande l'appelle", () => {
    it("hors terminal, pas de couleur — une sortie redirigée reste brute", () => {
      env({});
      assert.equal(resolveColorEnabled(false), false);
    });

    it("sur un terminal, de la couleur", () => {
      env({});
      assert.equal(resolveColorEnabled(true), true);
    });

    it("🔴 `NO_COLOR` gagne SUR un terminal — c'est une convention publique", () => {
      env({ NO_COLOR: "1" });
      assert.equal(resolveColorEnabled(true), false);
    });

    it("🔴 `FORCE_COLOR` gagne HORS terminal — c'est ce qui rend une sortie capturable", () => {
      env({ FORCE_COLOR: "1" });
      assert.equal(resolveColorEnabled(false), true);
    });

    it("`NO_COLOR` l'emporte sur `FORCE_COLOR` — le refus prime", () => {
      env({ NO_COLOR: "1", FORCE_COLOR: "1" });
      assert.equal(resolveColorEnabled(true), false);
    });

    it("`FORCE_COLOR=0` ne force rien — c'est la forme documentée du retrait", () => {
      env({ FORCE_COLOR: "0" });
      assert.equal(resolveColorEnabled(false), false);
    });
  });

  describe("ce que la mise en forme produit", () => {
    it("colorée, elle enveloppe de séquences ANSI qui se referment", () => {
      const s = styleFor(true);
      assert.equal(s.green("ok"), "[32mok[0m");
      assert.equal(s.bold("ok"), "[1mok[0m");
    });

    it("neutralisée, elle rend le texte NU — jamais une séquence orpheline", () => {
      // Une séquence non fermée dans un fichier de journal le corrompt pour
      // tout ce qui suit ; ne rien émettre est la seule sortie sûre.
      const s = styleFor(false);
      assert.equal(s.green("ok"), "ok");
      assert.equal(s.red(s.bold("ok")), "ok");
    });
  });
});
