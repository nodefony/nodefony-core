import { expect } from "chai";
import {
  navigateSchemaNode,
  nodeFlags,
  notEditableReason,
  validateLeafValue,
  recipeFor,
  getResolvedPath,
  type IJsonSchemaNode,
} from "../../src/configMutation.js";

// JSON Schema représentatif (forme `z.toJSONSchema` + flags `meta()` au top-level).
const schema: IJsonSchemaNode = {
  type: "object",
  properties: {
    headerServer: {
      type: ["string", "null"],
      default: "nodefony",
      runtimeMutable: true,
    },
    http3: { type: "boolean", default: true, reserved: true },
    logLevel: { enum: ["debug", "info", "warn"], runtimeMutable: true },
    jwt: {
      type: "object",
      properties: {
        secret: { type: "string", secret: true },
        accessTtlS: {
          type: "integer",
          minimum: 60,
          maximum: 3600,
          runtimeMutable: true,
        },
      },
    },
    derived: { type: "string", kernelDerived: true },
    name: { type: "string", minLength: 2, maxLength: 8, runtimeMutable: true },
    nullableNum: {
      anyOf: [{ type: "number" }, { type: "null" }],
      runtimeMutable: true,
    },
  },
};

describe("configMutation — navigateSchemaNode", () => {
  it("résout un champ de premier niveau", () => {
    const n = navigateSchemaNode(schema, ["headerServer"]);
    expect(n?.runtimeMutable).to.equal(true);
  });

  it("résout un champ imbriqué (jwt.accessTtlS)", () => {
    const n = navigateSchemaNode(schema, ["jwt", "accessTtlS"]);
    expect(n?.maximum).to.equal(3600);
  });

  it("est insensible à la casse", () => {
    const n = navigateSchemaNode(schema, ["JWT", "ACCESSTTLS"]);
    expect(n?.minimum).to.equal(60);
  });

  it("renvoie null sur un chemin inconnu", () => {
    expect(navigateSchemaNode(schema, ["nope"])).to.equal(null);
    expect(navigateSchemaNode(schema, ["jwt", "nope"])).to.equal(null);
  });

  it("renvoie null sur un schéma absent", () => {
    expect(navigateSchemaNode(null, ["x"])).to.equal(null);
  });
});

describe("configMutation — nodeFlags / notEditableReason", () => {
  it("extrait les flags", () => {
    expect(nodeFlags({ secret: true })).to.deep.equal({
      runtimeMutable: false,
      reserved: false,
      kernelDerived: false,
      secret: true,
    });
  });

  it("refuse secret en priorité", () => {
    expect(
      notEditableReason({
        runtimeMutable: true,
        reserved: true,
        kernelDerived: true,
        secret: true,
      }),
    ).to.equal("secret");
  });

  it("ordre réservé > dérivé > boot", () => {
    expect(
      notEditableReason({
        runtimeMutable: true,
        reserved: true,
        kernelDerived: true,
        secret: false,
      }),
    ).to.equal("reserved");
    expect(
      notEditableReason({
        runtimeMutable: true,
        reserved: false,
        kernelDerived: true,
        secret: false,
      }),
    ).to.equal("kernel_derived");
    expect(
      notEditableReason({
        runtimeMutable: false,
        reserved: false,
        kernelDerived: false,
        secret: false,
      }),
    ).to.equal("boot_only");
  });

  it("null quand runtimeMutable seul", () => {
    expect(
      notEditableReason({
        runtimeMutable: true,
        reserved: false,
        kernelDerived: false,
        secret: false,
      }),
    ).to.equal(null);
  });
});

describe("configMutation — validateLeafValue", () => {
  const node = (p: string[]) =>
    navigateSchemaNode(schema, p) as IJsonSchemaNode;

  it("enum : accepte une valeur listée, rejette le reste", () => {
    expect(validateLeafValue(node(["logLevel"]), "info").ok).to.equal(true);
    const bad = validateLeafValue(node(["logLevel"]), "trace");
    expect(bad.ok).to.equal(false);
  });

  it("type multiple (string|null) : accepte string ET null", () => {
    expect(validateLeafValue(node(["headerServer"]), "x").ok).to.equal(true);
    expect(validateLeafValue(node(["headerServer"]), null).ok).to.equal(true);
    expect(validateLeafValue(node(["headerServer"]), 42).ok).to.equal(false);
  });

  it("integer + bornes", () => {
    expect(validateLeafValue(node(["jwt", "accessTtlS"]), 300).ok).to.equal(
      true,
    );
    expect(validateLeafValue(node(["jwt", "accessTtlS"]), 30).ok).to.equal(
      false,
    );
    expect(validateLeafValue(node(["jwt", "accessTtlS"]), 99999).ok).to.equal(
      false,
    );
    expect(validateLeafValue(node(["jwt", "accessTtlS"]), 3.5).ok).to.equal(
      false,
    );
  });

  it("string + longueur", () => {
    expect(validateLeafValue(node(["name"]), "bob").ok).to.equal(true);
    expect(validateLeafValue(node(["name"]), "a").ok).to.equal(false);
    expect(validateLeafValue(node(["name"]), "trop-long-vraiment").ok).to.equal(
      false,
    );
  });

  it("union anyOf (number|null)", () => {
    expect(validateLeafValue(node(["nullableNum"]), 7).ok).to.equal(true);
    expect(validateLeafValue(node(["nullableNum"]), null).ok).to.equal(true);
    expect(validateLeafValue(node(["nullableNum"]), "x").ok).to.equal(false);
  });

  it("boolean", () => {
    expect(validateLeafValue(node(["http3"]), false).ok).to.equal(true);
    expect(validateLeafValue(node(["http3"]), "false").ok).to.equal(false);
  });
});

describe("configMutation — recipeFor", () => {
  it("recette env standard", () => {
    expect(recipeFor("http", ["jwt", "accessTtlS"], false)).to.equal(
      "NF__HTTP__JWT__ACCESSTTLS=<valeur>",
    );
  });

  it("recette *_FILE pour un secret", () => {
    expect(recipeFor("security", ["jwt", "secret"], true)).to.equal(
      "NF__SECURITY__JWT__SECRET__FILE=/run/secrets/jwt_secret",
    );
  });
});

describe("configMutation — getResolvedPath", () => {
  const cfg = { headerServer: "nodefony", jwt: { accessTtlS: 900 } };

  it("lit une valeur imbriquée", () => {
    expect(getResolvedPath(cfg, ["jwt", "accessTtlS"])).to.equal(900);
  });

  it("insensible à la casse", () => {
    expect(getResolvedPath(cfg, ["JWT", "ACCESSTTLS"])).to.equal(900);
  });

  it("undefined si absent", () => {
    expect(getResolvedPath(cfg, ["nope"])).to.equal(undefined);
    expect(getResolvedPath(cfg, ["jwt", "nope"])).to.equal(undefined);
  });
});
