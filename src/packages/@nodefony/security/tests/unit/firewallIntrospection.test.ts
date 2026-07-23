import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module, IAdminRequest } from "nodefony";
import { Firewall } from "../../nodefony/service/firewall";
import { createSecurityAdminApi } from "../../nodefony/src/admin/SecurityAdminApi";
import type {
  IFirewallDescription,
  IRoleHierarchyDescription,
} from "../../nodefony/contracts/IFirewallDescription";
import type { ISecurityConfigInput } from "../../nodefony/config/defineModuleConfig";

/**
 * Introspection du firewall (data plane Studio P6.15) — `Firewall.describe()` +
 * `describeRoleHierarchy()` et les endpoints `SecurityAdminApi` `firewall` /
 * `roleHierarchy`. Cibles : projection FIDÈLE de l'état runtime (zones montées,
 * authenticators registre∪montés, défenses résolues), **redaction du secret CSRF**
 * (présence, jamais valeur), hiérarchie de rôles transitive, 503 sans firewall.
 *
 * Le 401 observé via curl prouve la route + le gate RBAC du broker ; CE test
 * prouve le HANDLER lui-même (la valeur renvoyée), inatteignable par curl.
 */

const CSRF_SECRET = "TOP_SECRET_csrf_value_0123456789";

/** Construit un firewall buildé (kernel factice → `#build` au onBoot). */
function bootFirewall(options: ISecurityConfigInput): {
  firewall: Firewall;
  container: Container;
} {
  const container = new Container();
  const bootCbs: Array<() => void> = [];
  container.set("kernel", {
    container,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") bootCbs.push(cb);
    },
  });
  const firewall = new Firewall({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  container.set("firewall", firewall);
  bootCbs.forEach((cb) => cb());
  return { firewall, container };
}

const CONFIG: ISecurityConfigInput = {
  roleHierarchy: {
    ROLE_ADMIN: ["ROLE_USER"],
    ROLE_SUPER: ["ROLE_ADMIN"],
  },
  areas: {
    "nodefony-admin": {
      pattern: "^/nodefony",
      security: true,
      mode: "first",
      authenticators: ["session", "anonymous"],
      host: "localhost",
    },
    public: {
      pattern: "^/public",
      security: false,
      authenticators: [],
    },
  },
  csrf: {
    enabled: true,
    secret: CSRF_SECRET,
    trustedOrigins: ["https://alias.example.org"],
  },
  cors: {
    enabled: true,
    origins: ["https://app.example.org"],
    credentials: true,
  },
};

function req(): IAdminRequest {
  return {
    params: {},
    query: {},
    body: null,
    user: null,
    roles: ["ROLE_NODEFONY_ADMIN"],
  };
}

// ════════════════════════════════════════════════════════════════════════════
describe("Firewall.describe — zones", () => {
  it("projette les zones triées par spécificité avec leurs métadonnées", () => {
    const { firewall } = bootFirewall(CONFIG);
    const d = firewall.describe();
    assert.equal(d.configValid, true);
    assert.equal(d.configError, null);
    // Tri par longueur de pattern décroissante : "^/nodefony" avant "^/public".
    assert.deepEqual(
      d.zones.map((z) => z.name),
      ["nodefony-admin", "public"],
    );
    const admin = d.zones[0]!;
    // `RegExp.source` échappe le `/` → `^\/nodefony` (représentation regex canonique).
    assert.equal(admin.pattern, "^\\/nodefony");
    assert.equal(admin.security, true);
    assert.equal(admin.mode, "first");
    assert.deepEqual(admin.authenticators, ["session", "anonymous"]);
    assert.equal(admin.allowsAnonymous, true);
    assert.equal(admin.host, "localhost");
    assert.equal(admin.realtime, true); // défaut Zero Trust

    const pub = d.zones[1]!;
    assert.equal(pub.security, false);
    assert.equal(pub.allowsAnonymous, false);
    assert.equal(pub.host, null);
  });
});

describe("Firewall.describe — authenticators (registre ∪ montés)", () => {
  it("marque montés ceux référencés par une zone, disponibles ceux du registre", () => {
    const { firewall } = bootFirewall(CONFIG);
    const auth = firewall.describe().authenticators;
    const byName = new Map(auth.map((a) => [a.name, a]));
    // Montés (référencés par la zone admin).
    assert.equal(byName.get("session")?.mounted, true);
    assert.equal(byName.get("anonymous")?.mounted, true);
    // Disponibles au registre mais non montés (aucune zone ne les liste).
    assert.equal(byName.get("jwt")?.mounted, false);
    assert.equal(byName.get("jwt")?.available, true);
    assert.equal(byName.get("apikey")?.available, true);
    // Tous les builtins sont au moins « disponibles ».
    for (const n of ["anonymous", "userpassword", "session", "jwt", "apikey"]) {
      assert.ok(byName.has(n), `${n} listé`);
    }
  });
});

describe("Firewall.describe — défenses (secret REDACTÉ)", () => {
  it("résout csrf/cors/headers/rateLimit", () => {
    const { firewall } = bootFirewall(CONFIG);
    const def = firewall.describe().defenses;
    assert.ok(def, "défenses présentes (config valide)");
    assert.equal(def!.csrf.enabled, true);
    assert.equal(def!.csrf.synchronizerToken, true); // secret fourni → armé
    assert.deepEqual(def!.csrf.trustedOrigins, ["https://alias.example.org"]);
    assert.equal(def!.cors.enabled, true);
    assert.deepEqual(def!.cors.origins, ["https://app.example.org"]);
    assert.equal(def!.cors.credentials, true);
    assert.equal(def!.headers.enabled, true);
    assert.ok(def!.headers.csp.length > 0);
    assert.equal(def!.rateLimit.enabled, true);
  });

  it("n'expose JAMAIS la valeur du secret CSRF (présence seule)", () => {
    const { firewall } = bootFirewall(CONFIG);
    const dump = JSON.stringify(firewall.describe());
    assert.ok(
      !dump.includes(CSRF_SECRET),
      "le secret CSRF ne doit jamais fuiter dans l'introspection",
    );
  });
});

describe("Firewall.describeRoleHierarchy", () => {
  it("rend la déclaration brute + la résolution transitive triée", () => {
    const { firewall } = bootFirewall(CONFIG);
    const h = firewall.describeRoleHierarchy();
    assert.deepEqual(h.hierarchy.ROLE_ADMIN, ["ROLE_USER"]);
    assert.deepEqual(h.hierarchy.ROLE_SUPER, ["ROLE_ADMIN"]);
    const byRole = new Map(h.roles.map((r) => [r.role, r.inherits]));
    assert.deepEqual(byRole.get("ROLE_ADMIN"), ["ROLE_USER"]);
    // ROLE_SUPER → ROLE_ADMIN → ROLE_USER (transitif, hors lui-même, trié).
    assert.deepEqual(byRole.get("ROLE_SUPER"), ["ROLE_ADMIN", "ROLE_USER"]);
  });
});

describe("Firewall.describe — config invalide (fail-closed)", () => {
  it("configValid=false + message + défenses null sur authenticator inconnu", () => {
    const { firewall } = bootFirewall({
      areas: {
        broken: { pattern: "^/x", authenticators: ["does-not-exist"] },
      },
    });
    const d = firewall.describe();
    assert.equal(d.configValid, false);
    assert.ok(d.configError && d.configError.includes("does-not-exist"));
  });
});

describe("SecurityAdminApi — endpoints firewall / roleHierarchy", () => {
  it("déclare firewall + roleHierarchy en GET ROLE_NODEFONY_ADMIN", () => {
    const api = createSecurityAdminApi(new Container());
    for (const path of ["firewall", "roleHierarchy"]) {
      const ep = api.adminEndpoints().find((e) => e.path === path);
      assert.ok(ep, `endpoint ${path} présent`);
      assert.equal(ep!.method, "GET");
      assert.equal(ep!.role, "ROLE_NODEFONY_ADMIN");
    }
  });

  it("firewall → describe() du service résolu", async () => {
    const { container } = bootFirewall(CONFIG);
    const ep = createSecurityAdminApi(container)
      .adminEndpoints()
      .find((e) => e.path === "firewall")!;
    const res = (await ep.handler(req())) as IFirewallDescription;
    assert.equal(res.configValid, true);
    assert.equal(res.zones.length, 2);
  });

  it("roleHierarchy → describeRoleHierarchy() du service résolu", async () => {
    const { container } = bootFirewall(CONFIG);
    const ep = createSecurityAdminApi(container)
      .adminEndpoints()
      .find((e) => e.path === "roleHierarchy")!;
    const res = (await ep.handler(req())) as IRoleHierarchyDescription;
    assert.deepEqual(res.hierarchy.ROLE_ADMIN, ["ROLE_USER"]);
  });

  it("503 si aucun firewall dans le container", async () => {
    const ep = createSecurityAdminApi(new Container())
      .adminEndpoints()
      .find((e) => e.path === "firewall")!;
    const res = (await ep.handler(req())) as { status: number };
    assert.equal(res.status, 503);
  });
});

/**
 * F10 — l'introspection ne doit pas afficher une intention de configuration à la
 * place de l'état appliqué.
 *
 * `security.headers.hsts` / `frameguard` / `noSniff` sont conservées pour la
 * compatibilité mais INERTES (marquées `reserved` dans le schéma) : ces trois
 * en-têtes sont posés par `@nodefony/http` à l'entrée brute, afin de couvrir aussi
 * les statiques et les pages d'erreur. Les recopier faisait afficher `deny` à
 * l'écran Firewall de Studio pendant que le transport émettait `SAMEORIGIN` — une
 * console d'admin qui rassure à tort est pire qu'une console absente.
 */
describe("Firewall.describe() — les en-têtes de transport disent le RÉEL (F10)", () => {
  /** Pose un HttpKernel factice qui déclare ce qu'il émet vraiment. */
  const withHttpKernel = (
    container: Container,
    emitted: {
      strictTransportSecurity: string | null;
      frameOptions: string | null;
      contentTypeOptions: string | null;
    },
  ): void => {
    container.set("HttpKernel", {
      describeTransportSecurityHeaders: () => emitted,
    });
  };

  it("le transport gagne contre la config security inerte", () => {
    const { firewall, container } = bootFirewall({
      ...CONFIG,
      // L'app croit configurer ici : ces clés ne pilotent RIEN.
      headers: { frameguard: "deny", noSniff: true, hsts: true },
    });
    withHttpKernel(container, {
      strictTransportSecurity: null, // HSTS désactivé côté http
      frameOptions: "SAMEORIGIN", // ≠ « deny » de la config security
      contentTypeOptions: null, // nosniff non émis
    });
    const d = firewall.describe().defenses!;
    assert.equal(d.headers.frameguard, "sameorigin");
    assert.equal(d.headers.hsts, false);
    assert.equal(d.headers.noSniff, false);
  });

  it("le `max-age` remonté est celui de l'en-tête réellement émis", () => {
    const { firewall, container } = bootFirewall(CONFIG);
    withHttpKernel(container, {
      strictTransportSecurity: "max-age=86400; includeSubDomains",
      frameOptions: "DENY",
      contentTypeOptions: "nosniff",
    });
    const d = firewall.describe().defenses!;
    assert.equal(d.headers.hsts, true);
    assert.equal(d.headers.hstsMaxAgeS, 86400);
    assert.equal(d.headers.frameguard, "deny");
    assert.equal(d.headers.noSniff, true);
  });

  it("sans HttpKernel au container, on ne devine pas : repli sur la config", () => {
    const { firewall } = bootFirewall({
      ...CONFIG,
      headers: { frameguard: "sameorigin" },
    });
    assert.equal(
      firewall.describe().defenses!.headers.frameguard,
      "sameorigin",
    );
  });
});
