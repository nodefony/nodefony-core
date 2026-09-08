/**
 * **Le catalogue rend ce qu'on a le droit d'écrire — pas ce qui est écrit.**
 *
 * Ces contrôles portent sur la fonction PURE : un JSON Schema entre, une liste
 * de réglages sort. Le croisement avec les valeurs effectives et leur
 * provenance vit dans le plan d'administration, et se prouve ailleurs.
 *
 * Les schémas de ces cas sont écrits à la main, dans la forme exacte que
 * `z.toJSONSchema()` produit — vérifiée sur la sortie réelle de
 * `@nodefony/http`. Un décor construit en appelant zod ne prouverait que la
 * cohérence de la lecture avec elle-même.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { flattenConfigSchema } from "../config/schemaCatalog";

describe("catalogue des réglages d'un schéma de configuration", () => {
  it("rend une ligne par feuille, avec son chemin pointé", () => {
    const catalogue = flattenConfigSchema({
      type: "object",
      properties: {
        certificates: {
          type: "object",
          properties: {
            selfSigned: {
              type: "object",
              properties: {
                size: { type: "number", default: 2048 },
                hash: { type: "string", enum: ["sha256", "sha512"] },
              },
            },
          },
        },
      },
    });
    assert.deepEqual(
      catalogue.map((l) => l.key),
      ["certificates.selfSigned.size", "certificates.selfSigned.hash"],
    );
  });

  it("ne donne PAS de ligne aux sections — on ne leur assigne pas de valeur", () => {
    const catalogue = flattenConfigSchema({
      type: "object",
      properties: {
        session: {
          type: "object",
          description: "Sessions HTTP.",
          properties: { name: { type: "string", default: "nodefony" } },
        },
      },
    });
    assert.deepEqual(
      catalogue.map((l) => l.key),
      ["session.name"],
      "la section `session` ne se règle pas, seule sa feuille se règle",
    );
  });

  it("traite un objet LIBRE comme une feuille — il se règle d'un bloc", () => {
    // `z.looseObject({})` : ce qu'on écrit part tel quel dans une bibliothèque
    // tierce (`node:http`). Le schéma ne déclare aucune sous-propriété, et
    // c'est bien une clé assignable — la rater priverait l'utilisateur des
    // options de la lib.
    const catalogue = flattenConfigSchema({
      type: "object",
      properties: {
        http: {
          type: "object",
          properties: {},
          additionalProperties: true,
          description: "Options `http.Server` supplémentaires.",
        },
      },
    });
    assert.deepEqual(
      catalogue.map((l) => l.key),
      ["http"],
    );
    assert.equal(catalogue[0].type, "object");
  });

  it("rend une énumération par ses VALEURS, pas par son type", () => {
    // `string` ne dit pas qu'on ne peut écrire que ces trois-là — et c'est
    // exactement ce qu'on a besoin de savoir avant d'écrire la clé.
    const [hash] = flattenConfigSchema({
      type: "object",
      properties: {
        hash: { type: "string", enum: ["sha256", "sha384", "sha512"] },
      },
    });
    assert.equal(hash.type, "sha256|sha384|sha512");
  });

  it("porte la description du schéma, et la chaîne vide quand il n'y en a pas", () => {
    const catalogue = flattenConfigSchema({
      type: "object",
      properties: {
        avec: { type: "string", description: "Ce que fait la clé." },
        sans: { type: "string" },
      },
    });
    assert.equal(catalogue[0].description, "Ce que fait la clé.");
    assert.equal(catalogue[1].description, "");
  });

  it("distingue « défaut absent » de « défaut nul »", () => {
    // Un `default: null` est une DÉCISION du schéma (« laisse le framework
    // choisir ») ; une clé sans défaut est optionnelle et ne vaut rien tant
    // qu'on ne l'écrit pas. Les confondre ferait croire qu'une valeur est
    // posée là où il n'y en a aucune.
    const catalogue = flattenConfigSchema({
      type: "object",
      properties: {
        nul: { type: "number", default: null },
        absent: { type: "number" },
      },
    });
    assert.isTrue("default" in catalogue[0]);
    assert.strictEqual(catalogue[0].default, null);
    assert.isFalse("default" in catalogue[1]);
  });

  it("nomme les métadonnées Nodefony — c'est ce qui évite de régler un champ INERTE", () => {
    const catalogue = flattenConfigSchema({
      type: "object",
      properties: {
        http3: { type: "object", reserved: true, properties: {} },
        secret: { type: "string", secret: true },
        derive: { type: "array", kernelDerived: true },
        ordinaire: { type: "string" },
      },
    });
    assert.deepEqual(
      catalogue.map((l) => l.note),
      ["réservé", "secret", "dérivé du kernel", ""],
    );
  });

  it("rend un tableau VIDE plutôt que de lever, sur une forme non navigable", () => {
    // Un module non migré rend `null` ; un schéma d'une forme qu'on ne
    // comprend pas ne doit pas casser l'inspection des autres.
    assert.deepEqual(flattenConfigSchema(null), []);
    assert.deepEqual(flattenConfigSchema(undefined), []);
    assert.deepEqual(flattenConfigSchema("pas un schéma"), []);
    assert.deepEqual(flattenConfigSchema({ type: "object" }), []);
  });
});
