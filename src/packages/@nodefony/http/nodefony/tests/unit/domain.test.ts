/// <reference types="node" />
import { expect } from "chai";
import {
  compileDomainPattern,
  compileDomainPatterns,
  compileTrustedHosts,
  isDomainAllowed,
  resolveTrustedHostNames,
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

// La MÊME politique, rendue en noms d'hôtes plutôt qu'en `RegExp` — ce que
// consomme un générateur de configuration reverse-proxy (`server_name`).
describe("resolveTrustedHostNames — la barrière, lisible par un proxy", () => {
  it("le domaine canonique en fait TOUJOURS partie, hôtes déclarés ou non", () => {
    // Le cas de toute application générée : `trustedHosts` au défaut (`false`).
    expect(resolveTrustedHostNames("app.example.com", false)).to.deep.equal([
      "app.example.com",
    ]);
    expect(resolveTrustedHostNames("app.example.com", undefined)).to.deep.equal(
      ["app.example.com"],
    );
  });

  it("accepte les TROIS formes de la config — pas seulement le tableau", () => {
    // 🔴 Le défaut qui rendait `proxy:generate` muet chez l'utilisateur : la
    // commande supposait `string[]`, et `domains.filter` levait sur `false`.
    expect(resolveTrustedHostNames("app.fr", "marseille.fr")).to.deep.equal([
      "app.fr",
      "marseille.fr",
    ]);
    expect(
      resolveTrustedHostNames("app.fr", ["marseille.fr", "*.cdn.app.fr"]),
    ).to.deep.equal(["app.fr", "marseille.fr", "*.cdn.app.fr"]);
  });

  it("bypass (`true`) → AUCUN nom : le proxy filtre déjà le Host", () => {
    expect(resolveTrustedHostNames("app.fr", true)).to.deep.equal([]);
  });

  it("écarte les doublons et les motifs non exprimables en nom d'hôte", () => {
    expect(resolveTrustedHostNames("app.fr", ["app.fr", ""])).to.deep.equal([
      "app.fr",
    ]);
    expect(
      resolveTrustedHostNames("app.fr", [/^.*\.app\.fr$/u, "b.fr"]),
    ).to.deep.equal(["app.fr", "b.fr"]);
  });
});
