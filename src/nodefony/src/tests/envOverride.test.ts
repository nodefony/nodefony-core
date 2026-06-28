import assert from "node:assert";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  coerceEnvValue,
  parseNfEnvOverrides,
  applyResolvedPath,
  pathLooksSecret,
} from "../config/envOverride";
import { defineEnv, envString } from "../config/index";

describe("envOverride — coerceEnvValue", () => {
  it("booléens explicites (pas de piège znv)", () => {
    assert.strictEqual(coerceEnvValue("true"), true);
    assert.strictEqual(coerceEnvValue("false"), false);
    assert.strictEqual(coerceEnvValue(" true "), true);
  });
  it("nombres entiers et décimaux", () => {
    assert.strictEqual(coerceEnvValue("300"), 300);
    assert.strictEqual(coerceEnvValue("-5"), -5);
    assert.strictEqual(coerceEnvValue("1.5"), 1.5);
  });
  it("CSV → tableau de chaînes (trim + vides retirés)", () => {
    assert.deepStrictEqual(coerceEnvValue("a, b ,c"), ["a", "b", "c"]);
  });
  it("JSON explicite tableau/objet", () => {
    assert.deepStrictEqual(coerceEnvValue("[1,2]"), [1, 2]);
    assert.deepStrictEqual(coerceEnvValue('{"x":1}'), { x: 1 });
  });
  it("JSON malformé → chaîne brute (valeur jamais perdue)", () => {
    assert.strictEqual(coerceEnvValue("[bad"), "[bad");
  });
  it("chaîne simple inchangée", () => {
    assert.strictEqual(coerceEnvValue("https://a.com"), "https://a.com");
  });
});

describe("envOverride — parseNfEnvOverrides", () => {
  it("extrait module + chemin (minuscules) + valeur coercée", () => {
    const out = parseNfEnvOverrides({
      NF__SECURITY__JWT__ACCESSTTLS: "300",
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].moduleSeg, "security");
    assert.deepStrictEqual(out[0].path, ["jwt", "accessttls"]);
    assert.strictEqual(out[0].value, 300);
  });
  it("ignore les clés hors préfixe et les NF__X sans champ", () => {
    const out = parseNfEnvOverrides({
      PATH: "/usr/bin",
      NF_LOG_DRIVER: "stdout", // catalogue (simple underscore) — pas un override
      NF__HTTP: "x", // module seul, pas de champ
      NF__HTTP__SERVERS__HTTPS__PORT: "8443",
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].moduleSeg, "http");
    assert.deepStrictEqual(out[0].path, ["servers", "https", "port"]);
    assert.strictEqual(out[0].value, 8443);
  });
});

describe("envOverride — applyResolvedPath (résolution casse-insensible)", () => {
  it("surcharge une clé existante (camelCase) via un segment minuscule", () => {
    const target = { jwt: { accessTtlS: 900 } };
    const ok = applyResolvedPath(target, ["jwt", "accessttls"], 300);
    assert.strictEqual(ok, true);
    assert.strictEqual(target.jwt.accessTtlS, 300);
  });
  it("match exact prioritaire", () => {
    const target = { cors: { maxAgeS: 600 } };
    assert.strictEqual(
      applyResolvedPath(target, ["cors", "maxAgeS"], 60),
      true,
    );
    assert.strictEqual(target.cors.maxAgeS, 60);
  });
  it("chemin inconnu → false, cible inchangée (pas de clé fantôme)", () => {
    const target = { jwt: { accessTtlS: 900 } };
    const ok = applyResolvedPath(target, ["jwt", "nope"], 1);
    assert.strictEqual(ok, false);
    assert.deepStrictEqual(target, { jwt: { accessTtlS: 900 } });
  });
  it("refuse de traverser un non-objet", () => {
    const target = { jwt: 1 };
    assert.strictEqual(applyResolvedPath(target, ["jwt", "x"], 2), false);
  });
});

describe("envOverride — pathLooksSecret", () => {
  it("détecte les chemins sensibles", () => {
    assert.strictEqual(pathLooksSecret(["jwt", "secret"]), true);
    assert.strictEqual(pathLooksSecret(["webhooks", "encryptionKey"]), true);
    assert.strictEqual(pathLooksSecret(["jwt", "accessTtlS"]), false);
  });
});

describe("defineEnv — convention *_FILE (secret monté)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nf-env-file-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lit la valeur depuis le fichier pointé par <KEY>_FILE (newline final retiré)", () => {
    const f = join(dir, "secret");
    writeFileSync(f, "s3cr3t\n");
    const env = defineEnv(
      { NF_SECRET: envString({ optional: true }) },
      { NF_SECRET_FILE: f },
    );
    assert.strictEqual(env.NF_SECRET, "s3cr3t");
  });

  it("lève si KEY et KEY_FILE sont posés ensemble", () => {
    const f = join(dir, "secret2");
    writeFileSync(f, "x");
    assert.throws(
      () =>
        defineEnv(
          { NF_SECRET: envString({ optional: true }) },
          { NF_SECRET: "direct", NF_SECRET_FILE: f },
        ),
      /tous deux définis/,
    );
  });

  it("lève si le fichier est illisible", () => {
    assert.throws(
      () =>
        defineEnv(
          { NF_SECRET: envString({ optional: true }) },
          { NF_SECRET_FILE: join(dir, "absent") },
        ),
      /impossible/,
    );
  });
});
