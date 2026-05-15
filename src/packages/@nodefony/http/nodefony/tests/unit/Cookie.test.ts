import { expect } from "chai";
import "mocha";
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
      const c = new Cookie("foo", "bar", { httpOnly: true, secure: true, path: "/api" });
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
      const original = new Cookie("orig", "val", { path: "/", httpOnly: true, secure: true });
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
      expect(c.sign("hello", "secret1")).to.not.equal(c.sign("hello", "secret2"));
    });

    it("different values produce different outputs", () => {
      const c = new Cookie("foo", "bar");
      expect(c.sign("hello", "secret")).to.not.equal(c.sign("world", "secret"));
    });

    it("throws TypeError if val is not a string", () => {
      const c = new Cookie("foo", "bar");
      expect(() => c.sign(42 as unknown as string, "secret")).to.throw(TypeError);
    });

    it("throws TypeError if secret is not a string", () => {
      const c = new Cookie("foo", "bar");
      expect(() => c.sign("hello", 42 as unknown as string)).to.throw(TypeError);
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
