import {
  LOGIN_PAGE_ASSETS_BASE,
  oauth2AuthorizePath,
  safeRedirectPath,
  type ILoginPageDescription,
  type LoginPageLayout,
} from "nodefony";

/** Fournisseur prêt à afficher : libellé, adresse d'autorisation, icône. */
export interface ILoginPageViewProvider {
  readonly label: string;
  readonly href: string;
  /** Symbole du sprite d'icônes (`i-key`, `m-github`). */
  readonly icon: string;
}

/**
 * Données du gabarit de la page de connexion — tout ce qu'il affiche, déjà
 * validé : aucune valeur de la requête n'y entre sans être filtrée.
 */
export interface ILoginPageView {
  /** Nom affiché de l'application. */
  readonly brand: string;
  /** Titre de la carte et de l'onglet. */
  readonly title: string;
  readonly logo: string;
  readonly layout: LoginPageLayout;
  /** Thème imposé par `?theme=`, `null` = celui du système. */
  readonly theme: "light" | "dark" | null;
  /** Fournisseurs avant le formulaire (au moins un fournisseur proposé). */
  readonly ssoFirst: boolean;
  readonly password: boolean;
  readonly providers: readonly ILoginPageViewProvider[];
  /** Destination après connexion, déjà passée par `safeRedirectPath`. */
  readonly from: string;
  readonly styleHref: string;
  readonly scriptHref: string;
  readonly logoHref: string;
  /** Nonce CSP de la requête, posé sur le `<script>`. */
  readonly nonce: string;
}

/** Ce que la requête apporte à la page. */
export interface ILoginPageRequest {
  /** Valeur brute de `?from=`. */
  readonly from: unknown;
  /** Valeur brute de `?theme=`. */
  readonly theme: unknown;
  readonly nonce: string;
  /** Nom de l'application, quand la configuration ne donne pas de titre. */
  readonly projectName: string;
  /** Empreinte des fichiers servis, ajoutée à leur adresse (cache). */
  readonly assetsVersion: string;
}

/** Feuille, script et logo de la page, servis sous {@link LOGIN_PAGE_ASSETS_BASE}. */
export const LOGIN_PAGE_ASSET_FILES = {
  style: "login.css",
  script: "login.js",
  logo: "nodefony-logo.svg",
} as const;

const DEFAULT_TITLE = "Se connecter";

/**
 * Prépare les données du gabarit à partir de la description de la page
 * (security) et de la requête.
 *
 * Fonction pure : `from` repasse par `safeRedirectPath` (un chemin hors de
 * l'origine retombe sur `/`), `theme` n'accepte que `light` ou `dark`.
 *
 * @param page - description rendue par `authFlow.describeLoginPage()`
 * @param request - valeurs de la requête, non filtrées
 * @returns les données du gabarit
 */
export function buildLoginPageView(
  page: ILoginPageDescription,
  request: ILoginPageRequest,
): ILoginPageView {
  const from = safeRedirectPath(request.from);
  const asset = (file: string): string =>
    `${LOGIN_PAGE_ASSETS_BASE}/${file}?v=${encodeURIComponent(request.assetsVersion)}`;
  const logoHref = asset(LOGIN_PAGE_ASSET_FILES.logo);
  // L'adresse de retour ne voyage vers le fournisseur que si elle dit quelque
  // chose : `/` est déjà la destination par défaut.
  const providerFrom = from === "/" ? undefined : from;
  return {
    brand: page.title ?? request.projectName,
    title: DEFAULT_TITLE,
    logo: page.logo ?? logoHref,
    layout: page.layout,
    theme:
      request.theme === "light" || request.theme === "dark"
        ? request.theme
        : null,
    ssoFirst: page.providers.length > 0,
    password: page.password,
    providers: page.providers.map(({ name, label }) => ({
      label,
      href: oauth2AuthorizePath(name, providerFrom),
      icon: name === "github" ? "m-github" : "i-key",
    })),
    from,
    styleHref: asset(LOGIN_PAGE_ASSET_FILES.style),
    scriptHref: asset(LOGIN_PAGE_ASSET_FILES.script),
    logoHref,
    nonce: request.nonce,
  };
}

/**
 * Gabarit Eta de la page de connexion par défaut (balisage F03, feuille
 * `nodefony/login.css`, script `nodefony/login.js`).
 *
 * En chaîne dans le code : un `.eta` posé à côté ne serait pas publié
 * (`files` du paquet = `dist`, `docs`). Compilé une fois par processus.
 * Tout passe par `<%= %>` (échappé) ; aucune sortie brute.
 */
