import { expect } from "chai";
import Route from "../../src/Route.js";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";

function makeCtx(
  pathname: string,
  method = "GET",
  domain = "localhost",
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
    const result = r.match(makeCtx("/user/42")) as string[] &
      Record<string, string>;
    expect(result).to.be.an("array");
    expect(result["id"]).to.equal("42");
  });

  it("extracts multiple variables", () => {
    const r = new Route("r", { path: "/user/{id}/post/{pid}" });
    const result = r.match(makeCtx("/user/7/post/99")) as string[] &
      Record<string, string>;
    expect(result["id"]).to.equal("7");
    expect(result["pid"]).to.equal("99");
  });

  it("URL-decodes variable values", () => {
    const r = new Route("r", { path: "/tag/{name}" });
    const result = r.match(makeCtx("/tag/hello%20world")) as string[] &
      Record<string, string>;
    expect(result["name"]).to.equal("hello world");
  });

  it("default value applied when variable is empty", () => {
    const r = new Route("r", {
      path: "/page/{slug}",
      defaults: { slug: "home" },
    });
    const result = r.match(makeCtx("/page/home")) as string[] &
      Record<string, string>;
    expect(result["slug"]).to.equal("home");
  });
});

// ─── strictness mono-segment des variables ───────────────────────────────────
// Invariant critique : une variable `{x}` = `[^/]+` ne franchit JAMAIS `/`.
// C'est ce qui garantit que `module/{name}` ne masque pas `module/{name}/docs`,
// et que le fallback SPA 2 segments ne masque pas les routes API ≥3 segments.

