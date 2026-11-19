/**
 * Les textes de l'accueil en DÉVELOPPEMENT : la présentation du framework, les
 * liens vers la console et la documentation, le compte de ton poste, et où
 * personnaliser la page.
 *
 * Données pures, sans dépendance au moteur de rendu : la même source sert la
 * page<% if (it.front) { %> du front (par `devHome.ts`, qui les retire du build de production)<% } else { %> rendue par le serveur (`homePage.ts`, en développement seulement)<% } %>.
 *
 * C'est TA page : retire ce fichier (et ses usages) quand tu n'en as plus
 * besoin.
 */

/** Un fragment de texte de l'accueil : du texte simple, ou du code. */
export interface IHomeText {
  readonly text: string;
  readonly code: boolean;
}

/** Une carte de l'accueil, lien ou non. */
export interface IHomeCard {
  readonly title: string;
  readonly text: readonly IHomeText[];
  /** Adresse si la carte est un lien, sinon `null`. */
  readonly href: string | null;
  /** Invitation affichée au pied d'une carte-lien (« Ouvrir /nodefony → »). */
  readonly go: string | null;
  /** Identifiant et mot de passe à recopier (`null` = mot de passe inconnu ici). */
  readonly creds: {
    readonly user: string;
    readonly password: string | null;
  } | null;
  /** Teinte de la carte : `safe` = la garantie de production, en vert. */
  readonly tone: "safe" | null;
  /**
   * Sélecteur d'habillages de la page de connexion : un formulaire `GET` vers
   * `action`, qui marche sans JavaScript. `null` = pas de sélecteur.
   */
  readonly skins: {
    readonly action: string;
    readonly options: readonly string[];
    readonly selected: string;
  } | null;
}

/** Une section de l'accueil : un titre, une accroche, des cartes. */
export interface IHomeSection {
  readonly id: string;
  readonly kicker: string;
  readonly title: string;
  readonly intro: string;
  /** `true` = bande pleine largeur, sur le fond adouci. */
  readonly band: boolean;
  readonly cards: readonly IHomeCard[];
  readonly note: string | null;
}

/** Tout le contenu de développement de l'accueil. */
export interface IHomeContent {
  /** Console d'administration, ou `null` quand l'application n'en a pas. */
  readonly console: { readonly label: string; readonly href: string } | null;
  /** Liens qui SORTENT de l'application (documentation, sources). */
  readonly external: readonly {
    readonly label: string;
    readonly href: string;
  }[];
  /** Le bouton de la démo, montré seulement si elle est chargée. */
  readonly demoLabel: string;
  readonly hero: {
    /** Le premier badge, mis en avant. */
    readonly lead: string;
    readonly title: string;
    readonly sub: string;
    readonly sig: string;
    readonly badges: readonly string[];
    readonly install: { readonly command: string; readonly arg: string };
  };
  readonly sections: readonly IHomeSection[];
}

/**
 * Compose un texte d'accueil : les valeurs interpolées deviennent du code.
 * rich`Celui de l'onglet : ${"public/favicon.ico"}.`
 */
function rich(
  strings: TemplateStringsArray,
  ...codes: readonly string[]
): IHomeText[] {
  const out: IHomeText[] = [];
  strings.forEach((text, i) => {
    if (text !== "") out.push({ text, code: false });
    const code = codes[i];
    if (code !== undefined) out.push({ text: code, code: true });
  });
  return out;
}

/**
 * Le contenu de développement de l'accueil. Une FONCTION, pas une constante :
 * jamais appelée, elle disparaît du bundle de production avec tout ce qu'elle
 * porte — mot de passe compris.
 *
 * @returns un contenu neuf à chaque appel
 */
