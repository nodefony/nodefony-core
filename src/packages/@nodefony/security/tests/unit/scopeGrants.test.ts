import assert from "node:assert/strict";
import { accountDirectory } from "../support/accountDirectory";
import { Container, extend } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import {
  ScopeGrantPolicy,
  refusedScopes,
  scopeGrantKeyProblem,
} from "../../nodefony/src/token/scopeGrants";
import { RoleHierarchyWalker } from "../../nodefony/src/RoleHierarchyWalker";
import { defineSecurityConfig } from "../../nodefony/config/defineModuleConfig";
import { TokenService } from "../../nodefony/service/tokenService";
import { ApiKeyService } from "../../nodefony/service/apiKeys";
import { ApiKeyError } from "../../nodefony/errors/ApiKeyError";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";

/**
 * `grantableScopes` (#604) — qui peut OBTENIR un scope d'application. Avant
 * lui, l'émetteur accordait tout scope d'application demandé à tout compte :
 * un outil MCP réservé par `scopes: ["vitrine:write"]` s'ouvrait à quiconque
 * demandait ce scope.
 */

const GRANTS = {
  "vitrine:write": ["ROLE_ADMIN"],
  "shop:*": ["ROLE_SHOP"],
  "shop:admin:*": ["ROLE_SHOP_MANAGER"],
};

describe("ScopeGrantPolicy — résolution", () => {
  const policy = new ScopeGrantPolicy(GRANTS);

  it("clé exacte, famille, famille la plus longue ; non déclaré = libre", () => {
    assert.deepEqual(policy.rolesFor("vitrine:write"), ["ROLE_ADMIN"]);
    assert.deepEqual(policy.rolesFor("shop:read"), ["ROLE_SHOP"]);
    assert.deepEqual(policy.rolesFor("shop:admin:refund"), [
      "ROLE_SHOP_MANAGER",
    ]);
    assert.equal(policy.rolesFor("vitrine:read"), null);
    assert.equal(policy.rolesFor("shopping:read"), null);
  });

  it("une clé exacte l'emporte sur la famille qui la couvre", () => {
    const p = new ScopeGrantPolicy({
      "shop:*": ["ROLE_SHOP"],
      "shop:refund": ["ROLE_SHOP_MANAGER"],
    });
    assert.deepEqual(p.rolesFor("shop:refund"), ["ROLE_SHOP_MANAGER"]);
  });

  it("l'ordre des clés ne décide de rien", () => {
    const reversed = new ScopeGrantPolicy(
      Object.fromEntries(Object.entries(GRANTS).reverse()),
    );
    assert.deepEqual(reversed.rolesFor("shop:admin:x"), ["ROLE_SHOP_MANAGER"]);
  });
});

describe("refusedScopes — un juge, deux familles", () => {
  const policy = new ScopeGrantPolicy(GRANTS);
  const hierarchy = new RoleHierarchyWalker({
    ROLE_NODEFONY_ADMIN: ["ROLE_ADMIN"],
  });

  it("déclaré et accordé / déclaré et refusé / préfixe / non déclaré", () => {
    assert.deepEqual(
      refusedScopes(["vitrine:write"], ["ROLE_ADMIN"], policy, null),
      [],
    );
    assert.deepEqual(
      refusedScopes(["vitrine:write", "vitrine:read"], [], policy, null),
      [{ scope: "vitrine:write", rule: "application" }],
    );
    assert.deepEqual(
      refusedScopes(["shop:read"], ["ROLE_SHOP"], policy, null),
      [],
    );
    assert.deepEqual(
      refusedScopes(["shop:read"], ["ROLE_USER"], policy, null),
      [{ scope: "shop:read", rule: "application" }],
    );
    assert.deepEqual(refusedScopes(["orders:read"], [], policy, null), []);
  });

  it("la hiérarchie de rôles compte : ROLE_NODEFONY_ADMIN couvre ROLE_ADMIN", () => {
    assert.deepEqual(
      refusedScopes(
        ["vitrine:write"],
        ["ROLE_NODEFONY_ADMIN"],
        policy,
        hierarchy,
      ),
      [],
    );
  });

  it("la règle d'administration reste appliquée, sans grantableScopes", () => {
    assert.deepEqual(
      refusedScopes(["admin:write", "x:y"], [], new ScopeGrantPolicy(), null),
      [{ scope: "admin:write", rule: "admin" }],
    );
  });
});

describe("schéma — la clé se juge AU DÉMARRAGE", () => {
  it("accepte un scope exact et une famille", () => {
    const cfg = defineSecurityConfig({ grantableScopes: GRANTS });
    assert.deepEqual(cfg.grantableScopes["shop:*"], ["ROLE_SHOP"]);
  });

  it("défaut vide : rien n'est restreint", () => {
    assert.deepEqual(defineSecurityConfig({}).grantableScopes, {});
  });

  for (const key of ["admin:write", "admin:read", "admin:*"]) {
    it(`refuse « ${key} » — réservé au framework`, () => {
      assert.throws(
        () => defineSecurityConfig({ grantableScopes: { [key]: ["ROLE_X"] } }),
        /réservé au plan d'administration/u,
      );
    });
  }

  for (const key of ["shop*", "*", ":*", "shop:*:read", "a b", "a\\b"]) {
    it(`refuse la clé mal formée « ${key} »`, () => {
      assert.notEqual(scopeGrantKeyProblem(key), null);
      assert.throws(() =>
        defineSecurityConfig({ grantableScopes: { [key]: ["ROLE_X"] } }),
      );
    });
  }

  it("refuse une liste de rôles vide", () => {
    assert.throws(
      () => defineSecurityConfig({ grantableScopes: { "x:y": [] } }),
      /au moins un rôle/u,
    );
  });
});

