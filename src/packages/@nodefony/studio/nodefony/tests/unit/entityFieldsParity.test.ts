/**
 * Unit — l'éditeur de champs de Studio écrit la MÊME grammaire que la commande.
 *
 * L'écran compose des lignes et les sérialise (`serializeField`) ; seul
 * l'analyseur du générateur (`parseEntityFields`) juge. Deux grammaires
 * divergeraient en silence : ce test fait passer chaque combinaison que l'écran
 * sait produire par le VRAI analyseur, et exige d'y retrouver l'intention de la
 * ligne — type, facultatif, unicité, index, taille, cible, valeurs, défaut.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import {
  ENTITY_FIELD_TYPES,
  formatEntityField,
  parseEntityFields,
} from "nodefony";
import {
  NO_DEFAULT_TYPES,
  emptyFieldRow,
  fieldNamesOf,
  serializeField,
  serializeFields,
  type IFieldRow,
} from "../../../frontend/src/routes/create/createModel";

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

const row = (change: Partial<IFieldRow>): IFieldRow => ({
  ...emptyFieldRow(1),
  name: "champ",
  ...change,
});

describe("Créer — éditeur de champs : la sérialisation passe le VRAI analyseur", () => {
  it("chaque type × facultatif × unique × indexé × défaut rend l'intention de la ligne", () => {
    const types = [...ENTITY_FIELD_TYPES, "ref"];
    let checked = 0;
    for (const type of types) {
      for (const nullable of [false, true]) {
        for (const mode of ["", "unique", "indexed"] as const) {
          for (const withDefault of [false, true]) {
            const r = row({
              type,
              nullable,
              unique: mode === "unique",
              indexed: mode === "indexed",
              length: type === "string" ? "120" : type === "char" ? "2" : "",
              precision: type === "decimal" ? "10" : "",
              scale: type === "decimal" ? "2" : "",
              values: type === "enum" ? ["a", "b"] : [],
              target: type === "ref" ? "User" : "",
              defaultValue: withDefault ? (DEFAULTS[type] ?? "x") : "",
            });
            const text = serializeField(r) ?? "";
            const [parsed] = parseEntityFields(text);
            const label = JSON.stringify({ text });
            expect(parsed?.type, label).to.equal(type);
            expect(parsed?.nullable, label).to.equal(nullable);
            expect(parsed?.unique, label).to.equal(mode === "unique");
            if (type !== "ref" && mode !== "unique") {
              expect(parsed?.indexed, label).to.equal(mode === "indexed");
            }
            if (type === "string") expect(parsed?.length, label).to.equal(120);
            if (type === "char") expect(parsed?.length, label).to.equal(2);
            if (type === "enum")
              expect(parsed?.values, label).to.deep.equal(["a", "b"]);
            if (type === "ref") expect(parsed?.target, label).to.equal("User");
            if (withDefault && !NO_DEFAULT_TYPES.has(type)) {
              expect(parsed?.defaultValue, label).to.equal(DEFAULTS[type]);
            }
            // Un seul écrivain de référence : le cœur. L'écran écrit la même
            // ligne, au `:index` près d'une relation — indexée d'office, la
            // forme canonique ne l'écrit pas.
            if (!(type === "ref" && mode === "indexed")) {
              expect(formatEntityField(parsed!), label).to.equal(text);
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).to.equal(types.length * 12);
  });

  it("les types SANS défaut de l'écran sont exactement ceux que l'analyseur refuse", () => {
    /** Le type sous une forme que l'analyseur accepte SANS défaut. */
    const form = (type: string): string =>
      type === "ref"
        ? "ref:User"
        : type === "enum"
          ? "enum(a,b)"
          : type === "char"
            ? "char(2)"
            : type === "decimal"
              ? "decimal(10,2)"
              : type;
    const refused = [...ENTITY_FIELD_TYPES, "ref"].filter((type) => {
      try {
        parseEntityFields(`champ:${form(type)}=a`);
        return false;
      } catch {
        return true;
      }
    });
    // `int`/`float`/`bool`/`uuid`/`decimal`/`char` refusent « a » pour une autre
    // raison (valeur du mauvais type) : on ne garde que le refus de PRINCIPE.
    const byPrinciple = refused.filter((type) => {
      const valid = DEFAULTS[type];
      if (!valid) return true;
      try {
        parseEntityFields(`champ:${form(type)}=${valid}`);
        return false;
      } catch {
        return true;
      }
    });
    expect([...byPrinciple].sort()).to.deep.equal([...NO_DEFAULT_TYPES].sort());
  });

  it("un décimal choisi dans l'écran porte TOUJOURS sa précision (sinon refusé)", () => {
    // La forme nue est refusée par l'analyseur : l'écran ne doit jamais l'envoyer.
    expect(() => parseEntityFields("prix:decimal")).to.throw();
    const text = serializeField(
      row({ name: "prix", type: "decimal", precision: "10", scale: "2" }),
    );
    expect(text).to.equal("prix:decimal(10,2)");
    expect(() => parseEntityFields(text ?? "")).not.to.throw();
  });

  it("une ligne sans nom n'est pas envoyée ; les noms se relisent pour les index", () => {
    const text = serializeFields([
      row({ name: "titre", type: "string" }),
      row({ name: "   " }),
      row({ name: "auteur", type: "ref", target: "User", nullable: true }),
    ]);
    expect(text).to.equal("titre:string auteur:ref:User?");
    expect(parseEntityFields(text)).to.have.length(2);
    expect(fieldNamesOf(text)).to.deep.equal(["titre", "auteur"]);
  });
});
