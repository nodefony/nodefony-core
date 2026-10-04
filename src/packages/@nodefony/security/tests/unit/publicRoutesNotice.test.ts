import { describe, it, expect } from "vitest";
import { publicRoutesNotice } from "../../nodefony/src/boot/publicRoutesNotice";

/**
 * Le point « routes métier publiques » du bilan de démarrage (#533).
 *
 * Hors zone, l'identité n'est jamais résolue : une route métier qu'on croit
 * protégée répond à n'importe qui. Le pattern arrive tel que `describe()` le
 * rend — `RegExp.source`, slashes ÉCHAPPÉS — et c'est la règle du cœur qui
 * le classe (`isFrameworkZone`), jamais une copie.
 */
describe("publicRoutesNotice", () => {
  it("aires du framework seules → point FIREWALL_PUBLIC_ROUTES, avec la recette", () => {
    const notice = publicRoutesNotice([
      { name: "nodefony-admin", pattern: "^\\/nodefony\\/api" },
    ]);
    expect(notice?.code).toBe("FIREWALL_PUBLIC_ROUTES");
    expect(notice?.level).toBe("warning");
    expect(notice?.fix).toContain('use("@nodefony/security"');
  });

  it("aucune zone du tout → même constat", () => {
    expect(publicRoutesNotice([])?.code).toBe("FIREWALL_PUBLIC_ROUTES");
  });

  it("une zone applicative → silence", () => {
    expect(
      publicRoutesNotice([
        { name: "nodefony-admin", pattern: "^\\/nodefony\\/api" },
        { name: "main", pattern: "^\\/api" },
      ]),
    ).toBe(null);
  });
});
