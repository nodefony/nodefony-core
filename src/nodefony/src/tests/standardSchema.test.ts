/*
 *   NODEFONY FRAMEWORK UNIT TEST
 *   Standard Schema — copie des types, garde, normalisation des anomalies
 */

import { expect, expectTypeOf } from "vitest";
import { z } from "zod";
import {
  isStandardSchema,
  SchemaValidationError,
  standardJsonSchemaOf,
  toSchemaValidationIssues,
} from "../runtime/standardSchema";
import type {
  IStandardSchemaV1,
  InferSchemaOutput,
} from "../runtime/standardSchema";

describe("Standard Schema — la copie des types", () => {
  it("un schéma Zod satisfait l'interface sans import de la spécification", () => {
    const schema = z.object({ title: z.string(), n: z.coerce.number() });
    expectTypeOf(schema).toExtend<IStandardSchemaV1>();
    expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
      title: string;
      n: number;
    }>();
  });

  it("isStandardSchema reconnaît Zod et refuse le reste", () => {
    expect(isStandardSchema(z.string())).to.equal(true);
    expect(isStandardSchema({})).to.equal(false);
    expect(isStandardSchema(null)).to.equal(false);
    expect(
      isStandardSchema({ "~standard": { version: 2, validate() {} } }),
    ).to.equal(false);
    expect(isStandardSchema({ "~standard": { version: 1 } })).to.equal(false);
  });

  it("standardJsonSchemaOf rend le convertisseur de Zod, null sinon", () => {
    const converter = standardJsonSchemaOf(z.object({ a: z.string() }));
    expect(converter).to.not.equal(null);
    const json = converter?.input({ target: "draft-2020-12" });
    expect(json).to.have.property("type", "object");
    const bare: IStandardSchemaV1 = {
      "~standard": { version: 1, vendor: "x", validate: (v) => ({ value: v }) },
    };
    expect(standardJsonSchemaOf(bare)).to.equal(null);
  });

  it("une valeur binaire est validée telle quelle, sans copie", () => {
    // Le codec binaire futur (#618) décode vers `Uint8Array` : le schéma
    // reçoit la valeur décodée, jamais une forme sérialisée.
    const bytes = new Uint8Array([1, 2, 3]);
    const result = z.instanceof(Uint8Array)["~standard"].validate(bytes);
    if (result instanceof Promise)
      throw new Error("validation synchrone attendue");
    expect(result.issues).to.equal(undefined);
    expect(result).to.have.property("value", bytes);
  });
});

describe("toSchemaValidationIssues — normalisation", () => {
  it("déplie les segments objet, convertit les clés, rattache la partie", () => {
    const sym = Symbol("s");
    const issues = toSchemaValidationIssues(
      [
        { message: "requis", path: ["author", { key: "email" }] },
        { message: "index", path: [0, { key: sym }] },
        { message: "racine" },
      ],
      "body",
    );
    expect(issues).to.deep.equal([
      { message: "requis", path: ["author", "email"], in: "body" },
      { message: "index", path: ["0", "Symbol(s)"], in: "body" },
      { message: "racine", path: [], in: "body" },
    ]);
  });

  it("normalise les anomalies réelles de Zod", () => {
    const schema = z.object({ email: z.email() });
    const result = schema["~standard"].validate({ email: "x" });
    if (result instanceof Promise || result.issues === undefined) {
      throw new Error("échec synchrone attendu");
    }
    const issues = toSchemaValidationIssues(result.issues, "query");
    expect(issues[0]).to.include({ in: "query" });
    expect(issues[0]?.path).to.deep.equal(["email"]);
  });
});

describe("SchemaValidationError", () => {
  it("porte le statut 422, son nom et un message qui situe chaque champ", () => {
    const error = new SchemaValidationError([
      { message: "trop court", path: ["title"], in: "body" },
      { message: "entier attendu", path: ["limit"], in: "query" },
    ]);
    expect(error).to.be.instanceOf(Error);
    expect(error.name).to.equal("SchemaValidationError");
    expect(error.code).to.equal(422);
    expect(error.message).to.equal(
      "Validation failed — body.title: trop court · query.limit: entier attendu",
    );
  });
});
