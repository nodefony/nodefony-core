/**
 * Offsets de mise en page Studio — SOURCE DE VÉRITÉ UNIQUE.
 *
 * Tout dérive des variables CSS du shell (header global + barre debug) — JAMAIS
 * de « magic number » (250px, 110px…) dispersé dans les pages. Modèle docs-site :
 * un seul scroll de page (le contenu), des panneaux latéraux STICKY pleine
 * hauteur avec leur propre overflow.
 *
 * Règle absolue : tout `calc(100vh - …)` DOIT soustraire `--nodefony-debugbar-height`,
 * sinon la debug bar recouvre les widgets pleine hauteur. Aucun nouveau `calc(100vh)`
 * en dehors de ce fichier.
 */
const HEADER = "var(--app-shell-header-height, 56px)";
const DEBUGBAR = "var(--nodefony-debugbar-height, 0px)";
const GAP = "var(--mantine-spacing-md, 16px)";
/**
 * Hauteur RÉELLE du PageHeader sticky — publiée par `<PageHeader sticky>` via
 * `ResizeObserver` dans `--nf-pageheader-height`. Fallback `76px` quand pas de
 * PageHeader sticky monté (ex. mode container, page sans PageHeader).
 *
 * Pourquoi DYNAMIQUE : le PageHeader peut faire 76 / 88 / 100 px selon son
 * subtitle (texte court vs Group complexe avec Code + Badge). Une constante
 * fixe laisse un trou visible (quelques px de contenu glisse SOUS le
 * PageHeader avant que les sticky en aval ne coupent). Calc en var = pixel-perfect.
 */
const PAGE_HEADER = "var(--nf-pageheader-height, 76px)";
/** Hauteur typique d'une bande de toolbar / filtres ou d'un strip Tabs.List sticky. */
const BAND = "48px";
/** Hauteur de la topbar d'un Modal Mantine fullScreen (titre + paddings). */
const MODAL_HEADER = "60px";

/**
 * Top d'un élément collé sous le header global. Avec le scroll INTERNE à
 * `AppShell.Main` (cf AdminLayout 2026-05-28), le scroll-ancestor commence
 * SOUS l'AppShell.Header → `top: 0` colle pile à la frontière, pas besoin
 * d'ajouter `HEADER`.
 */
export const STICKY_TOP = "0px";

/**
 * Top d'un panneau sticky placé SOUS un PageHeader lui-même sticky. Le
 * PageHeader occupe les premiers `PAGE_HEADER` px du Main scrollable.
 *
 * ⚠️ **Ne PAS y ajouter de marge de respiration.** Essayé, et rejeté : décaler
 * les panneaux de `GAP` ouvre entre l'en-tête et eux une bande où le corps de la
 * page défile À NU — l'en-tête ne peint que sa propre hauteur, et le texte passe
 * visiblement dessous. L'air sous l'en-tête est l'affaire du PageHeader (son
 * fond, sa hauteur), pas du décalage de ce qui le suit.
 */
export const CONTENT_STICKY_TOP = PAGE_HEADER;

/** Hauteur max d'un panneau latéral sticky (sidebar nav / sommaire). */
export const SIDEBAR_MAX_HEIGHT = `calc(100dvh - ${HEADER} - ${PAGE_HEADER} - ${DEBUGBAR} - ${GAP} * 2)`;

/**
 * Marge d'ancre : un titre cible ne passe pas sous l'en-tête sticky au saut.
 * Suffit de couvrir le PageHeader (le scroll-ancestor commence déjà sous le
 * Header global).
 */
export const HEADING_SCROLL_MARGIN = `calc(${PAGE_HEADER} + ${GAP} * 2)`;

/**
 * Contenu plein viewport sous un PageHeader sticky (Card mih, panel principal).
 * Alias sémantique de `SIDEBAR_MAX_HEIGHT` — sidebar et contenu partagent la même
 * enveloppe verticale en mode docs-site.
 */
export const PAGE_CONTENT_HEIGHT = SIDEBAR_MAX_HEIGHT;

/**
 * Contenu plein viewport sous PageHeader + UNE bande supplémentaire (toolbar
 * de recherche d'un DataGrid, bande de filtres modules d'un ERD…).
 */
export const PAGE_CONTENT_HEIGHT_WITH_BAND = `calc(100dvh - ${HEADER} - ${PAGE_HEADER} - ${BAND} - ${DEBUGBAR} - ${GAP} * 2)`;

/**
 * Contenu sous PageHeader + Tabs.List sticky DANS une Card paddée (Tabs.Panel
 * à scroll interne). Comprend les paddings supplémentaires de la Card.
 */
export const TABS_PANEL_HEIGHT = `calc(100dvh - ${HEADER} - ${PAGE_HEADER} - ${BAND} - ${DEBUGBAR} - ${GAP} * 4)`;

/**
 * Body d'un Modal Mantine fullScreen (sous la topbar du Modal).
 *
 * Soustrait la barre de débogage comme TOUS les autres tokens de cette table :
 * elle est posée en bas de l'écran quel que soit le contexte, plein écran
 * compris, et une hauteur qui l'ignore fait passer le dernier panneau dessous.
 * `dvh` et non `vh` — même raison que les autres : sur mobile, la barre d'adresse
 * escamotable rend `vh` faux.
 */
export const MODAL_FULLSCREEN_BODY = `calc(100dvh - ${MODAL_HEADER} - ${DEBUGBAR})`;

/** Contenu DANS un Modal fullScreen, avec un peu de respiration. */
export const MODAL_FULLSCREEN_CONTENT = `calc(100dvh - ${MODAL_HEADER} - ${DEBUGBAR} - ${GAP} * 2)`;