describe("Route — strictness mono-segment des variables", () => {
  it("/foo/{id} matche /foo/42 mais REJETTE /foo/a/b (pas de / dans la variable)", () => {
    const r = new Route("r", { path: "/foo/{id}" });
    expect(r.match(makeCtx("/foo/42"))).to.be.an("array");
    expect(r.match(makeCtx("/foo/a/b"))).to.not.be.ok;
  });

  it("/{section}/{page} matche EXACTEMENT 2 segments", () => {
    const r = new Route("r", { path: "/{section}/{page}" });
    const m = r.match(makeCtx("/modules/core")) as string[] &
      Record<string, string>;
    expect(m).to.be.an("array");
    expect(m["section"]).to.equal("modules");
    expect(m["page"]).to.equal("core");
  });

  it("/{section}/{page} REJETTE 1 segment ET 3 segments (ne masque pas /<mod>/api/<ep>)", () => {
    const r = new Route("r", { path: "/{section}/{page}" });
    expect(r.match(makeCtx("/modules")), "1 segment").to.not.be.ok;
    expect(r.match(makeCtx("/kernel/api/info")), "3 segments").to.not.be.ok;
  });

  it("/foo/{id}/docs matche /foo/x/docs mais pas /foo/x (route plus profonde non masquée)", () => {
    const r = new Route("r", { path: "/foo/{id}/docs" });
    expect(r.match(makeCtx("/foo/x/docs"))).to.be.an("array");
    expect(r.match(makeCtx("/foo/x"))).to.not.be.ok;
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

// ─── matchRequirements — methodOverride (pont WS-RPC api.request, mutations) ──

describe("Route — matchRequirements() — methodOverride (mutation WS)", () => {
  // En WS, context.method vaut toujours "WEBSOCKET" → le pont passe la méthode
  // LOGIQUE en methodOverride. La route doit déclarer le transport WEBSOCKET ET
  // la méthode logique.
  it("route POST+WEBSOCKET + methodOverride POST → no throw", () => {
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["POST", "WEBSOCKET"] },
    });
    expect(() =>
      r.match(makeCtx("/api", "WEBSOCKET"), undefined, "POST"),
    ).to.not.throw();
  });

  it("route GET+WEBSOCKET + methodOverride POST → 405 (mauvaise méthode logique)", () => {
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["GET", "WEBSOCKET"] },
    });
    let err: HttpError | undefined;
    try {
      r.match(makeCtx("/api", "WEBSOCKET"), undefined, "POST");
    } catch (e) {
      err = e as HttpError;
    }
    expect(err, "doit rejeter").to.exist;
    expect((err as HttpError).code).to.equal(405);
  });

  it("route POST-only SANS WEBSOCKET + methodOverride POST → 405 (zéro bypass)", () => {
    // Une mutation HTTP qui ne déclare pas le transport WEBSOCKET reste
    // INVISIBLE au pont (sécurité : on n'atteint que ce qui s'expose).
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["POST"] },
    });
    let err: HttpError | undefined;
    try {
      r.match(makeCtx("/api", "WEBSOCKET"), undefined, "POST");
    } catch (e) {
      err = e as HttpError;
    }
    expect(err, "doit rejeter").to.exist;
    expect((err as HttpError).code).to.equal(405);
  });

  it("sans methodOverride : route GET+WEBSOCKET + frame WS → no throw (historique)", () => {
    const r = new Route("r", {
      path: "/api",
      requirements: { methods: ["GET", "WEBSOCKET"] },
    });
    expect(() => r.match(makeCtx("/api", "WEBSOCKET"))).to.not.throw();
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

// ─── matchHostname() — host (regexp / wildcard / array) ──────────────────────

describe("Route — host matching (regexp, 403)", () => {
  it("host exact → matche le bon vhost", () => {
    const r = new Route("r", { path: "/x", host: "marseille.fr" });
    expect(() => r.match(makeCtx("/x", "GET", "marseille.fr"))).to.not.throw();
  });

  it("host exact → 403 sur un autre vhost", () => {
    const r = new Route("r", { path: "/x", host: "marseille.fr" });
    let err: HttpError | undefined;
    try {
      r.match(makeCtx("/x", "GET", "nodefony.com"));
    } catch (e) {
      err = e as HttpError;
    }
    expect(err).to.exist;
    expect((err as HttpError).code).to.equal(403);
  });

  it("host exact ancré → pas d'usurpation par suffixe (sécurité)", () => {
    const r = new Route("r", { path: "/x", host: "marseille.fr" });
    expect(() =>
      r.match(makeCtx("/x", "GET", "marseille.fr.evil.com")),
    ).to.throw();
  });

  it("host wildcard `*.cdn.x` → un label", () => {
    const r = new Route("r", { path: "/x", host: "*.cdn.nodefony.com" });
    expect(() =>
      r.match(makeCtx("/x", "GET", "img.cdn.nodefony.com")),
    ).to.not.throw();
    expect(() =>
      r.match(makeCtx("/x", "GET", "a.b.cdn.nodefony.com")),
    ).to.throw();
  });

  it("host array → plusieurs vhosts acceptés", () => {
    const r = new Route("r", {
      path: "/x",
      host: ["marseille.fr", "nodefony.com"],
    });
    expect(() => r.match(makeCtx("/x", "GET", "marseille.fr"))).to.not.throw();
    expect(() => r.match(makeCtx("/x", "GET", "nodefony.com"))).to.not.throw();
    expect(() => r.match(makeCtx("/x", "GET", "autre.com"))).to.throw();
  });

  it("requirements.domain en array → géré (régression : `!==` ne gérait pas string[])", () => {
    const r = new Route("r", {
      path: "/x",
      requirements: { domain: ["a.com", "b.com"] },
    });
    expect(() => r.match(makeCtx("/x", "GET", "a.com"))).to.not.throw();
    expect(() => r.match(makeCtx("/x", "GET", "b.com"))).to.not.throw();
    expect(() => r.match(makeCtx("/x", "GET", "c.com"))).to.throw();
  });

  it("sans host → servie sur tous les vhosts", () => {
    const r = new Route("r", { path: "/x" });
    expect(() => r.match(makeCtx("/x", "GET", "n-importe.com"))).to.not.throw();
    expect(r.hostRegexp).to.be.undefined;
  });
});

// ─── bypassFirewall — plumbing options → Route (P6 J3b) ───────────────────────
describe("Route — bypassFirewall (plumbing options)", () => {
  // VERROU du trou trouvé en J3b : le constructeur lisait les options champ par
  // champ SANS lire `bypassFirewall` → `createRoute({ bypassFirewall:true })`
  // restait false → les routes de login tombaient dans l'aire data plane =
  // deadlock (le login aurait exigé d'être déjà loggé). handleSecurity lit bien
  // `context.resolver.bypassFirewall` (câblé) — encore faut-il que la Route le porte.
  it("défaut false (Zero Trust)", () => {
    expect(new Route("r", { path: "/x" }).bypassFirewall).to.equal(false);
  });
  it("option true propagée jusqu'à la route", () => {
    expect(
      new Route("r", { path: "/x", bypassFirewall: true }).bypassFirewall,
    ).to.equal(true);
  });
  it("option false explicite reste false", () => {
    expect(
      new Route("r", { path: "/x", bypassFirewall: false }).bypassFirewall,
    ).to.equal(false);
  });
});
