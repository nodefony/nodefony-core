/// <reference types="node" />
import { expect } from "vitest";
import {
  Container,
  INSECURE_TRANSPORT_MESSAGE,
  RequestContext,
} from "nodefony";
import SessionAuthController from "../../controller/SessionAuthController.js";
import TokenAuthController from "../../controller/TokenAuthController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Le refus d'un secret reçu en clair (403, levé par security) doit SORTIR des
 * routes de connexion tel quel — pas en 500, pas en 401.
 *
 * Deux faits que seul ce banc tient, framework ne connaissant pas les classes
 * de security (duck-typing sur `code`) :
 *  - les deux contrôleurs rendent le 403 avec le message constant du cœur, que
 *    le navigateur reconnaît pour ne pas dire « mot de passe incorrect » ;
 *  - la route de jeton TRANSMET la requête au service : sans elle, il n'y a pas
 *    de transport à juger, et la garde se tairait sur cette porte.
 */

/** L'erreur telle que security la lève : seul son contrat est lu. */
const insecure = () =>
  Object.assign(new Error(INSECURE_TRANSPORT_MESSAGE), { code: 403 });

function makeContext(services: Record<string, unknown>): ContextType {
  const container = new Container();
  for (const [name, svc] of Object.entries(services)) container.set(name, svc);
  return {
    container,
    notificationsCenter: false,
    scheme: "http",
    request: { headers: {}, queryPost: {} },
  } as unknown as ContextType;
}

type Rendered = { body: unknown; status: unknown };

/** Neutralise la sortie HTTP : le rendu se lit dans le tableau rendu. */
function captureRender(
  ctrl: object,
  body: Record<string, unknown>,
): Rendered[] {
  const seen: Rendered[] = [];
  Object.defineProperty(ctrl, "renderJson", {
    value: (out: unknown, status?: unknown): void => {
      seen.push({ body: out, status });
    },
    configurable: true,
  });
  Object.defineProperty(ctrl, "queryPost", {
    value: body,
    configurable: true,
  });
  return seen;
}

describe("Routes de connexion — secret reçu en clair", () => {
  it("login de session → 403 + message constant", async () => {
    const context = makeContext({
      authFlow: {
        login: async () => {
          throw insecure();
        },
      },
    });
    const ctrl = new SessionAuthController(context);
    const seen = captureRender(ctrl, { username: "alice", password: "pw" });
    await RequestContext.run({ requestId: "a4-login", context }, () =>
      ctrl.login(),
    );
    const out = seen[0];
    expect(out, "une réponse doit être rendue").toBeDefined();
    expect(out?.status).to.equal(403);
    expect(out?.body).to.deep.equal({ error: INSECURE_TRANSPORT_MESSAGE });
  });

  it("second facteur → 403 + message constant", async () => {
    const context = makeContext({
      authFlow: {
        completeMfaLogin: async () => {
          throw insecure();
        },
      },
    });
    const ctrl = new SessionAuthController(context);
    const seen = captureRender(ctrl, { code: "123456" });
    await RequestContext.run({ requestId: "a4-totp", context }, () =>
      ctrl.loginTotp(),
    );
    const out = seen[0];
    expect(out, "une réponse doit être rendue").toBeDefined();
    expect(out?.status).to.equal(403);
  });

  it("émission de jeton → la requête est transmise, et le refus rendu en 403", async () => {
    const received: unknown[] = [];
    const context = makeContext({
      tokenService: {
        isEnabled: () => true,
        issueForCredentials: async (...args: unknown[]) => {
          received.push(args[4]);
          throw insecure();
        },
      },
    });
    const ctrl = new TokenAuthController(context);
    const seen = captureRender(ctrl, { username: "alice", password: "pw" });
    await RequestContext.run({ requestId: "a4-token", context }, () =>
      ctrl.token(),
    );
    const out = seen[0];
    expect(out, "une réponse doit être rendue").toBeDefined();
    expect(received).to.have.lengthOf(1);
    expect(
      received[0],
      "la requête porteuse doit atteindre le service",
    ).to.equal(context);
    expect(out?.status).to.equal(403);
    expect(out?.body).to.deep.equal({
      error: "invalid_request",
      error_description: INSECURE_TRANSPORT_MESSAGE,
    });
  });
});
