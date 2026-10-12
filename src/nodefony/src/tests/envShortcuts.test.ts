import { afterAll, describe, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BootConfigurationError } from "../kernel/BootConfigurationError";
import { assert } from "vitest";
import { z } from "zod";
import { applyEnvShortcuts, collectEnvShortcuts } from "../config/envShortcuts";

/**
 * Les raccourcis d'environnement déclarés DANS le schéma d'un module
 * (`.meta({ env })`, que `z.toJSONSchema` rend en `"env"` sur le nœud).
 *
 * Ce qui compte : un nom déclaré une seule fois suffit à ce que le Kernel
 * l'applique et que `nodefony env` le reconnaisse — l'oubli d'une seconde
 * écriture faisait déclarer « sans effet » une variable lue.
 */

// La forme exacte que produit `z.toJSONSchema` pour un module type redis.
const schema = {
  type: "object",
  properties: {
    keyNamespace: { type: "string", env: "NF_X_NAMESPACE" },
    globalOptions: {
      type: "object",
      default: {},
      properties: {
        socket: {
          type: "object",
          properties: {
            host: {
              type: "string",
              default: "localhost",
              description: "Hôte.",
              env: "NF_X_HOST",
            },
            port: { type: "integer", default: 6379, env: "NF_X_PORT" },
          },
        },
        password: { type: "string", secret: true, env: "NF_X_PASS" },
      },
    },
    mode: { type: "string", enum: ["a", "b"], env: "NF_X_MODE" },
    untouched: { type: "boolean", default: false },
  },
};

describe("raccourcis d'environnement déclarés dans le schéma", () => {
  it("relève chaque champ qui porte `env`, avec son chemin et ce que dit le schéma", () => {
    const found = collectEnvShortcuts(schema);
    assert.deepEqual(
      found.map((s) => [s.env, s.path.join(".")]),
      [
        ["NF_X_NAMESPACE", "keyNamespace"],
        ["NF_X_HOST", "globalOptions.socket.host"],
        ["NF_X_PORT", "globalOptions.socket.port"],
        ["NF_X_PASS", "globalOptions.password"],
        ["NF_X_MODE", "mode"],
      ],
    );
    const host = found.find((s) => s.env === "NF_X_HOST")!;
    assert.equal(host.default, "localhost");
    assert.equal(host.description, "Hôte.");
    assert.isTrue(found.find((s) => s.env === "NF_X_PASS")!.secret);
    assert.deepEqual(found.find((s) => s.env === "NF_X_MODE")!.values, [
      "a",
      "b",
    ]);
  });

  it("sans schéma, aucun raccourci — jamais une exception", () => {
    assert.deepEqual(collectEnvShortcuts(null), []);
    assert.deepEqual(collectEnvShortcuts(undefined), []);
  });

  it("pose la valeur au chemin, convertie selon le TYPE déclaré", () => {
    const options: Record<string, unknown> = {
      globalOptions: { socket: { host: "localhost", port: 6379 } },
    };
    const applied = applyEnvShortcuts(options, schema, {
      NF_X_HOST: "redis.internal",
      NF_X_PORT: "6380",
      NF_X_PASS: "s3cret",
    });
    const socket = (options.globalOptions as Record<string, unknown>)
      .socket as Record<string, unknown>;
    assert.equal(socket.host, "redis.internal");
    // Un port est un nombre : laissé en chaîne, Zod le refuserait au parse.
    assert.strictEqual(socket.port, 6380);
    assert.deepEqual(
      applied.map((a) => [a.env, a.secret]),
      [
        ["NF_X_HOST", false],
        ["NF_X_PORT", false],
        ["NF_X_PASS", true],
      ],
    );
  });

  it("une variable VIDE vaut absente (la ligne `NF_X=` d'un .env)", () => {
    const options: Record<string, unknown> = {};
    assert.deepEqual(applyEnvShortcuts(options, schema, { NF_X_HOST: "" }), []);
    assert.deepEqual(options, {});
  });

  it("crée le conteneur manquant d'un champ DÉCLARÉ", () => {
    // Un champ facultatif sans défaut n'existe pas dans les options : la pose
    // doit le créer, sinon le raccourci serait muet sur un réglage documenté.
    const options: Record<string, unknown> = {};
    applyEnvShortcuts(options, schema, { NF_X_NAMESPACE: "preprod" });
    assert.equal(options.keyNamespace, "preprod");
  });

  it("de bout en bout avec le VRAI zod : `.describe().meta({ env })` garde les deux", () => {
    // Le JSON écrit à la main ci-dessus ne prouve rien de zod : c'est ICI qu'on
    // voit que `.meta()` posé après `.describe()` conserve la description
    // (héritage des clones) et sort bien `"env"` dans le JSON Schema.
    const real = z.toJSONSchema(
      z.strictObject({
        host: z
          .string()
          .default("localhost")
          .describe("Hôte.")
          .meta({ env: "NF_Y_HOST" }),
        apiKey: z.string().optional().meta({ env: "NF_Y_API_KEY" }),
        tenant: z
          .string()
          .optional()
          .meta({ env: "NF_Y_KEY_TENANT", secret: false }),
        section: z
          .strictObject({ a: z.string().optional() })
          .meta({ env: "NF_Y_SECTION" }),
      }),
    );
    const found = collectEnvShortcuts(real);
    const host = found.find((x) => x.env === "NF_Y_HOST")!;
    assert.equal(host.description, "Hôte.");
    assert.equal(host.default, "localhost");
    const byEnv = Object.fromEntries(found.map((x) => [x.env, x.secret]));
    // Le NOM supplée quand le schéma se tait…
    assert.equal(byEnv.NF_Y_API_KEY, true);
    // …mais le schéma DÉCIDE quand il parle, `false` compris.
    assert.equal(byEnv.NF_Y_KEY_TENANT, false);
    // Une SECTION n'est pas un réglage : une variable ne remplace pas un sous-arbre.
    assert.notProperty(byEnv, "NF_Y_SECTION");
  });

  describe("secret monté en FICHIER (`<NOM>_FILE`)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nf-envshortcut-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const secret = path.join(dir, "redis-password");
    writeFileSync(secret, "monte-en-fichier\n");

    it("lit le fichier, sans son saut de ligne final", () => {
      const options: Record<string, unknown> = {};
      const applied = applyEnvShortcuts(options, schema, {
        NF_X_PASS_FILE: secret,
      });
      const global = options.globalOptions as Record<string, unknown>;
      assert.equal(global.password, "monte-en-fichier");
      // Le journal nomme ce qui a VRAIMENT été lu : la variable _FILE.
      assert.deepEqual(
        applied.map((a) => a.env),
        ["NF_X_PASS_FILE"],
      );
    });

    it("refuse la variable ET son _FILE posées ensemble", () => {
      assert.throws(
        () =>
          applyEnvShortcuts({}, schema, {
            NF_X_PASS: "direct",
            NF_X_PASS_FILE: secret,
          }),
        BootConfigurationError,
        /NF_X_PASS ET NF_X_PASS_FILE/u,
      );
    });

    it("refuse un fichier illisible — jamais un défaut à la place du secret", () => {
      assert.throws(
        () =>
          applyEnvShortcuts({}, schema, {
            NF_X_PASS_FILE: path.join(dir, "absent"),
          }),
        BootConfigurationError,
        /NF_X_PASS_FILE/u,
      );
    });
  });
});
