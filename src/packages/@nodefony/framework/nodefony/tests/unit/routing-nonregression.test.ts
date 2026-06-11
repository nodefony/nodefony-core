import { expect } from "chai";
import Router from "../../service/router.js";
import Route from "../../src/Route.js";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";

/**
 * BANC DE NON-RÉGRESSION ROUTING — contrat de `Router.resolve` sur une TABLE de routes.
 *
 * Prérequis ABSOLU du chantier fast path P2/P3b (index de routes, split Resolver) :
 * tout refacto du Router DOIT passer ce banc À L'IDENTIQUE. Il fige la sémantique
 * OBSERVABLE de la résolution — pas l'implémentation :
 *
 *   A. « 1er match dans l'ordre d'insertion » (PAS de spécificité à la Express) ;
 *   B. dispatch par méthode + 405 agrégé RFC 9110 §15.5.6 (Allow) en pass 2 ;
 *   C. aucun match → resolver.resolve === false, AUCUN throw (le 404 vient d'http-kernel) ;
 *   D. @Domain : skip silencieux pass 1, 403 si seule candidate, EXCLUE du Allow pass 2 ;
 *   E. WEBSOCKET exempt du 405 HTTP (préserve l'exception d'origine, ex. 1002) ;
 *   F. cleanPathOverride (WS-RPC invoke) route par le path du message, pas l'URL ;
 *   G. normalisation : trailing slash, casse, query string ;
 *   H. extraction + décodage des variables au niveau resolve ;
 *   I. table VIVANTE : create/removeRoutes visibles au resolve suivant (un index
 *      devra s'invalider — invariant `dirty`).
 *
 * Réf : docs/audits/bench-frameworks-2026-06.md (verdict) + mémoire IA
 * project_fastpath_chantier_kit.
 */

interface FakeResponse {
  headers: Record<string, unknown>;
  setHeaders(h: Record<string, unknown>): void;
}

function makeCtx(
  pathname: string,
  method = "GET",
  domain = "localhost",
): ContextType & { response: FakeResponse } {
  const response: FakeResponse = {
    headers: {},
    setHeaders(h) {
      Object.assign(this.headers, h);
    },
  };
  return {
    request: { url: new URL(`http://${domain}${pathname}`) },
    method,
    domain,
    response,
  } as unknown as ContextType & { response: FakeResponse };
}

// Router.resolve n'utilise que `routes` (module-level), `this.log` et
// `this.kernel?.environment` → proxy sans Module complet (pattern Router.test.ts).
function makeRouter(): Router {
  const p = Object.create(Router.prototype) as Router & {
    log: (...args: unknown[]) => void;
  };
  p.routes = Router.routes;
  p.log = () => undefined;
  return p;
}

// Isolation TABLE : le banc vide la table partagée et la restaure après chaque
// test — aucune interférence avec les routes des autres fichiers du worker.
let saved: Route[] = [];
beforeEach(() => {
  saved = Router.routes.splice(0);
});
afterEach(() => {
  Router.routes.splice(0);
  Router.routes.push(...saved);
});

// ─── A. Ordre d'insertion — 1er match gagne ──────────────────────────────────

