import {
  LOGIN_PAGE_ASSETS_BASE,
  LOGIN_PAGE_LAYOUTS,
  LOGIN_PAGE_SKINS,
  LOGIN_PAGE_SKIN_SPECS,
  isLoginPageSkin,
  loginPageSkinFile,
  LOGIN_PAGE_THEME_KEY,
  OAUTH2_CANCELLED_REASON,
  oauth2AuthorizePath,
  safeRedirectPath,
  type ILoginPageDescription,
  type ILoginPageHero,
  type LoginPageLayout,
  type LoginPageSkin,
} from "nodefony";

/** Fournisseur prêt à afficher : libellé, adresse d'autorisation, icône. */
export interface ILoginPageViewProvider {
  /** Ce que l'utilisateur lit : la marque d'un compte grand public, sinon « Compte de l'organisation ». */
  readonly label: string;
  /** Petite ligne sous le libellé (`SSO · Keycloak`), ou `null` pour une marque grand public. */
  readonly caption: string | null;
  readonly href: string;
  /** Symbole du sprite d'icônes (`i-key`, `m-github`), quand `image` est nulle. */
  readonly icon: string;
  /** Image réglée par l'application (`oauth2.providers.<nom>.icon`), ou `null`. */
  readonly image: string | null;
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
  /** Ligne sous le titre, ou `null` pour la phrase déduite des moyens proposés. */
  readonly subtitle: string | null;
  /** Panneau d'illustration : `null` = vitrine Nodefony, `false` = marque seule. */
  readonly hero: ILoginPageHero | false | null;
  /** Pied de page affiché ? */
  readonly footer: boolean;
  readonly logo: string;
  readonly skin: LoginPageSkin;
  readonly layout: LoginPageLayout;
  /** Fond de page décoré par l'habillage (`<body data-backdrop>`). */
  readonly backdrop: boolean;
  /** Thème imposé par `?theme=`, `null` = celui du système. */
  readonly theme: "light" | "dark" | null;
  /** Fournisseurs et passkey avant le formulaire (au moins l'un des deux proposé). */
  readonly ssoFirst: boolean;
  readonly password: boolean;
  /** Bouton passkey rendu (masqué tant que le script n'a pas constaté le navigateur). */
  readonly passkey: boolean;
  /**
   * Aucun moyen de connexion : ni formulaire, ni passkey, ni fournisseur
   * opérationnel. La page le dit au lieu de rendre une carte vide.
   */
  readonly empty: boolean;
  /** Ligne sous le titre : celle de la configuration, sinon déduite des moyens proposés. */
  readonly lead: string;
  readonly providers: readonly ILoginPageViewProvider[];
  /** Destination après connexion, déjà passée par `safeRedirectPath`. */
  readonly from: string;
  /**
   * Sélecteur d'aperçu (habillage, mise en page), ou `null` : rendu seulement
   * en développement ET quand `loginPage.previewPicker` le demande.
   */
  readonly picker: ILoginPagePicker | null;
  /**
   * Message d'échec d'une connexion par fournisseur (`?reason=` posé par le
   * callback OAuth), ou `null`. Texte FIXE : la raison reçue n'est jamais
   * affichée, et une annulation (`access_denied`) n'en produit aucun.
   */
  readonly notice: string | null;
  readonly styleHref: string;
  /** Feuille de l'habillage, chargée après {@link styleHref}, ou `null`. */
  readonly skinHref: string | null;
  /** Feuille de l'application, chargée après {@link styleHref}, ou `null`. */
  readonly stylesheetHref: string | null;
  readonly scriptHref: string;
  readonly logoHref: string;
  /** Nonce CSP de la requête, posé sur le `<script>`. */
  readonly nonce: string;
}

/** Le sélecteur d'aperçu : les choix possibles et ceux affichés. */
export interface ILoginPagePicker {
  readonly skins: readonly LoginPageSkin[];
  readonly layouts: readonly LoginPageLayout[];
  /** Chemin prévenu avant chaque rechargement (`loginPage.previewHook`), ou `null`. */
  readonly hook: string | null;
}

