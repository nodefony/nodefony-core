/// <reference types="node" />
import { expect } from "chai";
import { Container } from "nodefony";
import OAuth2Controller from "../../controller/OAuth2Controller.js";
import WebAuthnController from "../../controller/WebAuthnController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Le FACTEUR d'authentification externe doit remonter jusqu'au journal d'audit.
 *
 * `AuthFlow.establishSessionFor(context, identifier, reason)` retombe sur
 * `"federated"` quand l'appelant se tait — et pendant longtemps, personne ne
 * parlait : une passkey et un login social produisaient la même ligne d'audit.
 * Après un incident, « une session externe s'est ouverte » ne dit pas s'il faut
 * révoquer une clé FIDO ou un compte Google. Ces deux tests verrouillent le
 * troisième argument **à sa source, chez les appelants** — `AuthFlow`, lui,
 * accepterait n'importe quelle chaîne.
 *
 * ⚠️ Les controllers sont construits pour de VRAI (`new`) : leurs méthodes
 * `#privées` font un contrôle de marque, qu'un `Object.create(prototype)` ne
 * passe pas (« Receiver must be an instance of class »). Le constructeur ne
 * réclame du contexte que le `container` et le `notificationsCenter` — les
 * dépendances arrivent donc par le container, comme en production, et seules les
 * sorties HTTP (`renderJson`/`redirect`) sont neutralisées.
 */

type Call = { identifier: unknown; reason: unknown };

/** Session minimale : porte le challenge / l'état OAuth, encaisse `save()`. */
function fakeSession(entries: Record<string, unknown>) {
  const store: Record<string, unknown> = { ...entries };
  return {
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v;
    },
    save: async () => undefined,
  };
}

/** Espion d'`AuthFlow` : ne retient que ce qu'on lui a passé. */
function spyFlow(calls: Call[]) {
  return {
    establishSessionFor: async (
      _ctx: unknown,
      identifier: unknown,
      reason?: unknown,
    ) => {
      calls.push({ identifier, reason });
      return { username: "alice" };
    },
    ensureSession: async () => null,
    me: async () => null,
  };
}

function makeContext(
  services: Record<string, unknown>,
  session: unknown,
  query: { get?: Record<string, unknown>; post?: Record<string, unknown> },
): ContextType {
  const container = new Container();
  for (const [name, svc] of Object.entries(services)) container.set(name, svc);
  return {
    container,
    notificationsCenter: false,
    session,
    request: {
      headers: { origin: "https://example.test" },
      queryGet: query.get ?? {},
      query: query.get ?? {},
      queryPost: query.post ?? {},
    },
  } as unknown as ContextType;
}

/** Neutralise les sorties HTTP : on observe l'argument, pas la réponse écrite. */
function captureOutput(ctrl: object): void {
  Object.defineProperty(ctrl, "renderJson", {
    value: (body: unknown) => body,
    configurable: true,
  });
  Object.defineProperty(ctrl, "redirect", {
    value: (url: string) => url,
    configurable: true,
  });
}

describe("Facteur d'authentification externe → audit", () => {
  it("WebAuthnController.loginVerify passe `webauthn`", async () => {
    const calls: Call[] = [];
    const context = makeContext(
      {
        authFlow: spyFlow(calls),
        webauthn: {
          isEnabled: () => true,
          verifyAuthentication: async () => ({ userId: "alice" }),
        },
      },
      fakeSession({ "webauthn:auth:challenge": "chal-1" }),
      { post: { response: { id: "cred-1" } } },
    );
    const ctrl = new WebAuthnController(context);
    captureOutput(ctrl);
    Object.defineProperty(ctrl, "queryPost", {
      value: { response: { id: "cred-1" } },
      configurable: true,
    });

    const out = (await ctrl.loginVerify()) as { verified?: boolean };

    // Garde-fou : sans challenge lisible le controller sort en 400 SANS appeler
    // le flow — le test passerait « à vide ».
    expect(out.verified, "la cérémonie doit aboutir").to.equal(true);
    expect(calls).to.have.lengthOf(1);
    expect(calls[0]!.identifier).to.equal("alice");
    expect(calls[0]!.reason).to.equal("webauthn");
  });

  it("OAuth2Controller.callback passe `oauth`", async () => {
    const calls: Call[] = [];
    const context = makeContext(
      {
        authFlow: spyFlow(calls),
        oauth2: {
          isEnabled: () => true,
          getRedirects: () => ({ success: "/ok", failure: "/ko" }),
          exchangeAndProvision: async () => ({ identifier: "alice" }),
        },
      },
      fakeSession({
        "oauth2:state": "st-1",
        "oauth2:verifier": "v-1",
        "oauth2:provider": "google",
      }),
      { get: { code: "c-1", state: "st-1" } },
    );
    const ctrl = new OAuth2Controller(context);
    captureOutput(ctrl);
    Object.defineProperty(ctrl, "queryGet", {
      value: { code: "c-1", state: "st-1" },
      configurable: true,
    });

    const out = await ctrl.callback("google");

    // Un `state` mal lu redirigerait vers `/ko` SANS appeler le flow : on vérifie
    // d'abord qu'on est sur le chemin nominal.
    expect(out, "le callback doit réussir").to.equal("/ok");
    expect(calls).to.have.lengthOf(1);
    expect(calls[0]!.identifier).to.equal("alice");
    expect(calls[0]!.reason).to.equal("oauth");
  });
});
