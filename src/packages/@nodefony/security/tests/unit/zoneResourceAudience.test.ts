import assert from "node:assert/strict";
import { BootConfigurationError, Container } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import * as jose from "jose";
import { TokenService } from "../../nodefony/service/tokenService";
import { InvalidTargetError } from "../../nodefony/errors/InvalidTargetError";
import { defineSecurityConfig } from "../../nodefony/config/defineModuleConfig";
import type { ISecurityConfigInput } from "../../nodefony/config/defineModuleConfig";
import { getAuthenticatorFactory } from "../../nodefony/src/authenticator/authenticatorRegistry";
import { UserToken } from "../../nodefony/src/token/UserToken";
import {
  defaultAudience,
  resolveJwtRuntime,
} from "../../nodefony/src/token/jwtRuntime";
import type { IJwtKeystore } from "../../nodefony/contracts/IJwtKeystore";

/**
 * La ressource d'une ZONE (`areas.<zone>.resource`) est émettable par
 * l'application sans être recopiée dans `jwt.audiences` — et l'émetteur comme
 * le vérificateur le savent, puisqu'ils lisent la même règle
 * (`resolveJwtRuntime`). Une seule écriture : c'est ce qui permet à un module
 * (la démo de `create app --demo`) d'apporter sa zone à jeton par une
 * surcharge `module-security`, dont la fusion profonde remplacerait sinon les
 * audiences de l'application position par position.
 */

const RESOURCE = "https://test.nf/demo/api/partner";

const alice: IUser = {
  id: "u-alice",
  identifier: "alice",
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
};