/** Ce que la requête apporte à la page. */
export interface ILoginPageRequest {
  /** Valeur brute de `?from=`. */
  readonly from: unknown;
  /** Valeur brute de `?theme=`. */
  readonly theme: unknown;
  /** Valeur brute de `?reason=`, posée par le callback OAuth sur un échec. */
  readonly reason?: unknown;
  /** Valeur brute de `?skin=`, lue seulement quand {@link preview} est vrai. */
  readonly skin?: unknown;
  /** Valeur brute de `?layout=`, lue seulement quand {@link preview} est vrai. */
  readonly layout?: unknown;
  /**
   * Aperçu autorisé (développement) : `?skin=` et `?layout=` remplacent la
   * configuration le temps de la requête. Faux en production, où ils sont ignorés.
   */
  readonly preview?: boolean;
  readonly nonce: string;
  /** Nom de l'application, quand la configuration ne donne pas de titre. */
  readonly projectName: string;
  /** Empreinte des fichiers servis, ajoutée à leur adresse (cache). */
  readonly assetsVersion: string;
}

/**
 * Mémoïse une ressource chargée de façon asynchrone : le SUCCÈS est gardé, un
 * ÉCHEC est oublié. Garder la promesse rejetée figerait la panne — la page
 * répondrait 500 jusqu'au redémarrage, même une fois le fichier corrigé.
 *
 * @param load - charge la ressource
 * @returns la fonction qui la rend, chargée une seule fois tant qu'elle réussit
 */
export function keepSuccess<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    }));
}

/** Feuille, script et logo de la page, servis sous {@link LOGIN_PAGE_ASSETS_BASE}. */
export const LOGIN_PAGE_ASSET_FILES = {
  style: "login.css",
  script: "login.js",
  logo: "nodefony-logo.svg",
} as const;

const DEFAULT_TITLE = "Se connecter";

/**
 * Fournisseurs dont la MARQUE est le mot que l'utilisateur connaît : il a un
 * compte GitHub, pas un « fournisseur OpenID Connect ». Tout autre fournisseur
 * est un serveur d'identité d'organisation (Keycloak, Okta, un OIDC
 * d'entreprise) dont le nom ne dit rien à qui se connecte.
 */
const PUBLIC_ACCOUNT_PROVIDERS: ReadonlySet<string> = new Set([
  "apple",
  "bitbucket",
  "discord",
  "facebook",
  "github",
  "gitlab",
  "google",
  "linkedin",
  "microsoft",
  "slack",
]);

/** Libellé d'un fournisseur d'organisation : ce qu'il ouvre, pas son logiciel. */
export const ORGANIZATION_ACCOUNT_LABEL = "Compte de l'organisation";

/** Annonce d'une page sans aucun moyen de connexion. */
export const LOGIN_PAGE_EMPTY_NOTICE =
  "Aucun moyen de connexion n'est disponible pour le moment. Prévenez l'administrateur du site.";

/**
 * Ligne sous le titre, déduite des moyens proposés quand la configuration n'en
 * donne pas : elle annonce ce que la carte contient, jamais autre chose.
 */
function leadFor(password: boolean, passkey: boolean, sso: boolean): string {
  if (password && sso) return "Compte de l'organisation ou identifiant local";
  if (password && passkey) return "Identifiant et mot de passe, ou passkey";
  if (password) return "Identifiant et mot de passe";
  if (sso) return "Avec le compte de votre organisation";
  if (passkey) return "Avec votre passkey";
  return "Aucun moyen de connexion disponible";
}

/** Annonce d'un retour du fournisseur sans connexion, hors annulation. */
const PROVIDER_FAILED_NOTICE =
  "La connexion par le fournisseur n'a pas abouti. Réessayez, ou choisissez une autre méthode.";

/** Dit si une valeur de requête nomme une mise en page connue. */
function isLayout(value: unknown): value is LoginPageLayout {
  return (LOGIN_PAGE_LAYOUTS as readonly unknown[]).includes(value);
}

/**
 * Habillage et mise en page servis : la configuration, sauf aperçu demandé en
 * développement. Un `?skin=` seul prend la mise en page de son habillage ; une
 * valeur inconnue est ignorée.
 */
