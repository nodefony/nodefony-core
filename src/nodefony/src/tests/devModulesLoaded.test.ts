/**
 * La règle qui dit si les modules `policy: "dev"` sont chargés — UNE fois, pour
 * le gating ET pour la configuration (`ctx.devModules`).
 *
 * Vécu : le fragment drizzle de l'application du dépôt recopiait `ctx.isProd`
 * pour décider d'ouvrir le connecteur du module de banc. En production sous
 * dérogation (`NF_WITH_DEV_MODULES=1`, la marche de la CI), le module était
 * chargé, son connecteur non — huit entités orphelines.
 */
import { describe, it } from "vitest";
import { assert } from "vitest";
import {
  devModulesLoaded,
  devOnlyModules,
  gateModuleManifest,
  GATED_BY_POLICY,
} from "../kernel/moduleGating";

describe("devModulesLoaded — le verdict du gating, publié à la configuration", () => {
  it("hors production : chargés, dérogation ou pas", () => {
    assert.isTrue(devModulesLoaded(false, undefined));
    assert.isTrue(devModulesLoaded(false, "1"));
  });

  it("en production : écartés, sauf dérogation explicite `1`", () => {
    assert.isFalse(devModulesLoaded(true, undefined));
    assert.isFalse(devModulesLoaded(true, "true"));
    assert.isTrue(devModulesLoaded(true, "1"));
  });

  it("dit la MÊME chose que le gating du manifeste", () => {
    const manifest = [{ name: "@app/bench", policy: "dev" as const }];
    for (const isProduction of [false, true]) {
      for (const flag of [undefined, "1"]) {
        const outcome = gateModuleManifest(manifest, {
          isProduction,
          forceDevModules: isProduction && devModulesLoaded(isProduction, flag),
          config: {},
        });
        assert.equal(
          outcome.entries.some((e) => e.name === "@app/bench"),
          devModulesLoaded(isProduction, flag),
          `production=${isProduction} dérogation=${String(flag)}`,
        );
      }
    }
  });
});

describe("devOnlyModules — ce que la production n'aura pas, demandé de n'importe où", () => {
  const manifest = [
    "@nodefony/http",
    { name: "@app/bench", policy: "dev" as const },
    { name: "./src/demo", policy: "dev" as const },
    { name: "@app/sometimes", when: () => false },
    { name: "@app/mandatory", policy: "mandatory" as const },
  ];

  it('rend les modules `policy: "dev"`, dans l\'ordre du manifeste', () => {
    assert.deepEqual(devOnlyModules(manifest), ["@app/bench", "./src/demo"]);
  });

  it("n'évalue AUCUNE garde `when()` — sa config n'est pas celle du lecteur", () => {
    let called = false;
    devOnlyModules([
      {
        name: "@app/guarded",
        when: () => {
          called = true;
          return true;
        },
      },
    ]);
    assert.isFalse(called);
  });

  it("dit la MÊME chose que le gating d'un runtime de production", () => {
    const { gated } = gateModuleManifest(manifest, {
      isProduction: true,
      forceDevModules: false,
      config: {},
    });
    const byPolicy = gated
      .filter((g) => g.reason === GATED_BY_POLICY)
      .map((g) => g.module);
    assert.deepEqual(devOnlyModules(manifest), byPolicy);
  });

  it("un manifeste absent ou mal formé ne rend rien", () => {
    assert.deepEqual(devOnlyModules(undefined), []);
    assert.deepEqual(devOnlyModules([null, { policy: "dev" }]), []);
  });
});
