import { expect } from "chai";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Container, Event } from "nodefony";
import Controller from "../../src/Controller.js";
import type Route from "../../src/Route.js";
import type { ContextType, HttpResponse } from "@nodefony/http";

const HERE = fileURLToPath(import.meta.url); // ce fichier = un vrai File
const DIR = path.dirname(HERE); // un vrai dossier

interface HarnessOptions {
  session?: unknown;
  sessions?: unknown;
  frontend?: unknown;
  router?: unknown;
  template?: unknown;
  requestEnded?: boolean;
  range?: string;
}

// Harnais : on construit un VRAI Controller (Container + Event réels) pour que
// setContext / get / once / log / le pipeline de stream fonctionnent comme en
// prod — le ctor exige juste un Context portant container + notificationsCenter.
// Les services (template/sessions/frontend/router) sont injectés dans le
// Container ; les I/O réseau (send/render/writeHead/raw response) sont des fakes
// instrumentés. Pas de serveur, pas de socket.
function makeController(opts: HarnessOptions = {}) {
  const calls = {
    send: [] as unknown[],
    render: [] as unknown[],
    json: 0,
    html: 0,
    redirect: [] as unknown[][],
    headers: [] as unknown[],
    status: [] as unknown[],
    writeHead: [] as unknown[][],
    end: 0,
    fileMime: 0,
  };

  // Réponse node brute (Writable) pour exercer le pipe de streamFile.
  const raw = new PassThrough();
  (raw as unknown as { removeHeader: () => void }).removeHeader = () => {};
  raw.on("data", () => {}); // drain pour laisser le flux atteindre "end"

  const response = {
    response: raw,
    statusCode: 200,
    encoding: "utf8" as const,
    setHeaders(h: unknown) {
      calls.headers.push(h);
    },
    setStatusCode(s: unknown) {
      calls.status.push(s);
      response.statusCode = s as number;
    },
    setEncoding() {},
    setFileMimeType() {
      calls.fileMime++;
    },
  };

  const ctx = {
    container: new Container(),
    notificationsCenter: new Event(),
    // Le vrai `Context` porte l'instrumentation de phases (`IContext`) — un stub
    // qui l'omet ne reproduit pas la donnée réelle et casse dès qu'un chemin la
    // mesure (renderView → phase `render`).
    phaseStart() {},
    phaseEnd() {},
    request: {
      url: new URL("http://127.0.0.1/test"),
      queryGet: { a: "1" },
      query: { b: "2" },
      queryFile: [],
      queryPost: { c: "3" },
      headers: opts.range ? { range: opts.range } : {},
    },
    method: "GET",
    session: opts.session,
    requestEnded: opts.requestEnded ?? true,
    security: false,
    finished: false,
    setContextJson() {
      calls.json++;
    },
    setContextHtml() {
      calls.html++;
    },
    send(data?: unknown) {
      calls.send.push(data);
      return Promise.resolve({});
    },
    render(data?: unknown) {
      calls.render.push(data);
      return Promise.resolve({});
    },
    redirect(url: string, status?: unknown, headers?: unknown) {
      calls.redirect.push([url, status, headers]);
    },
    writeHead(code: unknown, headers: unknown) {
      calls.writeHead.push([code, headers]);
    },
    end() {
      calls.end++;
    },
  };

  ctx.container.set(
    "template",
    (opts.template ?? { render: async () => "" }) as object,
  );
  if (opts.sessions) ctx.container.set("sessions", opts.sessions as object);
  if (opts.frontend) ctx.container.set("frontend", opts.frontend as object);
  if (opts.router) ctx.container.set("router", opts.router as object);

  const context = ctx as unknown as ContextType;
  const c = new Controller("test-ctrl", context);
  c.response = response as unknown as HttpResponse;
  return { c, calls, ctx, response };
}

// ─── setContext (via ctor) ────────────────────────────────────────────────────

describe("Controller — setContext()", () => {
  it("populates query fields, method and response from the context", () => {
    const { c } = makeController();
    expect(c.queryGet).to.deep.equal({ a: "1" });
    expect(c.query).to.deep.equal({ b: "2" });
    expect(c.queryPost).to.deep.equal({ c: "3" });
    expect(c.queryFile).to.deep.equal([]);
    expect(c.method).to.equal("GET");
  });

  it("hydrates the session when present on the context", () => {
    const session = { id: "s1" };
    const { c } = makeController({ session });
    expect(c.session).to.equal(session);
  });
});

// ─── content-type helpers ───────────────────────────────────────────────────

describe("Controller — setContextJson / setContextHtml", () => {
  it("delegate to the context", () => {
    const { c, calls } = makeController();
    c.setContextJson();
    c.setContextHtml();
    expect(calls.json).to.equal(1);
    expect(calls.html).to.equal(1);
  });
});

