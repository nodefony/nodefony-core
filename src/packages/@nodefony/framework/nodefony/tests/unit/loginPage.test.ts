/// <reference types="node" />
// @vitest-environment jsdom
/**
 * La page de connexion par défaut : les données du gabarit (filtrées), le
 * gabarit rendu (échappé), et le CONTRAT avec le script du cœur — le vrai
 * `mountLoginPage` est monté sur le HTML rendu et conduit le déroulé jusqu'à
 * la session. Une classe ou un attribut renommé d'un seul côté fait tomber ce
 * banc, alors que chacun passerait ses propres tests.
 */
import { expect, vi } from "vitest";
import { Eta } from "eta";
import type { ILoginPageDescription } from "nodefony";
import {
  LOGIN_PAGE_TEMPLATE,
  buildLoginPageView,
  keepSuccess,
  LOGIN_PAGE_EMPTY_NOTICE,
  ORGANIZATION_ACCOUNT_LABEL,
  type ILoginPageRequest,
} from "../../src/loginPage.js";
import { NodefonyLogin } from "../../../../../../nodefony/src/client/auth/NodefonyLogin.js";
import { mountLoginPage } from "../../../../../../nodefony/src/client/login/mountLoginPage.js";

const PAGE: ILoginPageDescription = {
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
  passkey: false,
  previewPicker: false,
  providers: [
    { name: "keycloak", label: "Compte entreprise", icon: null },
    { name: "github", label: "GitHub", icon: null },
  ],
};

const REQUEST: ILoginPageRequest = {
  from: "/admin/users?tab=2",
  theme: undefined,
  nonce: "n0nce",
  projectName: "mon-app",
  assetsVersion: "abc123",
};

const eta = new Eta({ autoEscape: true, useWith: false });
const template = eta.compile(LOGIN_PAGE_TEMPLATE);

function render(
  page: ILoginPageDescription = PAGE,
  request: ILoginPageRequest = REQUEST,
): Document {
  const html = template.call(eta, buildLoginPageView(page, request));
  return new DOMParser().parseFromString(html, "text/html");
}

describe("page de connexion — données du gabarit", () => {
  it("🔴 une destination hors de l'origine retombe sur `/` (CWE-601)", () => {
    for (const from of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      42,
    ]) {
      expect(
        buildLoginPageView(PAGE, { ...REQUEST, from }).from,
        String(from),
      ).toBe("/");
    }
  });

  it("le thème n'accepte que clair ou sombre", () => {
    expect(buildLoginPageView(PAGE, { ...REQUEST, theme: "dark" }).theme).toBe(
      "dark",
    );
    expect(
      buildLoginPageView(PAGE, { ...REQUEST, theme: "x" }).theme,
    ).toBeNull();
  });

  it("les fournisseurs gardent la destination et reviennent sur CETTE page ; `/` ne voyage pas", () => {
    const view = buildLoginPageView(PAGE, REQUEST);
    expect(view.providers.map((p) => p.href)).toEqual([
      "/nodefony/security/api/oauth2/keycloak/authorize?from=%2Fadmin%2Fusers%3Ftab%3D2&back=%2Flogin",
      "/nodefony/security/api/oauth2/github/authorize?from=%2Fadmin%2Fusers%3Ftab%3D2&back=%2Flogin",
    ]);
    const home = buildLoginPageView(PAGE, { ...REQUEST, from: undefined });
    expect(home.providers[0]?.href).toBe(
      "/nodefony/security/api/oauth2/keycloak/authorize?back=%2Flogin",
    );
    expect(view.ssoFirst).toBe(true);
  });

  it("un retour du fournisseur sans connexion s'annonce — sauf une annulation, et jamais le texte reçu", () => {
    expect(buildLoginPageView(PAGE, REQUEST).notice).toBeNull();
    expect(
      buildLoginPageView(PAGE, { ...REQUEST, reason: "access_denied" }).notice,
    ).toBeNull();
    for (const reason of ["failed", "server_error", "<b>forgé</b>"]) {
      const notice = buildLoginPageView(PAGE, { ...REQUEST, reason }).notice;
      expect(notice).toMatch(/n'a pas abouti/);
      expect(notice).not.toContain(reason);
    }
  });

  it("la marque vient du titre configuré, sinon du nom de l'application", () => {
    expect(buildLoginPageView(PAGE, REQUEST).brand).toBe("mon-app");
    expect(buildLoginPageView({ ...PAGE, title: "Parc" }, REQUEST).brand).toBe(
      "Parc",
    );
  });
});

