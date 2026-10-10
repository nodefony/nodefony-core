import assert from "node:assert/strict";
import { Container, LOGIN_PAGE_PATH } from "nodefony";
import type { Module } from "nodefony";
import { AuthFlow } from "../../nodefony/service/authFlow";
import { securityConfigSchema } from "../../nodefony/config/config";

/**
 * Section `security.loginPage` et sa lecture par `authFlow.describeLoginPage()`
 * — le contrat que le contrôleur de la page (framework) consomme sans importer
 * ce paquet (ADR-0015).
 */

function buildFlow(options: unknown, oauth2?: unknown): AuthFlow {
  const container = new Container();
  container.set("kernel", { container, once() {} });
  if (oauth2 !== undefined) container.set("oauth2", oauth2);
  return new AuthFlow({
    container,
    notificationsCenter: false,
    options,
  } as unknown as Module);
}

describe("security.loginPage — schéma", () => {
  it("défauts : servie sur LOGIN_PAGE_PATH, mot de passe proposé, mise en page split", () => {
    const page = securityConfigSchema.parse({}).loginPage;
    assert.deepEqual(page, {
      enabled: true,
      path: LOGIN_PAGE_PATH,
      password: true,
      layout: "split",
    });
  });

  for (const path of [
    "//evil.example/login",
    "/\\evil.example",
    "https://evil.example/login",
    "login",
    "/login?from=/",
    "/login#x",
    "",
  ]) {
    it(`refuse le chemin ${JSON.stringify(path)}`, () => {
      assert.equal(
        securityConfigSchema.safeParse({ loginPage: { path } }).success,
        false,
      );
    });
  }

  it("refuse une clé inconnue (strictObject)", () => {
    assert.equal(
      securityConfigSchema.safeParse({ loginPage: { layot: "card" } }).success,
      false,
    );
  });

  it("refuse une mise en page inconnue", () => {
    assert.equal(
      securityConfigSchema.safeParse({ loginPage: { layout: "grid" } }).success,
      false,
    );
  });
});

describe("AuthFlow.describeLoginPage", () => {
  it("décrit la page par défaut, sans fournisseur quand oauth2 est absent", () => {
    assert.deepEqual(buildFlow({}).describeLoginPage(), {
      path: "/login",
      title: null,
      logo: null,
      template: null,
      layout: "split",
      password: true,
      providers: [],
    });
  });

  it("reprend les réglages de l'application", () => {
    const flow = buildFlow({
      loginPage: {
        path: "/connexion",
        title: "Intranet",
        logo: "/img/logo.svg",
        template: "views/login.eta",
        layout: "card",
        password: false,
      },
    });
    assert.deepEqual(flow.describeLoginPage(), {
      path: "/connexion",
      title: "Intranet",
      logo: "/img/logo.svg",
      template: "views/login.eta",
      layout: "card",
      password: false,
      providers: [],
    });
  });

  it("désactivée → null (le contrôleur répond 404)", () => {
    assert.equal(
      buildFlow({ loginPage: { enabled: false } }).describeLoginPage(),
      null,
    );
  });

  it("configuration invalide → null, sans lever", () => {
    assert.equal(
      buildFlow({ loginPage: { path: "//evil" } }).describeLoginPage(),
      null,
    );
  });

  it("fournisseurs relus à chaque appel, réduits au contrat {name, label}", () => {
    let offered = [
      { name: "keycloak", label: "Keycloak", secret: "ne-doit-pas-sortir" },
    ];
    const flow = buildFlow({}, { listDisplayProviders: () => offered });
    assert.deepEqual(flow.describeLoginPage()?.providers, [
      { name: "keycloak", label: "Keycloak" },
    ]);
    offered = [];
    assert.deepEqual(flow.describeLoginPage()?.providers, []);
  });
});
