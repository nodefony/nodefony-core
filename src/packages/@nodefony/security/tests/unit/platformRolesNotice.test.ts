import assert from "node:assert/strict";
import { platformRolesNotice } from "../../nodefony/service/oauth2";

// Un annuaire qui accorde des rôles de PLATEFORME : l'ouverture est écrite,
// donc voulue. Le rappel sonne en production, il informe ailleurs — le
// décor de développement le portait en WARNING à chaque démarrage.
describe("platformRolesNotice — la sévérité suit l'environnement", () => {
  const granted = ["ROLE_ADMIN", "ROLE_NODEFONY_ADMIN", "ROLE_NODEFONY_ADMIN"];

  it("production → WARNING, rôles de plateforme nommés une fois", () => {
    const notice = platformRolesNotice("keycloak", true, granted, true);
    assert.equal(notice?.severity, "WARNING");
    assert.match(notice?.message ?? "", /\(ROLE_NODEFONY_ADMIN\)/u);
  });

  it("hors production → INFO, même message", () => {
    const notice = platformRolesNotice("keycloak", true, granted, false);
    assert.equal(notice?.severity, "INFO");
    assert.equal(
      notice?.message,
      platformRolesNotice("keycloak", true, granted, true)?.message,
    );
  });

  it("aucun rôle de plateforme accordé → rien à dire", () => {
    assert.equal(
      platformRolesNotice("keycloak", true, ["ROLE_ADMIN"], true),
      null,
    );
  });

  it("ouverture non écrite → rien à dire (le démarrage refuse ailleurs)", () => {
    assert.equal(
      platformRolesNotice("keycloak", undefined, granted, true),
      null,
    );
    assert.equal(platformRolesNotice("keycloak", false, granted, true), null);
  });
});
