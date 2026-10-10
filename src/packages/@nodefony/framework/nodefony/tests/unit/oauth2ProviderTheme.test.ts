/// <reference types="node" />
import { expect } from "vitest";
import { providerThemeOption } from "../../controller/OAuth2Controller.js";

/**
 * Le thème rendu par la page de connexion (`?theme=` sur `/authorize`) part
 * vers l'écran du fournisseur. La chaîne vient de l'URL : seules deux valeurs
 * passent, tout le reste est ignoré. Le trajet complet (Studio → serveur →
 * Keycloak) s'éprouve au navigateur ; ici, la garde seule.
 */
describe("OAuth2 — thème transmis à l'écran du fournisseur", () => {
  it("transmet clair et sombre", () => {
    expect(providerThemeOption("light")).to.deep.equal({ theme: "light" });
    expect(providerThemeOption("dark")).to.deep.equal({ theme: "dark" });
  });

  it("ignore toute autre valeur, et l'absence", () => {
    for (const forged of [
      null,
      "",
      "DARK",
      "auto",
      "dark&prompt=none",
      "<script>",
    ]) {
      expect(providerThemeOption(forged)).to.deep.equal({});
    }
  });
});
