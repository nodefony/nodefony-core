import { expect } from "chai";
import "mocha";
import Route from "../../src/Route.js";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";

function makeCtx(
  pathname: string,
  method = "GET",
  domain = "localhost"
): ContextType {
  return {
    request: { url: new URL(`http://${domain}${pathname}`) },
    method,
    domain,
  } as unknown as ContextType;
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("Route — constructor", () => {
  it("stores name", () => {
    const r = new Route("my-route");
    expect(r.name).to.equal("my-route");
  });

  it("compiles pattern when path given", () => {
    const r = new Route("r", { path: "/foo" });
    expect(r.pattern).to.be.instanceof(RegExp);
  });

  it("no path — no pattern crash", () => {
    expect(() => new Route("empty")).to.not.throw();
  });

  it("bypassFirewall defaults to false", () => {
    expect(new Route("r", { path: "/x" }).bypassFirewall).to.equal(false);
  });
});

// ─── compile() ────────────────────────────────────────────────────────────────

describe("Route — compile()", () => {
  it("/foo/bar → matches /foo/bar", () => {
    const r = new Route("r", { path: "/foo/bar" });
    expect(r.pattern!.test("/foo/bar")).to.be.true;
  });

  it("/foo/bar → rejects /foo/baz", () => {
    const r = new Route("r", { path: "/foo/bar" });
    expect(r.pattern!.test("/foo/baz")).to.be.false;
  });

  it("case-insensitive — /FOO/BAR matches /foo/bar", () => {
    const r = new Route("r", { path: "/foo/bar" });
    expect(r.pattern!.test("/FOO/BAR")).to.be.true;
  });

  it("/foo/{id} — pattern captures variable", () => {
    const r = new Route("r", { path: "/foo/{id}" });
    expect(r.variables).to.deep.equal(["id"]);
    expect(r.pattern!.test("/foo/42")).to.be.true;
  });

  it("/foo/* — wildcard matches any suffix", () => {
    const r = new Route("r", { path: "/foo/*" });
    expect(r.pattern!.test("/foo/bar/baz")).to.be.true;
  });
});

// ─── match() ──────────────────────────────────────────────────────────────────

describe("Route — match()", () => {
  it("simple path — returns array on match", () => {
    const r = new Route("r", { path: "/hello" });
    const result = r.match(makeCtx("/hello"));
    expect(result).to.be.an("array");
  });

  it("simple path — returns null/undefined on miss", () => {
    const r = new Route("r", { path: "/hello" });
    expect(r.match(makeCtx("/world"))).to.not.be.ok;
  });

  it("trailing slash ignored", () => {
    const r = new Route("r", { path: "/hello" });
    expect(r.match(makeCtx("/hello/"))).to.be.an("array");
  });

  it("extracts path variable", () => {
    const r = new Route("r", { path: "/user/{id}" });
    const result = r.match(makeCtx("/user/42")) as string[] & Record<string, string>;
    expect(result).to.be.an("array");
    expect(result["id"]).to.equal("42");
  });

  it("extracts multiple variables", () => {
    const r = new Route("r", { path: "/user/{id}/post/{pid}" });
    const result = r.match(makeCtx("/user/7/post/99")) as string[] & Record<string, string>;
    expect(result["id"]).to.equal("7");
    expect(result["pid"]).to.equal("99");
  });

  it("URL-decodes variable values", () => {
    const r = new Route("r", { path: "/tag/{name}" });
    const result = r.match(makeCtx("/tag/hello%20world")) as string[] & Record<string, string>;
    expect(result["name"]).to.equal("hello world");
  });

  it("default value applied when variable is empty", () => {
    const r = new Route("r", {
      path: "/page/{slug}",
      defaults: { slug: "home" },
    });
    const result = r.match(makeCtx("/page/home")) as string[] & Record<string, string>;
    expect(result["slug"]).to.equal("home");
  });
});

// ─── matchRequirements — methods ─────────────────────────────────────────────

describe("Route — matchRequirements() — methods", () => {
  it("GET allowed → no throw", () => {
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["GET"] },
    });
    expect(() => r.match(makeCtx("/api", "GET"))).to.not.throw();
  });

  it("POST rejected on GET-only route → HttpError 405", () => {
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["GET"] },
    });
    expect(() => r.match(makeCtx("/api", "POST"))).to.throw();
  });

  it("multiple methods allowed", () => {
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["GET", "POST"] },
    });
    expect(() => r.match(makeCtx("/api", "POST"))).to.not.throw();
  });
});

// ─── matchRequirements — domain ───────────────────────────────────────────────

describe("Route — matchRequirements() — domain", () => {
  it("matching domain → no throw", () => {
    const r = new Route("r", {
      path: "/x",
      requirements: { domain: "example.com" },
    });
    expect(() => r.match(makeCtx("/x", "GET", "example.com"))).to.not.throw();
  });

  it("wrong domain → throws 403", () => {
    const r = new Route("r", {
      path: "/x",
      requirements: { domain: "example.com" },
    });
    let err: HttpError | undefined;
    try {
      r.match(makeCtx("/x", "GET", "evil.com"));
    } catch (e) {
      err = e as HttpError;
    }
    expect(err).to.exist;
    expect((err as HttpError).code).to.equal(403);
  });
});

// ─── setPrefix() ──────────────────────────────────────────────────────────────

describe("Route — setPrefix()", () => {
  it("prepends prefix to path", () => {
    const r = new Route("r", { path: "bar", prefix: "/foo" });
    expect(r.path).to.equal("/foo/bar");
  });

  it("normalizes double slashes", () => {
    const r = new Route("r", { path: "/bar", prefix: "/foo" });
    expect(r.path).to.not.include("//");
  });
});

// ─── generateId() ─────────────────────────────────────────────────────────────

describe("Route — generateId()", () => {
  it("returns non-empty string", () => {
    const r = new Route("r", { path: "/x" });
    expect(r.hash).to.be.a("string").with.length.greaterThan(0);
  });

  it("two identical routes have the same hash", () => {
    const a = new Route("same", { path: "/x" });
    const b = new Route("same", { path: "/x" });
    expect(a.hash).to.equal(b.hash);
  });

  it("different paths → different hash", () => {
    const a = new Route("a", { path: "/x" });
    const b = new Route("b", { path: "/y" });
    expect(a.hash).to.not.equal(b.hash);
  });
});

// ─── toObject() ───────────────────────────────────────────────────────────────

describe("Route — toObject()", () => {
  it("returns object with expected keys", () => {
    const r = new Route("my-route", { path: "/foo" });
    const obj = r.toObject() as Record<string, unknown>;
    expect(obj).to.have.property("name", "my-route");
    expect(obj).to.have.property("path");
    expect(obj).to.have.property("bypassFirewall");
  });
});

// ─── addRequirement / getRequirement ─────────────────────────────────────────

describe("Route — requirements", () => {
  it("addRequirement + getRequirement roundtrip", () => {
    const r = new Route("r");
    r.addRequirement("domain", "example.com");
    expect(r.getRequirement("domain")).to.equal("example.com");
  });

  it("hasRequirements() — 0 when empty", () => {
    expect(new Route("r").hasRequirements()).to.equal(0);
  });

  it("hasRequirements() — 1 after adding one", () => {
    const r = new Route("r");
    r.addRequirement("domain", "example.com");
    expect(r.hasRequirements()).to.equal(1);
  });

  it("getRequirement on absent key → undefined", () => {
    expect(new Route("r").getRequirement("domain")).to.be.undefined;
  });
});
