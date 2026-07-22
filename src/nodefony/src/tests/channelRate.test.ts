import { expect } from "chai";
import {
  rateChannel,
  parseRate,
  isRateChannel,
  type RateBounds,
} from "../realtime/channelRate";

/**
 * channelRate — convention de cadence ISOMORPHE d'un canal realtime. Le front fabrique
 * (`rateChannel`), le serveur résout (`parseRate`) : les deux bords partagent CE module
 * (fin de la dérive `:${ms}` vs `slice+clamp` dupliqués). 1 canal = 1 cadence = 1 ref-count.
 */
describe("realtime / channelRate (granularité isomorphe)", () => {
  const bounds: RateBounds = { default: 5000, min: 1000, max: 60000 };

  describe("rateChannel — fabrication (front)", () => {
    it("cadence par défaut → canal de base nu (pas de fragmentation)", () => {
      expect(rateChannel("nodefony:orm:health", 5000, 5000)).to.equal(
        "nodefony:orm:health",
      );
    });

    it("intervalMs omis → canal de base nu", () => {
      expect(rateChannel("nodefony:orm:health")).to.equal(
        "nodefony:orm:health",
      );
      expect(rateChannel("nodefony:orm:health", undefined, 5000)).to.equal(
        "nodefony:orm:health",
      );
    });

    it("cadence explicite ≠ défaut → suffixe `:<ms>`", () => {
      expect(rateChannel("nodefony:orm:health", 2000, 5000)).to.equal(
        "nodefony:orm:health:2000",
      );
    });

    it("sans defaultMs, toute cadence donne un suffixe", () => {
      expect(rateChannel("nodefony:supervision", 1000)).to.equal(
        "nodefony:supervision:1000",
      );
    });
  });

  describe("parseRate — résolution + bornage (serveur)", () => {
    it("canal de base nu → cadence par défaut", () => {
      expect(
        parseRate("nodefony:orm:health", "nodefony:orm:health", bounds),
      ).to.equal(5000);
    });

    it("suffixe valide dans les bornes → tel quel", () => {
      expect(
        parseRate("nodefony:orm:health:2000", "nodefony:orm:health", bounds),
      ).to.equal(2000);
    });

    it("suffixe sous la borne basse → borné à min", () => {
      expect(
        parseRate("nodefony:orm:health:10", "nodefony:orm:health", bounds),
      ).to.equal(1000);
    });

    it("suffixe au-dessus de la borne haute → borné à max", () => {
      expect(
        parseRate("nodefony:orm:health:999999", "nodefony:orm:health", bounds),
      ).to.equal(60000);
    });

    it("suffixe non numérique ou ≤ 0 → défaut", () => {
      expect(
        parseRate("nodefony:orm:health:abc", "nodefony:orm:health", bounds),
      ).to.equal(5000);
      expect(
        parseRate("nodefony:orm:health:0", "nodefony:orm:health", bounds),
      ).to.equal(5000);
      expect(
        parseRate("nodefony:orm:health:-3", "nodefony:orm:health", bounds),
      ).to.equal(5000);
    });
  });

  describe("aller-retour fabrication ↔ résolution", () => {
    it("rateChannel puis parseRate restitue la cadence demandée (bornée)", () => {
      const ch = rateChannel("nodefony:orm:health", 2000, bounds.default);
      expect(parseRate(ch, "nodefony:orm:health", bounds)).to.equal(2000);
    });

    it("la cadence par défaut survit à l'aller-retour", () => {
      const ch = rateChannel("nodefony:orm:health", 5000, bounds.default);
      expect(ch).to.equal("nodefony:orm:health");
      expect(parseRate(ch, "nodefony:orm:health", bounds)).to.equal(5000);
    });
  });

  describe("isRateChannel — matching", () => {
    it("matche le canal de base nu", () => {
      expect(
        isRateChannel("nodefony:orm:health", "nodefony:orm:health"),
      ).to.equal(true);
    });

    it("matche une variante cadencée", () => {
      expect(
        isRateChannel("nodefony:orm:health:2000", "nodefony:orm:health"),
      ).to.equal(true);
    });

    it("ne matche pas un préfixe partiel d'un autre canal", () => {
      expect(
        isRateChannel("nodefony:orm:healthy", "nodefony:orm:health"),
      ).to.equal(false);
      expect(
        isRateChannel("nodefony:orm:flow", "nodefony:orm:health"),
      ).to.equal(false);
    });
  });
});
