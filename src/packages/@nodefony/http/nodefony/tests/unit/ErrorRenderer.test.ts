/// <reference types="node" />
import { expect } from "chai";
import { Nodefony } from "nodefony";
import DefaultErrorRenderer from "../../service/error-renderer.js";
import HttpError from "../../src/errors/httpError.js";

// Minimal context shape — DefaultErrorRenderer.renderHttp only touches
// context.metaData. We don't need a real HttpContext here.
function fakeHttpContext(): { metaData: Record<string, unknown> } {
  return {
    metaData: {
      nodefony: {
        requestId: "test-req-id",
        scheme: "https",
      },
      result: null,
    },
  };
}

function fakeWsContext(opts: { rejected: boolean }): { rejected: boolean } {
  return { rejected: opts.rejected };
}

describe("DefaultErrorRenderer — unit tests (P1.5)", () => {
  const renderer = new DefaultErrorRenderer();

  describe("renderHttp", () => {
    it("preserves error code as status when valid", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(
        new HttpError("Forbidden", 403),
        ctx as never,
      );
      expect(r.status).to.equal(403);
      expect(r.message).to.equal("Forbidden");
    });

    it("normalises code=200 to 500 (legacy quirk)", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new HttpError("oops", 200), ctx as never);
      expect(r.status).to.equal(500);
    });

    it("defaults to 500 when no code", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new Error("plain error"), ctx as never);
      expect(r.status).to.equal(500);
    });

    it("body is the context.metaData (mutated with error/code/message)", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(
        new HttpError("Not Found", 404),
        ctx as never,
      );
      expect(r.body).to.equal(ctx.metaData);
      const m = ctx.metaData as {
        code: number;
        message: string;
        error: unknown;
        nodefony: unknown;
      };
      expect(m.code).to.equal(404);
      expect(m.message).to.equal("Not Found");
      expect(m.error).to.be.an("object");
      // legacy contract: requestId stays under nodefony.*
      expect(m.nodefony).to.have.property("requestId", "test-req-id");
    });

    it("wraps native Error into HttpError-like shape with error.toJSON()", () => {
      const ctx = fakeHttpContext();
      renderer.renderHttp(new TypeError("native"), ctx as never);
      const m = ctx.metaData as { error: { message?: string } };
      expect(m.error.message).to.include("native");
    });
  });

  describe("renderWebsocket", () => {
    it("clamps HTTP-style code in connected phase to 1011", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        new HttpError("server fail", 500),
        ctx as never,
      );
      expect(r.code).to.equal(1011);
    });

    it("keeps valid WS code in connected phase", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        new HttpError("policy", 1008),
        ctx as never,
      );
      expect(r.code).to.equal(1008);
    });

    // Régression J3b : un refus d'AUTH au handshake (401/403) DOIT fermer en
    // 1008 (Policy Violation) → le RealtimeClient n'essaie PAS de reconnecter.
    // Le clamp brut `< 1000 → 1011` (corrigé) écrasait 401 en 1011 (Internal
    // Error) → reconnexion en boucle → Studio bloquée au chargement anonyme.
    it("auth refusal 401 in connected phase → 1008 (Policy Violation, no reconnect)", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        new HttpError("Authentication required", 401),
        ctx as never,
      );
      expect(r.code).to.equal(1008);
    });

    it("forbidden 403 in connected phase → 1008", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        new HttpError("forbidden", 403),
        ctx as never,
      );
      expect(r.code).to.equal(1008);
    });

    it("not found 404 in connected phase → 4004 (privé app, pas 1011)", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        new HttpError("not found", 404),
        ctx as never,
      );
      expect(r.code).to.equal(4004);
    });

    it("clamps code > 599 to 500 in reject phase", () => {
      const ctx = fakeWsContext({ rejected: true });
      const r = renderer.renderWebsocket(
        new HttpError("weird", 9999),
        ctx as never,
      );
      expect(r.code).to.equal(500);
    });

    it("reason carries the error message", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        new HttpError("custom reason", 1002),
        ctx as never,
      );
      expect(r.reason).to.equal("custom reason");
    });
  });

  // Une donnée refusée par un schéma n'est pas une requête malformée : le corps a été
  // parsé, c'est son CONTENU qui viole le contrat → 422 (RFC 9110 §15.5.21), et le
  // client doit savoir QUEL champ corriger.
  describe("erreur de validation (Zod) → 422", () => {
    /**
     * Erreur telle que la produit zod. Reconstituée à la main (et non `z.parse()`) :
     * la reconnaissance est STRUCTURELLE côté renderer — une app peut embarquer sa
     * propre copie de zod, et un `instanceof` échouerait alors en silence.
     */
    function zodError(
      issues: { path: string[]; message: string; code: string }[],
    ): Error {
      const e = new Error("validation") as Error & { issues: unknown };
      e.name = "ZodError";
      e.issues = issues;
      return e;
    }

    it("rend 422 (pas 400, pas 500)", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(
        zodError([
          {
            path: ["title"],
            message: "String must contain at least 3",
            code: "too_small",
          },
        ]),
        ctx as never,
      );
      expect(r.status).to.equal(422);
    });

    it("nomme les champs fautifs dans le corps", () => {
      const ctx = fakeHttpContext();
      renderer.renderHttp(
        zodError([
          { path: ["title"], message: "trop court", code: "too_small" },
          {
            path: ["author", "email"],
            message: "email invalide",
            code: "invalid_string",
          },
        ]),
        ctx as never,
      );
      const error = ctx.metaData.error as { fields?: unknown };
      expect(error.fields).to.deep.equal([
        { field: "title", message: "trop court", rule: "too_small" },
        {
          field: "author.email",
          message: "email invalide",
          rule: "invalid_string",
        },
      ]);
    });

    it("résume les champs dans le message", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(
        zodError([{ path: ["slug"], message: "déjà pris", code: "custom" }]),
        ctx as never,
      );
      expect(r.message).to.contain("slug: déjà pris");
    });

    it("une erreur ordinaire reste 500 — la détection ne déborde pas", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new Error("boom"), ctx as never);
      expect(r.status).to.equal(500);
    });

    it("un homonyme sans `issues` n'est PAS traité comme une validation", () => {
      const ctx = fakeHttpContext();
      const impostor = new Error("faux") as Error & { name: string };
      impostor.name = "ZodError"; // nom seul : pas de tableau d'anomalies
      const r = renderer.renderHttp(impostor, ctx as never);
      expect(r.status).to.equal(500);
    });

    it("sur WebSocket aussi : le 422 est mappé en code de fermeture (pas 1011)", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(
        zodError([
          { path: ["qty"], message: "doit être positif", code: "too_small" },
        ]),
        ctx as never,
      );
      // 4xx → 4004 côté WS (cf toWsCloseCode) : le client ne doit pas reconnecter
      // en boucle comme sur une erreur serveur (1011).
      expect(r.code).to.not.equal(1011);
      expect(r.reason).to.contain("qty");
    });
  });
});