// ─── renderJson ───────────────────────────────────────────────────────────────

describe("Controller — renderJson()", () => {
  it("serializes the object and sends it as JSON", async () => {
    const { c, calls } = makeController();
    await c.renderJson({ name: "john" });
    expect(calls.json).to.equal(1);
    expect(calls.send).to.deep.equal(['{"name":"john"}']);
  });
});

// ─── render / renderResponse ──────────────────────────────────────────────────

describe("Controller — render()", () => {
  it("delegates to context.render with the data", async () => {
    const { c, calls } = makeController();
    await c.render("<h1>hi</h1>");
    expect(calls.render).to.deep.equal(["<h1>hi</h1>"]);
  });
});

describe("Controller — renderResponse()", () => {
  it("applies headers and status then sends", async () => {
    const { c, calls } = makeController();
    await c.renderResponse("body", "utf8", 201, { "X-Test": "1" });
    expect(calls.headers).to.deep.equal([{ "X-Test": "1" }]);
    expect(calls.status).to.deep.equal([201]);
    expect(calls.send).to.deep.equal(["body"]);
  });

  it("sends without touching headers/status when none given", async () => {
    const { c, calls } = makeController();
    await c.renderResponse("body");
    expect(calls.headers).to.have.lengthOf(0);
    expect(calls.status).to.have.lengthOf(0);
    expect(calls.send).to.deep.equal(["body"]);
  });
});

// ─── renderView ──────────────────────────────────────────────────────────────

describe("Controller — renderView()", () => {
  it("renders the template then sends as HTML (no frontend service)", async () => {
    const { c, calls } = makeController({
      template: {
        render: async (_tpl: string, locals: Record<string, unknown>) =>
          `VIEW:${JSON.stringify(locals)}`,
      },
    });
    await c.renderView(HERE, { user: "bob" });
    expect(calls.html).to.equal(1);
    expect(calls.send).to.deep.equal(['VIEW:{"user":"bob"}']);
  });

  it("injects frontend helpers into the template locals", async () => {
    let seenLocals: Record<string, unknown> = {};
    const { c } = makeController({
      frontend: {
        renderTags: (entry: string) => `<tags:${entry}>`,
        renderDocument: (entry: string) => `<doc:${entry}>`,
      },
      template: {
        render: async (_tpl: string, locals: Record<string, unknown>) => {
          seenLocals = locals;
          return "ok";
        },
      },
    });
    await c.renderView(HERE, { user: "bob" });
    expect(seenLocals).to.have.property("frontendTags");
    expect(seenLocals).to.have.property("frontendDocument");
    expect(seenLocals.user).to.equal("bob");
  });
});

// ─── setRoute / getSession ───────────────────────────────────────────────────

describe("Controller — setRoute() / getSession()", () => {
  it("setRoute stores and returns the route", () => {
    const { c } = makeController();
    const route = { name: "r" } as unknown as Route;
    expect(c.setRoute(route)).to.equal(route);
    expect(c.route).to.equal(route);
  });

  it("getSession returns the context session when present", () => {
    const session = { id: "s1" };
    const { c } = makeController({ session });
    expect(c.getSession()).to.equal(session);
  });

  it("getSession returns undefined when no session", () => {
    const { c } = makeController();
    expect(c.getSession()).to.be.undefined;
  });
});

// ─── session (getter) ───────────────────────────────────────────────────────

describe("Controller — session getter", () => {
  it("reflects context.session (activation pilotée par le pipeline)", () => {
    const fake = { id: "sid-1" } as unknown;
    const { c } = makeController();
    // Pas d'activation → null (lazy : @UseSession / cookie pilotent au pipeline).
    expect(c.session).to.equal(null);
    // Le point d'activation du pipeline pose context.session → le getter suit.
    (c.context as unknown as { session: unknown }).session = fake;
    expect(c.session).to.equal(fake);
    expect(c.getSession()).to.equal(fake);
  });
});

// ─── redirect ─────────────────────────────────────────────────────────────────

describe("Controller — redirect()", () => {
  it("calls context.redirect with the url", () => {
    const { c, calls } = makeController();
    c.redirect("/login", 302);
    expect(calls.redirect).to.deep.equal([["/login", 302, undefined]]);
  });

  it("throws when no url is given", () => {
    const { c } = makeController();
    expect(() => c.redirect("")).to.throw(/no url/);
  });
});

// ─── flash bag ────────────────────────────────────────────────────────────────

