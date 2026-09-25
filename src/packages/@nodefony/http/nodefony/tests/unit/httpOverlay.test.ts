/**
 * #494 — liste blanche de @nodefony/http (`httpOverlaySchema`).
 *
 * Le piège qu'elle garde : un champ repris du schéma de configuration AVEC son
 * défaut injecterait ce défaut dans chaque calque qui ne le mentionne pas, et
 * écraserait en silence la configuration du module pour la requête.
 * Débrancher : retirer `overlayField(…)` autour d'un champ → le 1ᵉʳ bloc tombe.
 */
import { expect } from "chai";
import { httpOverlaySchema } from "../../config/config.js";

describe("httpOverlaySchema — liste blanche de @nodefony/http (#494)", () => {
  it("un calque vide reste vide : aucun défaut injecté", () => {
    expect(httpOverlaySchema.parse({})).to.deep.equal({});
    expect(httpOverlaySchema.parse({ upload: {} })).to.deep.equal({
      upload: {},
    });
  });

  it("accepte les quotas de corps et d'envoi, avec les bornes du schéma", () => {
    expect(
      httpOverlaySchema.parse({
        maxBodySize: 2_097_152,
        upload: { maxFiles: 3, maxFileSize: 10 },
      }),
    ).to.deep.equal({
      maxBodySize: 2_097_152,
      upload: { maxFiles: 3, maxFileSize: 10 },
    });
    expect(() => httpOverlaySchema.parse({ maxBodySize: -1 })).to.throw();
  });

  it("refuse tout le reste — sécurité, chemins, analyse de la requête", () => {
    for (const refused of [
      { trustProxy: true },
      { securityHeaders: {} },
      { queryString: { parameterLimit: 10 } },
      { upload: { uploadDir: "/etc" } },
      { session: {} },
    ]) {
      expect(
        () => httpOverlaySchema.parse(refused),
        JSON.stringify(refused),
      ).to.throw();
    }
  });
});
