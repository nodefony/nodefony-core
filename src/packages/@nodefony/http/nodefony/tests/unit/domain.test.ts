/// <reference types="node" />
import { expect } from "chai";
import {
  compileDomainAlias,
  isDomainAllowed,
} from "../../src/context/domainMatcher.js";

// Validation du Host entrant (vhosts servis par le kernel). Fonctions pures :
// (domain, alias) → RegExp[] compilée une fois au boot, puis test par requête.
describe("domainMatcher — validation du Host (kernel-level)", () => {
  describe("domaine principal — ancré exact", () => {
    it("matche le domaine exact", () => {
      const reg = compileDomainAlias("localhost");
      expect(isDomainAllowed(reg, "localhost")).to.equal(true);
    });

    it("rejette un sous-domaine usurpé (ancrage ^$)", () => {
      const reg = compileDomainAlias("app.example.com");
      // app.example.com.evil.com ne doit PAS passer.
      expect(isDomainAllowed(reg, "app.example.com.evil.com")).to.equal(false);
      expect(isDomainAllowed(reg, "evil-app.example.com")).to.equal(false);
    });

    it("rejette un Host inconnu (défaut = 401 côté kernel)", () => {
      const reg = compileDomainAlias("localhost");
      expect(isDomainAllowed(reg, "attacker.com")).to.equal(false);
    });
  });

  describe("alias en string (séparés espace/virgule)", () => {
    it("compile plusieurs patterns", () => {
      const reg = compileDomainAlias(
        "localhost",
        "a.example.com, b.example.com",
      );
      expect(isDomainAllowed(reg, "a.example.com")).to.equal(true);
      expect(isDomainAllowed(reg, "b.example.com")).to.equal(true);
      expect(isDomainAllowed(reg, "localhost")).to.equal(true);
    });

    it("sépare aussi sur l'espace", () => {
      const reg = compileDomainAlias(
        "localhost",
        "a.example.com b.example.com",
      );
      expect(isDomainAllowed(reg, "b.example.com")).to.equal(true);
    });

    it("ignore les tokens vides (séparateurs consécutifs) — pas de regex match-all", () => {
      // "a.com,,b.com" produisait un token "" → new RegExp("") = /(?:)/ qui
      // matche TOUT (vhost wildcard implicite = trou de sécurité). Doit être ignoré.
      const reg = compileDomainAlias("localhost", "a.com,, b.com");
      expect(isDomainAllowed(reg, "a.com")).to.equal(true);
      expect(isDomainAllowed(reg, "b.com")).to.equal(true);
      expect(isDomainAllowed(reg, "n-importe-quoi.com")).to.equal(false);
    });
  });

  describe("alias en array", () => {
    it("compile les string", () => {
      const reg = compileDomainAlias("localhost", ["a.example.com"]);
      expect(isDomainAllowed(reg, "a.example.com")).to.equal(true);
    });

    it("reprend les RegExp telles quelles", () => {
      const reg = compileDomainAlias("localhost", [/^.+\.example\.com$/u]);
      expect(isDomainAllowed(reg, "anything.example.com")).to.equal(true);
      expect(isDomainAllowed(reg, "example.com")).to.equal(false);
    });

    it("mélange string + RegExp", () => {
      const reg = compileDomainAlias("localhost", [
        "static.example.com",
        /^[^.]+\.cdn\.example\.com$/u,
      ]);
      expect(isDomainAllowed(reg, "static.example.com")).to.equal(true);
      expect(isDomainAllowed(reg, "img.cdn.example.com")).to.equal(true);
    });
  });

  describe("alias en objet (régression bug `instanceof String`)", () => {
    // BUG historique http-kernel.ts:501 : `if (ele instanceof String)` était
    // TOUJOURS faux pour une string primitive → les alias déclarés en objet
    // n'étaient JAMAIS compilés (mort silencieux). Ce test garantit la non-régression.
    it("compile les valeurs string d'un objet alias", () => {
      const reg = compileDomainAlias("localhost", {
        vhost1: "a.example.com",
        vhost2: "b.example.com",
      });
      expect(isDomainAllowed(reg, "a.example.com")).to.equal(true);
      expect(isDomainAllowed(reg, "b.example.com")).to.equal(true);
    });

    it("reprend les valeurs RegExp d'un objet alias", () => {
      const reg = compileDomainAlias("localhost", {
        cdn: /^[^.]+\.cdn\.example\.com$/u,
      });
      expect(isDomainAllowed(reg, "img.cdn.example.com")).to.equal(true);
    });
  });

  describe("alias absent / vide", () => {
    it("undefined → seul le domaine principal", () => {
      const reg = compileDomainAlias("localhost", undefined);
      expect(reg.length).to.equal(1);
      expect(isDomainAllowed(reg, "localhost")).to.equal(true);
    });

    it("array vide → seul le domaine principal", () => {
      const reg = compileDomainAlias("localhost", []);
      expect(reg.length).to.equal(1);
    });
  });

  describe("isDomainAllowed — court-circuit", () => {
    it("retourne false sur une liste vide", () => {
      expect(isDomainAllowed([], "localhost")).to.equal(false);
    });

    it("matche dès le premier pattern satisfait", () => {
      const reg = compileDomainAlias("localhost", ["a.com", "b.com"]);
      expect(isDomainAllowed(reg, "a.com")).to.equal(true);
    });
  });
});
