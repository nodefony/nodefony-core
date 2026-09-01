import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { assertUserContract } from "@nodefony/user";
import {
  userSchema,
  DOCUMENT_USER_COLUMNS,
} from "../../nodefony/entity/userEntity";

/**
 * Le contrôle de contrat appliqué à un schéma DOCUMENT doit exiger ce que ce
 * stockage porte en propre — ni plus, ni moins.
 *
 * Les deux erreurs se paient différemment. Exiger trop (la clé, les
 * horodatages, que le moteur fournit) refuserait une entité correcte : un refus
 * faux au démarrage apprend surtout à passer outre les refus. Exiger trop peu
 * laisserait passer le manque que ce contrôle existe pour attraper.
 */
describe("contrat utilisateur — ce qu'un schéma document doit porter", () => {
  it("n'exige QUE les champs que la dérivation produit", () => {
    assert.deepEqual(
      DOCUMENT_USER_COLUMNS.map((column) => column.name).sort(),
      Object.keys(userSchema).sort(),
      "la liste exigée doit être dérivée du schéma produit, jamais recopiée",
    );
    // La clé et les horodatages appartiennent au moteur — les exiger comme
    // chemins refuserait toute entité document, y compris celle du framework.
    const names = new Set(DOCUMENT_USER_COLUMNS.map((column) => column.name));
    assert.ok(!names.has("id"), "`id` est servi par le virtuel sur `_id`");
    assert.ok(
      !names.has("createdAt") && !names.has("updatedAt"),
      "les horodatages viennent de l'option `timestamps`",
    );
  });

  it("REFUSE un schéma amputé, en nommant le champ ET son lecteur", () => {
    const paths = Object.keys(userSchema).filter((name) => name !== "roles");
    assert.throws(
      () =>
        assertUserContract(paths, "L'entité de test", DOCUMENT_USER_COLUMNS),
      (error: Error) => {
        assert.match(error.message, /\broles\b/u);
        assert.match(error.message, /countActiveAdmins|role=/u);
        assert.match(error.message, /orm:generate/u);
        return true;
      },
    );
  });

  it("LAISSE PASSER le schéma que le framework produit lui-même", () => {
    assert.doesNotThrow(() =>
      assertUserContract(
        Object.keys(userSchema),
        "L'entité de repli",
        DOCUMENT_USER_COLUMNS,
      ),
    );
  });
});