function resolveSkin(
  page: ILoginPageDescription,
  request: ILoginPageRequest,
): { skin: LoginPageSkin; layout: LoginPageLayout } {
  if (request.preview !== true) {
    return { skin: page.skin, layout: page.layout };
  }
  const skin = isLoginPageSkin(request.skin) ? request.skin : page.skin;
  const layout = isLayout(request.layout)
    ? request.layout
    : skin === page.skin
      ? page.layout
      : LOGIN_PAGE_SKIN_SPECS[skin].layout;
  return { skin, layout };
}

/**
 * Prépare les données du gabarit à partir de la description de la page
 * (security) et de la requête.
 *
 * Fonction pure : `from` repasse par `safeRedirectPath` (un chemin hors de
 * l'origine retombe sur `/`), `theme` n'accepte que `light` ou `dark`,
 * `skin` et `layout` ne sont lus qu'en aperçu et contre leur liste fermée.
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
  const { skin, layout } = resolveSkin(page, request);
  const skinFile = loginPageSkinFile(skin);
  const sso = page.providers.length > 0;
  return {
    brand: page.title ?? request.projectName,
    title: page.heading ?? DEFAULT_TITLE,
    subtitle: page.subtitle,
    hero: page.hero,
    footer: page.footer,
    logo: page.logo ?? logoHref,
    skin,
    layout,
    backdrop: LOGIN_PAGE_SKIN_SPECS[skin].backdrop,
    theme:
      request.theme === "light" || request.theme === "dark"
        ? request.theme
        : null,
    ssoFirst: page.providersFirst && (sso || page.passkey),
    password: page.password,
    passkey: page.passkey,
    empty: !page.password && !page.passkey && !sso,
    lead: page.subtitle ?? leadFor(page.password, page.passkey, sso),
    providers: page.providers.map(({ name, label, icon }) => ({
      // Le nom du logiciel (et le sigle SSO) reste lisible, en petit, pour
      // qui le connaît ; le mot principal est celui de l'utilisateur.
      ...(PUBLIC_ACCOUNT_PROVIDERS.has(name.toLowerCase())
        ? { label, caption: null }
        : { label: ORGANIZATION_ACCOUNT_LABEL, caption: `SSO · ${label}` }),
      // `back` = cette page : un « Retour » chez le fournisseur ramène ici,
      // quelle que soit l'adresse d'échec configurée (Studio en a une autre).
      href: oauth2AuthorizePath(name, providerFrom, page.path),
      icon: name === "github" ? "m-github" : "i-key",
      image: icon,
    })),
    from,
    picker:
      request.preview === true && page.previewPicker
        ? {
            skins: LOGIN_PAGE_SKINS,
            layouts: LOGIN_PAGE_LAYOUTS,
            hook: page.previewHook ?? null,
          }
        : null,
    notice:
      typeof request.reason === "string" &&
      request.reason.length > 0 &&
      request.reason !== OAUTH2_CANCELLED_REASON
        ? PROVIDER_FAILED_NOTICE
        : null,
    styleHref: asset(LOGIN_PAGE_ASSET_FILES.style),
    skinHref: skinFile === null ? null : asset(skinFile),
    stylesheetHref: page.stylesheet,
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
 * Tout passe par `<%= %>` (échappé) ; aucune sortie brute. L'icône
 * d'empreinte (`i-finger`) reprend `IconFingerprint` de Tabler Icons (MIT),
 * celle du bouton de Studio : les deux écrans montrent le même geste.
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
<% if (!it.theme) { %>
    <script nonce="<%= it.nonce %>">try{var t=localStorage.getItem("${LOGIN_PAGE_THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<% } %>
    <link rel="stylesheet" href="<%= it.styleHref %>" />
<% if (it.skinHref) { %>
    <link rel="stylesheet" href="<%= it.skinHref %>" />
<% } %>
<% if (it.stylesheetHref) { %>
    <link rel="stylesheet" href="<%= it.stylesheetHref %>" />
<% } %>
    <script type="module" src="<%= it.scriptHref %>" nonce="<%= it.nonce %>"></script>
  </head>
  <body data-skin="<%= it.skin %>" data-layout="<%= it.layout %>"<% if (it.backdrop) { %> data-backdrop<% } %><% if (it.ssoFirst) { %> data-sso-first<% } %>>
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="3.8" /><path d="M10.8 12.2 19.5 3.5M16.5 6.5l2.5 2.5M14 9l2 2" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></symbol>
      <symbol id="i-finger" viewBox="0 0 24 24"><path d="M18.9 7a8 8 0 0 1 1.1 5v1a6 6 0 0 0 .8 3" /><path d="M8 11a4 4 0 0 1 8 0v1a10 10 0 0 0 2 6" /><path d="M12 11v2a14 14 0 0 0 2.5 8" /><path d="M8 15a18 18 0 0 0 1.8 6" /><path d="M4.9 19a22 22 0 0 1-.9-7v-1a8 8 0 0 1 12-6.95" /></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z" /></symbol>
      <symbol id="m-github" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></symbol>
    </svg>
    <header class="nf-strip">
      <div class="nf-strip-brand"><img class="nf-logo" src="<%= it.logo %>" alt="" /><%= it.brand %></div>
    </header>
    <div class="nf-layout">
      <aside class="nf-hero" aria-hidden="true">
        <div class="nf-hero-brand"><img class="nf-logo" src="<%= it.logo %>" alt="" /><%= it.brand %></div>
<% if (it.hero === null) { %>
        <div class="nf-home">
          <img
            class="nf-home-logo"
            src="<%= it.logoHref %>"
            alt=""
          />
          <h2>Le framework Node.js fullstack</h2>
          <p class="sub">
            Temps réel natif · développement agentic-ready · socle TypeScript
            isomorphe
          </p>
          <p class="sig">
            Une action de contrôleur. Deux transports. La même session, la même
            sécurité, le même code.
          </p>
          <ul class="badges">
            <li class="agentic">Agentic ready</li>
            <li>Node.js ≥ 24</li>
            <li>TypeScript strict</li>
            <li>ESM only</li>
            <li>Licence Apache 2.0</li>
          </ul>
          <div
            class="install"
            role="img"
            aria-label="Commande d'installation : npx nodefony create app"
          >
            <span class="p">$</span><span>npx nodefony create app</span>
          </div>
          <div class="features">
            <div class="feature">
              <span class="ic"
                ><svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polygon
                    points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
                  /></svg
              ></span>
              <h3>Temps réel natif</h3>
              <p>
                Le WebSocket n'est pas un ajout : même pipeline, même table de
                routes, même sécurité que le HTTP.
              </p>
            </div>
            <div class="feature">
              <span class="ic"
                ><svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" /></svg
              ></span>
              <h3>Sécurité par conception</h3>
              <p>
                Pare-feu applicatif par zones, Zero Trust, CSRF Fetch Metadata,
                sessions hybrides, WebAuthn.
              </p>
            </div>
            <div class="feature">
              <span class="ic"
                ><svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" /></svg
              ></span>
              <h3>DI & modules</h3>
              <p>
                Injection de dépendances par décorateurs, modules autonomes,
                configuration validée au boot.
              </p>
            </div>
            <div class="feature">
              <span class="ic"
                ><svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path
                    d="M3 12h18M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.7-4-9s1.5-6.4 4-9z"
                  /></svg
              ></span>
              <h3>Socle isomorphe</h3>
              <p>
                Le même paquet côté serveur et côté navigateur : client temps
                réel, règles et types écrits une fois.
              </p>
            </div>
          </div>
        </div>
        <small>Propulsé par Nodefony</small>
<% } else if (it.hero) { %>
        <div class="nf-home">
          <h2><%= it.hero.heading %></h2>
<% if (it.hero.text) { %>
          <p class="sub"><%= it.hero.text %></p>
<% } %>
        </div>
<% } %>
      </aside>
      <main class="nf-stage" data-nf-login data-from="<%= it.from %>">
        <button type="button" class="nf-theme" data-theme-toggle aria-label="Basculer entre thème clair et thème sombre"><svg class="nf-icon t-sun" aria-hidden="true"><use href="#i-sun" /></svg><svg class="nf-icon t-moon" aria-hidden="true"><use href="#i-moon" /></svg></button>
        <section class="nf-card" aria-labelledby="nf-title">
          <div class="nf-head">
            <div class="nf-brand"><img class="nf-logo" src="<%= it.logo %>" alt="" /><%= it.brand %></div>
            <h1 id="nf-title"><%= it.title %></h1>
            <p class="nf-sub" id="nf-sub"><%= it.lead %></p>
          </div>
          <div class="nf-body">
<% if (it.password) { %>
            <ol class="nf-steps" aria-label="Étapes">
              <li data-tab="identifier" aria-current="step">Identifiant</li>
              <li data-tab="password">Mot de passe</li>
              <li data-tab="mfa" hidden>Vérification</li>
            </ol>
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
              <!-- Compte de l'étape précédente, masqué : le gestionnaire de mots de passe
                   associe le mot de passe à CE compte (HTML, jeton « username »). -->
              <input name="username" autocomplete="username" hidden readonly tabindex="-1" />
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
<% } %>
<% if (it.password || it.passkey) { %>
            <div data-step="authenticated" hidden>
              <div class="nf-done" role="status">
                <span class="ring" aria-hidden="true"><svg class="nf-icon"><use href="#i-check" /></svg></span>
                <strong>Session ouverte</strong><span class="dest"></span>
                <span class="nf-progress" aria-hidden="true"><span></span></span>
              </div>
            </div>
<% } %>
<% if (it.providers.length > 0 || it.passkey) { %>
            <div data-alt>
<% if (it.password) { %>
              <div class="nf-or">ou</div>
<% } %>
              <div class="nf-alt">
<% if (it.passkey) { %>
                <button type="button" class="nf-btn span" data-passkey hidden><svg class="nf-icon" aria-hidden="true"><use href="#i-finger" /></svg>Passkey / empreinte digitale</button>
<% } %>
<% it.providers.forEach(function (provider) { %>
                <a class="nf-btn" href="<%= provider.href %>"><% if (provider.image) { %><img class="nf-icon" src="<%= provider.image %>" alt="" /><% } else { %><svg class="<%= provider.icon === 'm-github' ? 'nf-mark' : 'nf-icon' %>" aria-hidden="true"><use href="#<%= provider.icon %>" /></svg><% } %><% if (provider.caption) { %><span class="nf-label"><%= provider.label %><small><%= provider.caption %></small></span><% } else { %><%= provider.label %><% } %></a>
<% }) %>
              </div>
            </div>
<% } %>
            <div class="nf-message" aria-live="polite" data-message><% if (it.empty) { %><p class="nf-alert" role="alert"><span class="code">—</span><span>${LOGIN_PAGE_EMPTY_NOTICE}</span></p><% } else if (it.notice) { %><p class="nf-alert" role="alert"><span class="code">SSO</span><span><%= it.notice %></span></p><% } %></div>
<% if (it.password || it.passkey) { %>
            <noscript><p class="nf-hint">Cette page a besoin de JavaScript pour vous connecter.</p></noscript>
<% } %>
          </div>
        </section>
<% if (it.picker) { %>
        <form class="nf-picker" method="get" data-preview-picker<% if (it.picker.hook) { %> data-preview-hook="<%= it.picker.hook %>"<% } %> aria-label="Aperçu de la page (développement)">
          <input type="hidden" name="from" value="<%= it.from %>" />
          <label>Habillage <select name="skin"><% it.picker.skins.forEach(function (skin) { %><option value="<%= skin %>"<% if (skin === it.skin) { %> selected<% } %>><%= skin %></option><% }) %></select></label>
          <label>Mise en page <select name="layout"><% it.picker.layouts.forEach(function (layout) { %><option value="<%= layout %>"<% if (layout === it.layout) { %> selected<% } %>><%= layout %></option><% }) %></select></label>
          <noscript><button type="submit">Appliquer</button></noscript>
        </form>
<% } %>
<% if (it.footer) { %>
        <div class="nf-foot">
          <ul class="nf-facts" aria-label="Protection de la session">
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield" /></svg>cookie HttpOnly</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield" /></svg>anti-CSRF</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield" /></svg>CSP stricte</li>
          </ul>
          <a class="nf-powered" href="https://github.com/nodefony/nodefony-core" rel="noopener noreferrer"><img class="nf-logo nf-logo-mono" src="<%= it.logoHref %>" alt="" />Propulsé par Nodefony</a>
        </div>
<% } %>
      </main>
    </div>
  </body>
</html>
`;