// ── Émetteurs ────────────────────────────────────────────────────────────────

const user = (identifier: string, roles: string[]): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles,
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
});

function bootWith<T>(
  Ctor: new (m: Module) => T,
  options: Record<string, unknown>,
  setup: (c: Container) => void = () => {},
): { svc: T; container: Container } {
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
  container.set("users", accountDirectory());
  setup(container);
  const svc = new Ctor({
    container,
    notificationsCenter: false,
    options,
  } as unknown as Module);
  handlers["onBoot"]?.();
  return { svc, container };
}

const jwtConfig = {
  jwt: { enabled: true, issuer: "https://test.nf", audiences: ["nf-api"] },
  tokenStore: { store: "memory", gcIntervalS: 0 },
  grantableScopes: GRANTS,
};

describe("TokenService — le jeton est émis SANS le scope refusé", () => {
  it("compte sans rôle : vitrine:write retiré, le reste accordé", async () => {
    const { svc } = bootWith(TokenService, jwtConfig);
    const r = await svc.issueTokens(user("temoin", []), [
      "vitrine:write",
      "vitrine:read",
    ]);
    assert.equal(r.scope, "vitrine:read");
  });

  it("compte ROLE_ADMIN : vitrine:write accordé", async () => {
    const { svc } = bootWith(TokenService, jwtConfig);
    const r = await svc.issueTokens(user("admin", ["ROLE_ADMIN"]), [
      "vitrine:write",
    ]);
    assert.equal(r.scope, "vitrine:write");
  });

  it("la hiérarchie posée par le firewall est lue au conteneur", async () => {
    const { svc } = bootWith(TokenService, jwtConfig, (c) =>
      c.set(
        "roleHierarchy",
        new RoleHierarchyWalker({ ROLE_NODEFONY_ADMIN: ["ROLE_ADMIN"] }),
      ),
    );
    const r = await svc.issueTokens(user("root", ["ROLE_NODEFONY_ADMIN"]), [
      "vitrine:write",
    ]);
    assert.equal(r.scope, "vitrine:write");
  });

  it("le renouvellement REJUGE : un rôle retiré retire son scope", async () => {
    let roles = ["ROLE_ADMIN"];
    const { svc } = bootWith(TokenService, jwtConfig, (c) =>
      c.set("users", {
        async loadUserByIdentifier(id: string): Promise<IUser> {
          return user(id, roles);
        },
        async refreshUser(u: IUser): Promise<IUser> {
          return u;
        },
      }),
    );
    const first = await svc.issueTokens(user("bob", roles), [
      "vitrine:write",
      "vitrine:read",
    ]);
    assert.equal(first.scope, "vitrine:write vitrine:read");
    roles = [];
    const next = await svc.refresh(first.refresh_token);
    assert.equal(next.scope, "vitrine:read");
  });
});

describe("ApiKeyService — la création est REFUSÉE (403)", () => {
  const boot = () =>
    bootWith(
      ApiKeyService,
      { apiKeys: { enabled: true }, grantableScopes: GRANTS },
      (c) => c.set("tokenStore", new MemoryTokenStore()),
    ).svc;

  it("scope réservé, compte sans le rôle → 403 qui nomme le scope", async () => {
    await assert.rejects(
      () =>
        boot().createForSubject(
          "temoin",
          "user",
          { name: "k", scopes: ["vitrine:write"] },
          ["ROLE_USER"],
        ),
      (e: unknown) =>
        e instanceof ApiKeyError &&
        e.code === 403 &&
        e.message.includes("vitrine:write"),
    );
  });

  it("rôles omis = aucun rôle : le scope réservé est refusé (fail-closed)", async () => {
    await assert.rejects(
      () =>
        boot().createForSubject("x", "user", {
          name: "k",
          scopes: ["shop:read"],
        }),
      (e: unknown) => e instanceof ApiKeyError && e.code === 403,
    );
  });

  it("admin:write sans le rôle d'administration → 403 (même juge que le jeton)", async () => {
    await assert.rejects(
      () =>
        boot().createForSubject(
          "temoin",
          "user",
          { name: "k", scopes: ["admin:write"] },
          ["ROLE_USER"],
        ),
      (e: unknown) => e instanceof ApiKeyError && e.code === 403,
    );
  });

  it("compte qui porte le rôle → clé créée avec le scope", async () => {
    const created = await boot().createForSubject(
      "admin",
      "user",
      { name: "k", scopes: ["vitrine:write", "orders:read"] },
      ["ROLE_ADMIN"],
    );
    assert.deepEqual(created.scopes, ["vitrine:write", "orders:read"]);
  });
});

describe("module-security — un module complète grantableScopes", () => {
  it("la recette de fusion du Kernel ajoute sa clé à celles de l'app", async () => {
    // Même fusion que `Module.readOverrideModuleConfig` (`extend(true, …)`) ;
    // l'ordre surcharge → validation est éprouvé par KernelLifecycle.test.ts.
    const merged = extend(true, {}, jwtConfig, {
      grantableScopes: { "blog:publish": ["ROLE_EDITOR"] },
    }) as Record<string, unknown>;
    const { svc } = bootWith(TokenService, merged);
    const r = await svc.issueTokens(user("temoin", []), [
      "blog:publish",
      "vitrine:write",
    ]);
    assert.equal(r.scope, "", "les deux scopes réservés sont retirés");
  });
});
