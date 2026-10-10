import assert from "node:assert/strict";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import { defineSecurityConfig } from "../../nodefony/config/defineModuleConfig";

/**
 * RED-TEAM — une zone doit couvrir TOUT ce que le routeur sert sous son motif.
 *
 * Le routeur résout une route sans tenir compte de la casse et en retirant
 * les barres finales (`Route.compile` : drapeau `i` ; `Route.cleanPathname`).
 * Une zone qui compare plus strictement laisse passer `/ADMIN` ou `/admin/` :
 * la route est servie, AUCUNE zone ne la garde, l'action tourne en anonyme
 * (CWE-178, CWE-289). Vécu : `/nodefony/test/SECURE/whoami` rendait 200 sans
 * session pendant que `/nodefony/test/secure/whoami` rendait 401.
 */
function area(pattern: string, host?: string): SecuredArea {
  const validated = defineSecurityConfig({
    areas: { guarded: { pattern, ...(host ? { host } : {}) } },
  });
  return new SecuredArea("guarded", validated.areas.guarded!);
}

describe("SecuredArea — la zone couvre les variantes que le routeur sert (red-team)", () => {
  it("🔴 casse : `/ADMIN`, `/Admin/x` tombent dans la zone `^/admin`", () => {
    const z = area("^/admin");
    for (const p of ["/admin", "/ADMIN", "/Admin/users", "/aDmIn"]) {
      assert.equal(z.matchPath(p), true, p);
    }
  });

  it("🔴 barre finale : `/x/` et `/x//` tombent dans la zone ancrée `^/x$`", () => {
    const z = area("^/nodefony/test/login-guarded$");
    for (const p of [
      "/nodefony/test/login-guarded",
      "/nodefony/test/login-guarded/",
      "/nodefony/test/login-guarded//",
      "/NODEFONY/TEST/LOGIN-GUARDED/",
    ]) {
      assert.equal(z.matchPath(p), true, p);
    }
  });

  it("🔴 hôte : la casse du nom d'hôte ne sort pas de la zone (RFC 9110 §4.2.3)", () => {
    const z = area("^/", "app.example");
    assert.equal(z.matchPath("/x", "APP.example"), true);
    assert.equal(z.matchPath("/x", "app.example"), true);
  });

  it("contrôle : un autre chemin et un autre hôte restent HORS de la zone", () => {
    assert.equal(area("^/admin$").matchPath("/administration"), false);
    assert.equal(area("^/admin$").matchPath("/admin/x"), false);
    assert.equal(
      area("^/", "app.example").matchPath("/x", "evil.example"),
      false,
    );
  });
});