describe("Routing NR — A. premier match dans l'ordre d'insertion", () => {
  it("route paramétrée enregistrée AVANT une littérale → la paramétrée gagne (pas de spécificité)", () => {
    Router.createRoute("param-first", { path: "/a/{x}" });
    Router.createRoute("literal-after", { path: "/a/b" });
    const r = makeRouter().resolve(makeCtx("/a/b"));
    expect(r.resolve).to.equal(true);
    expect(r.route?.name).to.equal("param-first");
  });

  it("littérale enregistrée AVANT la paramétrée → la littérale gagne", () => {
    Router.createRoute("literal-first", { path: "/a/b" });
    Router.createRoute("param-after", { path: "/a/{x}" });
    const r = makeRouter().resolve(makeCtx("/a/b"));
    expect(r.route?.name).to.equal("literal-first");
  });

  it("wildcard enregistrée AVANT une littérale plus profonde → la wildcard absorbe", () => {
    Router.createRoute("wild-first", { path: "/w/*" });
    Router.createRoute("deep-literal", { path: "/w/deep/leaf" });
    const r = makeRouter().resolve(makeCtx("/w/deep/leaf"));
    expect(r.route?.name).to.equal("wild-first");
  });

  it("littérale AVANT la wildcard → la littérale gagne, la wildcard sert le reste", () => {
    Router.createRoute("lit", { path: "/w/exact" });
    Router.createRoute("wild", { path: "/w/*" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/w/exact")).route?.name).to.equal("lit");
    expect(router.resolve(makeCtx("/w/other/deep")).route?.name).to.equal(
      "wild",
    );
  });
});

// ─── B. Méthodes — dispatch + 405 agrégé (RFC 9110 §15.5.6) ──────────────────

describe("Routing NR — B. méthodes et 405 agrégé", () => {
  it("même path GET puis POST (2 routes) → la requête POST passe la route GET (continue) et matche la 2e", () => {
    Router.createRoute("m-get", {
      path: "/m",
      requirements: { methods: ["GET"] },
    });
    Router.createRoute("m-post", {
      path: "/m",
      requirements: { methods: ["POST"] },
    });
    const r = makeRouter().resolve(makeCtx("/m", "POST"));
    expect(r.route?.name).to.equal("m-post");
    // l'exception 405 de la route GET scannée en pass 1 est EFFACÉE par le match
    expect(r.exception).to.equal(undefined);
  });

  // ⚠️ ÉCART RFC DOCUMENTÉ (découvert en figeant le banc, 2026-06-11) : quand
  // plusieurs routes d'un même path jettent 405 en pass 1, l'exception finale
  // porte le Allow de la DERNIÈRE route scannée (ici "POST"), PAS l'agrégat
  // "GET, POST" voulu par RFC 9110 §15.5.6 — la pass 2 (agrégation) est
  // court-circuitée par `exception.code !== 405`. Le banc fige le comportement
  // ACTUEL ; la mise en conformité = lot dédié (le banc sera mis à jour avec).
  it("méthode non servie sur un path connu → 405, Allow = méthodes de la DERNIÈRE route du path (écart RFC connu)", () => {
    Router.createRoute("m-get", {
      path: "/m",
      requirements: { methods: ["GET"] },
    });
    Router.createRoute("m-post", {
      path: "/m",
      requirements: { methods: ["POST"] },
    });
    const ctx = makeCtx("/m", "DELETE");
    let err: (HttpError & { allow?: string }) | undefined;
    try {
      makeRouter().resolve(ctx);
    } catch (e) {
      err = e as HttpError & { allow?: string };
    }
    expect(err?.code).to.equal(405);
    expect(String(err?.allow ?? "")).to.equal("POST");
    // l'en-tête Allow est posé sur la response (RFC 9110 §15.5.6)
    expect(String(ctx.response.headers["Allow"])).to.equal("POST");
  });

  it("route SANS requirements.methods → sert toutes les méthodes", () => {
    Router.createRoute("any", { path: "/any" });
    const router = makeRouter();
    for (const m of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      expect(router.resolve(makeCtx("/any", m)).route?.name).to.equal("any");
    }
  });
});

// ─── C. Aucun match → resolve=false, pas de throw ────────────────────────────

describe("Routing NR — C. aucun match (404 différé à http-kernel)", () => {
  it("path inconnu → resolver.resolve === false, AUCUNE exception levée", () => {
    Router.createRoute("known", { path: "/known" });
    const r = makeRouter().resolve(makeCtx("/definitely-not-here"));
    expect(r.resolve).to.equal(false);
    expect(r.route).to.equal(null);
  });
});

// ─── D. Domain (@Domain / requirements.domain) ───────────────────────────────

describe("Routing NR — D. restriction de domaine", () => {
  it("route restreinte à un autre vhost, SEULE candidate → 403 (pas 404, pas 405)", () => {
    Router.createRoute("other-vhost", {
      path: "/d",
      requirements: { domain: "other.example.com" },
    });
    let err: HttpError | undefined;
    try {
      makeRouter().resolve(makeCtx("/d", "GET", "localhost"));
    } catch (e) {
      err = e as HttpError;
    }
    expect(err?.code).to.equal(403);
  });

  it("restreinte d'abord + ouverte ensuite (même path) → la requête hors vhost continue vers l'ouverte", () => {
    Router.createRoute("restricted", {
      path: "/d",
      requirements: { domain: "other.example.com" },
    });
    Router.createRoute("open", { path: "/d" });
    const r = makeRouter().resolve(makeCtx("/d", "GET", "localhost"));
    expect(r.route?.name).to.equal("open");
    expect(r.exception).to.equal(undefined);
  });

  // Outcome verrouillé : la méthode d'une route restreinte à un AUTRE vhost
  // n'apparaît pas dans le Allow servi à ce domaine (mécanisme actuel : Allow
  // de la dernière route scannée ; la pass 2 — agrégation + filtre servesDomain
  // — ne s'applique qu'aux exceptions non-405, cf écart RFC documenté en B).
  it("le Allow d'un 405 n'expose PAS la méthode d'une route d'un autre vhost", () => {
    Router.createRoute("d-get-other", {
      path: "/dd",
      requirements: { methods: ["GET"], domain: "other.example.com" },
    });
    Router.createRoute("d-post-open", {
      path: "/dd",
      requirements: { methods: ["POST"] },
    });
    let err: (HttpError & { allow?: string }) | undefined;
    try {
      makeRouter().resolve(makeCtx("/dd", "DELETE", "localhost"));
    } catch (e) {
      err = e as HttpError & { allow?: string };
    }
    expect(err?.code).to.equal(405);
    const allow = String(err?.allow ?? "");
    expect(allow).to.include("POST");
    expect(allow).to.not.include("GET");
  });
});

// ─── E. WEBSOCKET — exempt du 405 HTTP ───────────────────────────────────────

describe("Routing NR — E. WebSocket exempt de la pass 2 HTTP", () => {
  it("mismatch de sous-protocole WS → 1002 préservée (PAS convertie en 405 HTTP)", () => {
    Router.createRoute("ws-chat", {
      path: "/ws",
      requirements: { methods: ["WEBSOCKET"], protocol: "chat" },
    });
    const ctx = makeCtx("/ws", "WEBSOCKET") as ContextType & {
      acceptedProtocol: string;
    };
    ctx.acceptedProtocol = "other-proto";
    let err: HttpError | undefined;
    try {
      makeRouter().resolve(ctx);
    } catch (e) {
      err = e as HttpError;
    }
    expect(err?.code).to.equal(1002);
  });

  it("route WS avec le bon sous-protocole → matche et expose acceptedProtocol", () => {
    Router.createRoute("ws-ok", {
      path: "/ws",
      requirements: { methods: ["WEBSOCKET"], protocol: "chat" },
    });
    const ctx = makeCtx("/ws", "WEBSOCKET") as ContextType & {
      acceptedProtocol: string;
    };
    ctx.acceptedProtocol = "chat";
    const r = makeRouter().resolve(ctx);
    expect(r.route?.name).to.equal("ws-ok");
    expect(r.acceptedProtocol).to.equal("chat");
  });
});

// ─── F. cleanPathOverride (WS-RPC invoke) ────────────────────────────────────

describe("Routing NR — F. cleanPathOverride", () => {
  it("resolve(ctx, override) route par le path FOURNI, pas par l'URL de la connexion", () => {
    Router.createRoute("conn-url", { path: "/conn" });
    Router.createRoute("invoked", { path: "/invoked/{id}" });
    const ctx = makeCtx("/conn");
    const r = makeRouter().resolve(ctx, "/invoked/42");
    expect(r.route?.name).to.equal("invoked");
    expect(r.variables[0]).to.equal("42");
  });
});

// ─── G. Normalisation du path ────────────────────────────────────────────────

describe("Routing NR — G. normalisation", () => {
  it("trailing slash ignoré — /g/x/ matche la route /g/x", () => {
    Router.createRoute("g", { path: "/g/x" });
    expect(makeRouter().resolve(makeCtx("/g/x/")).route?.name).to.equal("g");
  });

  it("matching insensible à la casse — /G/X matche /g/x", () => {
    Router.createRoute("g", { path: "/g/x" });
    expect(makeRouter().resolve(makeCtx("/G/X")).route?.name).to.equal("g");
  });

  it("query string ignorée — /g/x?a=1&b=2 matche /g/x", () => {
    Router.createRoute("g", { path: "/g/x" });
    expect(makeRouter().resolve(makeCtx("/g/x?a=1&b=2")).route?.name).to.equal(
      "g",
    );
  });
});

// ─── H. Variables au niveau resolve ──────────────────────────────────────────

describe("Routing NR — H. extraction des variables", () => {
  it("variables extraites dans l'ordre + accès par nom", () => {
    Router.createRoute("v", { path: "/v/{section}/{page}" });
    const r = makeRouter().resolve(makeCtx("/v/docs/intro"));
    expect(r.variables[0]).to.equal("docs");
    expect(r.variables[1]).to.equal("intro");
    const named = r.variables as unknown as Record<string, unknown>;
    expect(named["section"]).to.equal("docs");
    expect(named["page"]).to.equal("intro");
  });

  it("valeurs URL-décodées — %C3%A9t%C3%A9 → été", () => {
    Router.createRoute("v", { path: "/v/{word}" });
    const r = makeRouter().resolve(makeCtx("/v/%C3%A9t%C3%A9"));
    expect(r.variables[0]).to.equal("été");
  });

  it("capture wildcard exposée sous '*'", () => {
    Router.createRoute("w", { path: "/files/*" });
    const r = makeRouter().resolve(makeCtx("/files/a/b/c.txt"));
    const named = r.variables as unknown as Record<string, unknown>;
    expect(named["*"]).to.equal("a/b/c.txt");
  });
});

// ─── I. Table vivante — invalidation (invariant `dirty` du futur index) ──────

describe("Routing NR — I. table vivante create/remove", () => {
  it("route ajoutée APRÈS un premier resolve → trouvable au resolve suivant (pas de cache périmé)", () => {
    Router.createRoute("first", { path: "/i/a" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/i/a")).route?.name).to.equal("first");
    // ajout à chaud — un futur index DOIT se réindexer
    Router.createRoute("late", { path: "/i/b" });
    expect(router.resolve(makeCtx("/i/b")).route?.name).to.equal("late");
  });

  it("removeRoutes(name) → le resolve suivant ne matche plus (resolve=false)", () => {
    Router.createRoute("gone", { path: "/i/gone" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/i/gone")).resolve).to.equal(true);
    router.removeRoutes("gone");
    expect(router.resolve(makeCtx("/i/gone")).resolve).to.equal(false);
  });

  it("retrait du 1er match → le resolve suivant tombe sur l'ANCIEN 2e (ordre préservé)", () => {
    Router.createRoute("shadow", { path: "/i/s/{x}" });
    Router.createRoute("revealed", { path: "/i/s/lit" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/i/s/lit")).route?.name).to.equal("shadow");
    router.removeRoutes("shadow");
    expect(router.resolve(makeCtx("/i/s/lit")).route?.name).to.equal(
      "revealed",
    );
  });
});

// ─── J. Contrat du resolver retourné ─────────────────────────────────────────

describe("Routing NR — J. contrat resolver", () => {
  it("bypassFirewall de la route propagé sur le resolver", () => {
    // bypassFirewall n'est pas une RouteOption (posé par le décorateur
    // @BypassFirewall sur la route déjà créée) → on pose le champ directement.
    const rt = Router.createRoute("fw", { path: "/fw" });
    rt.bypassFirewall = true;
    expect(makeRouter().resolve(makeCtx("/fw")).bypassFirewall).to.equal(true);
  });

  it("resolver d'un match porte route + resolve + variables cohérents", () => {
    Router.createRoute("c", { path: "/c/{id}" });
    const r = makeRouter().resolve(makeCtx("/c/7"));
    expect(r.resolve).to.equal(true);
    expect(r.route).to.be.instanceof(Route);
    expect(r.exception).to.equal(undefined);
    expect(r.variables).to.have.lengthOf(1);
  });
});
