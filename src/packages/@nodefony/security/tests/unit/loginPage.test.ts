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
  it("défauts : servie sur LOGIN_PAGE_PATH, mot de passe proposé, habillage frontispiece sans mise en page imposée, fournisseurs d'abord, pied de page", () => {
    const page = securityConfigSchema.parse({}).loginPage;
    assert.deepEqual(page, {
      enabled: true,
      path: LOGIN_PAGE_PATH,
      password: true,
      providersFirst: true,
      footer: true,
      skin: "frontispiece",
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

  it("🔴 refuse un habillage inconnu (une faute de frappe arrête le démarrage)", () => {
    assert.equal(
      securityConfigSchema.safeParse({ loginPage: { skin: "horizont" } })
        .success,
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
      heading: null,
      subtitle: null,
      stylesheet: null,
      providersFirst: true,
      hero: null,
      footer: true,
      skin: "frontispiece",
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
        heading: "Espace client",
        subtitle: "Votre compte Acme",
        stylesheet: "/assets/acme.css",
        providersFirst: false,
        hero: { heading: "Bienvenue" },
        footer: false,
        layout: "card",
        password: false,
      },
    });
    assert.deepEqual(flow.describeLoginPage(), {
      path: "/connexion",
      title: "Intranet",
      logo: "/img/logo.svg",
      template: "views/login.eta",
      heading: "Espace client",
      subtitle: "Votre compte Acme",
      stylesheet: "/assets/acme.css",
      providersFirst: false,
      hero: { heading: "Bienvenue", text: null },
      footer: false,
      skin: "frontispiece",
      layout: "card",
      password: false,
      providers: [],
    });
  });

  it("🔴 sans `layout`, la mise en page est celle de l'habillage ; un `layout` écrit gagne", () => {
    const skinned = buildFlow({ loginPage: { skin: "ledger" } });
    assert.equal(skinned.describeLoginPage()?.skin, "ledger");
    assert.equal(skinned.describeLoginPage()?.layout, "bare");
    const forced = buildFlow({ loginPage: { skin: "ledger", layout: "card" } });
    assert.equal(forced.describeLoginPage()?.layout, "card");
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

  it("`hero: false` passe tel quel ; une clé inconnue du panneau est refusée", () => {
    assert.equal(
      buildFlow({ loginPage: { hero: false } }).describeLoginPage()?.hero,
      false,
    );
    assert.equal(
      securityConfigSchema.safeParse({
        loginPage: { hero: { heading: "x", image: "/photo.jpg" } },
      }).success,
      false,
    );
  });

  it("fournisseurs relus à chaque appel, réduits au contrat {name, label, icon}", () => {
    let offered: Array<Record<string, string>> = [
      { name: "keycloak", label: "Keycloak", secret: "ne-doit-pas-sortir" },
      { name: "acme", label: "Acme", icon: "/assets/acme.svg" },
    ];
    const flow = buildFlow({}, { listDisplayProviders: () => offered });
    assert.deepEqual(flow.describeLoginPage()?.providers, [
      { name: "keycloak", label: "Keycloak", icon: null },
      { name: "acme", label: "Acme", icon: "/assets/acme.svg" },
    ]);
    offered = [];
    assert.deepEqual(flow.describeLoginPage()?.providers, []);
  });
});