/**
 * F189 — ce qui sort d'une panne, en production.
 *
 * Le renderer est le point de passage UNIQUE des deux transports : ce qu'on
 * scelle ici vaut pour la réponse HTTP et pour la trame de fermeture WS. En WS
 * l'enjeu est plus vif encore — le controller est instancié au handshake, donc
 * AVANT le firewall : une exception de son `initialize()` ferme la socket d'un
 * client anonyme.
 */
describe("DefaultErrorRenderer — ce qui fuit en production (F189)", () => {
  const renderer = new DefaultErrorRenderer();
  let previous: unknown;

  /** Erreur de validation à la forme d'un `ZodError` (reconnaissance structurelle). */
  const zodError = (
    issues: { path: string[]; message: string; code: string }[],
  ): Error => {
    const e = new Error("validation") as Error & { issues: unknown };
    e.name = "ZodError";
    e.issues = issues;
    return e;
  };

  /** Fait croire au singleton qu'un kernel tourne dans l'environnement demandé. */
  const pretendEnvironment = (environment: string): void => {
    (Nodefony as unknown as { setKernel(k: unknown): void }).setKernel({
      environment,
    });
  };

  beforeEach(() => {
    previous = (Nodefony as unknown as { getKernel(): unknown }).getKernel();
  });

  afterEach(() => {
    (Nodefony as unknown as { setKernel(k: unknown): void }).setKernel(
      previous as never,
    );
  });

  it("HTTP 500 : le message de l'exception ne franchit pas la frontière", () => {
    pretendEnvironment("production");
    const ctx = fakeHttpContext();
    const r = renderer.renderHttp(
      new Error("connect ECONNREFUSED 10.0.0.7:5432 — table users_secret"),
      ctx as never,
    );
    expect(r.status).to.equal(500);
    expect(r.message).to.equal("Internal Server Error");
    expect(JSON.stringify(r.body)).to.not.contain("users_secret");
    expect(JSON.stringify(r.body)).to.not.contain("10.0.0.7");
  });

  it("HTTP 500 : la stack ne franchit pas la frontière", () => {
    pretendEnvironment("production");
    const ctx = fakeHttpContext();
    renderer.renderHttp(new Error("boom"), ctx as never);
    const body = ctx.metaData as { error: Record<string, unknown> };
    expect(body.error).to.not.have.property("stack");
    expect(body.error).to.not.have.property("controller");
    expect(body.error).to.not.have.property("action");
  });

  it("HTTP 4xx : le message VOULU par le framework passe (403 n'est pas une fuite)", () => {
    pretendEnvironment("production");
    const ctx = fakeHttpContext();
    const r = renderer.renderHttp(
      new HttpError("Forbidden", 403),
      ctx as never,
    );
    expect(r.status).to.equal(403);
    expect(r.message).to.equal("Forbidden");
  });

  it("HTTP 422 : les champs fautifs restent lisibles (le client doit corriger)", () => {
    pretendEnvironment("production");
    const ctx = fakeHttpContext();
    const r = renderer.renderHttp(
      zodError([{ path: ["email"], message: "invalide", code: "invalid" }]),
      ctx as never,
    );
    expect(r.status).to.equal(422);
    expect(JSON.stringify(r.body)).to.contain("email");
  });

  it("WS 1011 : la raison de fermeture n'emporte pas le message d'exception", () => {
    pretendEnvironment("production");
    const ctx = fakeWsContext({ rejected: false });
    const r = renderer.renderWebsocket(
      new Error("boom: controller initialize() crashed at /srv/app/secret.ts"),
      ctx as never,
    );
    expect(r.code).to.equal(1011);
    expect(r.reason).to.equal("Internal Server Error");
    expect(r.reason).to.not.contain("secret.ts");
  });

  it("WS 1008 : un refus de policy garde son motif (le client doit renoncer)", () => {
    pretendEnvironment("production");
    const ctx = fakeWsContext({ rejected: false });
    const r = renderer.renderWebsocket(
      new HttpError("Forbidden", 403),
      ctx as never,
    );
    expect(r.code).to.equal(1008);
    expect(r.reason).to.equal("Forbidden");
  });

  it("DÉVELOPPEMENT : le détail reste servi, sinon on débogue à l'aveugle", () => {
    pretendEnvironment("development");
    const ctx = fakeHttpContext();
    const r = renderer.renderHttp(
      new Error("boom au fond du puits"),
      ctx as never,
    );
    expect(r.message).to.equal("boom au fond du puits");
    const body = ctx.metaData as { error: Record<string, unknown> };
    expect(body.error).to.have.property("stack");
  });

  it("`prod` écrit à la main est normalisé par le kernel — la garde ne teste QUE `production`", () => {
    // Kernel.setEnv() réduit toujours l'environnement à development|production.
    // Ce test scelle la raison pour laquelle la garde ne compare pas à "prod" :
    // un kernel réel ne porte jamais cette valeur.
    pretendEnvironment("prod");
    const ctx = fakeHttpContext();
    const r = renderer.renderHttp(new Error("brut"), ctx as never);
    expect(r.message).to.equal("brut");
  });
});