const users = {
  async authenticate(): Promise<IUser | null> {
    return null;
  },
  async loadUserByIdentifier(id: string): Promise<IUser> {
    if (id === "alice") return alice;
    throw new Error("not found");
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("unused");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

const input = {
  jwt: { enabled: true, issuer: "https://test.nf", audiences: ["nf-api"] },
  tokenStore: { store: "memory", gcIntervalS: 0 },
  areas: {
    partner: {
      pattern: "^/demo/api/partner",
      authenticators: ["jwt"],
      stateless: true,
      resource: RESOURCE,
    },
  },
} satisfies ISecurityConfigInput;

/** TokenService monté sur un faux kernel qui capture `onBoot` (patron de `tokenService.test.ts`). */
function bootTokenService(): { svc: TokenService; container: Container } {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    runProfile: { servers: false },
    once(ev: string, cb: () => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {},
  });
  container.set("users", users);
  const module = {
    container,
    notificationsCenter: false,
    options: input,
  } as unknown as Module;
  const svc = new TokenService(module);
  handlers["onBoot"]?.();
  return { svc, container };
}

describe("ressource d'une zone — audience émettable (RFC 8707)", () => {
  it("resolveJwtRuntime : la ressource d'une zone suit les audiences déclarées, l'audience par défaut ne bouge pas", () => {
    const config = defineSecurityConfig(input);
    const runtime = resolveJwtRuntime(config.jwt, config.areas);
    assert.deepEqual(runtime.audiences, ["nf-api", RESOURCE]);
    assert.equal(defaultAudience(runtime), "nf-api");
  });

  it("resolveJwtRuntime : une ressource déjà déclarée n'est pas dupliquée ; sans zones, rien n'est ajouté", () => {
    const config = defineSecurityConfig({
      ...input,
      jwt: { ...input.jwt, audiences: ["nf-api", RESOURCE] },
    });
    assert.deepEqual(resolveJwtRuntime(config.jwt, config.areas).audiences, [
      "nf-api",
      RESOURCE,
    ]);
    assert.deepEqual(resolveJwtRuntime(config.jwt).audiences, [
      "nf-api",
      RESOURCE,
    ]);
  });

  it("resolveJwtRuntime : audiences vides → l'émetteur reste l'audience par défaut, la zone vient après", () => {
    const config = defineSecurityConfig({
      ...input,
      jwt: { ...input.jwt, audiences: [] },
    });
    const runtime = resolveJwtRuntime(config.jwt, config.areas);
    assert.deepEqual(runtime.audiences, ["https://test.nf", RESOURCE]);
    assert.equal(defaultAudience(runtime), "https://test.nf");
  });

  it("émission : un jeton est délivré pour la ressource de la zone, qui en devient l'`aud`", async () => {
    const { svc, container } = bootTokenService();
    const issued = await svc.issueTokens(alice, [], RESOURCE);
    const ks = container.get<IJwtKeystore>("jwtKeystore");
    assert.ok(ks);
    const { payload } = await jose.jwtVerify(
      issued.access_token,
      jose.createLocalJWKSet(await ks.getPublicJWKS()),
      { algorithms: ["EdDSA"], issuer: "https://test.nf", audience: RESOURCE },
    );
    assert.equal(payload.aud, RESOURCE);
  });

  it("émission : une ressource que ni `jwt.audiences` ni une zone ne déclare reste refusée", async () => {
    const { svc } = bootTokenService();
    await assert.rejects(
      svc.issueTokens(alice, [], "https://test.nf/ailleurs"),
      InvalidTargetError,
    );
  });

  it("vérification : l'authenticator `jwt` du registre accepte, SUR LA ZONE, le jeton émis pour sa ressource", async () => {
    const { svc, container } = bootTokenService();
    const issued = await svc.issueTokens(alice, [], RESOURCE);
    const factory = getAuthenticatorFactory("jwt");
    assert.ok(factory);
    const authenticator = factory({
      container,
      config: defineSecurityConfig(input),
    });
    const context = {
      request: { headers: { authorization: `Bearer ${issued.access_token}` } },
      security: { resource: RESOURCE },
    } as unknown as ContextType;
    const token = await authenticator.authenticate(
      await authenticator.createToken(context),
    );
    assert.equal(token.getUser()?.identifier, "alice");
  });

  it("🔴 vérification : hors de la zone, le même jeton n'ouvre pas l'audience par défaut (#748)", async () => {
    const { svc, container } = bootTokenService();
    const issued = await svc.issueTokens(alice, [], RESOURCE);
    const factory = getAuthenticatorFactory("jwt");
    assert.ok(factory);
    const authenticator = factory({
      container,
      config: defineSecurityConfig(input),
    });
    await assert.rejects(
      authenticator.authenticate(new UserToken("jwt", issued.access_token)),
      AuthenticationError,
    );
  });
});

describe("ressource d'une zone écrite comme un CHEMIN — rendue absolue contre jwt.issuer", () => {
  const withPath = (issuer: string | undefined, resource: string) =>
    defineSecurityConfig({
      ...input,
      jwt: {
        enabled: true,
        audiences: ["nf-api"],
        ...(issuer ? { issuer } : {}),
      },
      areas: { partner: { ...input.areas.partner, resource } },
    });

  it("un chemin suit l'émetteur — chemin de l'émetteur et / final compris", () => {
    assert.equal(
      withPath("https://test.nf", "/demo/api/partner").areas.partner?.resource,
      RESOURCE,
    );
    assert.equal(
      withPath("https://test.nf/auth/", "/demo/api/partner").areas.partner
        ?.resource,
      "https://test.nf/auth/demo/api/partner",
    );
  });

  it("une ressource absolue n'est pas touchée", () => {
    assert.equal(
      withPath("https://test.nf", "https://autre.nf/x").areas.partner?.resource,
      "https://autre.nf/x",
    );
  });

  it("le chemin résolu est émettable : il entre dans les audiences du runtime", () => {
    const config = withPath("https://test.nf", "/demo/api/partner");
    assert.deepEqual(resolveJwtRuntime(config.jwt, config.areas).audiences, [
      "nf-api",
      RESOURCE,
    ]);
  });

  it("🔴 émetteur absent (« nodefony ») → démarrage refusé, en nommant jwt.issuer — jamais une zone retirée", () => {
    assert.throws(
      () => withPath(undefined, "/demo/api/partner"),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("jwt.issuer") &&
        error.message.includes("areas.partner.resource"),
    );
  });

  it("🔴 « // » (autre hôte) → refusé", () => {
    assert.throws(
      () => withPath("https://test.nf", "//evil.example/x"),
      BootConfigurationError,
    );
  });
});
