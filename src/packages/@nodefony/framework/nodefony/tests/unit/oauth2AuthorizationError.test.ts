/// <reference types="node" />
import { expect } from "vitest";
import { withAuthorizationError } from "../../controller/OAuth2Controller.js";

/**
 * Le code d'erreur rendu par un fournisseur au callback OAuth ne parvient à
 * l'écran d'arrivée que s'il appartient à la liste normalisée.
 *
 * C'est ce qui permet à l'écran de connexion de distinguer une ANNULATION
 * (`access_denied` : l'utilisateur est revenu choisir une autre méthode) d'un
 * échec — sans jamais recopier dans une URL une chaîne fournie par n'importe
 * qui. La condition « sous un `state` valide » vit dans le contrôleur et
 * s'éprouve sur le serveur réel (`oauth2-attack.test.ts`, @nodefony/http).
 */
describe("OAuth2 — code d'erreur transmis à l'adresse d'échec", () => {
  it("ajoute un code normalisé à une adresse sans requête", () => {
    expect(withAuthorizationError("/login", "access_denied")).to.equal(
      "/login?reason=access_denied",
    );
  });

  it("conserve la requête déjà présente", () => {
    expect(
      withAuthorizationError("/nodefony/login?error=oauth", "access_denied"),
    ).to.equal("/nodefony/login?error=oauth&reason=access_denied");
  });

  it("conserve le fragment, placé après la requête", () => {
    expect(
      withAuthorizationError("/app?error=oauth#connexion", "login_required"),
    ).to.equal("/app?error=oauth&reason=login_required#connexion");
  });

  it("garde une adresse absolue intacte hors du code ajouté", () => {
    expect(
      withAuthorizationError("https://app.example/login", "server_error"),
    ).to.equal("https://app.example/login?reason=server_error");
  });

  it("ne transmet RIEN d'un code hors de la liste — la chaîne vient de l'URL", () => {
    for (const forged of [
      "<script>alert(1)</script>",
      "access_denied&admin=1",
      "ACCESS_DENIED",
      "",
    ]) {
      expect(withAuthorizationError("/login?error=oauth", forged)).to.equal(
        "/login?error=oauth",
      );
    }
  });

  it("rend l'adresse intacte sans code", () => {
    expect(withAuthorizationError("/login?error=oauth", null)).to.equal(
      "/login?error=oauth",
    );
  });
});
