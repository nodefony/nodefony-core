import { expect } from "vitest";
import { Pdu } from "nodefony";
import Router from "../../service/router.js";
import Route from "../../src/Route.js";
import type { HTTPMethod } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";

/**
 * TESTS DE L'INDEX DE ROUTES (fast path étape 4) — complément du banc
 * routing-nonregression.test.ts (qui fige le contrat OBSERVABLE de resolve).
 *
 * Ici on cible les frontières PROPRES À L'INDEX :
 *   1. classification littérale vs dynamique (metachar regex → dynamique,
 *      comportement regex legacy intégralement préservé) ;
 *   2. lookup case-insensitive (les patterns sont compilés flag `i`) ;
 *   3. path racine `/` (normalisé en clé vide par setPattern) ;
 *   4. merge ordonné littérales ∪ dynamiques (positions entrelacées) ;
 *   5. garde-fou contre le swap DIRECT de la table (splice/push sans passer
 *      par l'API Router — pattern d'isolation des bancs de tests).
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

function makeRouter(): Router {
  const p = Object.create(Router.prototype) as Router;
  p.routes = Router.routes;
  // Le proxy n'a pas de syslog (pas de Module) → on substitue `log` par un stub
  // CONFORME au contrat `Service.log` (retourne un vrai Pdu, jamais consommé par
  // `resolve`) : muet, mais pas menteur sur la signature.
  p.log = (pci, severity, msgid, msg) =>
    new Pdu(pci, severity, "router", msgid, msg);
  return p;
}

let saved: Route[] = [];
beforeEach(() => {
  saved = Router.routes.splice(0);
});
afterEach(() => {
  Router.routes.splice(0);
  Router.routes.push(...saved);
});

describe("Routing index — classification littérale/dynamique", () => {
  it("path avec metachar regex (+) : le chemin DÉCLARÉ est celui qui est servi", () => {
    // ⚠️ CONTRAT INVERSÉ, et c'était le but. Ce test affirmait auparavant que
    // `/m+x` servait `/mmx` et refusait `/m+x` — parce que `compile()`
    // n'échappait que `/` et `.`, laissant le `+` valoir comme quantificateur.
    // Une route ne servait donc pas le chemin que son auteur avait écrit.
    // `compile()` neutralise désormais tout littéral : ce qui est déclaré est
    // ce qui est servi, et rien d'autre.
    Router.createRoute("meta", { path: "/m+x" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/m+x")).route?.name).to.equal("meta");
    expect(router.resolve(makeCtx("/mmx")).resolve).to.equal(false);
  });

  it("path avec alternance (|) : la route reste ANCRÉE sur son chemin", () => {
    // Le plus grave des métacaractères oubliés : `^/a|b$` ne dit pas « /a ou
    // /b », il dit « commence par /a » OU « finit par b » — la route absorbait
    // n'importe quelle URL finissant par `b`.
    Router.createRoute("alt", { path: "/a|b" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/a|b")).route?.name).to.equal("alt");
    expect(router.resolve(makeCtx("/totally/other/b")).resolve).to.equal(false);
    expect(router.resolve(makeCtx("/a")).resolve).to.equal(false);
  });

  it("path avec parenthèses : ce n'est pas un groupe de capture", () => {
    Router.createRoute("paren", { path: "/pricing/(beta)" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/pricing/(beta)")).route?.name).to.equal(
      "paren",
    );
    expect(router.resolve(makeCtx("/pricing/beta")).resolve).to.equal(false);
  });

  it("path avec point (échappé par compile) reste littéral exact", () => {
    Router.createRoute("dotted", { path: "/files/app.json" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/files/app.json")).route?.name).to.equal(
      "dotted",
    );
    // `.` échappé → PAS un joker regex
    expect(router.resolve(makeCtx("/files/appxjson")).resolve).to.equal(false);
  });
});

describe("Routing index — casse et racine", () => {
  it("route déclarée en MixedCase servie en lowercase et UPPERCASE (flag i)", () => {
    Router.createRoute("cased", { path: "/CaSe/PaTh" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/case/path")).route?.name).to.equal("cased");
    expect(router.resolve(makeCtx("/CASE/PATH")).route?.name).to.equal("cased");
  });

  it("path racine / (normalisé clé vide) matche la requête /", () => {
    Router.createRoute("root", { path: "/" });
    expect(makeRouter().resolve(makeCtx("/")).route?.name).to.equal("root");
  });
});

describe("Routing index — merge ordonné littérales ∪ dynamiques", () => {
  it("littérale(pos0) + dynamique(pos1) + littérale(pos2) même path : l'ordre strict du scan est émulé", () => {
    Router.createRoute("lit-get", {
      path: "/x",
      requirements: { methods: ["GET"] },
    });
    Router.createRoute("dyn", { path: "/{p}" });
    Router.createRoute("lit-post", {
      path: "/x",
      requirements: { methods: ["POST"] },
    });
    const router = makeRouter();
    // GET /x → la littérale pos0 gagne (avant la dynamique pos1)
    expect(router.resolve(makeCtx("/x", "GET")).route?.name).to.equal(
      "lit-get",
    );
    // POST /x → pos0 jette 405 (continue), pos1 dynamique matche AVANT la
    // littérale POST pos2 — ordre d'insertion, pas de préférence littérale.
    expect(router.resolve(makeCtx("/x", "POST")).route?.name).to.equal("dyn");
  });
});

describe("Routing index — garde-fou mutations directes de la table", () => {
  it("swap splice/push à longueur égale (autres objets Route) → réindexé au resolve suivant", () => {
    Router.createRoute("a", { path: "/swap/a" });
    Router.createRoute("b", { path: "/swap/b" });
    const router = makeRouter();
    // construit l'index sur la table {a, b}
    expect(router.resolve(makeCtx("/swap/a")).route?.name).to.equal("a");
    // swap DIRECT (sans API Router) vers {c, d} — même longueur, objets ≠
    const replacement = [
      new Route("c", { path: "/swap/c" }),
      new Route("d", { path: "/swap/d" }),
    ];
    Router.routes.splice(0);
    Router.routes.push(...replacement);
    expect(router.resolve(makeCtx("/swap/c")).route?.name).to.equal("c");
    expect(router.resolve(makeCtx("/swap/a")).resolve).to.equal(false);
  });
});

describe("Routing index — pré-filtre de préfixe littéral (scan dynamique)", () => {
  it("wildcard : /files/* sert /files/a/b — son préfixe est /files/, pas le chemin entier", () => {
    Router.createRoute("wild", { path: "/files/*" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/files/a/b")).route?.name).to.equal("wild");
    expect(router.resolve(makeCtx("/files/x")).route?.name).to.equal("wild");
  });

  it("variable en TÊTE : /{lang}/page n'a aucun préfixe exploitable → jamais écartée", () => {
    Router.createRoute("i18n", { path: "/{lang}/page" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/fr/page")).route?.name).to.equal("i18n");
    expect(router.resolve(makeCtx("/de/page")).route?.name).to.equal("i18n");
  });

  it("casse : /Nodefony/{id} sert /NODEFONY/7 (le motif est compilé avec le drapeau i)", () => {
    Router.createRoute("mixed", { path: "/Nodefony/{id}" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/NODEFONY/7")).route?.name).to.equal(
      "mixed",
    );
    expect(router.resolve(makeCtx("/nodefony/7")).route?.name).to.equal(
      "mixed",
    );
    expect(router.resolve(makeCtx("/Nodefony/7")).route?.name).to.equal(
      "mixed",
    );
  });

  it("hors ASCII : le préfixe s'arrête au 1er caractère non ASCII — sinon une route qui MATCHE serait écartée", () => {
    // Cas de rupture RÉEL, pas une précaution de principe : le motif `/Σ/{id}`
    // compilé avec le drapeau `i` matche `/ς/1` (le repli de casse réunit sigma
    // majuscule, minuscule et FINAL), là où `"/Σ/".toLowerCase()` rend `/σ/`,
    // que `/ς/1` ne commence pas. Un pré-filtre comparant le préfixe ENTIER
    // répondrait donc 404 sur une route qui sert la requête.
    // Le chemin arrive ici brut (pont WS-RPC via `cleanPathOverride`) : passé par
    // une URL il serait percent-encodé, donc déjà ASCII.
    Router.createRoute("sigma", { path: "/Σ/{id}" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/ignored"), "/ς/1").route?.name).to.equal(
      "sigma",
    );
    expect(router.resolve(makeCtx("/ignored"), "/σ/1").route?.name).to.equal(
      "sigma",
    );
  });

  it("une dynamique au préfixe divergent n'intercepte rien et ne décale pas l'ordre", () => {
    Router.createRoute("other", { path: "/other/{id}" });
    Router.createRoute("target", { path: "/target/{id}" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/target/9")).route?.name).to.equal("target");
    expect(router.resolve(makeCtx("/other/9")).route?.name).to.equal("other");
    expect(router.resolve(makeCtx("/nowhere/9")).resolve).to.equal(false);
  });

  it("le préfixe suit la table VIVANTE : une route ajoutée après un resolve est vue", () => {
    Router.createRoute("first", { path: "/live/{id}" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/live/1")).route?.name).to.equal("first");
    Router.createRoute("second", { path: "/added/{id}" });
    expect(router.resolve(makeCtx("/added/2")).route?.name).to.equal("second");
  });
});

describe("Routing index — le pré-filtre OPÈRE (pas seulement : ne casse rien)", () => {
  // Sans ces deux cas, un pré-filtre INERTE (préfixe toujours vide, condition
  // jamais vraie) passerait tous les tests précédents sans rien accélérer — on
  // croirait tenir l'optimisation. Compter les motifs réellement exécutés est la
  // seule preuve qu'elle mord, et la seule qui tombera si on la débranche.
  function countMatches(fn: () => void): number {
    const original = Route.prototype.match;
    let calls = 0;
    Route.prototype.match = function (
      this: Route,
      ...args: Parameters<typeof original>
    ) {
      calls++;
      return original.apply(this, args);
    };
    try {
      fn();
    } finally {
      Route.prototype.match = original;
    }
    return calls;
  }

  it("31 dynamiques en table, une seule au préfixe compatible → 1 seul Route.match", () => {
    for (let i = 0; i < 30; i++) {
      Router.createRoute(`other-${i}`, { path: `/zone${i}/{id}` });
    }
    Router.createRoute("wanted", { path: "/wanted/{id}" });
    const router = makeRouter();
    let name: string | undefined;
    const calls = countMatches(() => {
      name = router.resolve(makeCtx("/wanted/42")).route?.name;
    });
    expect(name).to.equal("wanted");
    expect(calls).to.equal(1);
  });

  it("pass 2 (405) intacte : le Allow reste l'agrégat, le pré-filtre ne vaut que pour la pass 1", () => {
    // Effet de bord à écarter explicitement : la pass 2 calcule le `Allow` de la
    // RFC 9110 §15.5.6 en rescannant TOUTE la table. Si le pré-filtre y avait
    // fuité, une méthode servie par une route au préfixe « incompatible »
    // disparaîtrait du Allow — un 405 qui ment sur ce que la ressource accepte.
    Router.createRoute("get-one", {
      path: "/agg/{id}",
      requirements: { methods: ["GET"] },
    });
    Router.createRoute("put-one", {
      path: "/agg/{id}",
      requirements: { methods: ["PUT"] },
    });
    const router = makeRouter();
    const ctx = makeCtx("/agg/7", "DELETE");
    expect(() => router.resolve(ctx)).to.throw();
    const rawAllow: unknown = ctx.response.headers.Allow;
    const allow = typeof rawAllow === "string" ? rawAllow : "";
    expect(allow).to.contain("GET");
    expect(allow).to.contain("PUT");
  });

  it("table SANS préfixe exploitable → scan intégral conservé (aucun raccourci abusif)", () => {
    for (let i = 0; i < 5; i++) {
      Router.createRoute(`var-${i}`, { path: `/{seg${i}}/x` });
    }
    Router.createRoute("last", { path: "/{seg}/y" });
    const router = makeRouter();
    let name: string | undefined;
    const calls = countMatches(() => {
      name = router.resolve(makeCtx("/a/y")).route?.name;
    });
    expect(name).to.equal("last");
    expect(calls).to.equal(6);
  });
});

describe("Routing index — raccourci littéral (le motif n'est pas exécuté)", () => {
  // Témoin : `String.prototype.match` passe par `exec` de la RegExp — une
  // propriété propre `exec` sur le motif de la route compte ses exécutions.
  function countExec(route: Route): () => number {
    const pattern = route.pattern as RegExp;
    const original = RegExp.prototype.exec;
    let calls = 0;
    pattern.exec = function (this: RegExp, s: string) {
      calls++;
      return original.call(this, s);
    };
    return () => calls;
  }

  it("chemin identique à la lettre : route servie, motif jamais exécuté, aucune capture", () => {
    const route = Router.createRoute("lit", { path: "/test/json" });
    const calls = countExec(route);
    const resolver = makeRouter().resolve(makeCtx("/test/json"));
    expect(resolver.route?.name).to.equal("lit");
    expect(
      Array.from(resolver.variables as unknown as unknown[]),
    ).to.deep.equal([]);
    expect(calls()).to.equal(0);
  });

  it("variante de casse : servie, mais jugée par le motif (drapeau i)", () => {
    const route = Router.createRoute("lit", { path: "/test/json" });
    const calls = countExec(route);
    expect(makeRouter().resolve(makeCtx("/TEST/Json")).route?.name).to.equal(
      "lit",
    );
    expect(calls()).to.equal(1);
  });

  it("signe Kelvin (U+212A) : la clé minuscule le confond avec k, le motif le refuse", () => {
    Router.createRoute("k", { path: "/k" });
    const resolver = makeRouter().resolve(makeCtx("/"), "/K");
    expect(resolver.resolve).to.equal(false);
  });

  it("littérale avec défaut positionnel : le motif s'exécute et le défaut reste capturé", () => {
    const route = Router.createRoute("def", {
      path: "/with/default",
      defaults: { name: "home" },
    });
    const calls = countExec(route);
    const resolver = makeRouter().resolve(makeCtx("/with/default"));
    expect(resolver.route?.name).to.equal("def");
    expect(calls()).to.equal(1);
    expect(
      Array.from(resolver.variables as unknown as unknown[]),
    ).to.deep.equal(["home"]);
  });

  it("l'hôte reste vérifié sur le raccourci : route d'un autre vhost → 403", () => {
    Router.createRoute("vhost", { path: "/vhost/only", host: "example.com" });
    expect(() => makeRouter().resolve(makeCtx("/vhost/only"))).to.throw(
      /Forbidden/,
    );
    expect(
      makeRouter().resolve(makeCtx("/vhost/only", "GET", "example.com")).route
        ?.name,
    ).to.equal("vhost");
  });

  it("les exigences restent appliquées sur le raccourci : GET sur une route POST → 405", () => {
    const route = Router.createRoute("post-only", {
      path: "/only/post",
      requirements: { methods: ["POST"] },
    });
    const calls = countExec(route);
    expect(() => makeRouter().resolve(makeCtx("/only/post", "GET"))).to.throw(
      /Not Allowed/,
    );
    expect(calls()).to.be.greaterThan(0); // pass 2 (Allow) teste le motif
    expect(
      makeRouter().resolve(makeCtx("/only/post", "POST")).route?.name,
    ).to.equal("post-only");
  });
});

describe("Routing index — routes de repli (`fallback`)", () => {
  // Vécu : le repli du Studio `GET /nodefony/{page}`, déclaré tôt, capturait
  // `GET /nodefony/mcp` de devkit (déclaré après) → 200 + HTML au lieu de 405,
  // et le client MCP se reconnectait chaque seconde.
  it("un repli déclaré EN PREMIER perd face à une littérale déclarée après", () => {
    Router.createRoute("spa", { path: "/nodefony/{page}", fallback: true });
    Router.createRoute("mcp", { path: "/nodefony/mcp" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/nodefony/mcp")).route?.name).to.equal(
      "mcp",
    );
    // Le repli sert toujours ce que personne d'autre ne sert.
    expect(router.resolve(makeCtx("/nodefony/logs")).route?.name).to.equal(
      "spa",
    );
  });

  it("…et face à une DYNAMIQUE déclarée après", () => {
    Router.createRoute("spa", { path: "/app/{page}", fallback: true });
    Router.createRoute("item", { path: "/app/{id}" });
    expect(makeRouter().resolve(makeCtx("/app/7")).route?.name).to.equal(
      "item",
    );
  });

  it("sans le drapeau, la règle reste « première déclarée gagne »", () => {
    Router.createRoute("spa", { path: "/nodefony/{page}" });
    Router.createRoute("mcp", { path: "/nodefony/mcp" });
    expect(makeRouter().resolve(makeCtx("/nodefony/mcp")).route?.name).to.equal(
      "spa",
    );
  });

  it("les replis gardent leur ordre RELATIF entre eux", () => {
    Router.createRoute("first", { path: "/f/{a}", fallback: true });
    Router.createRoute("second", { path: "/f/{b}", fallback: true });
    expect(makeRouter().resolve(makeCtx("/f/x")).route?.name).to.equal("first");
  });

  it("les méthodes départagent : POST → la route ordinaire, GET → le repli", () => {
    // La littérale ne sert que POST, le repli que GET : chacun garde sa méthode.
    Router.createRoute("spa", {
      path: "/nodefony/{page}",
      fallback: true,
      requirements: { methods: ["GET"] },
    });
    Router.createRoute("mcp", {
      path: "/nodefony/mcp",
      requirements: { methods: ["POST"] },
    });
    const router = makeRouter();
    expect(
      router.resolve(makeCtx("/nodefony/mcp", "POST")).route?.name,
    ).to.equal("mcp");
    expect(
      router.resolve(makeCtx("/nodefony/mcp", "GET")).route?.name,
    ).to.equal("spa");
  });
});

describe("Option `method` d'une route — elle RESTREINT, elle n'orne pas", () => {
  // Vécu : `@route("devkit-mcp", { path: "/mcp", method: "POST" })` servait
  // aussi GET — l'option n'était lue que pour l'affichage (`inspect`, journal),
  // jamais au match. Le client MCP recevait 400 au lieu de 405 et bouclait.
  it('method: "POST" → GET rend 405 avec Allow: POST', () => {
    Router.createRoute("only-post", { path: "/only/post-m", method: "POST" });
    const router = makeRouter();
    const ctx = makeCtx("/only/post-m", "GET");
    expect(() => router.resolve(ctx)).to.throw(/Not Allowed/);
    expect(ctx.response.headers.Allow).to.equal("POST");
    expect(
      makeRouter().resolve(makeCtx("/only/post-m", "POST")).route?.name,
    ).to.equal("only-post");
  });

  it('method: "GET" sert aussi HEAD (RFC 9110 §9.1), pas POST', () => {
    Router.createRoute("only-get", { path: "/only/get-m", method: "GET" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/only/get-m", "HEAD")).route?.name).to.equal(
      "only-get",
    );
    expect(() => router.resolve(makeCtx("/only/get-m", "POST"))).to.throw(
      /Not Allowed/,
    );
  });

  it("method ET requirements.methods → l'UNION, jamais l'écrasement", () => {
    Router.createRoute("both", {
      path: "/only/both",
      method: "POST",
      requirements: { methods: ["PUT"] },
    });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/only/both", "POST")).route?.name).to.equal(
      "both",
    );
    expect(router.resolve(makeCtx("/only/both", "PUT")).route?.name).to.equal(
      "both",
    );
  });

  it("sans method ni requirements → toutes les méthodes passent (inchangé)", () => {
    Router.createRoute("any", { path: "/only/any" });
    expect(
      makeRouter().resolve(makeCtx("/only/any", "DELETE")).route?.name,
    ).to.equal("any");
  });
});

describe("Route sans méthode déclarée — tous les verbes HTTP, JAMAIS le WebSocket", () => {
  // Vécu : une connexion WebSocket s'ouvrait sur `/nodefony/test/memory`,
  // action écrite pour HTTP — le contrôle des méthodes ne tournait pas faute
  // de déclaration. Le WebSocket (connexion ou pont `api.request`) se DÉCLARE.
  it("GET, POST, DELETE passent", () => {
    Router.createRoute("plain", { path: "/plain/any" });
    const router = makeRouter();
    for (const m of ["GET", "POST", "DELETE"]) {
      expect(router.resolve(makeCtx("/plain/any", m)).route?.name).to.equal(
        "plain",
      );
    }
  });

  it("une connexion WebSocket est refusée (405)", () => {
    Router.createRoute("plain", { path: "/plain/any" });
    expect(() =>
      makeRouter().resolve(makeCtx("/plain/any", "WEBSOCKET")),
    ).to.throw(/Not Allowed/);
  });

  it("le pont `api.request` est refusé (405)", () => {
    Router.createRoute("plain", { path: "/plain/any" });
    expect(() =>
      makeRouter().resolve(
        makeCtx("/plain/any", "WEBSOCKET"),
        "/plain/any",
        "GET",
      ),
    ).to.throw(/Not Allowed/);
  });

  it("WEBSOCKET déclaré → la connexion passe", () => {
    Router.createRoute("ws", {
      path: "/plain/ws",
      requirements: { methods: ["WEBSOCKET"] },
    });
    expect(
      makeRouter().resolve(makeCtx("/plain/ws", "WEBSOCKET")).route?.name,
    ).to.equal("ws");
  });
});

describe("Router.servesWebsocket — contrôle d'avant 101 (#577)", () => {
  const ws = (methods: HTTPMethod[], extra: Record<string, string> = {}) => ({
    requirements: { methods, ...extra },
  });

  it("seule une route qui DÉCLARE le transport WEBSOCKET sert le chemin", () => {
    Router.createRoute("http-only", { path: "/h" });
    Router.createRoute("get", { path: "/g", ...ws(["GET"]) });
    Router.createRoute("sock", { path: "/s", ...ws(["GET", "WEBSOCKET"]) });
    const router = makeRouter();
    expect(router.servesWebsocket("/s")).to.equal(true);
    expect(router.servesWebsocket("/h")).to.equal(false);
    expect(router.servesWebsocket("/g")).to.equal(false);
    expect(router.servesWebsocket("/inconnu")).to.equal(false);
  });

  it("même normalisation que resolve : barres finales et casse", () => {
    Router.createRoute("sock", { path: "/chat", ...ws(["WEBSOCKET"]) });
    const router = makeRouter();
    expect(router.servesWebsocket("/chat/")).to.equal(true);
    expect(router.servesWebsocket("/CHAT//")).to.equal(true);
    expect(router.resolve(makeCtx("/CHAT//", "WEBSOCKET")).resolve).to.equal(
      true,
    );
  });

  it("variables et racine : le motif de la route décide", () => {
    Router.createRoute("room", { path: "/room/{id}", ...ws(["WEBSOCKET"]) });
    Router.createRoute("root", { path: "/", ...ws(["WEBSOCKET"]) });
    const router = makeRouter();
    expect(router.servesWebsocket("/room/42")).to.equal(true);
    expect(router.servesWebsocket("/room")).to.equal(false);
    expect(router.servesWebsocket("/")).to.equal(true);
  });

  it("SUR-ENSEMBLE de resolve : hôte, protocole et exigences restent jugés après l'ouverture", () => {
    Router.createRoute("vhost", {
      path: "/v",
      host: "example.com",
      ...ws(["WEBSOCKET"], { protocol: "chat" }),
    });
    Router.createRoute("digits", {
      path: "/d/{n}",
      ...ws(["WEBSOCKET"], { n: "^\\d+$" }),
    });
    const router = makeRouter();
    // resolve refuserait (autre hôte, exigence de variable) : ce n'est pas un 404.
    expect(router.servesWebsocket("/v")).to.equal(true);
    expect(router.servesWebsocket("/d/abc")).to.equal(true);
  });
});
