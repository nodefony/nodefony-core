/// <reference types="node" />
import { expect } from "vitest";
import { oauth2FailureTarget } from "../../controller/OAuth2Controller.js";

/**
 * L'écran d'échec du callback OAuth reçoit une RAISON et la page où aller une
 * fois connecté.
 *
 * La raison permet à l'écran de connexion de distinguer une ANNULATION
 * (`access_denied` : l'utilisateur est revenu choisir une autre méthode) d'un
 * échec — sans jamais recopier dans une URL une chaîne fournie par n'importe
 * qui : hors de la liste normalisée, c'est `failed`. La condition « sous un
 * `state` valide » vit dans le contrôleur et s'éprouve sur le serveur réel
 * (`oauth2-attack.test.ts`, `oauth2-flow.test.ts`, @nodefony/http).
 */
describe("OAuth2 — adresse de l'écran d'échec", () => {
  it("ajoute un code normalisé à une adresse sans requête", () => {
    expect(oauth2FailureTarget("/login", "access_denied", null)).to.equal(
      "/login?reason=access_denied",
    );
  });

  it("conserve la requête déjà présente", () => {
    expect(
      oauth2FailureTarget("/nodefony/login?error=oauth", "access_denied", null),
    ).to.equal("/nodefony/login?error=oauth&reason=access_denied");
  });

  it("conserve le fragment, placé après la requête", () => {
    expect(
      oauth2FailureTarget("/app?error=oauth#connexion", "login_required", null),
    ).to.equal("/app?error=oauth&reason=login_required#connexion");
  });

  it("garde une adresse absolue intacte hors des paramètres ajoutés", () => {
    expect(
      oauth2FailureTarget("https://app.example/login", "server_error", null),
    ).to.equal("https://app.example/login?reason=server_error");
  });

  it("rend `failed` pour un code hors de la liste — la chaîne vient de l'URL", () => {
    for (const forged of [
      "<script>alert(1)</script>",
      "access_denied&admin=1",
      "ACCESS_DENIED",
      "",
    ]) {
      expect(oauth2FailureTarget("/login?error=oauth", forged, null)).to.equal(
        "/login?error=oauth&reason=failed",
      );
    }
  });

  it("rend `failed` sans code (state invalide, échange refusé)", () => {
    expect(oauth2FailureTarget("/login", null, null)).to.equal(
      "/login?reason=failed",
    );
  });

  it("transmet la page où aller une fois connecté", () => {
    expect(
      oauth2FailureTarget("/login", "access_denied", "/admin?tab=2"),
    ).to.equal("/login?reason=access_denied&from=%2Fadmin%3Ftab%3D2");
  });

  it("remplace la raison et la destination d'une tentative précédente", () => {
    // `back` est la page qui a lancé le flux : elle peut porter les paramètres
    // d'un échec antérieur, qui ne doivent ni se dupliquer ni mentir.
    expect(
      oauth2FailureTarget(
        "/login?reason=failed&from=%2Fold&skin=ledger",
        "access_denied",
        "/new",
      ),
    ).to.equal("/login?reason=access_denied&from=%2Fnew&skin=ledger");
    expect(
      oauth2FailureTarget("/login?reason=failed&from=%2Fold", null, null),
    ).to.equal("/login?reason=failed");
  });
});
