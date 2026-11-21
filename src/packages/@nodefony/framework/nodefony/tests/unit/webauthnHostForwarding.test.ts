/// <reference types="node" />
import { expect } from "vitest";
import { Container } from "nodefony";
import WebAuthnController from "../../controller/WebAuthnController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Le contrôleur des cérémonies passe l'hôte de la requête (`Context.domain`)
 * au service, qui en dérive le RP ID sous la barrière `trustedHosts` (#241).
 *
 * Deux choses à tenir ici, le reste vit dans le service :
 * - chaque cérémonie reçoit l'hôte — sans lui, le service retombe sur le RP ID
 *   du boot et la seconde marque d'une application multi-domaine reste sans
 *   passkeys ;
 * - un hôte refusé (erreur `code` 421) rend un 421 à corps CONSTANT : l'en-tête
 *   `Host`, écrit par le client, n'est jamais renvoyé.
 *
 * ⚠️ Controllers construits pour de VRAI (`new`) : leurs méthodes `#privées`
 * font un contrôle de marque (cf `authFactorAudit.test.ts`).
 */

type Seen = { method: string; host: unknown };

function spyService(seen: Seen[], refuse: boolean) {
  const answer = (method: string, host: unknown) => {
    seen.push({ method, host });
    if (refuse) {
      return Promise.reject(
        Object.assign(new Error(`hôte « ${String(host)} » refusé`), {
          code: 421,
        }),
      );
    }
    return Promise.resolve({ challenge: "chal-1" });
  };
  return {
    isEnabled: () => true,
    generateRegistrationOptions: (_user: unknown, host?: string) =>
      answer("registerOptions", host),
    generateAuthenticationOptions: (_userId?: string, host?: string) =>
      answer("loginOptions", host),
    verifyAuthentication: (
      _r: unknown,
      _c: string,
      _o?: string,
      host?: string,
    ) =>
      refuse
        ? answer("loginVerify", host)
        : (seen.push({ method: "loginVerify", host }),
          Promise.resolve({ userId: "alice" })),
  };
}

function makeController(seen: Seen[], refuse: boolean): WebAuthnController {
  const container = new Container();
  container.set("webauthn", spyService(seen, refuse));
  container.set("authFlow", {
    ensureSession: async () => null,
    me: async () => ({ id: "uuid-1", identifier: "alice" }),
    establishSessionFor: async () => ({ identifier: "alice" }),
  });
  const session = new Map<string, unknown>([
    ["webauthn:auth:challenge", "chal-1"],
  ]);
  const context = {
    container,
    notificationsCenter: false,
    domain: "evil.example",
    session: {
      get: (k: string) => session.get(k),
      set: (k: string, v: unknown) => session.set(k, v),
      save: async () => undefined,
    },
    request: {
      headers: { origin: "https://evil.example" },
      query: {},
      body: {},
    },
  } as unknown as ContextType;
  const ctrl = new WebAuthnController(context);
  // Contrôleur singleton : en production le contexte vient de l'ALS que pose
  // le HttpKernel ; ici, on le fixe sur l'instance.
  Object.defineProperty(ctrl, "context", {
    value: context,
    configurable: true,
  });
  Object.defineProperty(ctrl, "renderJson", {
    value: (body: unknown, status = 200) => ({ status, body }),
    configurable: true,
  });
  Object.defineProperty(ctrl, "body", { value: {}, configurable: true });
  return ctrl;
}

type Rendered = { status: number; body: Record<string, unknown> };

describe("WebAuthn — l'hôte de la requête atteint le service (#241)", () => {
  it("🔴 chaque cérémonie reçoit `Context.domain`", async () => {
    const seen: Seen[] = [];
    const ctrl = makeController(seen, false);
    await ctrl.registerOptions();
    await ctrl.loginOptions();
    await makeController(seen, false).loginVerify();
    expect(seen.map((s) => s.method)).to.deep.equal([
      "registerOptions",
      "loginOptions",
      "loginVerify",
    ]);
    for (const s of seen) {
      expect(s.host, `${s.method} sans hôte`).to.equal("evil.example");
    }
  });

  it("🔴 hôte refusé → 421 à corps constant, le Host n'est pas renvoyé", async () => {
    const seen: Seen[] = [];
    for (const action of [
      "registerOptions",
      "loginOptions",
      "loginVerify",
    ] as const) {
      const out = (await makeController(seen, true)[
        action
      ]()) as unknown as Rendered;
      expect(out.status, action).to.equal(421);
      expect(out.body).to.deep.equal({ error: "Misdirected Request" });
      expect(JSON.stringify(out.body)).not.to.contain("evil");
    }
  });
});