describe("Controller — flash bag", () => {
  function withSession() {
    const store: Record<string, unknown> = {};
    const session = {
      setFlashBag(k: string, v: unknown) {
        store[k] = v;
        return v;
      },
      getFlashBag(k: string) {
        return store[k];
      },
    };
    return { ...makeController({ session }), store };
  }

  it("setFlashBag / getFlashBag go through the session", () => {
    const { c } = withSession();
    c.setFlashBag("msg", "hello");
    expect(c.getFlashBag("msg")).to.equal("hello");
  });

  it("addFlash is an alias of setFlashBag", () => {
    const { c, store } = withSession();
    c.addFlash("a", 1);
    expect(store.a).to.equal(1);
  });

  it("setFlashBag returns null when no session", () => {
    const { c } = makeController(); // pas de session
    expect(c.setFlashBag("x", 1)).to.be.null;
  });

  it("getFlashBag logs and returns null when no session", () => {
    const { c } = makeController();
    expect(c.getFlashBag("x")).to.be.null;
  });
});

// ─── forward ─────────────────────────────────────────────────────────────────

describe("Controller — forward()", () => {
  it("resolves the target controller and calls its action", async () => {
    const resolver = {
      callController(param?: unknown[], reload?: boolean) {
        return Promise.resolve(`FWD:${param?.join(",")}:${reload}`);
      },
    };
    const router = {
      resolveController(_ctx: ContextType, name: string) {
        expect(name).to.equal("mod:ctrl:action");
        return resolver;
      },
    };
    const { c } = makeController({ router });
    const res = await c.forward("mod:ctrl:action", [1, 2]);
    expect(res).to.equal("FWD:1,2:true");
  });
});

// ─── getFile / getFileAsync ─────────────────────────────────────────────────────

describe("Controller — getFile()", () => {
  it("returns a FileClass for a real file", () => {
    const { c } = makeController();
    expect(c.getFile(HERE).type).to.equal("File");
  });

  it("throws for a directory (type !== File)", () => {
    const { c } = makeController();
    expect(() => c.getFile(DIR)).to.throw();
  });
});

describe("Controller — getFileAsync()", () => {
  it("resolves a FileClass for a real file", async () => {
    const { c } = makeController();
    expect((await c.getFileAsync(HERE)).type).to.equal("File");
  });

  it("throws for a directory", async () => {
    const { c } = makeController();
    let threw = false;
    try {
      await c.getFileAsync(DIR);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  // RFC 9110 §15.5.5 : le 404 est l'absence de « représentation courante pour la
  // ressource cible ». Le 500 (§15.6.1) suppose une condition INATTENDUE — or le
  // chemin vient d'un paramètre d'URL, donc un nom qui ne correspond à rien est
  // une entrée client ordinaire. Sans ce contrat, un lecteur vidéo demandant un
  // fichier supprimé faisait rendre 500 à l'application.
  it("fichier ABSENT → 404, et le chemin ne fuit pas dans le message", async () => {
    const { c } = makeController();
    const absent = path.join(DIR, "aucun-fichier-ici-9110.bin");
    let code: unknown = null;
    let message = "";
    try {
      await c.getFileAsync(absent);
    } catch (e) {
      code = (e as { code?: unknown }).code;
      message = (e as Error).message;
    }
    expect(code).to.equal(404);
    // La même section autorise le serveur à ne pas divulguer l'existence d'une
    // ressource : un chemin serveur dans un corps d'erreur est une fuite.
    expect(message).to.not.include("aucun-fichier-ici");
  });

  it("DOSSIER → 404 aussi : il n'est pas servable comme fichier", async () => {
    const { c } = makeController();
    let code: unknown = null;
    try {
      await c.getFileAsync(DIR);
    } catch (e) {
      code = (e as { code?: unknown }).code;
    }
    expect(code).to.equal(404);
  });
});

// ─── streaming (renderFileDownload / streamFile / renderMediaStream) ────────────

describe("Controller — renderFileDownload()", () => {
  it("streams a real file (writeHead + pipe + end)", async () => {
    const { c, calls } = makeController();
    const stream = await c.renderFileDownload(HERE);
    expect(stream).to.exist;
    expect(calls.writeHead).to.have.lengthOf(1);
    expect(calls.end).to.equal(1);
  });
});

describe("Controller — renderMediaStream()", () => {
  it("streams a full file when no Range header is present", async () => {
    const { c, calls } = makeController();
    await c.renderMediaStream(HERE);
    expect(calls.writeHead).to.have.lengthOf(1);
    expect(calls.end).to.equal(1);
  });

  it("serves a 206 partial response when a Range header is present", async () => {
    const { c, calls } = makeController({ range: "bytes=0-99" });
    await c.renderMediaStream(HERE);
    expect(calls.status).to.include(206);
    expect(calls.writeHead).to.have.lengthOf(1);
  });
});
