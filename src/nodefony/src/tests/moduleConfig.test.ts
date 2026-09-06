import assert from "node:assert";
import { describe, it } from "vitest";
import { z } from "zod";
import { parseModuleConfig } from "../kernel/moduleConfig";
import { BootConfigurationError } from "../kernel/BootConfigurationError";

// Décor : la forme minimale d'une config de module — une racine stricte, une
// section stricte imbriquée, et une section LOOSE (celle qu'on transmet telle
// quelle à une bibliothèque tierce, dont on ne connaît pas toutes les options).
const schema = z.strictObject({
  enabled: z.boolean().default(true),
  // `prefault` et non `default` : en zod 4 la valeur d'un `.default()` est
  // rendue TELLE QUELLE, sans repasser par le parse — `{}` resterait `{}` et le
  // décor mesurerait autre chose que ce qu'il annonce.
  trustProxy: z
    .strictObject({ enabled: z.boolean().default(false) })
    .prefault({}),
  serverOptions: z.looseObject({ keepAlive: z.boolean().default(true) }),
});

describe("parseModuleConfig — la porte de validation des configs de module", () => {
  it("une config valide passe, défauts appliqués", () => {
    const c = parseModuleConfig(schema, { serverOptions: {} }, "@nodefony/x");
    assert.strictEqual(c.enabled, true);
    assert.strictEqual(c.trustProxy.enabled, false);
  });

  it("une clé inconnue à la RACINE est REFUSÉE, et le message la nomme", () => {
    assert.throws(
      () =>
        parseModuleConfig(
          schema,
          { trustProxi: true, serverOptions: {} },
          "@nodefony/x",
        ),
      (e: unknown) => {
        assert.ok(
          BootConfigurationError.is(e),
          `attendu BootConfigurationError, reçu ${(e as Error)?.name}`,
        );
        const m = (e as Error).message;
        assert.match(m, /@nodefony\/x/, "le message nomme le module");
        assert.match(m, /trustProxi/, "le message nomme la clé fautive");
        return true;
      },
    );
  });

  it("une clé inconnue IMBRIQUÉE est nommée avec son chemin complet", () => {
    assert.throws(
      () =>
        parseModuleConfig(
          schema,
          { trustProxy: { enable: true }, serverOptions: {} },
          "@nodefony/x",
        ),
      (e: unknown) => {
        // `trustProxy.enable`, pas seulement `enable` : sans le chemin, on
        // cherche la faute de frappe dans tout l'arbre de configuration.
        assert.match((e as Error).message, /trustProxy\.enable/);
        return true;
      },
    );
  });

  it("une section LOOSE conserve les options qu'elle ne connaît pas", () => {
    const c = parseModuleConfig(
      schema,
      { serverOptions: { insecureHTTPParser: true } },
      "@nodefony/x",
    );
    assert.strictEqual(
      (c.serverOptions as Record<string, unknown>).insecureHTTPParser,
      true,
      "une option de bibliothèque tierce non listée doit survivre au parse",
    );
  });

  it("une valeur du MAUVAIS type reste refusée, avec son chemin", () => {
    assert.throws(
      () =>
        parseModuleConfig(
          schema,
          { enabled: "oui", serverOptions: {} },
          "@nodefony/x",
        ),
      (e: unknown) => {
        assert.ok(BootConfigurationError.is(e));
        assert.match((e as Error).message, /enabled/);
        return true;
      },
    );
  });

  it("l'erreur Zod d'origine est conservée en `cause`", () => {
    try {
      parseModuleConfig(schema, { nope: 1, serverOptions: {} }, "@nodefony/x");
      assert.fail("aurait dû lever");
    } catch (e) {
      const cause = (e as Error).cause;
      assert.ok(
        cause instanceof Error && "issues" in cause,
        "la cause doit être l'erreur Zod, avec ses `issues`",
      );
    }
  });

  it("plusieurs clés inconnues sont TOUTES nommées", () => {
    try {
      parseModuleConfig(
        schema,
        { aa: 1, bb: 2, serverOptions: {} },
        "@nodefony/x",
      );
      assert.fail("aurait dû lever");
    } catch (e) {
      const m = (e as Error).message;
      assert.match(m, /aa/);
      assert.match(m, /bb/);
    }
  });

  it("une erreur non-Zod traverse sans être maquillée en liste d'anomalies", () => {
    const exploding = {
      parse() {
        throw new Error("boum");
      },
    } as unknown as z.ZodType<unknown>;
    assert.throws(
      () => parseModuleConfig(exploding, {}, "@nodefony/x"),
      /boum/,
    );
  });
});
