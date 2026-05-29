/// <reference types="node" />
import { expect } from "chai";
import {
  compileDomainPattern,
  compileDomainPatterns,
  compileTrustedHosts,
  isDomainAllowed,
} from "../../src/context/domainMatcher.js";

// Matching de domaine (Host) — fonctions pures. Politique UNIQUE : string exact
// ancré / `*` wildcard un-label / RegExp libre ; partagée par trustedHosts (kernel,
// sécu avant routing) et @Domain (route, routing).
describe("domainMatcher", () => {
  describe("compileDomainPattern — politique sûre", () => {
    it("string simple → match EXACT ancré (le point est littéral)", () => {
      const reg = compileDomainPattern("app.example.com");
      expect(reg.test("app.example.com")).to.equal(true);
      // `.` échappé → pas un joker : appXexample.com ne passe pas.
      expect(reg.test("appXexample.com")).to.equal(false);
      // ancré → pas de match partiel (anti-usurpation).
      expect(reg.test("app.example.com.evil.com")).to.equal(false);
      expect(reg.test("evil-app.example.com")).to.equal(false);
    });

    it("wildcard `*` → UN label (RFC 6125)", () => {
      const reg = compileDomainPattern("*.cdn.example.com");
      expect(reg.test("img.cdn.example.com")).to.equal(true);
      // un seul label : pas deux niveaux, pas le domaine nu.
      expect(reg.test("a.b.cdn.example.com")).to.equal(false);
      expect(reg.test("cdn.example.com")).to.equal(false);
    });

    it("RegExp → reprise telle quelle", () => {
      const re = /^.+\.example\.com$/u;
      expect(compileDomainPattern(re)).to.equal(re);
    });

    it("IPv6 loopback `[::1]` → crochets échappés, exact", () => {
      const reg = compileDomainPattern("[::1]");
      expect(reg.test("[::1]")).to.equal(true);
      expect(reg.test("::1")).to.equal(false);
    });
  });

  describe("compileDomainPatterns — liste", () => {
    it("normalise un pattern unique en liste", () => {
      expect(compileDomainPatterns("a.com")).to.have.length(1);
    });

    it("compile string + RegExp mélangés", () => {
      const regs = compileDomainPatterns([
        "a.example.com",
        /^x\.example\.com$/u,
      ]);
      expect(isDomainAllowed(regs, "a.example.com")).to.equal(true);
      expect(isDomainAllowed(regs, "x.example.com")).to.equal(true);
    });

    it("ignore les string vides (coquille de config)", () => {
      const regs = compileDomainPatterns(["", "a.com", ""]);
      expect(regs).to.have.length(1);
    });
  });

  describe("compileTrustedHosts — barrière kernel (sécu avant routing)", () => {
    it("défaut (false) en dev → domaine canonique + loopback", () => {
      const regs = compileTrustedHosts("nodefony.com", false, true);
      expect(isDomainAllowed(regs, "nodefony.com")).to.equal(true);
      expect(isDomainAllowed(regs, "localhost")).to.equal(true);
      expect(isDomainAllowed(regs, "127.0.0.1")).to.equal(true);
      expect(isDomainAllowed(regs, "[::1]")).to.equal(true);
      expect(isDomainAllowed(regs, "attacker.com")).to.equal(false);
    });

    it("défaut (false) en prod → domaine canonique SEUL (pas de loopback)", () => {
      const regs = compileTrustedHosts("nodefony.com", false, false);
      expect(isDomainAllowed(regs, "nodefony.com")).to.equal(true);
      expect(isDomainAllowed(regs, "localhost")).to.equal(false);
      expect(isDomainAllowed(regs, "127.0.0.1")).to.equal(false);
    });

    it("true → bypass total (Host filtré en amont par le proxy)", () => {
      const regs = compileTrustedHosts("nodefony.com", true, false);
      expect(isDomainAllowed(regs, "nodefony.com")).to.equal(true);
      expect(isDomainAllowed(regs, "n-importe-quoi.fr")).to.equal(true);
    });

    it("string additionnelle → vhost accepté en plus du canonique", () => {
      const regs = compileTrustedHosts("nodefony.com", "marseille.fr", false);
      expect(isDomainAllowed(regs, "nodefony.com")).to.equal(true);
      expect(isDomainAllowed(regs, "marseille.fr")).to.equal(true);
      // exact ancré → pas d'usurpation.
      expect(isDomainAllowed(regs, "marseille.fr.evil.com")).to.equal(false);
    });

    it("liste + wildcard additionnels", () => {
      const regs = compileTrustedHosts(
        "nodefony.com",
        ["marseille.fr", "*.cdn.nodefony.com"],
        false,
      );
      expect(isDomainAllowed(regs, "marseille.fr")).to.equal(true);
      expect(isDomainAllowed(regs, "img.cdn.nodefony.com")).to.equal(true);
    });
  });

  describe("isDomainAllowed — court-circuit", () => {
    it("retourne false sur une liste vide", () => {
      expect(isDomainAllowed([], "localhost")).to.equal(false);
    });

    it("matche dès le premier pattern satisfait", () => {
      const regs = compileDomainPatterns(["a.com", "b.com"]);
      expect(isDomainAllowed(regs, "a.com")).to.equal(true);
    });
  });
});
