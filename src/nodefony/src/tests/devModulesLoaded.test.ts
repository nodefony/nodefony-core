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
import { assert } from "chai";
import { devModulesLoaded, gateModuleManifest } from "../kernel/moduleGating";

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
