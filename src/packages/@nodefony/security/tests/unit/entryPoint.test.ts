import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType, ISecurityTrace } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import {
  entryPointLocation,
  isBrowserNavigation,
  type IEntryPointRequest,
} from "../../nodefony/src/entryPoint";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { securityConfigSchema } from "../../nodefony/config/config";
import type { IAuthenticator } from "../../nodefony/contracts/IAuthenticator";
import type { ISecurityAreaConfig } from "../../nodefony/config/defineModuleConfig";

/**
 * `entryPoint` d'une zone (#548) : un visiteur anonyme qui NAVIGUE vers une
 * page protégée est conduit à la page de connexion (302), tout autre client
 * garde son 401 et son `WWW-Authenticate`. La redirection reste un refus.
 */

const NAV: IEntryPointRequest = {
  method: "GET",
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  fetchMode: "navigate",
  path: "/compte",
};

describe("entryPoint — qui est une navigation", () => {
  it("GET ou HEAD qui demande du HTML, en navigation déclarée ou sans Fetch Metadata", () => {
    assert.equal(isBrowserNavigation(NAV), true);
    assert.equal(isBrowserNavigation({ ...NAV, method: "HEAD" }), true);
    assert.equal(isBrowserNavigation({ ...NAV, fetchMode: undefined }), true);
  });

  it("un appel d'API, un fetch, un POST ne sont pas des navigations", () => {
    assert.equal(
      isBrowserNavigation({ ...NAV, accept: "application/json" }),
      false,
    );
    assert.equal(isBrowserNavigation({ ...NAV, accept: undefined }), false);
    assert.equal(isBrowserNavigation({ ...NAV, fetchMode: "cors" }), false);
    assert.equal(
      isBrowserNavigation({ ...NAV, fetchMode: "same-origin" }),
      false,
    );
    assert.equal(isBrowserNavigation({ ...NAV, method: "POST" }), false);
    assert.equal(isBrowserNavigation({ ...NAV, method: undefined }), false);
  });

  it("l'adresse porte le chemin demandé, encodé, requête comprise, jamais l'hôte", () => {
    assert.equal(entryPointLocation("/login", NAV), "/login?from=%2Fcompte");
    assert.equal(
      entryPointLocation("/login", { ...NAV, path: "/compte?onglet=2" }),
      "/login?from=%2Fcompte%3Fonglet%3D2",
    );
    assert.equal(
      entryPointLocation("/login", { ...NAV, accept: "application/json" }),
      null,
    );
  });

  it("la page de connexion sous sa propre zone ne se redirige pas vers elle-même", () => {
    assert.equal(
      entryPointLocation("/login", { ...NAV, path: "/login" }),
      null,
    );
    assert.equal(
      entryPointLocation("/login", { ...NAV, path: "/login?from=%2Fx" }),
      null,
    );
  });

  it("un chemin demandé hors de l'origine ne voyage pas (garde anti-redirection ouverte)", () => {
    assert.equal(
      entryPointLocation("/login", { ...NAV, path: "//evil.example/x" }),
      "/login",
    );
  });
});

describe("entryPoint — la configuration refuse une adresse externe", () => {
  const parse = (entryPoint: string): boolean =>
    securityConfigSchema.safeParse({
      areas: { pages: { pattern: "^/compte", entryPoint } },
    }).success;

  it("accepte un chemin de l'origine, refuse le reste au boot", () => {
    assert.equal(parse("/login"), true);
    assert.equal(parse("https://evil.example/login"), false);
    assert.equal(parse("//evil.example/login"), false);
    assert.equal(parse("login"), false);
  });
});

/** Authenticator qui ne reconnaît jamais la requête : aucune preuve présentée. */
class SilentAuthenticator implements IAuthenticator {
  readonly name = "session";
  supports(): boolean {
    return false;
  }
  createToken(): never {
    throw new Error("jamais appelé");
  }
  authenticate(): never {
    throw new Error("jamais appelé");
  }
  onSuccess(): Promise<void> {
    return Promise.resolve();
  }
  onFailure(): Promise<void> {
    return Promise.resolve();
  }
  challenge(): string {
    return "";
  }
}

const zone = (entryPoint?: string): SecuredArea =>
  new SecuredArea("pages", {
    pattern: "^/compte",
    security: true,
    stateless: false,
    mode: "first",
    roles: [],
    realtime: true,
    authenticators: ["session"],
    ...(entryPoint === undefined ? {} : { entryPoint }),
  } as ISecurityAreaConfig);

function firewall(): Firewall {
  const fw = new Firewall({
    container: new Container(),
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
  fw.registerAuthenticator(new SilentAuthenticator());
  return fw;
}

interface IProbe {
  context: ContextType & { securityTrace: ISecurityTrace | null };
  headers: Record<string, string>;
  redirects: string[];
}

function probe(
  area: SecuredArea,
  request: { method: string; headers: Record<string, string> },
  opts: { canRedirect?: boolean } = {},
): IProbe {
  const headers: Record<string, string> = {};
  const redirects: string[] = [];
  const context = {
    request: { ...request, url: new URL("https://localhost/compte?onglet=2") },
    security: area,
    profiling: true,
    securityTrace: null,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
    ...(opts.canRedirect === false
      ? {}
      : {
          redirect: (url: string) => {
            redirects.push(url);
          },
        }),
  } as unknown as IProbe["context"];
  return { context, headers, redirects };
}

const NAVIGATION = {
  method: "GET",
  headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
};

describe("entryPoint — le pare-feu", () => {
  it("une navigation anonyme est conduite à la page de connexion, et reste un refus journalisé", async () => {
    const p = probe(zone("/login"), NAVIGATION);
    await assert.rejects(
      () => firewall().handleSecurity(p.context),
      AuthenticationError,
    );
    assert.deepEqual(p.redirects, ["/login?from=%2Fcompte%3Fonglet%3D2"]);
    assert.equal(p.headers["WWW-Authenticate"], undefined);
    assert.equal(p.context.securityTrace?.outcome, "denied");
    assert.equal(p.context.securityTrace?.reason, "no_credentials");
  });

  it("un appel d'API, un POST, une zone sans entryPoint, un WebSocket gardent le 401 et son défi", async () => {
    const cases: IProbe[] = [
      probe(zone("/login"), {
        method: "GET",
        headers: { accept: "application/json" },
      }),
      probe(zone("/login"), {
        method: "POST",
        headers: { accept: "text/html" },
      }),
      probe(zone(), NAVIGATION),
      probe(zone("/login"), NAVIGATION, { canRedirect: false }),
    ];
    for (const p of cases) {
      await assert.rejects(
        () => firewall().handleSecurity(p.context),
        AuthenticationError,
      );
      assert.deepEqual(p.redirects, []);
      assert.ok(p.headers["WWW-Authenticate"], "le 401 porte son défi");
      assert.equal(p.context.securityTrace?.reason, "no_credentials");
    }
  });
});