describe("page de connexion — gabarit rendu", () => {
  it("l'échec d'un fournisseur s'affiche dans la zone de message, l'annulation non", () => {
    const failed = render(PAGE, { ...REQUEST, reason: "failed" });
    const alert = failed.querySelector("[data-message] .nf-alert");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toMatch(/n'a pas abouti/);
    const cancelled = render(PAGE, { ...REQUEST, reason: "access_denied" });
    expect(cancelled.querySelector("[data-message]")?.children.length).toBe(0);
  });

  it("🔴 nonce sur le script, fichiers versionnés, mise en page et destination posées", () => {
    const doc = render();
    const script = doc.querySelector('script[type="module"]');
    expect(script?.getAttribute("nonce")).toBe("n0nce");
    expect(script?.getAttribute("src")).toBe(
      "/nodefony/security/login/login.js?v=abc123",
    );
    expect(
      doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href"),
    ).toBe("/nodefony/security/login/login.css?v=abc123");
    expect(doc.body.dataset.layout).toBe("split");
    expect(doc.body.hasAttribute("data-sso-first")).toBe(true);
    expect(
      doc.querySelector<HTMLElement>("[data-nf-login]")?.dataset.from,
    ).toBe("/admin/users?tab=2");
    expect(doc.title).toBe("Se connecter — mon-app");
  });

  it("🔴 un titre ou un libellé hostile sort en TEXTE", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const doc = render(
      {
        ...PAGE,
        title: hostile,
        providers: [{ name: "x", label: hostile, icon: null }],
      },
      REQUEST,
    );
    expect(doc.querySelector('img[src="x"]')).toBeNull();
    expect(doc.querySelector(".nf-brand")?.textContent).toContain(hostile);
    expect(doc.querySelector(".nf-alt a")?.textContent).toContain(hostile);
  });

  it("sans mot de passe : fournisseurs seuls, ni formulaire ni « ou »", () => {
    const doc = render({ ...PAGE, password: false }, REQUEST);
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector(".nf-or")).toBeNull();
    expect(doc.querySelectorAll(".nf-alt a")).toHaveLength(2);
  });

  it("sans fournisseur : pas de bloc alternatif, pas de `data-sso-first`", () => {
    const doc = render({ ...PAGE, providers: [] }, REQUEST);
    expect(doc.querySelector("[data-alt]")).toBeNull();
    expect(doc.body.hasAttribute("data-sso-first")).toBe(false);
  });

  // 🔴 Toutes les combinaisons de moyens : mot de passe (P), passkey (K),
  // fournisseurs (N). Chaque ligne dit ce que la carte DOIT montrer — un cas
  // oublié a déjà laissé la passkey hors de la page, et une carte vide sans
  // un mot quand rien n'était configuré.
  const KEYCLOAK = [{ name: "keycloak", label: "Keycloak", icon: null }];
  const CASES: Array<{
    name: string;
    password: boolean;
    passkey: boolean;
    providers: ILoginPageDescription["providers"];
    form: boolean;
    passkeyButton: boolean;
    links: number;
    or: boolean;
    lead: string;
    empty: boolean;
  }> = [
    {
      name: "P",
      password: true,
      passkey: false,
      providers: [],
      form: true,
      passkeyButton: false,
      links: 0,
      or: false,
      lead: "Identifiant et mot de passe",
      empty: false,
    },
    {
      name: "P+K",
      password: true,
      passkey: true,
      providers: [],
      form: true,
      passkeyButton: true,
      links: 0,
      or: true,
      lead: "Identifiant et mot de passe, ou passkey",
      empty: false,
    },
    {
      name: "P+N",
      password: true,
      passkey: false,
      providers: KEYCLOAK,
      form: true,
      passkeyButton: false,
      links: 1,
      or: true,
      lead: "Compte de l'organisation ou identifiant local",
      empty: false,
    },
    {
      name: "P+K+N",
      password: true,
      passkey: true,
      providers: KEYCLOAK,
      form: true,
      passkeyButton: true,
      links: 1,
      or: true,
      lead: "Compte de l'organisation ou identifiant local",
      empty: false,
    },
    {
      name: "K",
      password: false,
      passkey: true,
      providers: [],
      form: false,
      passkeyButton: true,
      links: 0,
      or: false,
      lead: "Avec votre passkey",
      empty: false,
    },
    {
      name: "N",
      password: false,
      passkey: false,
      providers: KEYCLOAK,
      form: false,
      passkeyButton: false,
      links: 1,
      or: false,
      lead: "Avec le compte de votre organisation",
      empty: false,
    },
    {
      name: "K+N",
      password: false,
      passkey: true,
      providers: KEYCLOAK,
      form: false,
      passkeyButton: true,
      links: 1,
      or: false,
      lead: "Avec le compte de votre organisation",
      empty: false,
    },
    {
      name: "aucun",
      password: false,
      passkey: false,
      providers: [],
      form: false,
      passkeyButton: false,
      links: 0,
      or: false,
      lead: "Aucun moyen de connexion disponible",
      empty: true,
    },
  ];
  for (const c of CASES) {
    it(`🔴 moyens ${c.name} : formulaire ${c.form}, passkey ${c.passkeyButton}, ${c.links} fournisseur(s), « ou » ${c.or}`, () => {
      const doc = render(
        {
          ...PAGE,
          password: c.password,
          passkey: c.passkey,
          providers: c.providers,
        },
        REQUEST,
      );
      expect(doc.querySelector('form[data-step="identifier"]') !== null).toBe(
        c.form,
      );
      const passkey = doc.querySelector<HTMLElement>("[data-passkey]");
      expect(passkey !== null).toBe(c.passkeyButton);
      // Masqué au rendu : seul le script, qui constate le navigateur, le montre.
      if (passkey !== null) expect(passkey.hidden).toBe(true);
      expect(doc.querySelectorAll(".nf-alt a")).toHaveLength(c.links);
      expect(doc.querySelector(".nf-or") !== null).toBe(c.or);
      expect(doc.getElementById("nf-sub")?.textContent).toBe(c.lead);
      // Une connexion qui passe par le script a son étape « connecté ».
      expect(doc.querySelector('[data-step="authenticated"]') !== null).toBe(
        c.password || c.passkey,
      );
      expect(doc.querySelector("[data-message]")?.textContent ?? "").toBe(
        c.empty ? `—${LOGIN_PAGE_EMPTY_NOTICE}` : "",
      );
    });
  }

  it("aucun moyen : ce message passe avant l'échec d'un fournisseur", () => {
    const doc = render(
      { ...PAGE, password: false, passkey: false, providers: [] },
      { ...REQUEST, reason: "server_error" },
    );
    expect(doc.querySelector("[data-message]")?.textContent).toBe(
      `—${LOGIN_PAGE_EMPTY_NOTICE}`,
    );
  });

  it("passkey sans fournisseur : `providersFirst` la place avant le formulaire", () => {
    const doc = render(
      { ...PAGE, password: true, passkey: true, providers: [] },
      REQUEST,
    );
    expect(doc.body.hasAttribute("data-sso-first")).toBe(true);
  });

  it("🔴 un fournisseur d'organisation se lit « Compte de l'organisation », son logiciel en petit ; une marque grand public garde son nom", () => {
    const doc = render();
    const [keycloak, github] = Array.from(doc.querySelectorAll(".nf-alt a"));
    expect(keycloak?.querySelector(".nf-label")?.firstChild?.textContent).toBe(
      ORGANIZATION_ACCOUNT_LABEL,
    );
    expect(keycloak?.querySelector("small")?.textContent).toBe(
      "SSO · Compte entreprise",
    );
    expect(github?.textContent?.trim()).toBe("GitHub");
    expect(github?.querySelector("small")).toBeNull();
  });

  it("🔴 les onglets d'étapes sont collés au formulaire, sous les fournisseurs quand ils passent d'abord", () => {
    const doc = render();
    const steps = doc.querySelector(".nf-steps");
    expect(steps?.parentElement?.classList.contains("nf-body")).toBe(true);
    expect(steps?.nextElementSibling?.getAttribute("data-step")).toBe(
      "identifier",
    );
  });

  it("thème : la bascule est rendue ; le thème mémorisé ne se relit que si `?theme=` n'impose rien", () => {
    const free = render();
    expect(free.querySelector("[data-theme-toggle]")).not.toBeNull();
    const inline = free.querySelector("head script:not([src])");
    expect(inline?.getAttribute("nonce")).toBe("n0nce");
    expect(inline?.textContent).toContain("nf-login-theme");
    const imposed = render(PAGE, { ...REQUEST, theme: "dark" });
    expect(imposed.querySelector("head script:not([src])")).toBeNull();
  });

  it("🔴 sélecteur d'aperçu : seulement en développement ET sur demande, avec la valeur affichée sélectionnée", () => {
    const asked = { ...PAGE, previewPicker: true };
    const dev = render(asked, { ...REQUEST, preview: true, skin: "ledger" });
    const picker = dev.querySelector("form[data-preview-picker]");
    expect(picker).not.toBeNull();
    expect(
      dev.querySelector<HTMLSelectElement>('select[name="skin"]')?.value,
    ).toBe("ledger");
    expect(
      dev.querySelector<HTMLSelectElement>('select[name="layout"]')?.value,
    ).toBe("bare");
    expect(dev.querySelectorAll('select[name="skin"] option')).toHaveLength(9);
    // Production : jamais, même demandé.
    expect(
      render(asked, { ...REQUEST, preview: false }).querySelector(
        "[data-preview-picker]",
      ),
    ).toBeNull();
    // Développement sans la demande : rien non plus.
    expect(
      render(PAGE, { ...REQUEST, preview: true }).querySelector(
        "[data-preview-picker]",
      ),
    ).toBeNull();
  });

  it("par défaut : « Se connecter », vitrine Nodefony, pied de page, aucune feuille de l'application", () => {
    const doc = render();
    expect(doc.querySelector("h1")?.textContent).toBe("Se connecter");
    expect(doc.title.startsWith("Se connecter —")).toBe(true);
    expect(doc.querySelector(".nf-hero .nf-home h2")?.textContent).toBe(
      "Le framework Node.js fullstack",
    );
    expect(doc.querySelector(".nf-foot")).not.toBeNull();
    expect(doc.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
  });

  it("titre, sous-titre et feuille de l'application (chargée APRÈS celle du framework)", () => {
    const doc = render({
      ...PAGE,
      heading: "Espace client",
      subtitle: "Votre compte Acme",
      stylesheet: "/assets/acme-login.css",
    });
    expect(doc.querySelector("h1")?.textContent).toBe("Espace client");
    expect(doc.title.startsWith("Espace client —")).toBe(true);
    expect(doc.querySelector("#nf-sub")?.textContent).toBe("Votre compte Acme");
    const sheets = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(
      (l) => l.getAttribute("href"),
    );
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatch(/login\.css\?v=/);
    expect(sheets[1]).toBe("/assets/acme-login.css");
  });

  it("🔴 un sous-titre, une accroche ou une adresse hostile sort en TEXTE", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const doc = render({
      ...PAGE,
      subtitle: hostile,
      hero: { heading: hostile, text: hostile },
      stylesheet: hostile,
    });
    expect(doc.querySelector("#nf-sub")?.textContent).toBe(hostile);
    expect(doc.querySelector(".nf-home h2")?.textContent).toBe(hostile);
    expect(doc.querySelector('img[src="x"]')).toBeNull();
  });

  it("`providersFirst: false` : le formulaire d'abord", () => {
    expect(
      render({ ...PAGE, providersFirst: false }).body.hasAttribute(
        "data-sso-first",
      ),
    ).toBe(false);
    expect(render().body.hasAttribute("data-sso-first")).toBe(true);
  });

  it("panneau : texte de l'application à la place de la vitrine, ou marque seule", () => {
    const custom = render({
      ...PAGE,
      hero: { heading: "Bienvenue chez Acme", text: null },
    });
    expect(custom.querySelector(".nf-home h2")?.textContent).toBe(
      "Bienvenue chez Acme",
    );
    expect(custom.querySelector(".nf-home .sub")).toBeNull();
    expect(custom.querySelector(".nf-home .features")).toBeNull();
    const bare = render({ ...PAGE, hero: false });
    expect(bare.querySelector(".nf-hero .nf-hero-brand")).not.toBeNull();
    expect(bare.querySelector(".nf-hero .nf-home")).toBeNull();
  });

  it("`footer: false` retire le pied de page", () => {
    expect(
      render({ ...PAGE, footer: false }).querySelector(".nf-foot"),
    ).toBeNull();
  });

  it("l'image d'un fournisseur remplace l'icône du framework", () => {
    const doc = render({
      ...PAGE,
      providers: [
        { name: "keycloak", label: "Acme SSO", icon: "/assets/acme.svg" },
        { name: "github", label: "GitHub", icon: null },
      ],
    });
    const [acme, github] = [...doc.querySelectorAll(".nf-alt .nf-btn")];
    expect(acme?.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/acme.svg",
    );
    expect(acme?.querySelector("svg")).toBeNull();
    expect(github?.querySelector("use")?.getAttribute("href")).toBe(
      "#m-github",
    );
  });

  it("le thème imposé se pose sur la racine", () => {
    expect(
      render(PAGE, { ...REQUEST, theme: "light" }).documentElement.dataset
        .theme,
    ).toBe("light");
    expect(render().documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("page de connexion — habillages", () => {
  const sheets = (doc: Document) =>
    [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) =>
      l.getAttribute("href"),
    );

  it("l'habillage par défaut n'ajoute aucune feuille ; `data-skin` toujours posé", () => {
    const doc = render();
    expect(doc.body.dataset.skin).toBe("frontispiece");
    expect(doc.body.hasAttribute("data-backdrop")).toBe(false);
    expect(sheets(doc)).toHaveLength(1);
  });

  it("🔴 ordre des feuilles : framework, habillage, application", () => {
    const doc = render({
      ...PAGE,
      skin: "blueprint",
      layout: "card",
      stylesheet: "/assets/acme-login.css",
    });
    expect(sheets(doc)).toEqual([
      "/nodefony/security/login/login.css?v=abc123",
      "/nodefony/security/login/skins/blueprint.css?v=abc123",
      "/assets/acme-login.css",
    ]);
    expect(doc.body.dataset.skin).toBe("blueprint");
    expect(doc.body.dataset.layout).toBe("card");
    // Fond décoré : le pied passe sur une pastille pleine (login.css).
    expect(doc.body.hasAttribute("data-backdrop")).toBe(true);
  });

  it("🔴 hors aperçu (production), `?skin=` et `?layout=` sont ignorés", () => {
    const doc = render(PAGE, {
      ...REQUEST,
      skin: "console",
      layout: "bare",
      preview: false,
    });
    expect(doc.body.dataset.skin).toBe("frontispiece");
    expect(doc.body.dataset.layout).toBe("split");
    expect(sheets(doc)).toHaveLength(1);
  });

  it("aperçu : `?skin=` seul prend la mise en page de son habillage", () => {
    const view = buildLoginPageView(PAGE, {
      ...REQUEST,
      skin: "ledger",
      preview: true,
    });
    expect(view.skin).toBe("ledger");
    expect(view.layout).toBe("bare");
    expect(view.skinHref).toBe(
      "/nodefony/security/login/skins/ledger.css?v=abc123",
    );
  });

  it("aperçu : `?layout=` remplace la mise en page, celle de la configuration sinon", () => {
    expect(
      buildLoginPageView(PAGE, {
        ...REQUEST,
        skin: "console",
        layout: "split",
        preview: true,
      }).layout,
    ).toBe("split");
    expect(
      buildLoginPageView(
        { ...PAGE, layout: "card" },
        { ...REQUEST, layout: "bare", preview: true },
      ).layout,
    ).toBe("bare");
    expect(
      buildLoginPageView(
        { ...PAGE, layout: "card" },
        { ...REQUEST, preview: true },
      ).layout,
    ).toBe("card");
  });

  it("🔴 aperçu : une valeur hors liste est ignorée, jamais injectée dans une adresse", () => {
    const view = buildLoginPageView(PAGE, {
      ...REQUEST,
      skin: "../../etc/passwd",
      layout: "<script>",
      preview: true,
    });
    expect(view.skin).toBe("frontispiece");
    expect(view.layout).toBe("split");
    expect(view.skinHref).toBeNull();
  });
});

describe("page de connexion — contrat avec le script du cœur", () => {
  it("🔴 le vrai script, monté sur le HTML rendu, conduit jusqu'à la session puis vers `from`", async () => {
    const rendered = render();
    document.documentElement.replaceWith(
      document.importNode(rendered.documentElement, true),
    );
    const calls: string[] = [];
    const fetch = ((input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : "requête");
      return Promise.resolve(
        new Response(
          JSON.stringify({ user: { id: 1, identifier: "admin", roles: [] } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof globalThis.fetch;
    const navigate = vi.fn();
    const unmount = mountLoginPage(document, {
      login: new NodefonyLogin({ fetch, passkey: null }),
      navigate,
    });
    try {
      const submit = (step: string): void => {
        document
          .querySelector(`form[data-step="${step}"]`)
          ?.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      };
      const username = document.querySelector<HTMLInputElement>("#nf-username");
      const password = document.querySelector<HTMLInputElement>("#nf-password");
      expect(username).not.toBeNull();
      expect(password).not.toBeNull();
      if (username === null || password === null) return;
      username.value = "admin";
      submit("identifier");
      expect(
        document.querySelector<HTMLElement>('[data-step="password"]')?.hidden,
      ).toBe(false);
      expect(document.querySelector(".nf-account .who")?.textContent).toBe(
        "admin",
      );
      password.value = "secret";
      submit("password");
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(calls).toEqual(["/nodefony/security/api/auth/login"]);
      expect(
        document.querySelector<HTMLElement>('[data-step="authenticated"]')
          ?.hidden,
      ).toBe(false);
      expect(navigate).toHaveBeenCalledWith("/admin/users?tab=2");
      // Six cases de code : le script les relit pour le second facteur.
      expect(
        document.querySelectorAll('[data-step="mfa"] .nf-otp input'),
      ).toHaveLength(6);
    } finally {
      unmount();
    }
  });
});

describe("page de connexion — passkey, avec le vrai script", () => {
  const mount = (page: ILoginPageDescription, login: NodefonyLogin) => {
    const rendered = render(page);
    document.documentElement.replaceWith(
      document.importNode(rendered.documentElement, true),
    );
    const navigate = vi.fn();
    return { navigate, unmount: mountLoginPage(document, { login, navigate }) };
  };

  it("🔴 navigateur capable : le bouton se montre, et un clic ouvre la session puis va vers `from`", async () => {
    const calls: string[] = [];
    const fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : "requête";
      calls.push(url);
      const body = url.endsWith("/options")
        ? { challenge: "c" }
        : { user: { id: 1, identifier: "admin", roles: [] } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof globalThis.fetch;
    const { navigate, unmount } = mount(
      { ...PAGE, password: false, passkey: true, providers: [] },
      new NodefonyLogin({
        fetch,
        passkey: { sign: () => Promise.resolve({ id: "cred" }) },
      }),
    );
    try {
      const button = document.querySelector<HTMLElement>("[data-passkey]");
      expect(button?.hidden).toBe(false);
      button?.click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(calls).toEqual([
        "/nodefony/security/api/webauthn/login/options",
        "/nodefony/security/api/webauthn/login/verify",
      ]);
      expect(navigate).toHaveBeenCalledWith("/admin/users?tab=2");
    } finally {
      unmount();
    }
  });

  it("🔴 navigateur incapable et passkey seule : bouton masqué ET la page le dit", () => {
    const { unmount } = mount(
      { ...PAGE, password: false, passkey: true, providers: [] },
      new NodefonyLogin({ passkey: null }),
    );
    try {
      expect(
        document.querySelector<HTMLElement>("[data-passkey]")?.hidden,
      ).toBe(true);
      expect(document.querySelector("[data-message]")?.textContent).toContain(
        "Ce navigateur ne sait pas se connecter",
      );
    } finally {
      unmount();
    }
  });

  it("navigateur incapable mais d'autres moyens : bouton masqué, aucun message", () => {
    const { unmount } = mount(
      { ...PAGE, password: true, passkey: true },
      new NodefonyLogin({ passkey: null }),
    );
    try {
      expect(
        document.querySelector<HTMLElement>("[data-passkey]")?.hidden,
      ).toBe(true);
      expect(document.querySelector("[data-message]")?.textContent).toBe("");
    } finally {
      unmount();
    }
  });
});

describe("page de connexion — bascule de thème, avec le vrai script", () => {
  it("🔴 un clic inverse le thème affiché et le retient ; un second clic revient", () => {
    const rendered = render(PAGE, { ...REQUEST, theme: "light" });
    document.documentElement.replaceWith(
      document.importNode(rendered.documentElement, true),
    );
    const unmount = mountLoginPage(document, {
      login: new NodefonyLogin({ passkey: null }),
      navigate: vi.fn(),
    });
    try {
      const toggle = document.querySelector<HTMLElement>("[data-theme-toggle]");
      toggle?.click();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(localStorage.getItem("nf-login-theme")).toBe("dark");
      toggle?.click();
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(localStorage.getItem("nf-login-theme")).toBe("light");
    } finally {
      unmount();
      localStorage.clear();
    }
  });
});

describe("page de connexion — sélecteur d'aperçu, avec le vrai script", () => {
  it("🔴 un choix recharge ; changer d'habillage rend la mise en page à l'habillage", () => {
    const rendered = render(
      { ...PAGE, previewPicker: true },
      { ...REQUEST, preview: true },
    );
    document.documentElement.replaceWith(
      document.importNode(rendered.documentElement, true),
    );
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const unmount = mountLoginPage(document, {
      login: new NodefonyLogin({ passkey: null }),
      navigate: vi.fn(),
    });
    try {
      const skin = document.querySelector<HTMLSelectElement>(
        'select[name="skin"]',
      );
      const layout = document.querySelector<HTMLSelectElement>(
        'select[name="layout"]',
      );
      if (skin === null || layout === null) throw new Error("sélecteur absent");
      skin.value = "horizon";
      skin.dispatchEvent(new Event("change", { bubbles: true }));
      expect(submit).toHaveBeenCalledTimes(1);
      expect(layout.disabled).toBe(true);
    } finally {
      unmount();
      submit.mockRestore();
    }
  });
});

describe("page de connexion — une panne de chargement n'est pas figée", () => {
  it("🔴 un échec est oublié : l'appel suivant recharge ; un succès est gardé", async () => {
    let calls = 0;
    let fail = true;
    const load = keepSuccess(() => {
      calls += 1;
      return fail ? Promise.reject(new Error("absent")) : Promise.resolve("ok");
    });
    await expect(load()).rejects.toThrow("absent");
    fail = false;
    expect(await load()).toBe("ok");
    expect(await load()).toBe("ok");
    expect(calls).toBe(2);
  });
});
