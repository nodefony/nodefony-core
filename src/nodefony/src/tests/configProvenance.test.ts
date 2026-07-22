import assert from "node:assert";

import {
  computeConfigProvenance,
  extractJsonSchemaDefaults,
  findSetReservedKeys,
} from "../config/configProvenance";
import { defaultAppConfig } from "../config/defaults";

// JSON Schema fabriqué à la main reproduisant la forme réelle (z.toJSONSchema) :
// un bloc `webhooks` non réservé contenant deux feuilles réservées + une active,
// et une feuille réservée à la racine. Autonome (0 import cross-package).
const RESERVED_SCHEMA = {
  type: "object",
  properties: {
    webhooks: {
      type: "object",
      properties: {
        signAlg: {
          type: "string",
          default: "sha256",
          reserved: true,
          description: "INERTE — algo fixé HMAC-SHA256.",
        },
        timestampToleranceS: {
          type: "number",
          default: 300,
          reserved: true,
          description: "INERTE côté émetteur — fenêtre du récepteur.",
        },
        maxRetries: { type: "number", default: 5 }, // active, non réservée
      },
    },
    immutable: {
      type: "boolean",
      default: true,
      reserved: true,
      description: "INERTE — vient du contrat IAuditStore.",
    },
  },
};

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

describe("configProvenance — findSetReservedKeys (filet clé réservée au boot)", () => {
  it("signale une clé réservée NESTED posée à une valeur non-défaut, avec sa description", () => {
    const resolved = {
      webhooks: { signAlg: "sha256", timestampToleranceS: 600, maxRetries: 5 },
      immutable: true,
    };
    const hits = findSetReservedKeys(RESERVED_SCHEMA, resolved);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0]!.path, "webhooks.timestampToleranceS");
    assert.match(hits[0]!.description, /INERTE côté émetteur/);
  });

  it("ne signale RIEN quand toutes les clés réservées sont à leur défaut", () => {
    const resolved = {
      webhooks: { signAlg: "sha256", timestampToleranceS: 300, maxRetries: 5 },
      immutable: true,
    };
    assert.deepStrictEqual(findSetReservedKeys(RESERVED_SCHEMA, resolved), []);
  });

  it("ne signale PAS une clé ACTIVE (non réservée) posée à une valeur non-défaut", () => {
    const resolved = {
      webhooks: { signAlg: "sha256", timestampToleranceS: 300, maxRetries: 99 },
      immutable: true,
    };
    assert.deepStrictEqual(findSetReservedKeys(RESERVED_SCHEMA, resolved), []);
  });

  it("cumule plusieurs clés réservées déviées (racine + nested)", () => {
    const resolved = {
      webhooks: { signAlg: "sha256", timestampToleranceS: 42, maxRetries: 5 },
      immutable: false,
    };
    const paths = findSetReservedKeys(RESERVED_SCHEMA, resolved)
      .map((h) => h.path)
      .sort();
    assert.deepStrictEqual(paths, [
      "immutable",
      "webhooks.timestampToleranceS",
    ]);
  });

  it("schéma null / non exploitable → aucune entrée (module non migré)", () => {
    assert.deepStrictEqual(findSetReservedKeys(null, {}), []);
    assert.deepStrictEqual(findSetReservedKeys({}, {}), []);
  });

  it("config PARTIELLE (clé absente) → pas de faux positif (absent ≠ posé)", () => {
    // `immutable` absent de la config résolue : ne DOIT PAS être signalé même si
    // son défaut (true) « diffère » de undefined. Robustesse au desync.
    const resolved = { webhooks: { timestampToleranceS: 600 } };
    const paths = findSetReservedKeys(RESERVED_SCHEMA, resolved).map(
      (h) => h.path,
    );
    assert.deepStrictEqual(paths, ["webhooks.timestampToleranceS"]);
  });

  it("un enum à valeur unique (signAlg) ne peut jamais dévier → jamais signalé", () => {
    // signAlg n'admet que "sha256" (= son défaut) : même « posé » par l'app, il
    // reste égal au défaut → 0 bruit (on ne signale que ce qui trompe vraiment).
    const resolved = {
      webhooks: { signAlg: "sha256", timestampToleranceS: 300, maxRetries: 5 },
      immutable: true,
    };
    assert.deepStrictEqual(findSetReservedKeys(RESERVED_SCHEMA, resolved), []);
  });
});
