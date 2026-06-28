import assert from "node:assert";

import {
  computeConfigProvenance,
  extractJsonSchemaDefaults,
} from "../config/configProvenance";
import { defaultAppConfig } from "../config/defaults";

describe("configProvenance — computeConfigProvenance", () => {
  it("classe chaque feuille : default / app / env", () => {
    const defaults = {
      jwt: { accessTtlS: 900, alg: "EdDSA" },
      cors: { maxAgeS: 600 },
    };
    const resolved = {
      jwt: { accessTtlS: 300, alg: "EdDSA" },
      cors: { maxAgeS: 600 },
    };
    const env = new Set(["jwt.accessttls"]); // surchargé par NF__…__JWT__ACCESSTTLS
    const prov = computeConfigProvenance(resolved, defaults, env);
    assert.strictEqual(prov["jwt.accessTtlS"], "env"); // dans envPaths
    assert.strictEqual(prov["jwt.alg"], "default"); // == défaut
    assert.strictEqual(prov["cors.maxAgeS"], "default");
  });

  it("valeur différente du défaut sans env → app", () => {
    const prov = computeConfigProvenance(
      { jwt: { accessTtlS: 120 } },
      { jwt: { accessTtlS: 900 } },
      new Set(),
    );
    assert.strictEqual(prov["jwt.accessTtlS"], "app");
  });

  it("champ présent côté résolu mais absent du défaut → app", () => {
    const prov = computeConfigProvenance(
      { jwt: { issuer: "https://api" } },
      { jwt: {} },
      new Set(),
    );
    assert.strictEqual(prov["jwt.issuer"], "app");
  });

  it("tableaux comparés par valeur (égal → default)", () => {
    const prov = computeConfigProvenance(
      { cors: { origins: ["a", "b"] } },
      { cors: { origins: ["a", "b"] } },
      new Set(),
    );
    assert.strictEqual(prov["cors.origins"], "default");
  });
});

describe("configProvenance — extractJsonSchemaDefaults", () => {
  it("walk les properties + prend les default (imbriqués)", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "number", default: 1 },
        b: {
          type: "object",
          properties: { c: { type: "number", default: 2 } },
        },
      },
    };
    assert.deepStrictEqual(extractJsonSchemaDefaults(schema), {
      a: 1,
      b: { c: 2 },
    });
  });

  it("prend le default d'un objet entier quand présent", () => {
    const schema = {
      type: "object",
      properties: {
        cors: { type: "object", default: { enabled: true, maxAgeS: 600 } },
      },
    };
    assert.deepStrictEqual(extractJsonSchemaDefaults(schema), {
      cors: { enabled: true, maxAgeS: 600 },
    });
  });

  it("schéma absent / non-objet → {}", () => {
    assert.deepStrictEqual(extractJsonSchemaDefaults(null), {});
    assert.deepStrictEqual(extractJsonSchemaDefaults({ type: "string" }), {});
  });
});

/**
 * Scénario APP (carte Studio `isApp`) : reproduit le calcul du data plane
 * `KernelAdminApi` pour la config de l'application — défauts = `defaultAppConfig`
 * (le schéma app DÉCRIT sans `.default()`, donc `extractJsonSchemaDefaults` serait
 * vide → tout en "app") et env = chemins `NF__APP__*`. Garde l'origine correcte.
 */
describe("configProvenance — scénario APP (defaultAppConfig + NF__APP__*)", () => {
  it("default / app / env sur la config app réelle", () => {
    const resolved = structuredClone(defaultAppConfig) as unknown as {
      domain: string;
      servers: { http: { port: number } };
    };
    resolved.domain = "0.0.0.0"; // surchargé par l'app (≠ défaut "localhost")
    resolved.servers.http.port = 8080; // surchargé par NF__APP__SERVERS__HTTP__PORT
    // log.driver reste "stdout" (défaut)
    const prov = computeConfigProvenance(
      resolved as unknown as Record<string, unknown>,
      defaultAppConfig as unknown as Record<string, unknown>,
      new Set(["servers.http.port"]),
    );
    assert.strictEqual(prov["domain"], "app");
    assert.strictEqual(prov["servers.http.port"], "env");
    assert.strictEqual(prov["log.driver"], "default");
  });
});
