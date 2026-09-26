/**
 * Unit — composer les champs d'une entité sans connaître la grammaire (#471).
 *
 * Trois étages : l'ÉCRIVAIN de la grammaire (`formatEntityField`) défait
 * exactement ce que l'analyseur fait ; le COMPOSITEUR rend la ligne qu'on aurait
 * tapée et laisse l'analyseur juger ; le DIALOGUE réel (`askMissing`, readline
 * sur flux simulés) passe par le compositeur pour la question `fields`.
 */
import { assert } from "chai";
import { PassThrough } from "node:stream";
import { describe, it } from "vitest";
import {
  ENTITY_FIELD_TYPES,
  formatEntityField,
  parseEntityFields,
} from "../cli/scaffold/entityFields";
import {
  composeEntityFields,
  type TAskQuestion,
} from "../cli/scaffold/entityFieldsDialog";
import { askMissing } from "../cli/scaffold/interactive";
import { getScaffoldSpec } from "../cli/scaffold/spec";

/** La forme minimale d'un type que l'analyseur accepte. */
const typeForm = (type: string): string =>
  type === "ref"
    ? "ref:User"
    : type === "enum"
      ? "enum(a,b)"
      : type === "char"
        ? "char(2)"
        : type === "decimal"
          ? "decimal(12,2)"
          : type;

/** Un défaut valide pour chaque type qui en accepte un. */
const DEFAULTS: Record<string, string> = {
  string: "abc",
  text: "abc",
  int: "3",
  float: "1.5",
  bool: "true",
  uuid: "00000000-0000-4000-8000-000000000001",
  enum: "a",
  char: "AB",
  decimal: "12.50",
};

describe("formatEntityField — l'inverse exact de parseEntityFields", () => {
  it("aller-retour : chaque type × facultatif × contrainte × défaut", () => {
    let checked = 0;
    for (const type of [...ENTITY_FIELD_TYPES, "ref"]) {
      for (const nullable of ["", "?"]) {
        for (const constraint of ["", ":index", ":unique"]) {
          for (const def of ["", DEFAULTS[type] ?? ""]) {
            const line = `champ:${typeForm(type)}${nullable}${def ? `=${def}` : ""}${constraint}`;
            const [parsed] = parseEntityFields(line);
            const written = formatEntityField(parsed);
            assert.deepEqual(parseEntityFields(written), [parsed], line);
            // Forme canonique : elle se relit identique à elle-même.
            assert.equal(
              formatEntityField(parseEntityFields(written)[0]),
              written,
            );
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, (ENTITY_FIELD_TYPES.length + 1) * 12);
  });

  it("tailles et relation : la forme écrite est celle qu'on tape", () => {
    assert.equal(
      formatEntityField(parseEntityFields("titre:string(200)?")[0]),
      "titre:string(200)?",
    );
    assert.equal(
      formatEntityField(parseEntityFields("prix:decimal(10,2)=0:index")[0]),
      "prix:decimal(10,2)=0:index",
    );
    // Une relation est indexée d'office : son `:index` ne s'écrit pas.
    assert.equal(
      formatEntityField(parseEntityFields("auteur:ref:User:index")[0]),
      "auteur:ref:User",
    );
  });
});

/** Un `ask` scripté : chaque question consomme la réponse suivante de SA clé. */
function scriptedAsk(replies: Record<string, Array<string | boolean>>): {
  ask: TAskQuestion;
  asked: string[];
} {
  const asked: string[] = [];
  const ask: TAskQuestion = async (q) => {
    asked.push(q.key);
    const queue = replies[q.key];
    if (!queue || queue.length === 0) return q.default;
    return queue.shift()!;
  };
  return { ask, asked };
}

describe("composeEntityFields — un champ à la fois", () => {
  it("compose une ligne que l'analyseur accepte, et la montre en récapitulatif", async () => {
    const { ask } = scriptedAsk({
      fieldName: ["titre", "prix", "statut", "auteur", ""],
      fieldType: ["string", "decimal", "enum", "ref"],
      length: ["200"],
      precision: ["10"],
      scale: ["2"],
      values: ["brouillon, publie"],
      target: ["User"],
      nullable: [false, false, false, true],
      constraint: ["unique", "index", "none"],
      unique: [false],
      defaultValue: ["", "0", "brouillon"],
    });
    const out = new PassThrough();
    let written = "";
    out.on("data", (c: Buffer) => (written += c.toString()));
    const fields = await composeEntityFields(ask, out, ["User"], "Post");
    assert.equal(
      fields,
      "titre:string(200):unique prix:decimal(10,2)=0:index " +
        "statut:enum(brouillon,publie)=brouillon auteur:ref:User?",
    );
    assert.lengthOf(parseEntityFields(fields), 4);
    assert.include(
      written,
      `Ligne équivalente : nodefony create entity Post ${fields}`,
    );
  });

  it("un refus de l'analyseur est AFFICHÉ et le champ se recompose", async () => {
    const { ask } = scriptedAsk({
      fieldName: ["titre", "titre", "resume", ""],
      fieldType: ["string", "string", "text"],
      constraint: ["none", "none", "none"],
      defaultValue: ["", "", ""],
    });
    const out = new PassThrough();
    let written = "";
    out.on("data", (c: Buffer) => (written += c.toString()));
    const fields = await composeEntityFields(ask, out, [], "Post");
    assert.equal(fields, "titre:string resume:text");
    assert.include(written, "« titre » déclaré deux fois");
  });

  it("aucune question de défaut pour json, date ni ref ; aucune taille pour text", async () => {
    const { ask, asked } = scriptedAsk({
      fieldName: ["meta", "vu", "corps", ""],
      fieldType: ["json", "date", "text"],
    });
    const fields = await composeEntityFields(
      ask,
      new PassThrough(),
      [],
      "Post",
    );
    assert.equal(fields, "meta:json vu:date corps:text");
    assert.equal(asked.filter((k) => k === "defaultValue").length, 1); // text seul
    assert.notInclude(asked, "length");
  });

  it("aucun champ : réponse vide, pas de récapitulatif", async () => {
    const { ask } = scriptedAsk({ fieldName: [""] });
    const out = new PassThrough();
    let written = "";
    out.on("data", (c: Buffer) => (written += c.toString()));
    assert.equal(await composeEntityFields(ask, out, [], "Post"), "");
    assert.notInclude(written, "Ligne équivalente");
  });
});

describe("askMissing — la question `fields` passe par le compositeur", () => {
  it("dialogue readline réel : la grammaire n'est jamais demandée", async () => {
    const [spec] = getScaffoldSpec("entity");
    // Toutes les autres questions sont déjà répondues : seule `fields` se pose.
    const partial = Object.fromEntries(
      spec.questions
        .filter((q) => q.key !== "fields")
        .map((q) => [q.key, q.key === "name" ? "Post" : q.default]),
    );
    const input = new PassThrough();
    const output = new PassThrough();
    let written = "";
    // nom · type (1 = string) · longueur (vide) · facultatif (o) · contrainte
    // (1 = aucune) · défaut (vide) · nom vide = terminer
    const queue = ["titre", "1", "", "o", "1", "", ""];
    output.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      written += text;
      if (/[:\]] $/u.test(text) && queue.length > 0) {
        input.write(`${queue.shift()}\n`);
      }
    });
    const answers = await askMissing(
      spec,
      partial,
      { hasCheckout: false },
      input,
      output,
    );
    assert.equal(answers.fields, "titre:string?");
    assert.notInclude(written, "nom:type");
    assert.include(
      written,
      "Ligne équivalente : nodefony create entity Post titre:string?",
    );
  });
});
