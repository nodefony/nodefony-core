/// <reference types="node" />
import { expect } from "chai";
import { Container } from "nodefony";
import WebAuthnController from "../../controller/WebAuthnController.js";
import type { ContextType } from "@nodefony/http";

/**
 * `login/options` ne doit RIEN dire d'un compte à un appelant anonyme.
 *
 * La route est en `bypassFirewall` : elle précède l'authentification, donc
 * n'importe qui peut la poster. Le statut était déjà uniforme (200 + défi même
 * pour un compte fantôme), mais le corps ne l'était pas : `allowCredentials`
 * arrivait **peuplé** pour un porteur de passkey et **vide** sinon. Deux fuites
 * en une — savoir qu'un identifiant est enrôlé, et récupérer ses
 * `credentialId`, que W3C WebAuthn L3 décrit comme un identifiant corrélable
 * (§ « Privacy leak via credential IDs » : les exposer à un appelant NON
 * authentifié permet de dés-anonymiser un utilisateur entre sites, et de
 * confirmer une hypothèse d'identité avec un accès physique momentané à son
 * authenticator).
 *
 * Les deux remèdes que la spec propose sont exactement ceux d'ici : credentials
 * découvrables (pas d'`allowCredentials`) pour l'anonyme, et **étape
 * d'authentification préalable** — la session — quand on cible vraiment.
 *
 * ⚠️ Controllers construits pour de VRAI (`new`) : leurs méthodes `#privées`
 * font un contrôle de marque (cf `authFactorAudit.test.ts`).
 */

/** Ce que le controller a demandé au service (le `userId` de ciblage, ou rien). */
type Ask = { userId: unknown };

/**
 * Service WebAuthn doublé, fidèle au vrai régime : un `userId` produit la liste
 * des credentials de ce porteur, son absence l'omet (usernameless).
 */
function spyService(asks: Ask[], enrolled: Record<string, string[]>) {
  return {
    isEnabled: () => true,
    generateAuthenticationOptions: async (userId?: string) => {
      asks.push({ userId });
      const options: Record<string, unknown> = {
        challenge: "chal-1",
        rpId: "localhost",
        timeout: 60000,
      };
      if (userId) {
        options.allowCredentials = (enrolled[userId] ?? []).map((id) => ({
          id,
          transports: ["internal"],
        }));
      }
      return options;
    },
  };
}

/** `AuthFlow` doublé — `me()` décide si l'appelant est déjà authentifié. */
function spyFlow(me: { username: string } | null) {
  return {
    ensureSession: async () => null,
    me: async () => me,
    establishSessionFor: async () => ({ username: "alice" }),
  };
}

function makeContext(
  services: Record<string, unknown>,
  post: Record<string, unknown>,
): ContextType {
  const container = new Container();
  for (const [name, svc] of Object.entries(services)) container.set(name, svc);
  return {
    container,
    notificationsCenter: false,
    session: null,
    request: {
      headers: { origin: "https://example.test" },
      queryGet: {},
      query: {},
      queryPost: post,
    },
  } as unknown as ContextType;
}

function makeController(
  asks: Ask[],
  post: Record<string, unknown>,
  me: { username: string } | null,
): WebAuthnController {
  const context = makeContext(
    {
      webauthn: spyService(asks, { admin: ["cred-admin-1", "cred-admin-2"] }),
      authFlow: spyFlow(me),
    },
    post,
  );
  const ctrl = new WebAuthnController(context);
  Object.defineProperty(ctrl, "renderJson", {
    value: (body: unknown) => body,
    configurable: true,
  });
  Object.defineProperty(ctrl, "queryPost", { value: post, configurable: true });
  return ctrl;
}

describe("WebAuthn login/options — anti-énumération (W3C L3, credential ID privacy)", () => {
  it("anonyme : un identifiant ENRÔLÉ ne fait pas fuiter ses credentialId", async () => {
    const asks: Ask[] = [];
    const out = (await makeController(
      asks,
      { username: "admin" },
      null,
    ).loginOptions()) as unknown as Record<string, unknown>;

    // Garde-fou : sans défi la cérémonie n'a pas eu lieu, le test passerait à vide.
    expect(out.challenge, "un défi doit être servi").to.be.a("string");
    expect(
      out.allowCredentials,
      "aucune liste de credentials pour un appelant anonyme",
    ).to.equal(undefined);
    expect(
      asks[0]!.userId,
      "le service ne doit pas être ciblé depuis le corps de la requête",
    ).to.equal(undefined);
  });

  it("anonyme : compte enrôlé et compte fantôme rendent le MÊME corps", async () => {
    const asks: Ask[] = [];
    const real = (await makeController(
      asks,
      { username: "admin" },
      null,
    ).loginOptions()) as unknown as Record<string, unknown>;
    const ghost = (await makeController(
      asks,
      { username: "ghost-user-xyz" },
      null,
    ).loginOptions()) as unknown as Record<string, unknown>;

    expect(
      Object.keys(real).sort(),
      "mêmes champs des deux côtés (rien ne distingue les deux comptes)",
    ).to.deep.equal(Object.keys(ghost).sort());
    expect(real.allowCredentials).to.equal(undefined);
    expect(ghost.allowCredentials).to.equal(undefined);
  });

  it("authentifié : le ciblage suit la SESSION, jamais le corps de la requête", async () => {
    const asks: Ask[] = [];
    const out = (await makeController(
      asks,
      { username: "admin" },
      {
        username: "alice",
      },
    ).loginOptions()) as unknown as Record<string, unknown>;

    expect(out.challenge, "un défi doit être servi").to.be.a("string");
    expect(
      asks[0]!.userId,
      "identité prouvée par la session — le `username` posté est ignoré",
    ).to.equal("alice");
  });
});
