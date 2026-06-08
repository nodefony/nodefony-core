/// <reference types="node" />
import { expect } from "chai";
import {
  buildTrustProxy,
  extractClientIp,
  resolveFromRight,
} from "../../src/context/trustProxy";

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

// IP cliente réelle : dépouillement X-Forwarded-For DE DROITE À GAUCHE (OWASP).
// Le cœur de la parade au spoofing : la partie gauche de XFF est forgeable par
// le client, seule la partie droite (écrite par les proxies de confiance) l'est.
describe("extractClientIp — IP cliente from-right (anti-spoof)", () => {
  const loopback = buildTrustProxy("loopback");

  it("pas de X-Forwarded-For → adresse du socket", () => {
    expect(extractClientIp(undefined, "203.0.113.9", loopback)).to.equal(
      "203.0.113.9",
    );
  });

  it("pas de socket → null (jamais de fallback sur un XFF forgeable)", () => {
    expect(extractClientIp("1.2.3.4", undefined, loopback)).to.equal(null);
    expect(extractClientIp("1.2.3.4", null, loopback)).to.equal(null);
  });

  it("client DIRECT (socket non fiable) + XFF forgé → ignore le XFF, garde le socket", () => {
    // Le client public envoie lui-même `X-Forwarded-For: 1.2.3.4` : ne doit
    // JAMAIS être cru (aucun proxy de confiance entre lui et nous).
    expect(extractClientIp("1.2.3.4", "203.0.113.9", loopback)).to.equal(
      "203.0.113.9",
    );
  });

  it("🔴 1 proxy de confiance + XFF spoofé en tête → IP réelle (PAS la forgée)", () => {
    // client forge "1.2.3.4", nginx (loopback) append la vraie IP "203.0.113.9".
    // Régression de la faille : l'ancien code renvoyait XFF[0] = "1.2.3.4".
    expect(
      extractClientIp("1.2.3.4, 203.0.113.9", "127.0.0.1", loopback),
    ).to.equal("203.0.113.9");
  });

  it("2 proxies de confiance en chaîne → IP réelle", () => {
    const t = buildTrustProxy(["loopback", "10.0.0.0/8"]);
    expect(
      extractClientIp("1.2.3.4, 203.0.113.9, 10.0.0.5", "127.0.0.1", t),
    ).to.equal("203.0.113.9");
  });

  it("toute la chaîne de confiance → élément le plus à gauche", () => {
    const t = buildTrustProxy(["loopback", "10.0.0.0/8"]);
    expect(extractClientIp("10.0.0.1", "127.0.0.1", t)).to.equal("10.0.0.1");
  });

  it("trustProxy=false → toujours le socket (XFF jamais cru)", () => {
    const none = buildTrustProxy(false);
    expect(extractClientIp("1.2.3.4", "203.0.113.9", none)).to.equal(
      "203.0.113.9",
    );
  });

  it("trustProxy=true → confiance totale, élément le plus à gauche", () => {
    const all = buildTrustProxy(true);
    expect(extractClientIp("1.2.3.4, 5.6.7.8", "127.0.0.1", all)).to.equal(
      "1.2.3.4",
    );
  });

  it("espaces et éléments vides dans XFF → ignorés", () => {
    expect(
      extractClientIp("  203.0.113.9 ,  ", "127.0.0.1", loopback),
    ).to.equal("203.0.113.9");
  });

  it("X-Forwarded-For en tableau (en-tête répété) → aplati puis from-right", () => {
    expect(
      extractClientIp(["1.2.3.4", "203.0.113.9"], "127.0.0.1", loopback),
    ).to.equal("203.0.113.9");
  });

  it("IPv4-mapped IPv6 du socket (::ffff:127.0.0.1) reconnu comme proxy de confiance", () => {
    expect(
      extractClientIp("203.0.113.9", "::ffff:127.0.0.1", loopback),
    ).to.equal("203.0.113.9");
  });
});

// Cœur from-right générique partagé par X-Forwarded-For et le `for` RFC 7239.
// Opère sur une chaîne déjà normalisée (IP nues, `null` = maillon obfusqué).
describe("resolveFromRight — cœur générique from-right", () => {
  const loopback = buildTrustProxy("loopback");

  it("chaîne vide → le socket lui-même", () => {
    expect(resolveFromRight([], "203.0.113.9", loopback)).to.equal(
      "203.0.113.9",
    );
  });

  it("socket non fiable → socket (1er maillon non fiable)", () => {
    expect(resolveFromRight(["1.2.3.4"], "203.0.113.9", loopback)).to.equal(
      "203.0.113.9",
    );
  });

  it("socket fiable → remonte au maillon le plus à droite (IP réelle)", () => {
    expect(
      resolveFromRight(["1.2.3.4", "203.0.113.9"], "127.0.0.1", loopback),
    ).to.equal("203.0.113.9");
  });

  it("maillon null (obfusqué) = barrière → dernier proxy de confiance, jamais null", () => {
    // socket fiable → on veut remonter mais le maillon de droite est obfusqué.
    expect(resolveFromRight([null], "127.0.0.1", loopback)).to.equal(
      "127.0.0.1",
    );
    expect(
      resolveFromRight(["203.0.113.9", null], "127.0.0.1", loopback),
    ).to.equal("127.0.0.1");
  });

  it("toute la chaîne de confiance → élément le plus à gauche", () => {
    const t = buildTrustProxy(["loopback", "10.0.0.0/8"]);
    expect(resolveFromRight(["10.0.0.1", "10.0.0.2"], "127.0.0.1", t)).to.equal(
      "10.0.0.1",
    );
  });
});
