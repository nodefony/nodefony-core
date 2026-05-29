/// <reference types="node" />
import { expect } from "chai";
import { buildTrustProxy } from "../../src/context/trustProxy.js";

// Confiance envers les en-têtes X-Forwarded-* : ne faire confiance qu'aux
// reverse-proxies déclarés. Fonction pure (config → checker isTrusted(addr)).
describe("buildTrustProxy — confiance reverse-proxy", () => {
  describe("false / undefined → aucune confiance", () => {
    it("false rejette toute adresse", () => {
      const t = buildTrustProxy(false);
      expect(t.isTrusted("127.0.0.1")).to.equal(false);
      expect(t.isTrusted("10.0.0.1")).to.equal(false);
    });

    it("undefined rejette toute adresse", () => {
      const t = buildTrustProxy(undefined);
      expect(t.isTrusted("127.0.0.1")).to.equal(false);
    });
  });

  describe("true → confiance totale", () => {
    it("accepte toute adresse", () => {
      const t = buildTrustProxy(true);
      expect(t.isTrusted("1.2.3.4")).to.equal(true);
      expect(t.isTrusted("::1")).to.equal(true);
    });
  });

  describe("CIDR / IP", () => {
    it("CIDR IPv4 — match dans la plage, pas hors plage", () => {
      const t = buildTrustProxy("10.0.0.0/8");
      expect(t.isTrusted("10.1.2.3")).to.equal(true);
      expect(t.isTrusted("11.0.0.1")).to.equal(false);
    });

    it("IP exacte", () => {
      const t = buildTrustProxy("192.168.1.10");
      expect(t.isTrusted("192.168.1.10")).to.equal(true);
      expect(t.isTrusted("192.168.1.11")).to.equal(false);
    });

    it("liste mixte IPv4 CIDR + IPv6", () => {
      const t = buildTrustProxy(["10.0.0.0/8", "::1"]);
      expect(t.isTrusted("10.9.9.9")).to.equal(true);
      expect(t.isTrusted("::1")).to.equal(true);
      expect(t.isTrusted("8.8.8.8")).to.equal(false);
    });
  });

  describe("presets", () => {
    it("loopback — 127.0.0.1 et ::1 de confiance, public non", () => {
      const t = buildTrustProxy("loopback");
      expect(t.isTrusted("127.0.0.1")).to.equal(true);
      expect(t.isTrusted("::1")).to.equal(true);
      expect(t.isTrusted("8.8.8.8")).to.equal(false);
    });

    it("uniquelocal — RFC 1918", () => {
      const t = buildTrustProxy("uniquelocal");
      expect(t.isTrusted("10.0.0.1")).to.equal(true);
      expect(t.isTrusted("192.168.0.1")).to.equal(true);
      expect(t.isTrusted("172.16.0.1")).to.equal(true);
      expect(t.isTrusted("8.8.8.8")).to.equal(false);
    });
  });

  describe("robustesse", () => {
    it("normalise IPv4-mapped IPv6 (::ffff:127.0.0.1) → loopback", () => {
      const t = buildTrustProxy("loopback");
      expect(t.isTrusted("::ffff:127.0.0.1")).to.equal(true);
    });

    it("adresse vide / non-IP → false", () => {
      const t = buildTrustProxy("loopback");
      expect(t.isTrusted(undefined)).to.equal(false);
      expect(t.isTrusted(null)).to.equal(false);
      expect(t.isTrusted("not-an-ip")).to.equal(false);
    });

    it("entrée invalide → throw à la compilation (fail fast)", () => {
      expect(() => buildTrustProxy("garbage-entry")).to.throw();
    });
  });
});