export function homeContent(): IHomeContent {
  return {
    console: <%= it.complete ? '{ label: "Console", href: "/nodefony" }' : "null" %>,
    external: [
      { label: "Documentation", href: "https://nodefony.net/" },
      { label: "GitHub", href: "https://github.com/nodefony/nodefony-core" },
    ],
    demoLabel: "Voir les démos",
    hero: {
      lead: "Agentic ready",
      title: "Le framework Node.js fullstack",
      sub: "Temps réel natif · développement agentic-ready · socle TypeScript isomorphe",
      sig: "Une action de contrôleur. Deux transports. La même session, la même sécurité, le même code.",
      badges: [
        "Node.js <%= it.nodeRange %>",
        "TypeScript strict",
        "ESM only",
        "Licence Apache 2.0",
      ],
      install: { command: "<%= it.installCommand %>", arg: "mon-app" },
    },
    sections: [
<% if (it.complete) { %>      {
        id: "nf-start",
        kicker: "Développement",
        title: "Pour commencer",
        intro: "Le compte de ton poste et la console d'administration.",
        band: true,
        cards: [
          {
            title: "Compte de développement",
<% if (it.devAdminPassword) { %>            text: rich`Défini dans ${"nodefony/security/provisionUsers.ts"}, tiré au hasard pour cette application. Créé au premier démarrage — si ${"NF_ADMIN_PASSWORD"} figurait alors dans ${".env"}, c'est lui le mot de passe.`,
            creds: { user: "admin", password: "<%= it.devAdminPassword %>" },
<% } else { %>            text: rich`Son mot de passe est ${"DEV_ADMIN_PASSWORD"} dans ${"nodefony/security/provisionUsers.ts"}, tiré au hasard à la création de l'application — sauf si ${"NF_ADMIN_PASSWORD"} figurait dans ${".env"} au premier démarrage.`,
            creds: { user: "admin", password: null },
<% } %>            href: null,
            go: null,
            tone: null,
            skins: null,
          },
          {
            title: "Console d'administration",
            text: rich`L'état réel de l'application : routes, services, configuration effective, journal.`,
            href: "/nodefony",
            go: "Ouvrir /nodefony →",
            creds: null,
            tone: null,
            skins: null,
          },
          {
            title: "En production",
            text: rich`Aucun mot de passe par défaut (staging compris) : ${"admin"} n'est créé que si ${"NF_ADMIN_PASSWORD"} est posé. Sans lui, aucun compte — un avertissement au démarrage renvoie à ${"npx nodefony security:user:add admin --admin"}. Le démarrage n'est jamais bloqué.`,
            href: null,
            go: null,
            creds: null,
            tone: "safe",
            skins: null,
          },
        ],
        note: null,
      },
<% } %>      {
        id: "nf-custom",
        kicker: "Personnaliser",
        title: "C'est ta page",
        intro: "Où changer l'accueil, la marque<%= it.complete ? ' et la page de connexion' : '' %>.",
        band: false,
        cards: [
          {
            title: "Accueil",
<% if (it.front) { %>            text: rich`${"<%= it.front.pageFile %>"} pour le contenu, ${"frontend/src/showcase.css"} pour le style, ${"frontend/src/homeContent.ts"} pour ces sections de développement.`,
<% } else { %>            text: rich`${"nodefony/home/homePage.ts"} pour le contenu, ${"public/showcase.css"} pour le style, ${"nodefony/home/homeContent.ts"} pour ces sections de développement.`,
<% } %>            href: null,
            go: null,
            creds: null,
            tone: null,
            skins: null,
          },
          {
            title: "Logo",
<% if (it.front) { %>            text: rich`Celui de la page : ${"frontend/src/brand.ts"}. Celui de l'onglet : ${"public/favicon.ico"}.`,
<% } else { %>            text: rich`Celui de la page : ${"public/nodefony-logo.png"}. Celui de l'onglet : ${"public/favicon.ico"}.`,
<% } %>            href: null,
            go: null,
            creds: null,
            tone: null,
            skins: null,
          },
<% if (it.complete) { %>          {
            title: "Page de connexion",
            text: rich`${"loginPage"} dans ${"nodefony/config/security.ts"} : ${"title"}, ${"logo"}, ${"stylesheet"}, ${"skin"}. Choisis un habillage pour le voir :`,
            href: null,
            go: null,
            creds: null,
            tone: null,
            skins: {
              action: "<%= it.loginPage.path %>",
              options: [
<% for (const skin of it.loginPage.skins) { %>                <%= JSON.stringify(skin) %>,
<% } %>              ],
              selected: "horizon",
            },
          },
<% } %>        ],
<% if (it.front) { %>        note: "Ces sections n'existent qu'en développement : le build de production les retire.",
<% } else { %>        note: "Ces sections n'existent qu'en développement : le serveur ne les rend pas en production.",
<% } %>      },
    ],
  };
}
