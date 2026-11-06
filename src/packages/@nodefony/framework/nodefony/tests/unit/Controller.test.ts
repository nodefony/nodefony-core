import { expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { Container, Event } from "nodefony";
import Controller from "../../src/Controller.js";
import { Scope } from "../../decorators/routerDecorators.js";
import type Route from "../../src/Route.js";
import { HttpContext } from "@nodefony/http";
import type {
  ContextType,
  HttpResponse,
  IByteStreamOptions,
  IByteStreamResult,
} from "@nodefony/http";

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
  /** Mode du kernel — la sonde CSP ne parle qu'en développement. */
  environment?: string;
  /** Valeur de `Content-Security-Policy` déjà posée sur la réponse. */
  csp?: string;
}

/**
 * Contrôleur PAR REQUÊTE : ce fichier éprouve l'API qu'un contrôleur tient de
 * SA requête (contexte reçu au constructeur, accesseurs inscriptibles). Le
 * singleton, lui, est éprouvé par `singletonDefault.test.ts`.
 */
@Scope("request")
class HarnessController extends Controller {}

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

  const response = {
    // Retrait d’en-tête : sur la réponse du contexte, jamais sur la brute.
    removeHeader() {},
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
    // La sonde CSP lit l'en-tête RÉELLEMENT posé — c'est le firewall qui le
    // compose, jamais une configuration relue.
    getHeader(name: string) {
      return name === "Content-Security-Policy" ? opts.csp : undefined;
    },
  };

  const ctx = {
    container: new Container(),
    notificationsCenter: new Event(),
    kernel: { environment: opts.environment ?? "production" },
    // Le vrai `Context` porte l'instrumentation de phases (`IContext`) — un stub
    // qui l'omet ne reproduit pas la donnée réelle et casse dès qu'un chemin la
    // mesure (renderView → phase `render`).
    phaseStart() {},
    phaseEnd() {},
    request: {
      url: new URL("http://127.0.0.1/test"),
      query: { a: "1" },
      files: [],
      body: { c: "3" },
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

  ctx.container.set("template", opts.template ?? { render: async () => "" });
  if (opts.sessions) ctx.container.set("sessions", opts.sessions);
  if (opts.frontend) ctx.container.set("frontend", opts.frontend);
  if (opts.router) ctx.container.set("router", opts.router);

  const context = ctx as unknown as ContextType;
  const c = new HarnessController("test-ctrl", context);
  c.response = response as unknown as HttpResponse;
  return { c, calls, ctx, response };
}

// ─── setContext (via ctor) ────────────────────────────────────────────────────

describe("Controller — setContext()", () => {
  it("populates query fields, method and response from the context", () => {
    const { c } = makeController();
    expect(c.query).to.deep.equal({ a: "1" });
    expect(c.body).to.deep.equal({ c: "3" });
    expect(c.files).to.deep.equal([]);
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

/**
 * La sonde CSP — un avertissement qui NOMME le geste, jamais un refus.
 *
 * Ce que ces cas défendent : un `<script>` en ligne sous une politique à nonce
 * ne s'exécutera PAS dans le navigateur, et personne ne le voit quand la page
 * est produite par un test, un `curl` ou un agent. Mesuré au banc de
 * découvrabilité : la doc portait la réponse, aucun message ne la nommait, et
 * la tâche restait rouge deux runs sur trois.
 *
 * Elle ne parle qu'en développement, ne change aucune réponse, et se tait sur
 * les trois formes qui sont DÉJÀ correctes.
 */
describe("Controller — avertissement CSP (script en ligne sans nonce)", () => {
  const CSP_NONCE = "default-src 'self'; script-src 'self' 'nonce-abc123'";
  const CSP_SANS_NONCE = "default-src 'self'; script-src 'self'";

  /** Remplace `log` par un espion — le message est ce qu'on mesure. */
  function espionner(c: Controller): string[] {
    const vus: string[] = [];
    (
      c as unknown as { log: (m: unknown, s?: unknown, t?: unknown) => void }
    ).log = (m: unknown) => {
      vus.push(String(m));
    };
    return vus;
  }

  it("avertit, et nomme la vue signée ET le nonce", async () => {
    const { c } = makeController({
      environment: "development",
      csp: CSP_NONCE,
    });
    const vus = espionner(c);
    await c.render("<html><body><script>let n = 0;</script></body></html>");
    expect(vus).to.have.lengthOf(1);
    // Le message doit porter le GESTE, pas seulement le constat : c'est toute
    // la différence entre un refus utilisable et un refus juste.
    expect(vus[0]).to.include("cspNonce");
    expect(vus[0]).to.include("renderView");
    expect(vus[0]).to.include("headers.md");
    // Le conseil d'avant le lot 1 (« un script servi passe 'self' ») est faux
    // sous 'strict-dynamic' : il ne doit plus jamais être donné.
    expect(vus[0]).not.to.include("satisfait");
  });

  it("se tait quand le script porte déjà son nonce", async () => {
    const { c } = makeController({
      environment: "development",
      csp: CSP_NONCE,
    });
    const vus = espionner(c);
    await c.render('<script nonce="abc123">let n = 0;</script>');
    expect(vus).to.have.lengthOf(0);
  });

  it("🔴 avertit aussi pour un script SERVI sans nonce — 'strict-dynamic' ignore 'self'", async () => {
    const { c } = makeController({
      environment: "development",
      csp: CSP_NONCE,
    });
    const vus = espionner(c);
    await c.render('<script type="module" src="/app/debugbar.js"></script>');
    expect(vus).to.have.lengthOf(1);
  });

  it("avertit pour un <style> sans nonce (politique de styles, ADR-0024 §C2)", async () => {
    const { c } = makeController({
      environment: "development",
      csp: CSP_NONCE,
    });
    const vus = espionner(c);
    await c.render("<style>body{}</style>");
    expect(vus).to.have.lengthOf(1);
  });

  it("se tait quand la politique n'exige aucun nonce", async () => {
    const { c } = makeController({
      environment: "development",
      csp: CSP_SANS_NONCE,
    });
    const vus = espionner(c);
    await c.render("<script>let n = 0;</script>");
    expect(vus).to.have.lengthOf(0);
  });

  it("ne coûte RIEN hors développement — même page, même politique", async () => {
    const { c } = makeController({ environment: "production", csp: CSP_NONCE });
    const vus = espionner(c);
    await c.render("<script>let n = 0;</script>");
    expect(vus).to.have.lengthOf(0);
  });

  it("avertit aussi sur une VUE rendue, pas seulement sur render()", async () => {
    const { c } = makeController({
      environment: "development",
      csp: CSP_NONCE,
      template: { render: async () => "<script>let n = 0;</script>" },
    });
    const vus = espionner(c);
    await c.renderView(HERE, {});
    expect(vus).to.have.lengthOf(1);
    expect(vus[0]).to.include("cspNonce");
  });

  it("ne change RIEN à la réponse envoyée", async () => {
    const { c, calls } = makeController({
      environment: "development",
      csp: CSP_NONCE,
    });
    espionner(c);
    await c.render("<script>let n = 0;</script>");
    expect(calls.render).to.deep.equal(["<script>let n = 0;</script>"]);
  });

  it("🔴 la lecture de l'en-tête TIENT sur une vraie réponse Node, pas seulement sur le faux", async () => {
    // Le contrôle d'INSTRUMENT, et il manquait. Les cas ci-dessus interrogent
    // un faux `getHeader` : ils prouvent la règle, jamais qu'elle s'applique au
    // chemin réel. Or le firewall pose l'en-tête en MINUSCULES
    // (`HttpResponse.setHeader` normalise), et la sonde le lit sous sa forme
    // canonique. Si Node distinguait les deux, la sonde serait muette en
    // production pendant que ces sept cas resteraient verts.
    const { createServer } = await import("node:http");
    const serveur = createServer((_req, res) => {
      res.setHeader("content-security-policy", CSP_NONCE);
      // La question, et elle ne se pose qu'ici : la casse canonique retrouve
      // ce que la casse basse a écrit ?
      res.end(String(res.getHeader("Content-Security-Policy") ?? ""));
    });
    await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
    const { port } = serveur.address() as { port: number };
    try {
      const reponse = await fetch(`http://127.0.0.1:${port}/`);
      expect(await reponse.text()).to.equal(CSP_NONCE);
    } finally {
      await new Promise<void>((r) => serveur.close(() => r()));
    }
  });
});

describe("Controller — renderStream() hors requête HTTP", () => {
  it("refuse en 500 et DÉTRUIT la source confiée (sinon producteur orphelin)", () => {
    const { c } = makeController();
    const source = new Readable({
      read() {
        // Jamais lue : l'appel est refusé.
      },
    });
    expect(() => c.renderStream(source)).to.throw(/requête HTTP/);
    expect(source.destroyed, "source détruite").to.equal(true);
  });

  it("…et ANNULE un flux web (l'amont d'un fetch se ferme)", async () => {
    const { c } = makeController();
    let cancelled = false;
    const web = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    expect(() => c.renderStream(web)).to.throw(/requête HTTP/);
    await new Promise((r) => setImmediate(r));
    expect(cancelled, "flux web annulé").to.equal(true);
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

  it("🔴 signe le gabarit et donne le nonce de la REQUÊTE à la vue (ADR-0024 §C0)", async () => {
    let seenSource = "";
    let seenLocals: Record<string, unknown> = {};
    const { c } = makeController({
      template: {
        render: async (tpl: string, locals: Record<string, unknown>) => {
          seenSource = tpl;
          seenLocals = locals;
          return "ok";
        },
      },
    });
    (c.context as unknown as { cspNonce: string }).cspNonce = "N0nce==";
    const view = path.join(
      mkdtempSync(path.join(tmpdir(), "nf-view-nonce-")),
      "index.eta",
    );
    writeFileSync(view, '<style>p{}</style><script src="/app/x.js"></script>');
    try {
      await c.renderView(view, { user: "bob" });
    } finally {
      rmSync(path.dirname(view), { recursive: true, force: true });
    }
    expect(seenSource).toBe(
      '<style nonce="<%= it.cspNonce %>">p{}</style><script nonce="<%= it.cspNonce %>" src="/app/x.js"></script>',
    );
    expect(seenLocals.cspNonce).toBe("N0nce==");
    expect(seenLocals.user).toBe("bob");
    // Accesseur non énumérable : rien de plus dans un JSON de locals.
    expect(Object.keys(seenLocals)).not.toContain("cspNonce");
  });

  it("un `cspNonce` fourni par l'action est gardé", async () => {
    let seenLocals: Record<string, unknown> = {};
    const { c } = makeController({
      template: {
        render: async (_tpl: string, locals: Record<string, unknown>) => {
          seenLocals = locals;
          return "ok";
        },
      },
    });
    await c.renderView(HERE, { cspNonce: "mine" });
    expect(seenLocals.cspNonce).toBe("mine");
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

// `getFile` est déprécié mais conservé pour compat : ces tests gardent
// précisément ce contrat tant qu'il existe.
describe("Controller — getFile()", () => {
  it("returns a FileClass for a real file", () => {
    const { c } = makeController();
    // oxlint-disable-next-line typescript/no-deprecated
    expect(c.getFile(HERE).type).to.equal("File");
  });

  it("throws for a directory (type !== File)", () => {
    const { c } = makeController();
    // oxlint-disable-next-line typescript/no-deprecated
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

// ─── fichiers en flux (streamFile / renderFileDownload / renderMediaStream) ──
// Le cycle de vie appartient à la brique de `@nodefony/http` (`openStream`),
// éprouvée sur serveur réel (`http/tests/http/byteStream.test.ts`). Ici : ce que
// le contrôleur lui CONFIE — la source, le statut, les en-têtes, les options.

interface IOpened {
  source: Readable;
  options: IByteStreamOptions | undefined;
  self: unknown;
  bytes: number;
}

/**
 * Le harnais, avec un contexte HTTP : `openStream` relève ce qu'on lui confie,
 * lit la source jusqu'au bout puis la détruit — ce que fait la brique.
 */
function makeHttpController(opts: HarnessOptions = {}) {
  const harness = makeController(opts);
  const opened: IOpened[] = [];
  Object.setPrototypeOf(harness.ctx, HttpContext.prototype);
  Object.defineProperty(harness.ctx, "response", { value: harness.response });
  Object.defineProperty(harness.ctx, "openStream", {
    async value(
      this: unknown,
      source: Readable,
      options?: IByteStreamOptions,
    ): Promise<IByteStreamResult> {
      const entry: IOpened = { source, options, self: this, bytes: 0 };
      opened.push(entry);
      for await (const chunk of source) entry.bytes += (chunk as Buffer).length;
      source.destroy();
      return { reason: "end", bytes: entry.bytes };
    },
  });
  return { ...harness, opened };
}

describe("Controller — fichiers en flux", () => {
  const SIZE = statSync(HERE).size;

  it("hors requête HTTP : refus 500", async () => {
    const { c } = makeController();
    await expect(c.streamFile(HERE)).rejects.toThrow(/requête HTTP/);
  });

  it("streamFile confie le fichier à la brique : source finie, sans délai d'inactivité, taille et type posés", async () => {
    const { c, ctx, opened, calls } = makeHttpController();
    const stream = await c.streamFile(HERE);
    expect(opened).to.have.lengthOf(1);
    const entry = opened[0] as IOpened;
    expect(entry.self, "ouvert sur le contexte de la requête").to.equal(ctx);
    expect(entry.source).to.equal(stream);
    expect(entry.options?.live).to.equal(false);
    expect(entry.options?.idleTimeout).to.equal(0);
    expect(entry.options?.status).to.equal(200);
    expect(entry.options?.headers?.["Content-Length"]).to.equal(SIZE);
    expect(entry.bytes).to.equal(SIZE);
    expect(calls.fileMime, "type déduit du nom").to.equal(1);
    expect(stream?.destroyed).to.equal(true);
  });

  it("un extrait (start/end) annonce SA longueur, et la lecture est bornée à la taille relevée", async () => {
    const { c, opened } = makeHttpController();
    await c.streamFile(HERE, {}, { start: 10 });
    expect(opened[0]?.options?.headers?.["Content-Length"]).to.equal(SIZE - 10);
    expect(opened[0]?.bytes).to.equal(SIZE - 10);
    const read = opened[0]?.source as unknown as { end: number } | undefined;
    expect(read?.end).to.equal(SIZE - 1);
    await c.streamFile(HERE, {}, { start: 10, end: 19 });
    expect(opened[1]?.options?.headers?.["Content-Length"]).to.equal(10);
    expect(opened[1]?.bytes).to.equal(10);
  });

  it("le type fourni par l'appelant gagne, et ses en-têtes ne sont pas modifiés", async () => {
    const { c, opened, calls } = makeHttpController();
    const headers = { "content-type": "application/json" };
    await c.streamFile(HERE, headers);
    expect(headers).to.deep.equal({ "content-type": "application/json" });
    expect(calls.fileMime).to.equal(0);
    expect(opened[0]?.options?.headers?.["Content-Length"]).to.equal(SIZE);
  });

  it("renderFileDownload : pièce jointe, fichier entier", async () => {
    const { c, opened } = makeHttpController();
    await c.renderFileDownload(HERE);
    const headers = opened[0]?.options?.headers ?? {};
    expect(String(headers["Content-Disposition"])).to.match(/^attachment;/);
    expect(headers["Content-Length"]).to.equal(SIZE);
    expect(opened[0]?.bytes).to.equal(SIZE);
  });

  it("renderMediaStream sans Range : 200, fichier entier, plages annoncées", async () => {
    const { c, opened } = makeHttpController();
    await c.renderMediaStream(HERE);
    expect(opened[0]?.options?.status).to.equal(200);
    expect(opened[0]?.options?.headers?.["Accept-Ranges"]).to.equal("bytes");
    expect(opened[0]?.bytes).to.equal(SIZE);
  });

  it("Content-Disposition : un nom ASCII part tel quel", async () => {
    const { c, opened } = makeHttpController();
    await c.renderFileDownload(HERE);
    expect(opened[0]?.options?.headers?.["Content-Disposition"]).to.equal(
      `attachment; filename="${path.basename(HERE)}"`,
    );
  });

  it("Content-Disposition : un nom accentué part en filename* UTF-8, avec un repli ASCII (RFC 6266 §4.3, RFC 8187)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nf-disposition-"));
    try {
      const file = path.join(dir, "café 100%€.txt");
      writeFileSync(file, "x");
      const { c, opened } = makeHttpController();
      await c.renderFileDownload(file);
      expect(opened[0]?.options?.headers?.["Content-Disposition"]).to.equal(
        "attachment; filename=\"caf_ 100__.txt\"; filename*=UTF-8''caf%C3%A9%20100%25%E2%82%AC.txt",
      );
      await c.renderMediaStream(file);
      expect(
        String(opened[1]?.options?.headers?.["Content-Disposition"]),
      ).to.match(/^inline; filename="caf_ 100__\.txt"; filename\*=UTF-8''/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("téléchargement déjà périmé pour un cache, en HTTP-date VALIDE (RFC 9111 §5.3)", async () => {
    const { c, opened } = makeHttpController();
    await c.renderFileDownload(HERE);
    const expires = String(opened[0]?.options?.headers?.Expires);
    expect(new Date(expires).getTime()).to.equal(0);
    expect(expires).to.match(
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
    );
  });

  it("HEAD avec Range : la plage est IGNORÉE, en-têtes du GET complet (RFC 9110 §14.2)", async () => {
    const { c, opened, calls } = makeHttpController({ range: "bytes=0-99" });
    c.method = "HEAD";
    await c.renderMediaStream(HERE);
    expect(calls.status).to.not.include(206);
    expect(opened[0]?.options?.status).to.equal(200);
    expect(opened[0]?.options?.headers?.["Content-Range"]).to.equal(undefined);
    expect(opened[0]?.options?.headers?.["Content-Length"]).to.equal(
      String(SIZE),
    );
  });

  it("If-Range dont l'étiquette ne correspond pas : Range IGNORÉ, fichier entier en 200 (RFC 9110 §13.1.5)", async () => {
    const { c, ctx, opened, calls } = makeHttpController({
      range: "bytes=0-99",
    });
    (
      ctx as unknown as { request: { headers: Record<string, string> } }
    ).request.headers["if-range"] = '"v1"';
    await c.renderMediaStream(HERE);
    expect(calls.status).to.not.include(206);
    expect(opened[0]?.options?.status).to.equal(200);
    expect(opened[0]?.bytes).to.equal(SIZE);
  });

  it("renderMediaStream avec Range : 206, la plage seule", async () => {
    const { c, opened, calls } = makeHttpController({ range: "bytes=0-99" });
    await c.renderMediaStream(HERE);
    expect(calls.status).to.include(206);
    expect(opened[0]?.options?.status).to.equal(206);
    expect(opened[0]?.options?.headers?.["Content-Range"]).to.equal(
      `bytes 0-99/${SIZE}`,
    );
    expect(opened[0]?.bytes).to.equal(100);
  });
});

describe("Controller.log — module signataire", () => {
  it("le module du contrôleur signe par défaut, plus le noyau", () => {
    const { c } = makeController();
    c.module = { name: "app" } as never;
    expect(c.log("ok", "INFO", "APP").moduleName).toBe("app");
  });

  it("context.logModule prime sur le module du contrôleur, l'argument explicite sur tout", () => {
    const { c, ctx } = makeController();
    c.module = { name: "app" } as never;
    Object.assign(ctx, { logModule: "billing" });
    expect(c.log("ok", "INFO", "APP").moduleName).toBe("billing");
    expect(c.log("ok", "INFO", "APP", undefined, "audit").moduleName).toBe(
      "audit",
    );
  });
});

describe("Controller — requêtes conditionnelles sur un fichier (RFC 9110 §13)", () => {
  /** Pose des en-têtes de requête sur le contexte du harnais. */
  function withRequestHeaders(
    ctx: unknown,
    headers: Record<string, string>,
  ): void {
    Object.assign(
      (ctx as { request: { headers: Record<string, string> } }).request.headers,
      headers,
    );
  }

  /** Les validateurs servis par un premier GET sans condition. */
  async function served(): Promise<{ etag: string; lastModified: string }> {
    const { c, opened } = makeHttpController();
    await c.streamFile(HERE);
    const head = opened[0]?.options?.headers ?? {};
    return {
      etag: String(head.ETag),
      lastModified: String(head["Last-Modified"]),
    };
  }

  it("un fichier part avec ETag forte, Last-Modified et `Cache-Control: private, no-cache`", async () => {
    const { c, opened } = makeHttpController();
    await c.streamFile(HERE);
    const head = opened[0]?.options?.headers ?? {};
    expect(String(head.ETag)).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(Date.parse(String(head["Last-Modified"]))).toBe(
      Math.floor(statSync(HERE).mtimeMs / 1000) * 1000,
    );
    expect(head["Cache-Control"]).toBe("private, no-cache");
  });

  it("If-None-Match égale : 304 SANS ouvrir le fichier, validateurs et Cache-Control portés, `null` rendu", async () => {
    const { etag } = await served();
    const { c, ctx, opened, calls } = makeHttpController();
    withRequestHeaders(ctx, { "if-none-match": etag });
    const result = await c.streamFile(HERE);
    expect(result).toBeNull();
    expect(opened).toHaveLength(0);
    expect(calls.status).toContain(304);
    const sent = calls.headers.at(-1) as Record<string, unknown>;
    expect(sent.ETag).toBe(etag);
    expect(sent["Cache-Control"]).toBe("private, no-cache");
    expect(sent["Last-Modified"]).toBeDefined();
  });

  it("If-Modified-Since à la date servie : 304 ; plus ancienne : 200", async () => {
    const { lastModified } = await served();
    const fresh = makeHttpController();
    withRequestHeaders(fresh.ctx, { "if-modified-since": lastModified });
    expect(await fresh.c.streamFile(HERE)).toBeNull();
    expect(fresh.calls.status).toContain(304);
    const old = makeHttpController();
    withRequestHeaders(old.ctx, {
      "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT",
    });
    await old.c.streamFile(HERE);
    expect(old.opened).toHaveLength(1);
  });

  it("If-Match qui ne correspond pas : 412, fichier non ouvert", async () => {
    const { c, ctx, opened, calls } = makeHttpController();
    withRequestHeaders(ctx, { "if-match": '"autre"' });
    expect(await c.streamFile(HERE)).toBeNull();
    expect(opened).toHaveLength(0);
    expect(calls.status).toContain(412);
  });

  it("téléchargement : le 304 garde `Expires` (RFC 9110 §15.4.5)", async () => {
    const { etag } = await served();
    const { c, ctx, calls } = makeHttpController();
    withRequestHeaders(ctx, { "if-none-match": etag });
    expect(await c.renderFileDownload(HERE)).toBeNull();
    const sent = calls.headers.at(-1) as Record<string, unknown>;
    expect(sent.Expires).toBe("Thu, 01 Jan 1970 00:00:00 GMT");
    expect(sent["Content-Disposition"]).toBeUndefined();
  });

  it("Cache-Control et ETag de l'action gagnent — et l'ETag de l'action sert à comparer", async () => {
    const own = makeHttpController();
    await own.c.streamFile(HERE, {
      "cache-control": "public, max-age=60",
      etag: '"v7"',
    });
    const head = own.opened[0]?.options?.headers ?? {};
    expect(head["cache-control"]).toBe("public, max-age=60");
    expect(head["Cache-Control"]).toBeUndefined();
    expect(head.etag).toBe('"v7"');
    expect(head.ETag).toBeUndefined();
    const again = makeHttpController();
    withRequestHeaders(again.ctx, { "if-none-match": '"v7"' });
    expect(await again.c.streamFile(HERE, { etag: '"v7"' })).toBeNull();
    expect(again.calls.status).toContain(304);
  });

  it("un extrait (start/end) n'est pas la représentation : ni validateur ni évaluation", async () => {
    const { etag } = await served();
    const { c, ctx, opened } = makeHttpController();
    withRequestHeaders(ctx, { "if-none-match": etag });
    await c.streamFile(HERE, {}, { start: 0, end: 9 });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.options?.headers?.ETag).toBeUndefined();
  });

  it("média : If-Range égale à l'ETag → 206 ; à l'ETag faible → 200 entier", async () => {
    const { etag } = await served();
    const strong = makeHttpController({ range: "bytes=0-99" });
    withRequestHeaders(strong.ctx, { "if-range": etag });
    await strong.c.renderMediaStream(HERE);
    expect(strong.opened[0]?.options?.status).toBe(206);
    expect(strong.opened[0]?.bytes).toBe(100);
    expect(strong.opened[0]?.options?.headers?.ETag).toBe(etag);
    const weak = makeHttpController({ range: "bytes=0-99" });
    withRequestHeaders(weak.ctx, { "if-range": `W/${etag}` });
    await weak.c.renderMediaStream(HERE);
    expect(weak.opened[0]?.options?.status).toBe(200);
    expect(weak.opened[0]?.bytes).toBe(statSync(HERE).size);
  });

  it("média : If-Range égale à Last-Modified → 206", async () => {
    const { lastModified } = await served();
    const { c, ctx, opened } = makeHttpController({ range: "bytes=0-99" });
    withRequestHeaders(ctx, { "if-range": lastModified });
    await c.renderMediaStream(HERE);
    expect(opened[0]?.options?.status).toBe(206);
  });

  it("média : If-None-Match égale l'emporte sur Range → 304, rien d'ouvert", async () => {
    const { etag } = await served();
    const { c, ctx, opened, calls } = makeHttpController({
      range: "bytes=0-99",
    });
    withRequestHeaders(ctx, { "if-none-match": etag });
    await c.renderMediaStream(HERE);
    expect(opened).toHaveLength(0);
    expect(calls.status).toContain(304);
  });
});
