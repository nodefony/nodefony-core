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
  layout: "split",
  password: true,
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

  it("les fournisseurs gardent la destination ; `/` ne voyage pas", () => {
    const view = buildLoginPageView(PAGE, REQUEST);
    expect(view.providers.map((p) => p.href)).toEqual([
      "/nodefony/security/api/oauth2/keycloak/authorize?from=%2Fadmin%2Fusers%3Ftab%3D2",
      "/nodefony/security/api/oauth2/github/authorize?from=%2Fadmin%2Fusers%3Ftab%3D2",
    ]);
    const home = buildLoginPageView(PAGE, { ...REQUEST, from: undefined });
    expect(home.providers[0]?.href).toBe(
      "/nodefony/security/api/oauth2/keycloak/authorize",
    );
    expect(view.ssoFirst).toBe(true);
  });

  it("la marque vient du titre configuré, sinon du nom de l'application", () => {
    expect(buildLoginPageView(PAGE, REQUEST).brand).toBe("mon-app");
    expect(buildLoginPageView({ ...PAGE, title: "Parc" }, REQUEST).brand).toBe(
      "Parc",
    );
  });
});

describe("page de connexion — gabarit rendu", () => {
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
          JSON.stringify({ user: { id: 1, username: "admin", roles: [] } }),
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
