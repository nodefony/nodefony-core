import { expect } from "chai";
import Cookie from "../../src/cookies/cookie.js";

describe("Cookie — unit tests", () => {
  describe("constructor(name, value)", () => {
    it("stores name and value", () => {
      const c = new Cookie("session", "abc123");
      expect(c.name).to.equal("session");
      expect(c.value).to.equal("abc123");
    });

    it("applies default options", () => {
      const c = new Cookie("foo", "bar");
      expect(c.signed).to.equal(false);
      expect(c.httpOnly).to.equal(true);
      expect(c.secure).to.equal(true);
    });

    it("merges custom options", () => {
      const c = new Cookie("foo", "bar", {
        httpOnly: true,
        secure: true,
        path: "/api",
      });
      expect(c.httpOnly).to.equal(true);
      expect(c.secure).to.equal(true);
      expect(c.path).to.equal("/api");
    });

    it("throws if name is empty string", () => {
      expect(() => new Cookie("", "val")).to.throw("cookie must have name");
    });
  });

  describe("constructor(cookie) — copy", () => {
    it("copies all properties from an existing Cookie", () => {
      const original = new Cookie("orig", "val", {
        path: "/",
        httpOnly: true,
        secure: true,
      });
      const copy = new Cookie(original);
      expect(copy.name).to.equal("orig");
      expect(copy.value).to.equal("val");
      expect(copy.httpOnly).to.equal(true);
      expect(copy.secure).to.equal(true);
      expect(copy.path).to.equal("/");
    });
  });

  describe("toString()", () => {
    it("returns name=encodedValue", () => {
      const c = new Cookie("name", "value");
      expect(c.toString()).to.equal("name=value");
    });

    it("encodes special characters", () => {
      const c = new Cookie("name", "hello world");
      expect(c.toString()).to.equal("name=hello%20world");
    });
  });

  describe("serialize()", () => {
    it("starts with name=value", () => {
      const c = new Cookie("session", "id123");
      expect(c.serialize()).to.match(/^session=id123/);
    });

    it("includes Path when set", () => {
      const c = new Cookie("foo", "bar", { path: "/admin" });
      expect(c.serialize()).to.include("Path=/admin");
    });

    it("includes HttpOnly flag", () => {
      const c = new Cookie("foo", "bar", { httpOnly: true });
      expect(c.serialize()).to.include("HttpOnly");
    });

    it("includes Secure flag", () => {
      const c = new Cookie("foo", "bar", { secure: true });
      expect(c.serialize()).to.include("Secure");
    });

    it("includes SameSite=Strict", () => {
      const c = new Cookie("foo", "bar", { sameSite: "Strict" });
      expect(c.serialize()).to.include("SameSite=Strict");
    });

    it("includes SameSite=Lax", () => {
      const c = new Cookie("foo", "bar", { sameSite: "Lax" });
      expect(c.serialize()).to.include("SameSite=Lax");
    });

    it("omits Max-Age when not set", () => {
      const c = new Cookie("foo", "bar");
      expect(c.serialize()).to.not.include("Max-Age");
    });
  });

  describe("RFC 6265bis — SameSite / __Host- / None⇒Secure (étape 4)", () => {
    it("defaults SameSite to Lax (jamais None)", () => {
      const c = new Cookie("foo", "bar");
      expect(c.sameSite).to.equal("Lax");
      expect(c.serialize()).to.include("SameSite=Lax");
    });

    it("normalise la casse vers la forme canonique", () => {
      const c = new Cookie("foo", "bar", {
        sameSite: "none" as unknown as "None",
      });
      expect(c.sameSite).to.equal("None");
    });

    it("SameSite=None impose Secure même si secure:false", () => {
      const c = new Cookie("foo", "bar", { sameSite: "None", secure: false });
      expect(c.serialize()).to.include("SameSite=None");
      expect(c.serialize()).to.include("Secure");
    });

    it("__Host- impose Secure, Path=/ et interdit Domain", () => {
      const c = new Cookie("__Host-sid", "id", {
        secure: false,
        path: "/admin",
        domain: "example.com",
      });
      const s = c.serialize();
      expect(s).to.include("Secure");
      expect(s).to.include("Path=/");
      expect(s).to.not.include("Path=/admin");
      expect(s).to.not.include("Domain=");
    });

    it("__Secure- impose Secure mais garde Path/Domain", () => {
      const c = new Cookie("__Secure-sid", "id", {
        secure: false,
        path: "/app",
        domain: "example.com",
      });
      const s = c.serialize();
      expect(s).to.include("Secure");
      expect(s).to.include("Path=/app");
      expect(s).to.include("Domain=example.com");
    });

    it("serializeWebSocket applique aussi None⇒Secure et __Host-", () => {
      const c = new Cookie("__Host-sid", "id", {
        secure: false,
        domain: "example.com",
        path: "/x",
      });
      const obj = c.serializeWebSocket();
      expect(obj.secure).to.equal(true);
      expect(obj.path).to.equal("/");
      expect(obj.domain).to.equal(undefined);
    });
  });

  describe("clearCookie()", () => {
    it("sets expires to epoch (1ms — expired)", () => {
      const c = new Cookie("foo", "bar");
      c.clearCookie();
      expect(c.expires).to.be.instanceof(Date);
      expect(c.expires!.getTime()).to.equal(1);
    });

    it("sets path to '/'", () => {
      const c = new Cookie("foo", "bar", { path: "/admin" });
      c.clearCookie();
      expect(c.path).to.equal("/");
    });

    it("expired cookie appears in serialize with past Expires", () => {
      const c = new Cookie("foo", "bar");
      c.clearCookie();
      expect(c.serialize()).to.include("Expires=");
      expect(c.serialize()).to.include("1970");
    });
  });

  describe("setValue()", () => {
    it("updates the cookie value", () => {
      const c = new Cookie("foo", "initial");
      c.setValue("updated");
      expect(c.value).to.equal("updated");
    });

    it("decodes URI-encoded values", () => {
      const c = new Cookie("foo", "initial");
      c.setValue("hello%20world");
      expect(c.value).to.equal("hello world");
    });
  });

  describe("sign()", () => {
    it("returns a non-empty string", () => {
      const c = new Cookie("foo", "bar");
      const signed = c.sign("hello", "mysecret");
      expect(signed).to.be.a("string").and.have.length.greaterThan(0);
    });

    it("is deterministic — same inputs produce same output", () => {
      const c = new Cookie("foo", "bar");
      expect(c.sign("hello", "secret")).to.equal(c.sign("hello", "secret"));
    });

    it("different secrets produce different outputs", () => {
      const c = new Cookie("foo", "bar");
      expect(c.sign("hello", "secret1")).to.not.equal(
        c.sign("hello", "secret2"),
      );
    });

    it("different values produce different outputs", () => {
      const c = new Cookie("foo", "bar");
      expect(c.sign("hello", "secret")).to.not.equal(c.sign("world", "secret"));
    });

    it("throws TypeError if val is not a string", () => {
      const c = new Cookie("foo", "bar");
      expect(() => c.sign(42 as unknown as string, "secret")).to.throw(
        TypeError,
      );
    });

    it("throws TypeError if secret is not a string", () => {
      const c = new Cookie("foo", "bar");
      expect(() => c.sign("hello", 42 as unknown as string)).to.throw(
        TypeError,
      );
    });

    it("throws TypeError if secret is empty", () => {
      const c = new Cookie("foo", "bar");
      expect(() => c.sign("hello", "")).to.throw(TypeError);
    });

    it("preserves the value — format value.signature", () => {
      const c = new Cookie("foo", "bar");
      const signed = c.sign("hello", "mysecret");
      expect(signed.startsWith("hello.")).to.equal(true);
    });
  });

  describe("unsign() — vérification de signature", () => {
    it("round-trip — recovers the original value", () => {
      const c = new Cookie("foo", "bar");
      const signed = c.sign("hello", "mysecret");
      expect(c.unsign(signed, "mysecret")).to.equal("hello");
    });

    it("tolerates the s: prefix (signed cookie marker)", () => {
      const c = new Cookie("foo", "bar");
      const signed = `s:${c.sign("hello", "mysecret")}`;
      expect(c.unsign(signed, "mysecret")).to.equal("hello");
    });

    it("rejects a tampered value → false", () => {
      const c = new Cookie("foo", "bar");
      const signed = c.sign("hello", "mysecret");
      const tampered = signed.replace("hello", "hELLo");
      expect(c.unsign(tampered, "mysecret")).to.equal(false);
    });

    it("rejects a wrong secret → false", () => {
      const c = new Cookie("foo", "bar");
      const signed = c.sign("hello", "mysecret");
      expect(c.unsign(signed, "othersecret")).to.equal(false);
    });

    it("rejects an unsigned value (no signature) → false", () => {
      const c = new Cookie("foo", "bar");
      expect(c.unsign("plain", "mysecret")).to.equal(false);
    });

    it("throws if secret is empty", () => {
      const c = new Cookie("foo", "bar");
      expect(() => c.unsign("hello.sig", "")).to.throw(TypeError);
    });
  });

  describe("signed cookie — end-to-end (setValue)", () => {
    it("signs the value with a configured secret (s: prefix) and round-trips", () => {
      const c = new Cookie("sid", "v123", {
        signed: true,
        secret: "topsecret",
      });
      expect((c.value as string).startsWith("s:")).to.equal(true);
      expect(c.unsign(c.value as string, "topsecret")).to.equal("v123");
    });

    it("refuses the default/predictable secret (fail-closed)", () => {
      expect(() => new Cookie("sid", "v123", { signed: true })).to.throw(
        /secret/,
      );
    });
  });

  describe("serializeWebSocket()", () => {
    it("returns object with name and value", () => {
      const c = new Cookie("ws", "token");
      const obj = c.serializeWebSocket();
      expect(obj).to.have.property("name", "ws");
      expect(obj).to.have.property("value", "token");
    });

    describe("setExpires() — regression maxAge overflow", () => {
      it("maxAge=0 (session cookie) → expires is undefined", () => {
        const c = new Cookie("sid", "abc", { maxAge: 0 });
        c.setExpires(undefined);
        expect(c.expires).to.equal(undefined);
      });

      it("maxAge=3600 → expires ~1h in the future (not year 58339)", () => {
        const before = Date.now();
        const c = new Cookie("sid", "abc", { maxAge: 3600 });
        c.setExpires(undefined);
        const after = Date.now();
        expect(c.expires).to.be.instanceof(Date);
        const ms = c.expires!.getTime();
        expect(ms).to.be.above(before + 3599 * 1000);
        expect(ms).to.be.below(after + 3601 * 1000);
        // ne doit pas être dans un futur pathologique (> +1 an)
        expect(ms).to.be.below(Date.now() + 366 * 24 * 3600 * 1000);
      });

      it("maxAge=86400 → expires ~24h in the future", () => {
        const before = Date.now();
        const c = new Cookie("sid", "abc", { maxAge: 86400 });
        c.setExpires(undefined);
        expect(c.expires).to.be.instanceof(Date);
        const ms = c.expires!.getTime();
        expect(ms).to.be.above(before + 86399 * 1000);
        expect(ms).to.be.below(Date.now() + 86401 * 1000);
      });

      it("maxAge=undefined → no expires (session cookie)", () => {
        const c = new Cookie("sid", "abc");
        c.setExpires(undefined);
        expect(c.expires).to.equal(undefined);
      });
    });

    it("includes optional fields when set", () => {
      const c = new Cookie("ws", "token", { path: "/", httpOnly: true });
      const obj = c.serializeWebSocket();
      expect(obj).to.have.property("path", "/");
      expect(obj).to.have.property("httponly", true);
    });
  });
});