export const LOGIN_PAGE_TEMPLATE = `<!doctype html>
<html lang="fr"<% if (it.theme) { %> data-theme="<%= it.theme %>"<% } %>>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <meta name="robots" content="noindex" />
    <title><%= it.title %> — <%= it.brand %></title>
    <link rel="icon" href="<%= it.logoHref %>" type="image/svg+xml" />
    <link rel="stylesheet" href="<%= it.styleHref %>" />
    <script type="module" src="<%= it.scriptHref %>" nonce="<%= it.nonce %>"></script>
  </head>
  <body data-layout="<%= it.layout %>"<% if (it.ssoFirst) { %> data-sso-first<% } %>>
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="3.8" /><path d="M10.8 12.2 19.5 3.5M16.5 6.5l2.5 2.5M14 9l2 2" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z" /></symbol>
      <symbol id="m-github" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></symbol>
    </svg>
    <header class="nf-strip">
      <div class="nf-strip-brand"><img class="nf-logo" src="<%= it.logo %>" alt="" /><%= it.brand %></div>
    </header>
    <div class="nf-layout">
      <aside class="nf-hero" aria-hidden="true">
        <div class="nf-hero-brand"><img class="nf-logo" src="<%= it.logo %>" alt="" /><%= it.brand %></div>
      </aside>
      <main class="nf-stage" data-nf-login data-from="<%= it.from %>">
        <section class="nf-card" aria-labelledby="nf-title">
          <div class="nf-head">
            <div class="nf-brand"><img class="nf-logo" src="<%= it.logo %>" alt="" /><%= it.brand %></div>
            <h1 id="nf-title"><%= it.title %></h1>
            <p class="nf-sub" id="nf-sub"><% if (it.password && it.providers.length > 0) { %>Compte de l'organisation ou identifiant local<% } else if (it.password) { %>Identifiant et mot de passe<% } else { %>Avec le compte de votre organisation<% } %></p>
          </div>
<% if (it.password) { %>
          <ol class="nf-steps" aria-label="Étapes">
            <li data-tab="identifier" aria-current="step">Identifiant</li>
            <li data-tab="password">Mot de passe</li>
            <li data-tab="mfa" hidden>Vérification</li>
          </ol>
<% } %>
          <div class="nf-body">
<% if (it.password) { %>
            <form data-step="identifier">
              <div class="nf-field">
                <label for="nf-username">Identifiant ou adresse e-mail</label>
                <div class="nf-input">
                  <svg class="nf-icon" aria-hidden="true"><use href="#i-user" /></svg>
                  <input id="nf-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required />
                </div>
              </div>
              <button class="nf-btn primary" type="submit">Continuer<svg class="nf-icon" aria-hidden="true"><use href="#i-arrow" /></svg></button>
            </form>
            <form data-step="password" hidden>
              <div class="nf-account">
                <span class="nf-avatar" aria-hidden="true"></span><span class="who"></span>
                <button type="button" class="nf-link" data-go="identifier">Changer</button>
              </div>
              <div class="nf-field">
                <div class="nf-label-row"><label for="nf-password">Mot de passe</label></div>
                <div class="nf-input">
                  <svg class="nf-icon" aria-hidden="true"><use href="#i-lock" /></svg>
                  <input id="nf-password" name="password" type="password" autocomplete="current-password" required />
                  <button type="button" class="nf-reveal" data-reveal aria-label="Afficher le mot de passe" aria-pressed="false"><svg class="nf-icon" aria-hidden="true"><use href="#i-eye" /></svg></button>
                </div>
              </div>
              <button class="nf-btn primary" type="submit">Se connecter<svg class="nf-icon" aria-hidden="true"><use href="#i-arrow" /></svg></button>
            </form>
            <form data-step="mfa" hidden>
              <div class="nf-field">
                <label id="nf-otp-label">Code à 6 chiffres</label>
                <div class="nf-otp" role="group" aria-labelledby="nf-otp-label">
                  <input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Chiffre 1" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 2" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 3" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 4" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 5" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 6" />
                </div>
              </div>
              <p class="nf-hint">Le code affiché par votre application d'authentification.</p>
              <button class="nf-btn primary" type="submit">Vérifier</button>
            </form>
            <div data-step="authenticated" hidden>
              <div class="nf-done" role="status">
                <span class="ring" aria-hidden="true"><svg class="nf-icon"><use href="#i-check" /></svg></span>
                <strong>Session ouverte</strong><span class="dest"></span>
                <span class="nf-progress" aria-hidden="true"><span></span></span>
              </div>
            </div>
<% } %>
<% if (it.providers.length > 0) { %>
            <div data-alt>
<% if (it.password) { %>
              <div class="nf-or">ou</div>
<% } %>
              <div class="nf-alt">
<% it.providers.forEach(function (provider) { %>
                <a class="nf-btn" href="<%= provider.href %>"><svg class="<%= provider.icon === 'm-github' ? 'nf-mark' : 'nf-icon' %>" aria-hidden="true"><use href="#<%= provider.icon %>" /></svg><%= provider.label %></a>
<% }) %>
              </div>
            </div>
<% } %>
            <div class="nf-message" aria-live="polite" data-message></div>
<% if (it.password) { %>
            <noscript><p class="nf-hint">Cette page a besoin de JavaScript pour vous connecter.</p></noscript>
<% } %>
          </div>
        </section>
        <div class="nf-foot">
          <ul class="nf-facts" aria-label="Protection de la session">
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield" /></svg>cookie HttpOnly</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield" /></svg>anti-CSRF</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield" /></svg>CSP stricte</li>
          </ul>
          <a class="nf-powered" href="https://github.com/nodefony/nodefony-core" rel="noopener noreferrer"><img class="nf-logo nf-logo-mono" src="<%= it.logoHref %>" alt="" />Propulsé par Nodefony</a>
        </div>
      </main>
    </div>
  </body>
</html>
`;
