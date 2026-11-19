/**
 * Ce que l'accueil montre en DÉVELOPPEMENT seulement : la présentation du
 * framework, les liens vers la console et la documentation, le compte de ton
 * poste, et où personnaliser la page.
 *
 * 🔴 La garde est ICI, sur les données, et pas dans la page : `DEV_HOME` vaut
 * `null` dès que Vite construit pour la production (`import.meta.env.DEV` est
 * remplacé par `false`), et le minifieur retire alors tout l'objet — textes,
 * liens et mot de passe compris. Une garde posée dans le gabarit de la page ne
 * suffirait pas : Vue et Angular compilent les textes de leurs gabarits dans le
 * bundle, qu'ils soient affichés ou non.
 *
 * C'est TA page : retire ce fichier (et ses usages dans la page) quand tu n'en
 * as plus besoin.
 */
<%= it.front.badge.versionImport %>

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
export interface IDevHome {
  /** Console d'administration, ou `null` quand l'application n'en a pas. */
  readonly console: { readonly label: string; readonly href: string } | null;
  /** Liens qui SORTENT de l'application (documentation, sources). */
  readonly external: readonly {
    readonly label: string;
    readonly href: string;
  }[];
  /** Le bouton de la démo, montré seulement si elle est chargée (`findDemo`). */
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
  /** Le front de cette page : nom, version lue à l'exécution, logo. */
  readonly front: {
    readonly name: string;
    readonly version: string;
    readonly logo: string;
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

/** Contenu de développement de l'accueil — `null` en production. */
export const DEV_HOME: IDevHome | null = import.meta.env.DEV
  ? {
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
      front: {
        name: "<%= it.front.badge.name %>",
        version: <%= it.front.badge.versionExpr %>,
        logo: "<%= it.front.badge.logo %>",
      },
      sections: [
<% if (it.complete) { %>        {
          id: "nf-start",
          kicker: "Développement",
          title: "Pour commencer",
          intro: "Le compte de ton poste et la console d'administration.",
          band: true,
          cards: [
            {
              title: "Compte de développement",
<% if (it.devAdminPassword) { %>              text: rich`Défini dans ${"nodefony/security/provisionUsers.ts"}, tiré au hasard pour cette application. Créé au premier démarrage — si ${"NF_ADMIN_PASSWORD"} figurait alors dans ${".env"}, c'est lui le mot de passe.`,
              creds: { user: "admin", password: "<%= it.devAdminPassword %>" },
<% } else { %>              text: rich`Son mot de passe est ${"DEV_ADMIN_PASSWORD"} dans ${"nodefony/security/provisionUsers.ts"}, tiré au hasard à la création de l'application — sauf si ${"NF_ADMIN_PASSWORD"} figurait dans ${".env"} au premier démarrage.`,
              creds: { user: "admin", password: null },
<% } %>              href: null,
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
<% } %>        {
          id: "nf-custom",
          kicker: "Personnaliser",
          title: "C'est ta page",
          intro: "Où changer l'accueil, la marque<%= it.complete ? ' et la page de connexion' : '' %>.",
          band: false,
          cards: [
            {
              title: "Accueil",
              text: rich`${"<%= it.front.pageFile %>"} pour le contenu, ${"frontend/src/showcase.css"} pour le style, ${"frontend/src/devHome.ts"} pour ces sections de développement.`,
              href: null,
              go: null,
              creds: null,
              tone: null,
              skins: null,
            },
            {
              title: "Logo",
              text: rich`Celui de la page : ${"frontend/src/brand.ts"}. Celui de l'onglet : ${"public/favicon.ico"}.`,
              href: null,
              go: null,
              creds: null,
              tone: null,
              skins: null,
            },
<% if (it.complete) { %>            {
              title: "Page de connexion",
              text: rich`${"loginPage"} dans ${"nodefony/config/security.ts"} : ${"title"}, ${"logo"}, ${"stylesheet"}, ${"skin"}. Choisis un habillage pour le voir :`,
              href: null,
              go: null,
              creds: null,
              tone: null,
              skins: {
                action: "<%= it.loginPage.path %>",
                options: [
<% for (const skin of it.loginPage.skins) { %>                  <%= JSON.stringify(skin) %>,
<% } %>                ],
                selected: "horizon",
              },
            },
<% } %>          ],
          note: "Ces sections n'existent qu'en développement : le build de production les retire.",
        },
      ],
    }
  : null;
